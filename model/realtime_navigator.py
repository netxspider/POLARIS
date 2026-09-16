# /Users/arnavraj/POLARIS/model/realtime_navigator.py
import os
import argparse

# 1. Environment thread overrides (MUST be at the very top to prevent macOS OpenMP segfaults)
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"

import sys
import json
import heapq
import pickle
import joblib
import numpy as np
import pandas as pd
import rasterio
import requests
import torch
import torch.nn as nn
import torch.nn.functional as F
from math import radians, cos, sin, asin, sqrt, atan2, degrees
from datetime import datetime, timezone

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))

MODEL_LAT_PATH = os.path.join(CURRENT_DIR, "engine2_drift_lat_xgb.pkl")
MODEL_LON_PATH = os.path.join(CURRENT_DIR, "engine2_drift_lon_xgb.pkl")
BEST_CONVLSTM_PATH = os.path.join(CURRENT_DIR, "best_seaice_convlstm.pth")
BATHY_PATH = os.path.join(ROOT_DIR, "IBCSO_bed.tif")
NPZ_DATA_PATH = os.path.join(ROOT_DIR, "polaris_engine1_dataset.npz")
CACHE_DIR = os.path.join(CURRENT_DIR, "live_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

LAT_NORTH, LAT_SOUTH = -50.0, -80.0
LON_WEST, LON_EAST = 0.0, 90.0

# =========================================================================
# ADJUST RESOLUTION HERE (Change to 256, 256 or 128, 128 as desired)
# =========================================================================
GRID_H, GRID_W = 256, 256

CRUISE_SPEED_KTS = 14.0
ICEBERG_BUFFER_NMI = 6.0
GROUNDING_DEPTH_M = -25.0

device = torch.device("cpu")

# ==========================================
# 2. GEODETIC & COORDINATE CONVERSIONS
# ==========================================
def haversine_nmi(lat1, lon1, lat2, lon2):
    r_lat1, r_lon1, r_lat2, r_lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = r_lat2 - r_lat1, r_lon2 - r_lon1
    a = sin(dlat / 2.0)**2 + cos(r_lat1) * cos(r_lat2) * sin(dlon / 2.0)**2
    return 2.0 * 6371.0 * asin(sqrt(a)) / 1.852

def calculate_bearing(lat1, lon1, lat2, lon2):
    r_lat1, r_lon1, r_lat2, r_lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlon = r_lon2 - r_lon1
    x = sin(dlon) * cos(r_lat2)
    y = cos(r_lat1) * sin(r_lat2) - sin(r_lat1) * cos(r_lat2) * cos(dlon)
    return (degrees(atan2(x, y)) + 360) % 360

def coord_to_grid(lat, lon):
    r = int(np.clip(np.floor((LAT_NORTH - lat) / (LAT_NORTH - LAT_SOUTH) * GRID_H), 0, GRID_H - 1))
    c = int(np.clip(np.floor((lon - LON_WEST) / (LON_EAST - LON_WEST) * GRID_W), 0, GRID_W - 1))
    return r, c

def grid_to_coord(r, c):
    lat = LAT_NORTH - (r / (GRID_H - 1)) * (LAT_NORTH - LAT_SOUTH)
    lon = LON_WEST + (c / (GRID_W - 1)) * (LON_EAST - LON_WEST)
    return lat, lon

# ==========================================
# 3. LIVE ICEBERG INGESTION (USNIC)
# ==========================================
def fetch_live_usnic_icebergs():
    url = "https://usicecenter.gov/File/DownloadCurrentIcebergCsv"
    target_csv = os.path.join(CACHE_DIR, "live_icebergs.csv")
    try:
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200 and len(resp.content) > 100:
            with open(target_csv, "wb") as f:
                f.write(resp.content)
            print("  [Live Feed] Fetched active USNIC icebergs.")
    except Exception:
        print("  [Offline] Network unavailable. Using cached/synthetic iceberg stream.")

    active_corridor_bergs = {}
    if os.path.exists(target_csv):
        try:
            df = pd.read_csv(target_csv)
            df.columns = [c.lower().strip() for c in df.columns]
            lat_col = [c for c in df.columns if "lat" in c][0]
            lon_col = [c for c in df.columns if "lon" in c][0]
            id_col = [c for c in df.columns if any(k in c for k in ["iceberg", "name", "id"])][0]
            for _, row in df.iterrows():
                try:
                    lat, lon = float(row[lat_col]), float(row[lon_col])
                    if LAT_SOUTH <= lat <= LAT_NORTH and LON_WEST <= lon <= LON_EAST:
                        active_corridor_bergs[str(row[id_col])] = (lat, lon)
                except Exception:
                    continue
        except Exception:
            pass

    if not active_corridor_bergs:
        active_corridor_bergs = {
            "A-68A_Tracked": (-62.5, 42.0),
            "B-15Y_Tracked": (-64.8, 55.2),
            "D-28_Calf": (-66.1, 70.4)
        }
    return active_corridor_bergs

# ==========================================
# 4. BATHYMETRY MASK LOADER
# ==========================================
def load_bathymetry_mask(bathy_path):
    mask = np.zeros((GRID_H, GRID_W), dtype=bool)
    if os.path.exists(bathy_path):
        try:
            with rasterio.open(bathy_path) as src:
                # IBCSO is commonly distributed in a polar stereographic CRS;
                # convert WGS84 route coordinates before sampling the raster.
                from rasterio.warp import transform
                route_lats = []
                route_lons = []
                for r in range(GRID_H):
                    for c in range(GRID_W):
                        lat, lon = grid_to_coord(r, c)
                        route_lats.append(lat)
                        route_lons.append(lon)
                xs, ys = transform("EPSG:4326", src.crs, route_lons, route_lats)
                for r in range(GRID_H):
                    for c in range(GRID_W):
                        index = r * GRID_W + c
                        row, col = src.index(xs[index], ys[index])
                        if not (0 <= row < src.height and 0 <= col < src.width):
                            mask[r, c] = True
                            continue
                        val = src.read(1, window=((row, row + 1), (col, col + 1)))[0, 0]
                        if val != src.nodata and val > GROUNDING_DEPTH_M:
                            mask[r, c] = True
            return mask
        except Exception:
            pass
    # Shelf fallback scaled to dynamic GRID_H
    margin_row = int(GRID_H * 0.90)
    mask[margin_row:, :] = True
    return mask

# ==========================================
# 5. ENGINE 1: CONVLSTM ARCHITECTURE
# ==========================================
class ConvLSTMCell(nn.Module):
    def __init__(self, in_channels, hidden_channels, kernel_size=3):
        super().__init__()
        self.hidden_channels = hidden_channels
        self.conv = nn.Conv2d(in_channels + hidden_channels, 4 * hidden_channels, kernel_size, padding=kernel_size//2, bias=False)
        self.norm = nn.GroupNorm(num_groups=4, num_channels=4 * hidden_channels)

    def forward(self, x, state):
        h, c = state
        gates = self.norm(self.conv(torch.cat([x, h], dim=1)))
        i, f, o, g = torch.split(gates, self.hidden_channels, dim=1)
        c_next = torch.sigmoid(f) * c + torch.sigmoid(i) * torch.tanh(g)
        h_next = torch.sigmoid(o) * torch.tanh(c_next)
        return h_next, c_next

class PolarSeaIceConvLSTM(nn.Module):
    def __init__(self, in_channels=6, hidden_dim=48, out_timesteps=3):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.out_timesteps = out_timesteps

        self.enc_cell1 = ConvLSTMCell(in_channels, hidden_dim)
        self.enc_cell2 = ConvLSTMCell(hidden_dim, hidden_dim)

        self.dec_cell1 = ConvLSTMCell(hidden_dim, hidden_dim)
        self.dec_cell2 = ConvLSTMCell(hidden_dim, hidden_dim)

        self.prediction_head = nn.Sequential(
            nn.Conv2d(hidden_dim, 32, kernel_size=3, padding=1),
            nn.LeakyReLU(0.1, inplace=True),
            nn.Conv2d(32, 1, kernel_size=1),
            nn.Sigmoid()
        )

    def forward(self, x):
        b, t_in, _, h, w = x.shape
        h1 = torch.zeros(b, self.hidden_dim, h, w, device=x.device)
        c1 = torch.zeros(b, self.hidden_dim, h, w, device=x.device)
        h2 = torch.zeros(b, self.hidden_dim, h, w, device=x.device)
        c2 = torch.zeros(b, self.hidden_dim, h, w, device=x.device)

        for t in range(t_in):
            h1, c1 = self.enc_cell1(x[:, t], (h1, c1))
            h2, c2 = self.enc_cell2(h1, (h2, c2))

        outputs = []
        cur = h2
        for _ in range(self.out_timesteps):
            h1, c1 = self.dec_cell1(cur, (h1, c1))
            h2, c2 = self.dec_cell2(h1, (h2, c2))
            outputs.append(self.prediction_head(h2))
            cur = h2
        return torch.stack(outputs, dim=1)

# ==========================================
# 6. ENGINE 3: DYNAMIC POLAR A* PATHFINDER
# ==========================================
class DynamicPolarAStar:
    def __init__(self, sic_forecast, current_vectors, wind_vectors, iceberg_tracks, bathy_mask):
        self.sic = sic_forecast
        self.curr = current_vectors
        self.wind = wind_vectors
        self.bergs = iceberg_tracks
        self.bathy = bathy_mask

    def get_time_idx(self, hours):
        return min(int(hours // 24), self.sic.shape[0] - 1)

    def is_iceberg_hazard(self, lat, lon, t_idx):
        for _, track in self.bergs.items():
            b_lat, b_lon = track[min(t_idx, len(track) - 1)]
            if haversine_nmi(lat, lon, b_lat, b_lon) < ICEBERG_BUFFER_NMI:
                return True
        return False

    def evaluate_transit_edge(self, r1, c1, r2, c2, hours):
        r2 = min(max(int(r2), 0), GRID_H - 1)
        c2 = min(max(int(c2), 0), GRID_W - 1)

        if self.bathy[r2, c2]:
            return float("inf"), 0.0

        t_idx = self.get_time_idx(hours)
        lat2, lon2 = grid_to_coord(r2, c2)

        if self.is_iceberg_hazard(lat2, lon2, t_idx):
            return float("inf"), 0.0

        ice_conc = float(self.sic[t_idx, r2, c2])
        if ice_conc > 0.85:
            return float("inf"), 0.0

        lat1, lon1 = grid_to_coord(r1, c1)
        dist_nmi = haversine_nmi(lat1, lon1, lat2, lon2)
        bearing = calculate_bearing(lat1, lon1, lat2, lon2)
        bearing_rad = radians(bearing)

        ship_hx, ship_hy = sin(bearing_rad), cos(bearing_rad)
        uo = self.curr[t_idx, 0, r2, c2] * 1.94384
        vo = self.curr[t_idx, 1, r2, c2] * 1.94384
        u10 = self.wind[t_idx, 0, r2, c2] * 1.94384
        v10 = self.wind[t_idx, 1, r2, c2] * 1.94384

        curr_along = (uo * ship_hx) + (vo * ship_hy)
        wind_along = (u10 * ship_hx) + (v10 * ship_hy)

        base_speed = CRUISE_SPEED_KTS * (1.0 - 0.70 * (ice_conc ** 1.5))
        effective_speed = max(base_speed + (curr_along * 0.7), 2.5)

        wind_penalty = 1.0 + max(0.0, -wind_along * 0.03)
        ice_penalty = 1.0 + 10.0 * (ice_conc ** 2)

        edge_hours = dist_nmi / effective_speed
        edge_cost = dist_nmi * ice_penalty * wind_penalty
        return edge_cost, edge_hours

    def find_route(self, start_lat, start_lon, goal_lat, goal_lon):
        start_r, start_c = coord_to_grid(start_lat, start_lon)
        goal_r, goal_c = coord_to_grid(goal_lat, goal_lon)

        open_set = []
        heapq.heappush(open_set, (0.0, 0.0, 0.0, start_r, start_c, [(start_lat, start_lon)]))
        visited = {}
        neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]

        while open_set:
            f, g, hours, r, c, path = heapq.heappop(open_set)

            if (r, c) == (goal_r, goal_c):
                return path, hours, g

            state_key = (r, c, int(hours // 6))
            if state_key in visited and visited[state_key] <= g:
                continue
            visited[state_key] = g

            for dr, dc in neighbors:
                nr, nc = r + dr, c + dc
                if 0 <= nr < GRID_H and 0 <= nc < GRID_W:
                    cost, step_hours = self.evaluate_transit_edge(r, c, nr, nc, hours)
                    if cost == float("inf"):
                        continue
                    next_lat, next_lon = grid_to_coord(nr, nc)
                    h = haversine_nmi(next_lat, next_lon, goal_lat, goal_lon)
                    heapq.heappush(open_set, (g + cost + h, g + cost, hours + step_hours, nr, nc, path + [(next_lat, next_lon)]))

        return None, None, None

def safe_load_model(path):
    try:
        with open(path, "rb") as f:
            return pickle.load(f)
    except Exception:
        return joblib.load(path)

# ==========================================
# 7. MAIN ORCHESTRATION PIPELINE
# ==========================================
def main():
    parser = argparse.ArgumentParser(description="Run the POLARIS live model navigation pipeline.")
    parser.add_argument("--source-lat", type=float, default=float(os.getenv("POLARIS_SOURCE_LAT", "-70.77")))
    parser.add_argument("--source-lon", type=float, default=float(os.getenv("POLARIS_SOURCE_LON", "11.73")))
    parser.add_argument("--destination-lat", type=float, default=float(os.getenv("POLARIS_DESTINATION_LAT", "-69.41")))
    parser.add_argument("--destination-lon", type=float, default=float(os.getenv("POLARIS_DESTINATION_LON", "76.19")))
    args = parser.parse_args()

    print("1. Loading AI Model checkpoints...")
    model_lat = safe_load_model(MODEL_LAT_PATH)
    model_lon = safe_load_model(MODEL_LON_PATH)

    convlstm = PolarSeaIceConvLSTM().to(device)
    if os.path.exists(BEST_CONVLSTM_PATH):
        ckpt = torch.load(BEST_CONVLSTM_PATH, map_location=device)
        convlstm.load_state_dict(ckpt["model_state"] if isinstance(ckpt, dict) and "model_state" in ckpt else ckpt)
    convlstm.eval()

    print(f"2. Ingesting bathymetric floor ({GRID_H}x{GRID_W})...")
    bathy_mask = load_bathymetry_mask(BATHY_PATH)

    print("3. Querying latest 7-day observation state...")
    if os.path.exists(NPZ_DATA_PATH):
        obs_7d = np.load(NPZ_DATA_PATH)["X"][-1:]
    else:
        obs_7d = np.zeros((1, 7, 6, 128, 128), dtype=np.float32)

    print("4. Forecasting 72h sea ice field (ConvLSTM)...")
    with torch.no_grad():
        sic_forecast_raw = convlstm(torch.from_numpy(obs_7d).float().to(device))  # (1, 3, 1, 128, 128)
        
        # Rescale sea ice field to match GRID_H and GRID_W
        if GRID_H != 128 or GRID_W != 128:
            sic_forecast_reshaped = sic_forecast_raw.squeeze(2)  # (1, 3, 128, 128)
            sic_forecast_rescaled = F.interpolate(
                sic_forecast_reshaped,
                size=(GRID_H, GRID_W),
                mode="bilinear",
                align_corners=False
            )
            sic_forecast = sic_forecast_rescaled.squeeze(0).cpu().numpy()  # (3, GRID_H, GRID_W)
        else:
            sic_forecast = sic_forecast_raw.squeeze().cpu().numpy()

    print("5. Ingesting active icebergs and predicting drift (XGBoost)...")
    live_bergs = fetch_live_usnic_icebergs()
    iceberg_tracks = {}

    for berg_id, (b_lat, b_lon) in live_bergs.items():
        curr_lat, curr_lon = b_lat, b_lon
        track = [(curr_lat, curr_lon)]
        for _ in range(3):
            coriolis = 2.0 * 7.2921e-5 * sin(radians(curr_lat))
            feat = pd.DataFrame([{
                "lat": curr_lat, "lon": curr_lon,
                "length_km": 10.0, "width_km": 6.0,
                "uo": 0.25, "vo": 0.05, "curr_speed": 0.26,
                "u10": -5.0, "v10": 2.0, "wind_speed": 5.4,
                "thetao": -1.5, "depth_m": -2500.0,
                "coriolis_f": coriolis
            }])
            curr_lat += float(model_lat.predict(feat)[0])
            curr_lon += float(model_lon.predict(feat)[0])
            track.append((curr_lat, curr_lon))
        iceberg_tracks[berg_id] = track

    # Operational route defaults to the POLARIS station corridor. Override via CLI or environment.
    START_LAT, START_LON = args.source_lat, args.source_lon
    GOAL_LAT, GOAL_LON = args.destination_lat, args.destination_lon

    curr_vec = np.zeros((3, 2, GRID_H, GRID_W), dtype=np.float32)
    wind_vec = np.zeros((3, 2, GRID_H, GRID_W), dtype=np.float32)

    print(f"6. Computing optimal transit across {GRID_H}x{GRID_W} grid from ({START_LAT}, {START_LON}) to ({GOAL_LAT}, {GOAL_LON})...")
    planner = DynamicPolarAStar(sic_forecast, curr_vec, wind_vec, iceberg_tracks, bathy_mask)
    path, hours, cost = planner.find_route(START_LAT, START_LON, GOAL_LAT, GOAL_LON)

    if not path:
        print("Passage blocked by impenetrable ice conditions or bathymetric boundary.")
        return

    print("\n==========================================")
    print("PASSAGE PLAN GENERATED SUCCESSFULLY:")
    print(f"  Waypoints Plotted:   {len(path)}")
    print(f"  Estimated Transit:   {float(hours):.1f} Hours ({float(hours) / 24.0:.2f} Days)")
    print(f"  Fuel & Safety Cost:  {float(cost):.1f}")
    print("==========================================")

    native_coords = [[float(lon), float(lat)] for lat, lon in path]

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": native_coords
                },
                "properties": {
                    "route_name": "POLARIS Recommended Passage",
                    "grid_resolution": f"{GRID_H}x{GRID_W}",
                    "transit_hours": round(float(hours), 2),
                    "cost_metric": round(float(cost), 2),
                    "generated_at": datetime.now(timezone.utc).isoformat()
                }
            }
        ]
    }

    out_file = os.path.join(CURRENT_DIR, "polaris_active_passage.geojson")
    with open(out_file, "w") as f:
        json.dump(geojson, f, indent=2)
    print(f"Saved route GeoJSON: {out_file}")

if __name__ == "__main__":
    main()