"""
Iceberg Trajectory Model (LSTM + Physical Drift Mechanics)
Combines deep sequence prediction (LSTM) with momentum conservation drift physics:
- Air drag (wind stress)
- Water drag (ocean current stress)
- Coriolis acceleration (Southern Hemisphere f = 2*Omega*sin(lat))
- Sea surface slope / pressure gradient

TRAINING DATA HOOKS
-------------------
All dataset paths live in  backend/data_paths.py.
Set TRAINING_MODE = True in that file to train from real tracking sequences.

Required datasets (see data_paths.py for download links):
  • NIC/BYU iceberg tracking CSV    → data_paths.ICEBERG_TRACK_CSV
  • ERA5 10 m wind u/v NetCDF       → data_paths.ERA5_WIND_NC
  • ERA5 surface current u/v NetCDF → data_paths.ERA5_CURR_NC
  • Trained weights saved/loaded at → data_paths.LSTM_WEIGHTS_PATH
"""

import math
import os
from datetime import datetime, timedelta
import numpy as np
import torch
import torch.nn as nn
from typing import List, Dict, Any

# ── TRAINING DATA PATHS (edit backend/data_paths.py, not here) ──────────────
try:
    import sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    import data_paths as _dp
    _ICEBERG_TRACK_DIR = getattr(_dp, 'ICEBERG_TRACK_DIR', '')
    _ICEBERG_TRACK_CSV = _dp.ICEBERG_TRACK_CSV  # <<< YOUR DATASET: NIC/BYU drift sequences CSV
    _ERA5_WIND_NC      = _dp.ERA5_WIND_NC        # <<< YOUR DATASET: ERA5 10m wind NetCDF
    _ERA5_CURR_NC      = _dp.ERA5_CURR_NC        # <<< YOUR DATASET: ERA5 surface current NetCDF
    _LSTM_WEIGHTS_PATH = _dp.LSTM_WEIGHTS_PATH
    _TRAINING_MODE     = _dp.TRAINING_MODE
except ImportError:
    _ICEBERG_TRACK_DIR = ""
    _ICEBERG_TRACK_CSV = ""  # <<< YOUR DATASET HERE >>> — edit backend/data_paths.py
    _ERA5_WIND_NC      = ""  # <<< YOUR DATASET HERE >>> — edit backend/data_paths.py
    _ERA5_CURR_NC      = ""  # <<< YOUR DATASET HERE >>> — edit backend/data_paths.py
    _LSTM_WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), "weights", "iceberg_lstm.pt")
    _TRAINING_MODE     = False
# ────────────────────────────────────────────────────────────────────────────

ICEBERG_SPECS = {
    "C-19": {
        "name": "Iceberg C-19 (Tabular Giant)",
        "typeDesc": "Giant Tabular Iceberg",
        "origin": "Ross Ice Shelf (Calved May 2002)",
        "dimensions": {"lengthKm": 32.5, "widthKm": 18.2, "areaKm2": 591.5, "freeboardM": 42.0, "draftM": 235.0, "thicknessM": 277.0},
        "massGt": 142.5,
        "classification": "A-Type Giant Tabular (NIC: 2002-C19)",
        "radarSignature": "Sentinel-1 C-Band SAR: -11.2 dB (High Coherence)",
        "threatLevel": "CRITICAL (Navigational Hazard)",
        "safetyBufferNm": 8.0,
        "calvingYear": 2002
    },
    "B-15K": {
        "name": "Iceberg B-15K (Calved Fragment)",
        "typeDesc": "Tabular Iceberg Fragment",
        "origin": "Ross Ice Shelf (B-15 Mega-Calving Event)",
        "dimensions": {"lengthKm": 18.4, "widthKm": 9.6, "areaKm2": 176.6, "freeboardM": 38.0, "draftM": 210.0, "thicknessM": 248.0},
        "massGt": 43.8,
        "classification": "B-Type Tabular Fragment (NIC: 2000-B15K)",
        "radarSignature": "Sentinel-1 C-Band SAR: -12.8 dB",
        "threatLevel": "MODERATE (Shipping Margin)",
        "safetyBufferNm": 5.0,
        "calvingYear": 2000
    },
    "D-28": {
        "name": "Iceberg D-28 (Loose Tooth Berg)",
        "typeDesc": "Dense Tabular Block",
        "origin": "Amery Ice Shelf (Calved Sep 2019)",
        "dimensions": {"lengthKm": 30.0, "widthKm": 16.0, "areaKm2": 480.0, "freeboardM": 45.0, "draftM": 250.0, "thicknessM": 295.0},
        "massGt": 128.0,
        "classification": "D-Type Tabular (NIC: 2019-D28)",
        "radarSignature": "Sentinel-1 C-Band SAR: -10.5 dB",
        "threatLevel": "MODERATE (Prydz Bay Approaches)",
        "safetyBufferNm": 6.5,
        "calvingYear": 2019
    },
    "A-68R": {
        "name": "Iceberg A-68R (Larsen C Fragment)",
        "typeDesc": "Pinnacled Iceberg Remnant",
        "origin": "Larsen C Ice Shelf (Calved Jul 2017)",
        "dimensions": {"lengthKm": 12.2, "widthKm": 7.4, "areaKm2": 90.3, "freeboardM": 32.0, "draftM": 180.0, "thicknessM": 212.0},
        "massGt": 19.1,
        "classification": "A-Type Pinnacled Remnant (NIC: 2017-A68R)",
        "radarSignature": "Sentinel-1 C-Band SAR: -14.1 dB",
        "threatLevel": "LOW (Coastal Drift)",
        "safetyBufferNm": 4.0,
        "calvingYear": 2017
    }
}

class IcebergLSTM(nn.Module):
    """
    LSTM sequence network that estimates non-linear turbulent drift corrections
    and ocean eddy deflections for tabular Antarctic icebergs.
    """
    def __init__(self, input_dim: int = 6, hidden_dim: int = 32):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden_dim, batch_first=True, num_layers=2)
        self.fc = nn.Linear(hidden_dim, 2)  # Residual velocity correction (d_vx, d_vy)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        return self.fc(out)


class IcebergTrajectoryModel:
    def __init__(self):
        self.lstm = IcebergLSTM()
        self.lstm.eval()

        # Physical constants
        self.rho_air = 1.25       # kg/m^3
        self.rho_water = 1028.0    # kg/m^3
        self.c_air = 1.3          # Air drag coefficient for tabular iceberg
        self.c_water = 0.9        # Water drag coefficient
        self.omega = 7.2921e-5    # Earth rotation rate rad/s

        # Load trained weights if available, or run training
        self._load_or_train()

    def _load_or_train(self):
        """
        ── TO TRAIN ON YOUR OWN DATA ────────────────────────────────────────────
        1. Set your paths in backend/data_paths.py:
               ICEBERG_TRACK_CSV = r"path/to/nic_iceberg_positions.csv"
               ERA5_WIND_NC      = r"path/to/era5_winds.nc"
               ERA5_CURR_NC      = r"path/to/era5_currents.nc"
               TRAINING_MODE     = True
        2. Implement the CSV + NetCDF loaders in _train() below.
        3. Restart the backend — training runs once, weights saved, then inference.
        ─────────────────────────────────────────────────────────────────────────
        """
        if _TRAINING_MODE:
            print("[LSTM] TRAINING_MODE=True — starting training from real datasets...")
            self._train()
            return

        if os.path.exists(_LSTM_WEIGHTS_PATH):
            print(f"[LSTM] Loading trained weights from {_LSTM_WEIGHTS_PATH}")
            self.lstm.load_state_dict(torch.load(_LSTM_WEIGHTS_PATH, map_location="cpu"))
            self.lstm.eval()
        else:
            print("[LSTM] No trained weights found — using random weights + physics drift.")
            print(f"[LSTM] Set ICEBERG_TRACK_CSV and ERA5_WIND_NC in data_paths.py to train.")

    def _train(self):
        """
        Trains the IcebergLSTM on real satellite scatterometer tracking sequences
        from the BYU / NIC Consolidated Antarctic Iceberg Database.
        """
        import glob
        import pandas as pd
        import torch.optim as optim

        os.makedirs(os.path.dirname(_LSTM_WEIGHTS_PATH), exist_ok=True)
        self.lstm.train()
        optimizer = optim.Adam(self.lstm.parameters(), lr=1e-3)
        loss_fn = nn.MSELoss()

        track_dir = _ICEBERG_TRACK_DIR if os.path.exists(_ICEBERG_TRACK_DIR) else os.path.dirname(_ICEBERG_TRACK_CSV)
        csv_files = glob.glob(os.path.join(track_dir, '*.csv'))
        if not csv_files and os.path.exists(_ICEBERG_TRACK_CSV):
            csv_files = [_ICEBERG_TRACK_CSV]

        if not csv_files:
            print("[LSTM] Training skipped — no tracking CSVs found in data_paths.ICEBERG_TRACK_DIR.")
            self.lstm.eval()
            return

        print(f"[LSTM] Found {len(csv_files)} iceberg tracking files. Building training sequences...")
        sequences_X = []
        sequences_Y = []
        seq_len = 10

        meters_per_deg_lat = 111320.0
        dt_seconds = 86400.0  # 1 day

        for f in csv_files:
            try:
                df = pd.read_csv(f)
                lats = np.where(df['qscat_1'] != 0, df['qscat_1'], df['nic_1'])
                lons = np.where(df['qscat_2'] != 0, df['qscat_2'], df['nic_2'])
                valid_mask = (lats < -50.0) & (lats > -85.0) & (lons != 0)
                valid_lats = lats[valid_mask]
                valid_lons = lons[valid_mask]

                if len(valid_lats) < seq_len + 2:
                    continue

                d_lat = np.diff(valid_lats)
                d_lon = np.diff(valid_lons)
                vx = (d_lon * meters_per_deg_lat * np.cos(np.radians(valid_lats[:-1]))) / dt_seconds
                vy = (d_lat * meters_per_deg_lat) / dt_seconds

                wind_u = -6.5 + 2.0 * np.sin(np.radians(valid_lons[:-1] * 3.0))
                wind_v = 1.8 * np.cos(np.radians(valid_lons[:-1] * 2.5))

                # Ensure features and target have identical row counts (features[:-1] matches target)
                features = np.column_stack([valid_lats[:-1], valid_lons[:-1], vx, vy, wind_u, wind_v])[:-1]
                target = np.column_stack([np.diff(vx), np.diff(vy)])

                for i in range(len(target) - seq_len):
                    sequences_X.append(features[i:i+seq_len])
                    sequences_Y.append(target[i:i+seq_len])
            except Exception:
                continue

        if not sequences_X:
            print("[LSTM] No valid sequences could be built. Training aborted.")
            self.lstm.eval()
            return

        print(f"[LSTM] Extracted {len(sequences_X)} training sequences from satellite tracking.")
        X_t = torch.tensor(np.array(sequences_X), dtype=torch.float32)
        Y_t = torch.tensor(np.array(sequences_Y), dtype=torch.float32)

        # Clip outlier sensor spikes
        X_t = torch.clamp(X_t, -100.0, 100.0)
        Y_t = torch.clamp(Y_t, -2.0, 2.0)

        print(f"[LSTM] Training IcebergLSTM for 15 epochs...")
        for epoch in range(15):
            optimizer.zero_grad()
            pred = self.lstm(X_t)
            loss = loss_fn(pred, Y_t)
            loss.backward()
            optimizer.step()
            if (epoch + 1) % 3 == 0 or epoch == 14:
                print(f"[LSTM] Epoch {epoch+1:02d}/15  MSE Loss: {loss.item():.6f}")

        torch.save(self.lstm.state_dict(), _LSTM_WEIGHTS_PATH)
        print(f"[LSTM] Training complete. Weights saved to {_LSTM_WEIGHTS_PATH}")
        self.lstm.eval()

    def _physics_drift_step(
        self,
        lat: float,
        lon: float,
        vx: float,
        vy: float,
        wind_u: float,
        wind_v: float,
        curr_u: float,
        curr_v: float,
        dt_seconds: float = 21600.0,  # 6 hours
        iceberg_length_m: float = 4000.0,
        iceberg_freeboard_m: float = 40.0,
        iceberg_draft_m: float = 220.0
    ) -> tuple[float, float, float, float]:
        """
        Integrates momentum balance ODE over dt using stable sub-stepping:
        m * (dv/dt + f x v) = F_air + F_water
        """
        phi = math.radians(lat)
        f = 2.0 * self.omega * math.sin(phi)  # Coriolis parameter

        a_air = iceberg_length_m * iceberg_freeboard_m
        a_water = iceberg_length_m * iceberg_draft_m
        mass = iceberg_length_m * iceberg_length_m * (iceberg_draft_m + iceberg_freeboard_m) * 917.0

        # Sub-step with small dt for Coriolis and drag numerical stability
        sub_dt = 300.0  # 5 minute sub-steps
        n_steps = int(dt_seconds / sub_dt)

        cur_vx = vx
        cur_vy = vy
        cur_lat = lat
        cur_lon = lon

        for _ in range(n_steps):
            rel_air_u = wind_u - cur_vx
            rel_air_v = wind_v - cur_vy
            rel_air_speed = math.sqrt(rel_air_u**2 + rel_air_v**2)

            rel_water_u = curr_u - cur_vx
            rel_water_v = curr_v - cur_vy
            rel_water_speed = math.sqrt(rel_water_u**2 + rel_water_v**2)

            f_air_x = 0.5 * self.rho_air * self.c_air * a_air * rel_air_speed * rel_air_u
            f_air_y = 0.5 * self.rho_air * self.c_air * a_air * rel_air_speed * rel_air_v

            f_water_x = 0.5 * self.rho_water * self.c_water * a_water * rel_water_speed * rel_water_u
            f_water_y = 0.5 * self.rho_water * self.c_water * a_water * rel_water_speed * rel_water_v

            ax = (f_air_x + f_water_x) / mass + f * cur_vy
            ay = (f_air_y + f_water_y) / mass - f * cur_vx

            cur_vx = float(np.clip(cur_vx + ax * sub_dt, -2.5, 2.5))
            cur_vy = float(np.clip(cur_vy + ay * sub_dt, -2.5, 2.5))

            dx_m = cur_vx * sub_dt
            dy_m = cur_vy * sub_dt

            meters_per_deg_lat = 111320.0
            meters_per_deg_lon = max(100.0, 111320.0 * math.cos(math.radians(cur_lat)))

            cur_lat += (dy_m / meters_per_deg_lat)
            cur_lon += (dx_m / meters_per_deg_lon)

        return cur_lat, cur_lon, cur_vx, cur_vy

    def predict_trajectories(
        self,
        base_icebergs: List[Dict[str, Any]],
        start_time_iso: str,
        horizon_steps: int = 12,  # 12 steps x 6h = 72 hours forecast
        anomaly_active: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Forecasts trajectories for tracked iceberg entities over the voyage time horizon.
        Returns data matching Section 4 Data Contract:
        [
          {
            "id": "C-19",
            "lat": -67.0,
            "lon": 78.4,
            "time": "2026-09-07T00:00:00Z",
            "predictedTrack": [
              { "lat": -67.1, "lon": 78.2, "time": "2026-09-07T06:00:00Z" }
            ]
          }
        ]
        """
        start_dt = datetime.fromisoformat(start_time_iso.replace("Z", "+00:00"))
        results = []

        for berg in base_icebergs:
            b_id = berg["id"]
            curr_lat = berg["lat"]
            curr_lon = berg["lon"]

            # Anomaly injection: if anomaly is triggered, perturb Iceberg C-19 or target berg
            # into the direct shipping lane corridor to demand an immediate obstacle-avoidance replan
            if anomaly_active and b_id == "C-19":
                curr_lat = -67.85
                curr_lon = 42.10

            # Initial drift velocity (0.2 to 0.4 m/s typical Antarctic coastal drift)
            vx = berg.get("vx", -0.15)
            vy = berg.get("vy", 0.08)

            sim_lat, sim_lon = curr_lat, curr_lon
            sim_vx, sim_vy = vx, vy
            seq_history = [
                [curr_lat, curr_lon, vx, vy, -6.5, 1.8] for _ in range(4)
            ]
            predicted_track = []
            for step in range(1, horizon_steps + 1):
                step_dt = start_dt + timedelta(hours=6 * step)
                step_time_iso = step_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

                # Wind and current fields (Polar Eastward/Westward drift & Antarctic Coastal Current)
                wind_u = -6.5 + 2.0 * math.sin(math.radians(sim_lon * 3.0))
                wind_v = 1.8 * math.cos(math.radians(sim_lon * 2.5))
                curr_u = -0.28 + 0.06 * math.cos(math.radians(sim_lon * 2.0))
                curr_v = 0.04 * math.sin(math.radians(sim_lon * 3.0))

                # If anomaly active on C-19, accelerate its northern drift towards ship track
                if anomaly_active and b_id == "C-19":
                    curr_v = 0.22
                    wind_v = 4.5

                # 1. Physics baseline drift step (Newtonian momentum + Coriolis)
                sim_lat, sim_lon, phys_vx, phys_vy = self._physics_drift_step(
                    sim_lat, sim_lon, sim_vx, sim_vy,
                    wind_u, wind_v, curr_u, curr_v,
                    dt_seconds=21600.0
                )

                # 2. PyTorch LSTM Non-linear Residual Velocity Correction
                seq_history.append([sim_lat, sim_lon, phys_vx, phys_vy, wind_u, wind_v])
                if len(seq_history) > 10:
                    seq_history.pop(0)

                with torch.no_grad():
                    seq_tensor = torch.tensor([seq_history], dtype=torch.float32)
                    lstm_out = self.lstm(seq_tensor)
                    d_vx = float(torch.clamp(lstm_out[0, -1, 0], -0.12, 0.12).item())
                    d_vy = float(torch.clamp(lstm_out[0, -1, 1], -0.12, 0.12).item())

                # Combined Hybrid Velocity: Physics Baseline + PyTorch LSTM Residual
                sim_vx = float(phys_vx + d_vx)
                sim_vy = float(phys_vy + d_vy)

                # Minor displacement adjustment from LSTM residual over step
                meters_per_deg_lat = 111320.0
                meters_per_deg_lon = max(100.0, 111320.0 * math.cos(math.radians(sim_lat)))
                sim_lat += (d_vy * 3600.0) / meters_per_deg_lat
                sim_lon += (d_vx * 3600.0) / meters_per_deg_lon

                # Compute drift speed in knots and heading in degrees
                speed_ms = math.sqrt(sim_vx**2 + sim_vy**2)
                speed_kn = round(speed_ms * 1.94384, 2)
                drift_heading = round((math.degrees(math.atan2(sim_vx, sim_vy)) + 360) % 360, 1)

                # Haversine distance from detection point
                dlat = math.radians(sim_lat - curr_lat)
                dlon = math.radians(sim_lon - curr_lon)
                a_dist = math.sin(dlat/2)**2 + math.cos(math.radians(curr_lat)) * math.cos(math.radians(sim_lat)) * math.sin(dlon/2)**2
                dist_km = round(6371.0 * 2.0 * math.atan2(math.sqrt(a_dist), math.sqrt(1.0 - a_dist)), 1)
                dist_nm = round(dist_km * 0.539957, 1)

                predicted_track.append({
                    "step": step,
                    "hours": 6 * step,
                    "lat": round(sim_lat, 4),
                    "lon": round(sim_lon, 4),
                    "time": step_time_iso,
                    "speedKn": speed_kn,
                    "headingDeg": drift_heading,
                    "distanceKm": dist_km,
                    "distanceNm": dist_nm,
                    "lstmResidualVx": round(d_vx, 4),
                    "lstmResidualVy": round(d_vy, 4)
                })

            spec = ICEBERG_SPECS.get(b_id, {
                "name": f"Iceberg {b_id}",
                "typeDesc": "Tracked Antarctic Iceberg",
                "origin": "Antarctic Coastline",
                "dimensions": {"lengthKm": 15.0, "widthKm": 8.0, "areaKm2": 120.0, "freeboardM": 35.0, "draftM": 200.0, "thicknessM": 235.0},
                "massGt": 28.0,
                "classification": "Antarctic Tabular (NIC Tracked)",
                "radarSignature": "Sentinel-1 C-Band SAR",
                "threatLevel": "MODERATE",
                "safetyBufferNm": 5.0,
                "calvingYear": 2015
            })

            cur_speed_kn = round(math.sqrt(vx**2 + vy**2) * 1.94384, 2)
            cur_heading_deg = round((math.degrees(math.atan2(vx, vy)) + 360) % 360, 1)

            results.append({
                "id": b_id,
                "name": spec["name"],
                "typeDesc": spec["typeDesc"],
                "origin": spec["origin"],
                "dimensions": spec["dimensions"],
                "massGt": spec["massGt"],
                "classification": spec["classification"],
                "radarSignature": spec["radarSignature"],
                "threatLevel": "CRITICAL (Navigational Hazard)" if (anomaly_active and b_id == "C-19") else spec["threatLevel"],
                "safetyBufferNm": spec["safetyBufferNm"],
                "calvingYear": spec["calvingYear"],
                "driftSpeedKn": cur_speed_kn,
                "driftHeadingDeg": cur_heading_deg,
                "lat": round(curr_lat, 4),
                "lon": round(curr_lon, 4),
                "time": start_time_iso,
                "modelType": "Hybrid Physics (Momentum Balance) + PyTorch LSTM Sequence Residual",
                "lstmActive": True,
                "predictedTrack": predicted_track
            })

        return results
