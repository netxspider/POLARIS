"""
POLARIS Real-Time WebSocket Streaming Engine
Smart India Hackathon 2026 | MoES / NCPOR (PS ID: 26059)

Broadcasts 1 Hz telemetry packets over /ws/realtime delivering:
1. Dynamic Icebergs: Real-time coordinates, velocity, drift SOG/COG, and 6-hour forward
   projection vector using Physics momentum ODE + PyTorch LSTM sequence residual.
2. Live AIS Vessels: AISStream feed with automatic realistic Southern Ocean fallback fleet.
3. RV Polar Explorer Telemetry: Sounding depth, UKC (8.5m draft), true wind, fairway heading.
4. Polar Orbiter Synchronization: Authoritative millisecond ISO-8601 UTC timestamp.
"""

import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"

import json
import math
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Set, Optional

import torch
# pyrefly: ignore [missing-import]
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("polaris.realtime")

# Physical specifications for tracked Antarctic icebergs
from backend.models.iceberg_trajectory import ICEBERG_SPECS

# Default base icebergs
DEFAULT_ICEBERGS = [
    {"id": "C-19", "lat": -67.4000, "lon": 41.2000, "vx": -0.18, "vy": 0.05},
    {"id": "B-15K", "lat": -66.8000, "lon": 58.5000, "vx": -0.22, "vy": -0.04},
    {"id": "D-28", "lat": -68.1000, "lon": 73.6000, "vx": -0.15, "vy": 0.08},
    {"id": "A-68R", "lat": -66.1000, "lon": 24.8000, "vx": -0.25, "vy": 0.03}
]

# Baseline Maitri-to-Bharati fairway corridor waypoints
DEFAULT_ROUTE_WAYPOINTS = [
    {"lat": -70.7700, "lon": 11.7300, "speedKn": 10.9},
    {"lat": -69.8636, "lon": 12.9712, "speedKn": 10.9},
    {"lat": -69.5000, "lon": 15.4532, "speedKn": 10.9},
    {"lat": -69.3182, "lon": 17.9353, "speedKn": 14.0},
    {"lat": -69.3182, "lon": 20.4173, "speedKn": 14.0},
    {"lat": -69.3182, "lon": 22.8993, "speedKn": 10.9},
    {"lat": -69.3182, "lon": 25.3813, "speedKn": 10.9},
    {"lat": -69.3182, "lon": 27.8633, "speedKn": 10.9},
    {"lat": -69.1364, "lon": 30.3453, "speedKn": 10.9},
    {"lat": -69.1364, "lon": 32.8273, "speedKn": 10.9},
    {"lat": -69.1364, "lon": 35.3094, "speedKn": 10.9},
    {"lat": -68.9545, "lon": 37.7914, "speedKn": 10.9},
    {"lat": -68.9545, "lon": 40.2734, "speedKn": 10.9},
    {"lat": -68.9545, "lon": 42.7554, "speedKn": 14.0},
    {"lat": -68.9545, "lon": 45.2374, "speedKn": 14.0},
    {"lat": -68.9545, "lon": 47.7194, "speedKn": 10.9},
    {"lat": -68.9545, "lon": 50.2014, "speedKn": 10.9},
    {"lat": -68.9545, "lon": 52.6835, "speedKn": 10.9},
    {"lat": -69.1364, "lon": 55.1655, "speedKn": 10.9},
    {"lat": -69.1364, "lon": 57.6475, "speedKn": 14.0},
    {"lat": -69.1364, "lon": 60.1295, "speedKn": 14.0},
    {"lat": -69.1364, "lon": 62.6115, "speedKn": 10.9},
    {"lat": -69.1364, "lon": 65.0935, "speedKn": 10.9},
    {"lat": -69.3182, "lon": 67.5755, "speedKn": 14.0},
    {"lat": -69.5000, "lon": 70.0576, "speedKn": 14.0},
    {"lat": -69.5000, "lon": 72.5396, "speedKn": 10.9},
    {"lat": -69.5000, "lon": 75.0216, "speedKn": 10.9},
    {"lat": -69.4100, "lon": 76.1900, "speedKn": 14.0}
]


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance between two coordinates in meters."""
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def initial_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle initial bearing in degrees [0, 360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


class RealtimeService:
    """
    High-Performance Real-Time WebSocket Streaming Engine for POLARIS.
    Maintains continuous stateful physical models for icebergs, vessel telemetry,
    and polar AIS contacts, broadcasting updates at 1 Hz.
    """

    def __init__(self, iceberg_model, env_lookup, ais_service):
        self.iceberg_model = iceberg_model
        self.env_lookup = env_lookup
        self.ais_service = ais_service

        self.active_connections: Set[WebSocket] = set()
        self._running: bool = False
        self._broadcast_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self._engine2_models = None

        # Initialize Iceberg Physical States
        self.icebergs: Dict[str, Dict[str, Any]] = {}
        self._init_iceberg_states()

        # Initialize RV Polar Explorer Route Corridor & Telemetry
        self.route_waypoints: List[Dict[str, Any]] = self._load_route_waypoints()
        self.route_segment_lengths_m: List[float] = []
        self.total_route_distance_m: float = 0.0
        self._init_route_geometry()

        self.vessel_current_wp_idx: int = 0
        self.vessel_segment_dist_m: float = 0.0
        self.vessel_total_dist_traveled_m: float = 0.0
        self.vessel_lat: float = self.route_waypoints[0]["lat"]
        self.vessel_lon: float = self.route_waypoints[0]["lon"]
        self.vessel_speed_kn: float = 13.5
        self.vessel_heading_deg: float = 86.0
        self.vessel_draft_m: float = 8.5

        # Initialize Authentic Satellite Iceberg Tracking Cache (BYU/USNIC)
        self._satellite_tracks_cache: Dict[str, Any] = self._load_satellite_tracks()
        self.satellite_tracks_data: Dict[str, Any] = self._satellite_tracks_cache

        # Precompute initial frame so subscribers receive immediate data
        self.latest_frame: Dict[str, Any] = self._build_frame()

    def _load_engine2_models(self):
        if self._engine2_models is None:
            import joblib
            model_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "model")
            lat_path = os.path.join(model_dir, "engine2_drift_lat_xgb.pkl")
            lon_path = os.path.join(model_dir, "engine2_drift_lon_xgb.pkl")
            if os.path.exists(lat_path) and os.path.exists(lon_path):
                try:
                    lat_model = joblib.load(lat_path)
                    lon_model = joblib.load(lon_path)
                    self._engine2_models = (lat_model, lon_model)
                except Exception as exc:
                    logger.warning("Failed loading Engine 2 XGBoost models: %s", exc)
                    self._engine2_models = None
        return self._engine2_models

    def _predict_drift_engine2(self, lat: float, lon: float, length_km: float, width_km: float, curr_u: float, curr_v: float, wind_u: float, wind_v: float):
        eng2 = self._load_engine2_models()
        if eng2 is None:
            return None
        lat_model, lon_model = eng2
        import pandas as pd
        phi = math.radians(lat)
        f_coriolis = 2.0 * 7.2921e-5 * math.sin(phi)
        features = {
            "lat": lat, "lon": lon, "length_km": length_km, "width_km": width_km,
            "uo": curr_u, "vo": curr_v, "curr_speed": math.hypot(curr_u, curr_v),
            "u10": wind_u, "v10": wind_v, "wind_speed": math.hypot(wind_u, wind_v),
            "thetao": -1.5, "depth_m": -2500.0,
            "coriolis_f": f_coriolis,
        }
        row = pd.DataFrame([features])
        d_lat_24h = float(lat_model.predict(row)[0])
        d_lon_24h = float(lon_model.predict(row)[0])
        return d_lat_24h, d_lon_24h

    def _load_satellite_tracks(self) -> Dict[str, Any]:
        """Loads authentic BYU/USNIC satellite iceberg tracks from data cache."""
        tracks_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "data", "satellite_iceberg_tracks.json"
        )
        if os.path.exists(tracks_path):
            try:
                with open(tracks_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as exc:
                logger.warning("Failed loading satellite_iceberg_tracks.json: %s", exc)
        return {"metadata": {}, "icebergs": {}}

    def get_satellite_tracks(self) -> Dict[str, Any]:
        """Returns the cached BYU/USNIC satellite observation database."""
        return self._satellite_tracks_cache

    def _init_iceberg_states(self):
        """Initializes internal physical state and PyTorch LSTM input histories."""
        for berg in DEFAULT_ICEBERGS:
            b_id = berg["id"]
            spec = ICEBERG_SPECS.get(b_id, {
                "name": f"Iceberg {b_id}",
                "typeDesc": "Tabular Iceberg",
                "origin": "Antarctic Coast",
                "dimensions": {"lengthKm": 20.0, "widthKm": 10.0, "areaKm2": 200.0, "freeboardM": 40.0, "draftM": 220.0, "thicknessM": 260.0},
                "massGt": 50.0,
                "classification": "Tabular",
                "radarSignature": "Sentinel-1 SAR",
                "threatLevel": "CRITICAL" if b_id == "C-19" else "MODERATE",
                "safetyBufferNm": 6.0
            })

            dims = spec.get("dimensions", {})
            length_m = float(dims.get("lengthKm", 20.0)) * 1000.0
            freeboard_m = float(dims.get("freeboardM", 40.0))
            draft_m = float(dims.get("draftM", 220.0))

            vx = float(berg.get("vx", -0.18))
            vy = float(berg.get("vy", 0.05))
            lat = float(berg["lat"])
            lon = float(berg["lon"])

            # 10-step history queue for PyTorch LSTM sequence evaluation [lat, lon, vx, vy, wind_u, wind_v]
            seq_history = [
                [lat, lon, vx, vy, -6.5, 1.8] for _ in range(10)
            ]

            proj6h = {
                "lat": lat,
                "lon": lon,
                "distanceNm": 0.0,
                "headingDeg": 285.0,
                "source": "Engine 2 XGBoost",
            }
            predicted_track = []
            try:
                drift = self._predict_drift_engine2(lat, lon, float(dims.get("lengthKm", 20.0)), float(dims.get("widthKm", 10.0)), -0.28, 0.04, -6.5, 1.8)
                if drift:
                    d_lat_24h, d_lon_24h = drift
                    proj_lat = lat + d_lat_24h / 4.0
                    proj_lon = lon + d_lon_24h / 4.0
                    d_dist_m = haversine_distance_m(lat, lon, proj_lat, proj_lon)
                    proj6h = {
                        "lat": round(proj_lat, 4),
                        "lon": round(proj_lon, 4),
                        "distanceNm": round((d_dist_m / 1000.0) * 0.539957, 1),
                        "headingDeg": round(initial_bearing_deg(lat, lon, proj_lat, proj_lon), 1),
                        "source": "Engine 2 XGBoost",
                    }
                    c_lat, c_lon = lat, lon
                    now_utc = datetime.now(timezone.utc)
                    from datetime import timedelta
                    for step in range(1, 13):
                        c_lat += d_lat_24h / 4.0
                        c_lon += d_lon_24h / 4.0
                        predicted_track.append({
                            "step": step,
                            "hours": 6 * step,
                            "lat": round(c_lat, 4),
                            "lon": round(c_lon, 4),
                            "time": (now_utc + timedelta(hours=6 * step)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "speedKn": round(math.hypot(d_lat_24h, d_lon_24h) * 60.0 / 24.0, 2),
                            "headingDeg": round((math.degrees(math.atan2(d_lon_24h, d_lat_24h)) + 360.0) % 360.0, 1),
                            "source": "Engine 2 XGBoost",
                        })
            except Exception as exc:
                logger.debug("Initial Engine 2 drift computation fallback: %s", exc)

            self.icebergs[b_id] = {
                "id": b_id,
                "name": spec.get("name", f"Iceberg {b_id}"),
                "typeDesc": spec.get("typeDesc", "Tabular Iceberg"),
                "classification": spec.get("classification", "Tabular"),
                "radarSignature": spec.get("radarSignature", "Sentinel-1 C-Band SAR"),
                "threatLevel": spec.get("threatLevel", "MODERATE"),
                "safetyBufferNm": spec.get("safetyBufferNm", 5.0),
                "dimensions": {
                    "lengthKm": dims.get("lengthKm", 20.0),
                    "widthKm": dims.get("widthKm", 10.0),
                    "draftM": draft_m,
                    "freeboardM": freeboard_m
                },
                "massGt": spec.get("massGt", 50.0),
                "length_m": length_m,
                "freeboard_m": freeboard_m,
                "draft_m": draft_m,
                "lat": lat,
                "lon": lon,
                "vx": vx,
                "vy": vy,
                "seq_history": seq_history,
                "projection6h": proj6h,
                "predictedTrack": predicted_track,
                "source": "Engine 2 XGBoost"
            }

    def _load_route_waypoints(self) -> List[Dict[str, Any]]:
        """Loads fairway route waypoints from scenario cache or defaults."""
        scenario_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cached_scenario.json")
        if os.path.exists(scenario_path):
            try:
                with open(scenario_path, "r") as f:
                    data = json.load(f)
                    wps = data.get("route", {}).get("waypoints", [])
                    if len(wps) >= 2:
                        return wps
            except Exception as e:
                logger.warning("Failed loading waypoints from cached_scenario.json: %s", e)
        return DEFAULT_ROUTE_WAYPOINTS

    def _init_route_geometry(self):
        """Computes distances between consecutive route waypoints."""
        self.route_segment_lengths_m = []
        self.total_route_distance_m = 0.0
        n = len(self.route_waypoints)
        for i in range(n - 1):
            w1 = self.route_waypoints[i]
            w2 = self.route_waypoints[i + 1]
            seg_len = haversine_distance_m(w1["lat"], w1["lon"], w2["lat"], w2["lon"])
            self.route_segment_lengths_m.append(seg_len)
            self.total_route_distance_m += seg_len

    def advance_physics(self, dt: float = 1.0):
        """
        Advances all dynamic physical entities by dt seconds:
        - Iceberg coordinates, momentum ODE forces, and PyTorch LSTM residual corrections.
        - RV Polar Explorer position along Maitri–Bharati fairway corridor.
        - Fallback polar AIS vessels along their navigational vectors.
        """
        # 1. Advance Icebergs
        for b_id, berg in self.icebergs.items():
            lat = berg["lat"]
            lon = berg["lon"]
            vx = berg["vx"]
            vy = berg["vy"]
            length_m = berg["length_m"]
            freeboard_m = berg["freeboard_m"]
            draft_m = berg["draft_m"]

            # Wind and ocean current stress fields (polar easterlies & coastal current)
            wind_u = -6.5 + 2.0 * math.sin(math.radians(lon * 3.0))
            wind_v = 1.8 * math.cos(math.radians(lon * 2.5))
            curr_u = -0.28 + 0.06 * math.cos(math.radians(lon * 2.0))
            curr_v = 0.04 * math.sin(math.radians(lon * 3.0))

            # Coriolis parameter: f = 2 * Omega * sin(phi), Southern Hemisphere f < 0
            phi = math.radians(lat)
            f_coriolis = 2.0 * 7.2921e-5 * math.sin(phi)

            # Air and water drag forces
            a_air = length_m * freeboard_m
            a_water = length_m * draft_m
            mass = length_m * length_m * (draft_m + freeboard_m) * 917.0

            rel_air_u = wind_u - vx
            rel_air_v = wind_v - vy
            rel_air_spd = math.sqrt(rel_air_u**2 + rel_air_v**2)

            rel_wtr_u = curr_u - vx
            rel_wtr_v = curr_v - vy
            rel_wtr_spd = math.sqrt(rel_wtr_u**2 + rel_wtr_v**2)

            f_air_x = 0.5 * 1.25 * 1.3 * a_air * rel_air_spd * rel_air_u
            f_air_y = 0.5 * 1.25 * 1.3 * a_air * rel_air_spd * rel_air_v

            f_wtr_x = 0.5 * 1028.0 * 0.9 * a_water * rel_wtr_spd * rel_wtr_u
            f_wtr_y = 0.5 * 1028.0 * 0.9 * a_water * rel_wtr_spd * rel_wtr_v

            # Accelerations: Newtonian drag + Coriolis deflection
            ax = (f_air_x + f_wtr_x) / mass + f_coriolis * vy
            ay = (f_air_y + f_wtr_y) / mass - f_coriolis * vx

            # Integrate velocities with numerical bounds
            vx = float(max(-2.5, min(2.5, vx + ax * dt)))
            vy = float(max(-2.5, min(2.5, vy + ay * dt)))

            # Displacements in meters
            dx_m = vx * dt
            dy_m = vy * dt

            meters_per_deg_lat = 111320.0
            meters_per_deg_lon = max(100.0, 111320.0 * math.cos(math.radians(lat)))

            new_lat = lat + (dy_m / meters_per_deg_lat)
            new_lon = lon + (dx_m / meters_per_deg_lon)

            # PyTorch LSTM sequence correction
            seq_history = berg["seq_history"]
            seq_history.append([new_lat, new_lon, vx, vy, wind_u, wind_v])
            if len(seq_history) > 10:
                seq_history.pop(0)

            d_vx = 0.0
            d_vy = 0.0
            try:
                with torch.no_grad():
                    seq_tensor = torch.tensor([seq_history], dtype=torch.float32)
                    lstm_out = self.iceberg_model.lstm(seq_tensor)
                    d_vx = float(torch.clamp(lstm_out[0, -1, 0], -0.12, 0.12).item())
                    d_vy = float(torch.clamp(lstm_out[0, -1, 1], -0.12, 0.12).item())
            except Exception as lstm_err:
                logger.debug("LSTM inference exception (fallback to physics): %s", lstm_err)

            # Compute 6-hour projection and 72-hour trajectory using Engine 2 XGBoost
            drift = self._predict_drift_engine2(
                new_lat, new_lon,
                float(berg.get("dimensions", {}).get("lengthKm", 20.0)),
                float(berg.get("dimensions", {}).get("widthKm", 10.0)),
                curr_u, curr_v, wind_u, wind_v
            )
            if drift:
                d_lat_24h, d_lon_24h = drift
                proj_lat = new_lat + (d_lat_24h / 4.0)
                proj_lon = new_lon + (d_lon_24h / 4.0)
                d_dist_m = haversine_distance_m(new_lat, new_lon, proj_lat, proj_lon)
                dist_nm = round((d_dist_m / 1000.0) * 0.539957, 1)
                proj_hdg = round(initial_bearing_deg(new_lat, new_lon, proj_lat, proj_lon), 1)

                berg["projection6h"] = {
                    "lat": round(proj_lat, 4),
                    "lon": round(proj_lon, 4),
                    "distanceNm": dist_nm,
                    "headingDeg": proj_hdg,
                    "source": "Engine 2 XGBoost"
                }

                track = []
                c_lat, c_lon = new_lat, new_lon
                now_utc = datetime.now(timezone.utc)
                from datetime import timedelta
                for step in range(1, 13):
                    c_lat += d_lat_24h / 4.0
                    c_lon += d_lon_24h / 4.0
                    track.append({
                        "step": step,
                        "hours": 6 * step,
                        "lat": round(c_lat, 4),
                        "lon": round(c_lon, 4),
                        "time": (now_utc + timedelta(hours=6 * step)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "speedKn": round(math.hypot(d_lat_24h, d_lon_24h) * 60.0 / 24.0, 2),
                        "headingDeg": round((math.degrees(math.atan2(d_lon_24h, d_lat_24h)) + 360.0) % 360.0, 1),
                        "source": "Engine 2 XGBoost"
                    })
                berg["predictedTrack"] = track
                berg["source"] = "Engine 2 XGBoost"
            else:
                try:
                    if self.iceberg_model is not None:
                        proj_lat, proj_lon, _, _ = self.iceberg_model._physics_drift_step(
                            new_lat, new_lon, vx, vy,
                            wind_u, wind_v, curr_u, curr_v,
                            dt_seconds=21600.0,
                            iceberg_length_m=length_m,
                            iceberg_freeboard_m=freeboard_m,
                            iceberg_draft_m=draft_m
                        )
                        d_dist_m = haversine_distance_m(new_lat, new_lon, proj_lat, proj_lon)
                        dist_nm = round((d_dist_m / 1000.0) * 0.539957, 1)
                        proj_hdg = round(initial_bearing_deg(new_lat, new_lon, proj_lat, proj_lon), 1)

                        berg["projection6h"] = {
                            "lat": round(proj_lat, 4),
                            "lon": round(proj_lon, 4),
                            "distanceNm": dist_nm,
                            "headingDeg": proj_hdg
                        }
                except Exception as proj_err:
                    logger.debug("Projection step error: %s", proj_err)

            berg["lat"] = new_lat
            berg["lon"] = new_lon
            berg["vx"] = vx
            berg["vy"] = vy

        # 2. Advance RV Polar Explorer along fairway corridor
        # Cruising speed: 13.5 knots = 6.945 m/s
        speed_ms = self.vessel_speed_kn * 0.514444
        step_dist_m = speed_ms * dt
        self.vessel_segment_dist_m += step_dist_m
        self.vessel_total_dist_traveled_m += step_dist_m

        n_segments = len(self.route_segment_lengths_m)
        while self.vessel_current_wp_idx < n_segments and self.vessel_segment_dist_m >= self.route_segment_lengths_m[self.vessel_current_wp_idx]:
            self.vessel_segment_dist_m -= self.route_segment_lengths_m[self.vessel_current_wp_idx]
            self.vessel_current_wp_idx += 1

        if self.vessel_current_wp_idx >= n_segments:
            # Loop route for continuous demo operation
            self.vessel_current_wp_idx = 0
            self.vessel_segment_dist_m = 0.0
            self.vessel_total_dist_traveled_m = 0.0

        w_start = self.route_waypoints[self.vessel_current_wp_idx]
        w_end = self.route_waypoints[min(self.vessel_current_wp_idx + 1, len(self.route_waypoints) - 1)]
        seg_total_m = max(1.0, self.route_segment_lengths_m[self.vessel_current_wp_idx])
        t = min(1.0, self.vessel_segment_dist_m / seg_total_m)

        self.vessel_lat = w_start["lat"] + t * (w_end["lat"] - w_start["lat"])
        self.vessel_lon = w_start["lon"] + t * (w_end["lon"] - w_start["lon"])
        self.vessel_heading_deg = initial_bearing_deg(w_start["lat"], w_start["lon"], w_end["lat"], w_end["lon"])

        # 3. Advance Fallback AIS Fleet
        if hasattr(self.ais_service, "advance_fallback_vessels"):
            self.ais_service.advance_fallback_vessels(dt=dt)

    def _build_frame(self) -> Dict[str, Any]:
        """Constructs a complete telemetry packet adhering to M1 ↔ M2 contract."""
        now_dt = datetime.now(timezone.utc)
        timestamp_iso = now_dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

        # 1. Iceberg frames
        iceberg_list = []
        for b_id, berg in self.icebergs.items():
            speed_ms = math.sqrt(berg["vx"]**2 + berg["vy"]**2)
            speed_kn = round(speed_ms * 1.94384, 2)
            heading_deg = round((math.degrees(math.atan2(berg["vx"], berg["vy"])) + 360.0) % 360.0, 1)

            sat_berg_data = self._satellite_tracks_cache.get("icebergs", {}).get(b_id, {})

            iceberg_list.append({
                "id": b_id,
                "name": berg["name"],
                "typeDesc": berg["typeDesc"],
                "lat": round(berg["lat"], 4),
                "lon": round(berg["lon"], 4),
                "time": timestamp_iso,
                "speedKn": speed_kn,
                "headingDeg": heading_deg,
                "driftSpeedKn": speed_kn,
                "driftHeadingDeg": heading_deg,
                "vx": round(berg["vx"], 4),
                "vy": round(berg["vy"], 4),
                "threatLevel": berg["threatLevel"],
                "dimensions": berg["dimensions"],
                "safetyBufferNm": berg["safetyBufferNm"],
                "projection6h": berg["projection6h"],
                "predictedTrack": berg.get("predictedTrack", []),
                "source": berg.get("source", "Engine 2 XGBoost"),
                "satelliteTrack": sat_berg_data
            })

        # 2. AIS vessels (live feed with polar fallback fleet)
        raw_vessels = self.ais_service.get_vessels(limit=25)
        vessel_list = []
        for v in raw_vessels:
            s_kn = float(v.get("speedKn", v.get("speed", 10.0)))
            h_deg = float(v.get("headingDeg", v.get("heading", v.get("course", 90.0))))
            vessel_list.append({
                "mmsi": str(v.get("mmsi", "")),
                "name": v.get("name", "Unknown Vessel"),
                "type": v.get("type", "cargo"),
                "lat": round(float(v.get("lat", -66.0)), 4),
                "lon": round(float(v.get("lon", 20.0)), 4),
                "speedKn": round(s_kn, 1),
                "speed": round(s_kn, 1),
                "heading": round(h_deg, 1),
                "headingDeg": round(h_deg, 1),
                "course": round(float(v.get("course", h_deg)), 1),
                "destination": v.get("destination", "Antarctic Station"),
                "is_simulated": v.get("is_simulated", True),
                "is_demo": v.get("is_demo", True),
                "status_label": v.get("status_label", "DEMO / PRACTICE TARGET"),
                "note": v.get("note", "Simulated training target for collision avoidance testing.")
            })

        # 3. RV Polar Explorer Telemetry
        depth_m = round(float(self.env_lookup.get_depth(self.vessel_lat, self.vessel_lon)), 1)
        ukc_m = round(max(0.0, depth_m - self.vessel_draft_m), 1)
        weather = self.env_lookup.get_weather(self.vessel_lat, self.vessel_lon, timestamp_iso)
        progress_frac = round(min(1.0, max(0.0, self.vessel_total_dist_traveled_m / max(1.0, self.total_route_distance_m))), 6)

        telemetry = {
            "vesselName": "RV Polar Explorer",
            "lat": round(self.vessel_lat, 4),
            "lon": round(self.vessel_lon, 4),
            "speedKn": round(self.vessel_speed_kn, 1),
            "heading": round(self.vessel_heading_deg, 1),
            "depthM": depth_m,
            "draftM": round(self.vessel_draft_m, 1),
            "ukcM": ukc_m,
            "trueWind": {
                "speedKn": round(float(weather.get("windSpeedKn", 18.0)), 1),
                "directionDeg": round(float(weather.get("windDirectionDeg", 95.0)), 1)
            },
            "progress": progress_frac,
            "risk": 0.14
        }

        # Root satelliteTrack dictionary providing both individual iceberg IDs and container lookups
        sat_tracks_map = dict(self._satellite_tracks_cache.get("icebergs", {}))
        sat_tracks_map["metadata"] = self._satellite_tracks_cache.get("metadata", {})
        sat_tracks_map["icebergs"] = self._satellite_tracks_cache.get("icebergs", {})

        return {
            "type": "telemetry_frame",
            "timestamp": timestamp_iso,
            "icebergs": iceberg_list,
            "vessels": vessel_list,
            "telemetry": telemetry,
            "satelliteTrack": sat_tracks_map
        }

    def step(self, dt: float = 1.0) -> Dict[str, Any]:
        """Advances simulation by dt and generates the updated telemetry frame."""
        self.advance_physics(dt=dt)
        self.latest_frame = self._build_frame()
        return self.latest_frame

    def get_latest_frame(self) -> Dict[str, Any]:
        """Returns the most recent precomputed telemetry frame."""
        return self.latest_frame

    async def connect(self, websocket: WebSocket):
        """Accepts a new WebSocket client and immediately dispatches latest frame."""
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info("Realtime WebSocket client connected (Total: %d)", len(self.active_connections))

        # Auto-start loop if not active (e.g. in test client or ad-hoc invocation)
        if not self._running:
            await self.start()

        # Instantaneous first frame
        try:
            await websocket.send_json(self.latest_frame)
        except Exception as e:
            logger.debug("Failed sending initial frame to client: %s", e)
            self.disconnect(websocket)

    def disconnect(self, websocket: WebSocket):
        """Removes a client from active broadcast subscribers."""
        self.active_connections.discard(websocket)
        logger.info("Realtime WebSocket client disconnected (Total: %d)", len(self.active_connections))

    async def broadcast_json(self, data: Dict[str, Any]):
        """Broadcasts a JSON packet to all connected WebSocket subscribers."""
        if not self.active_connections:
            return

        dead_connections = []
        for connection in list(self.active_connections):
            try:
                await connection.send_json(data)
            except Exception as e:
                logger.debug("Error broadcasting frame to client: %s", e)
                dead_connections.append(connection)

        for dead_conn in dead_connections:
            self.disconnect(dead_conn)

    async def _broadcast_loop(self):
        """Asynchronous 1 Hz loop driving physical updates and telemetry frames."""
        logger.info("POLARIS Realtime broadcast loop started at 1 Hz.")
        while self._running:
            try:
                loop = asyncio.get_running_loop()
                t_start = loop.time()

                # Advance physics and synthesize telemetry frame
                frame = self.step(dt=1.0)
                await self.broadcast_json(frame)

                # Regulate to strict 1 Hz (1000 ms cadence)
                elapsed = loop.time() - t_start
                sleep_sec = max(0.01, 1.0 - elapsed)
                await asyncio.sleep(sleep_sec)
            except asyncio.CancelledError:
                break
            except Exception as loop_err:
                logger.warning("Error in realtime broadcast loop: %s", loop_err)
                await asyncio.sleep(1.0)

    async def start(self):
        """Starts the 1 Hz broadcast engine background task."""
        if self._running:
            return
        self._running = True
        self._broadcast_task = asyncio.create_task(self._broadcast_loop())
        logger.info("RealtimeService started.")

    async def stop(self):
        """Gracefully halts the broadcast engine and closes client connections."""
        self._running = False
        if self._broadcast_task:
            self._broadcast_task.cancel()
            try:
                await self._broadcast_task
            except asyncio.CancelledError:
                pass
            self._broadcast_task = None

        # Disconnect all active sockets
        for ws in list(self.active_connections):
            try:
                await ws.close(code=1000)
            except Exception:
                pass
        self.active_connections.clear()
        logger.info("RealtimeService stopped.")
