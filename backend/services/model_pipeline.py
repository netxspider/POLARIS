"""Production boundary for the standalone POLARIS model pipeline.

The model directory contains the trained Engine 1/2 artifacts and Engine 3
planner. This service owns loading those artifacts, refreshing external inputs,
and translating their outputs into the backend data contract.
"""

import csv
import io
import json
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("polaris.model_pipeline")


class ModelPipelineService:
    """Lazy, cache-backed orchestration for Engines 1, 2, and 3."""

    def __init__(self, project_root: Optional[str] = None):
        self.root = project_root or os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
        self.model_dir = os.path.join(self.root, "model")
        self.cache_dir = os.path.join(self.model_dir, "live_cache")
        os.makedirs(self.cache_dir, exist_ok=True)
        self._lock = threading.Lock()
        self._navigator = None
        self._models = None
        self._last_refresh: Optional[str] = None
        self._last_sources: Dict[str, Any] = {}
        self._last_forecast: Optional[np.ndarray] = None
        self._last_bathymetry: Optional[np.ndarray] = None
        self._last_depth: Optional[np.ndarray] = None
        self._land_mask: Optional[np.ndarray] = None
        self._last_iceberg_tracks: Dict[str, Any] = {}
        self._last_optimal_path: List[Tuple[float, float]] = []
        self._last_departure: Tuple[float, float] = (-70.77, 11.73)
        self._last_arrival: Tuple[float, float] = (-69.41, 76.19)

    def _load_navigator(self):
        if self._navigator is None:
            from model import realtime_navigator

            self._navigator = realtime_navigator
        return self._navigator

    def _get_land_mask(self, nav) -> np.ndarray:
        """Retrieve precomputed Natural Earth land mask for 0-90E, -80 to -50S."""
        if self._land_mask is not None and self._land_mask.shape == (nav.GRID_H, nav.GRID_W):
            return self._land_mask

        cache_file = os.path.join(self.cache_dir, f"land_mask_{nav.GRID_H}_{nav.GRID_W}.npy")
        if os.path.exists(cache_file):
            try:
                self._land_mask = np.load(cache_file)
                return self._land_mask
            except Exception as exc:
                logger.warning("Failed to load cached land mask: %s", exc)

        fallback_file = os.path.join(self.cache_dir, "land_mask_256_256.npy")
        if os.path.exists(fallback_file):
            try:
                from PIL import Image
                base_mask = np.load(fallback_file)
                img = Image.fromarray(base_mask.astype(np.uint8) * 255)
                resized = img.resize((nav.GRID_W, nav.GRID_H), Image.Resampling.NEAREST)
                self._land_mask = np.array(resized) > 127
                np.save(cache_file, self._land_mask)
                return self._land_mask
            except Exception as exc:
                logger.warning("Failed to resize fallback land mask: %s", exc)

        return np.zeros((nav.GRID_H, nav.GRID_W), dtype=bool)

    def status(self) -> Dict[str, Any]:
        """Return artifact and feed availability without loading PyTorch models."""
        files = {
            "engine1_checkpoint": "best_seaice_convlstm.pth",
            "engine1_tensor": "polaris_engine1_dataset.npz",
            "engine2_latitude": "engine2_drift_lat_xgb.pkl",
            "engine2_longitude": "engine2_drift_lon_xgb.pkl",
            "bathymetry": "IBCSO_bed.tif",
        }
        artifacts = {name: os.path.exists(os.path.join(self.model_dir, path)) for name, path in files.items()}
        return {
            "status": "ready" if all(artifacts.values()) else "degraded",
            "artifacts": artifacts,
            "lastRefresh": self._last_refresh,
            "sources": self._last_sources,
            "engines": {
                "engine1": "ConvLSTM 7-day input -> 72-hour sea-ice concentration",
                "engine2": "XGBoost drift regressors -> 72-hour iceberg trajectories",
                "engine3": "time-dependent A* over bathymetry, ice, currents, and wind",
            },
        }

    def _fetch_url(self, url: str, timeout: int = 15) -> Optional[bytes]:
        try:
            import requests

            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
            return response.content
        except Exception as exc:
            logger.warning("Feed request failed for %s: %s", url, exc)
            return None

    def _load_usnic_positions(self) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
        """Load official USNIC Antarctic major-iceberg observations."""
        url = os.getenv(
            "POLARIS_USNIC_ICEBERG_URL",
            "https://usicecenter.gov/File/DownloadCurrent?pId=134",
        ).strip()
        bundled = os.path.join(self.model_dir, "AntarcticIcebergs_20260910.csv")
        target = os.path.join(self.cache_dir, "live_icebergs.csv")
        content = self._fetch_url(url) if url else None
        source = "usnic-live"
        if content:
            with open(target, "wb") as handle:
                handle.write(content)
        elif os.path.exists(bundled):
            target = bundled
            source = "usnic-local-20260910"
        elif not os.path.exists(target):
            return {}, {"status": "unavailable", "source": source, "url": url}
        else:
            source = "usnic-cache"

        try:
            with open(target, "r", encoding="utf-8-sig") as f:
                text = f.read()
            rows = list(csv.DictReader(io.StringIO(text)))
            if not rows:
                return {}, {"status": "empty", "source": source}
            keys = {key.lower().strip(): key for key in rows[0]}
            lat_key = next((keys[k] for k in keys if "lat" in k), None)
            lon_key = next((keys[k] for k in keys if "lon" in k), None)
            id_key = next((keys[k] for k in keys if any(token in k for token in ("iceberg", "name", "id"))), None)
            if not all((lat_key, lon_key, id_key)):
                return {}, {"status": "invalid", "source": source}

            positions: Dict[str, Dict[str, Any]] = {}
            for row in rows:
                try:
                    lat = float(row[lat_key])
                    lon = float(row[lon_key])
                    if -90.0 <= lat <= -45.0 and -180.0 <= lon <= 180.0:
                        iceberg_id = str(row[id_key]).strip()
                        positions[iceberg_id] = {
                            "lat": lat,
                            "lon": lon,
                            "lengthNm": float(row.get("Length (NM)") or 0),
                            "widthNm": float(row.get("Width (NM)") or 0),
                            "areaSqNm": float(row.get("Area (sqNM)") or 0),
                            "areaSqKm": float(row.get("Area (sqKM)") or 0),
                            "lastUpdate": row.get("Last Update", ""),
                        }
                except (TypeError, ValueError, KeyError):
                    continue
            return positions, {"status": "ok", "source": source, "count": len(positions), "url": url, "date": "2026-09-10"}
        except Exception as exc:
            logger.warning("USNIC CSV parsing failed: %s", exc)
            return {}, {"status": "invalid", "source": source}

    def _load_observation_tensor(self) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Load the latest 7-day tensor from the Engine 1 dataset."""
        path = os.path.join(self.model_dir, "polaris_engine1_dataset.npz")
        remote_url = os.getenv("POLARIS_ENGINE1_TENSOR_URL", "").strip()
        remote_cache = os.path.join(self.cache_dir, "latest_engine1_tensor.npz")
        if remote_url:
            content = self._fetch_url(remote_url, timeout=30)
            if content:
                with open(remote_cache, "wb") as handle:
                    handle.write(content)
                path = remote_cache
        if not os.path.exists(path):
            return np.zeros((1, 7, 6, 128, 128), dtype=np.float32), {"status": "missing", "source": "engine1-cache"}
        try:
            tensor = np.load(path)["X"][-1:]
            source = "engine1-near-real-time-cache" if path == remote_cache else "engine1-local-tensor"
            return tensor.astype(np.float32), {"status": "ok", "source": source, "shape": list(tensor.shape)}
        except Exception as exc:
            logger.warning("Engine 1 tensor load failed: %s", exc)
            return np.zeros((1, 7, 6, 128, 128), dtype=np.float32), {"status": "invalid", "source": "engine1-cache"}

    def _load_models(self):
        if self._models is not None:
            return self._models
        nav = self._load_navigator()
        import joblib
        import torch

        lat_model = joblib.load(os.path.join(self.model_dir, "engine2_drift_lat_xgb.pkl"))
        lon_model = joblib.load(os.path.join(self.model_dir, "engine2_drift_lon_xgb.pkl"))
        sea_ice = nav.PolarSeaIceConvLSTM().to(nav.device)
        checkpoint = torch.load(os.path.join(self.model_dir, "best_seaice_convlstm.pth"), map_location=nav.device)
        sea_ice.load_state_dict(checkpoint.get("model_state", checkpoint) if isinstance(checkpoint, dict) else checkpoint)
        sea_ice.eval()
        self._models = (lat_model, lon_model, sea_ice)
        return self._models

    def _predict_icebergs(self, positions: Dict[str, Dict[str, Any]], start: datetime, official: bool = False) -> List[Dict[str, Any]]:
        nav = self._load_navigator()
        lat_model, lon_model, _ = self._load_models()
        if not positions:
            positions = {
                "A-68A_Tracked": {"lat": -62.5, "lon": 42.0},
                "B-15Y_Tracked": {"lat": -64.8, "lon": 55.2},
                "D-28_Calf": {"lat": -66.1, "lon": 70.4},
            }

        results = []
        import pandas as pd

        for berg_id, observation in positions.items():
            lat = float(observation["lat"])
            lon = float(observation["lon"])
            length_km = float(observation.get("lengthNm") or 0) * 1.852
            if length_km <= 0:
                length_km = float(observation.get("dimensions", {}).get("lengthKm", 10.0))
            width_km = float(observation.get("widthNm") or 0) * 1.852
            if width_km <= 0:
                width_km = float(observation.get("dimensions", {}).get("widthKm", 6.0))

            track = []
            curr_lat, curr_lon = lat, lon
            for step in range(1, 13):
                # 13 features required by Engine 2 XGBoost models:
                # ['lat', 'lon', 'length_km', 'width_km', 'uo', 'vo', 'curr_speed', 'u10', 'v10', 'wind_speed', 'thetao', 'depth_m', 'coriolis_f']
                u10 = -5.0 + 1.5 * np.sin(np.radians(curr_lon * 3.0))
                v10 = 2.0 * np.cos(np.radians(curr_lon * 2.5))
                w_spd = float(np.hypot(u10, v10))
                uo = 0.25 + 0.05 * np.cos(np.radians(curr_lon * 2.0))
                vo = 0.05 * np.sin(np.radians(curr_lon * 3.0))
                c_spd = float(np.hypot(uo, vo))
                coriolis = float(2.0 * 7.2921e-5 * np.sin(np.radians(curr_lat)))

                features = {
                    "lat": curr_lat, "lon": curr_lon, "length_km": length_km, "width_km": width_km,
                    "uo": uo, "vo": vo, "curr_speed": c_spd, "u10": u10,
                    "v10": v10, "wind_speed": w_spd, "thetao": -1.5, "depth_m": -2500.0,
                    "coriolis_f": coriolis,
                }

                row = pd.DataFrame([features])
                d_lat_24h = float(lat_model.predict(row)[0])
                d_lon_24h = float(lon_model.predict(row)[0])
                # Convert 24h drift prediction to 6h step (/ 4.0)
                curr_lat += d_lat_24h / 4.0
                curr_lon += d_lon_24h / 4.0

                speed_kn = round(float(np.hypot(d_lat_24h, d_lon_24h) * 60.0 / 24.0), 2)
                heading_deg = round(float((np.degrees(np.arctan2(d_lon_24h, d_lat_24h)) + 360.0) % 360.0), 1)

                track.append({
                    "step": step,
                    "hours": 6 * step,
                    "lat": round(curr_lat, 5),
                    "lon": round(curr_lon, 5),
                    "speedKn": speed_kn,
                    "headingDeg": heading_deg,
                    "time": (start + timedelta(hours=6 * step)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                })

            results.append({
                "id": berg_id,
                "name": observation.get("name", f"Iceberg {berg_id}"),
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "predictedTrack": track,
                "source": "Engine 2 XGBoost",
                "observation": observation,
                "dimensions": {
                    "lengthKm": round(length_km, 2),
                    "widthKm": round(width_km, 2),
                    "lengthNm": observation.get("lengthNm"),
                    "widthNm": observation.get("widthNm"),
                    "areaSqNm": observation.get("areaSqNm"),
                    "areaSqKm": observation.get("areaSqKm"),
                },
            })
        return results

    @staticmethod
    def _nearest_navigable(nav, mask: np.ndarray, lat: float, lon: float) -> Tuple[float, float]:
        row, col = nav.coord_to_grid(lat, lon)
        candidates = []
        for radius in range(0, max(nav.GRID_H, nav.GRID_W)):
            for drow in range(-radius, radius + 1):
                for dcol in range(-radius, radius + 1):
                    candidate_row = row + drow
                    candidate_col = col + dcol
                    if not (0 <= candidate_row < nav.GRID_H and 0 <= candidate_col < nav.GRID_W):
                        continue
                    if not mask[candidate_row, candidate_col]:
                        return nav.grid_to_coord(candidate_row, candidate_col)
        raise ValueError("No navigable bathymetry cell exists in the model domain")

    def run(self, start_lat: float, start_lon: float, end_lat: float, end_lon: float) -> Dict[str, Any]:
        """Refresh inputs and run all three engines for a requested voyage."""
        with self._lock:
            nav = self._load_navigator()
            import torch

            start = datetime.now(timezone.utc).replace(microsecond=0)
            positions, usnic_status = self._load_usnic_positions()
            observation_tensor, tensor_status = self._load_observation_tensor()
            lat_model, lon_model, sea_ice = self._load_models()

            with torch.no_grad():
                raw = sea_ice(torch.from_numpy(observation_tensor).float())
                forecast = raw.squeeze(2).cpu().numpy()[0]

            sic = nav.F.interpolate(
                torch.from_numpy(forecast).unsqueeze(0), size=(nav.GRID_H, nav.GRID_W), mode="bilinear", align_corners=False
            ).numpy()[0]
            current = np.zeros((3, 2, nav.GRID_H, nav.GRID_W), dtype=np.float32)
            wind = np.zeros((3, 2, nav.GRID_H, nav.GRID_W), dtype=np.float32)
            iceberg_data = self._predict_icebergs(positions, start, official=usnic_status.get("status") == "ok")
            tracks = {item["id"]: [(item["lat"], item["lon"])] + [(p["lat"], p["lon"]) for p in item["predictedTrack"]] for item in iceberg_data}
            bathy = nav.load_bathymetry_mask(os.path.join(self.model_dir, "IBCSO_bed.tif"))
            land_mask = self._get_land_mask(nav)
            bathy = bathy | land_mask
            from optimizer.maritime_fairways import MaritimeFairwayRouter, haversine_nm

            fairway_router = MaritimeFairwayRouter()
            is_global_departure = (start_lat > nav.LAT_NORTH or start_lon < nav.LON_WEST or start_lon > nav.LON_EAST)

            if is_global_departure:
                ocean_path = fairway_router.route_to_polar_gate(start_lat, start_lon, target_lon=end_lon)
                polar_gate = ocean_path[-1]
                marine_start = self._nearest_navigable(nav, bathy, polar_gate[0], polar_gate[1])
                marine_end = self._nearest_navigable(nav, bathy, end_lat, end_lon)
                planner = nav.DynamicPolarAStar(sic, current, wind, tracks, bathy)
                polar_path, polar_hours, polar_cost = planner.find_route(*marine_start, *marine_end)
                if not polar_path:
                    raise ValueError("No navigable route found for the requested coordinates")

                ocean_dist_nm = sum(
                    haversine_nm(ocean_path[i][0], ocean_path[i][1], ocean_path[i+1][0], ocean_path[i+1][1])
                    for i in range(len(ocean_path) - 1)
                )
                ocean_hours = ocean_dist_nm / nav.CRUISE_SPEED_KTS
                hours = ocean_hours + float(polar_hours)
                cost = float(polar_cost) + ocean_dist_nm
                path = ocean_path[:-1] + polar_path + [(end_lat, end_lon)]
            else:
                marine_start = self._nearest_navigable(nav, bathy, start_lat, start_lon)
                marine_end = self._nearest_navigable(nav, bathy, end_lat, end_lon)
                planner = nav.DynamicPolarAStar(sic, current, wind, tracks, bathy)
                polar_path, hours, cost = planner.find_route(*marine_start, *marine_end)
                if not polar_path:
                    raise ValueError("No navigable route found for the requested coordinates")
                path = [(start_lat, start_lon), *polar_path, (end_lat, end_lon)]

            route = {"waypoints": [{
                "lat": round(float(lat), 5), "lon": round(float(lon), 5),
                "time": (start + timedelta(hours=float(hours) * idx / max(1, len(path) - 1))).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "speedKn": nav.CRUISE_SPEED_KTS,
                "source": "Engine 3 Polar A*" if (not is_global_departure or idx >= len(ocean_path) - 1) else "Oceanic Fairway",
                "leg": "anchor" if idx in (0, len(path) - 1) else ("oceanic_fairway" if is_global_departure and idx < len(ocean_path) - 1 else "marine_fairway")
            } for idx, (lat, lon) in enumerate(path)], "summary": {
                "transitHours": round(float(hours), 2), "cost": round(float(cost), 2), "engine": "Engine 3 + Global Fairway" if is_global_departure else "Engine 3"
            }}
            risk_grid = [{
                "lat": round(float(nav.LAT_NORTH - (i / (nav.GRID_H - 1)) * (nav.LAT_NORTH - nav.LAT_SOUTH)), 4),
                "lon": round(float(nav.LON_WEST + (j / (nav.GRID_W - 1)) * (nav.LON_EAST - nav.LON_WEST)), 4),
                "time": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "risk": round(float(sic[0, i, j]), 4),
            } for i in range(nav.GRID_H) for j in range(nav.GRID_W)]
            self._last_refresh = start.isoformat().replace("+00:00", "Z")
            self._last_sources = {"usnic": usnic_status, "observationTensor": tensor_status, "bathymetry": "IBCSO local raster"}
            self._last_forecast = sic
            self._last_bathymetry = bathy
            self._last_depth = self._sample_depth_grid(nav)
            self._last_iceberg_tracks = tracks
            self._last_optimal_path = path
            self._last_departure = (start_lat, start_lon)
            self._last_arrival = (end_lat, end_lon)
            return {"iceRiskGrid": risk_grid, "icebergs": iceberg_data, "route": route, "sources": self._last_sources, "generatedAt": self._last_refresh}

    def _ensure_outputs(self) -> None:
        if self._last_forecast is None or self._last_bathymetry is None or self._last_depth is None:
            self.run(-70.77, 11.73, -69.41, 76.19)

    def _sample_depth_grid(self, nav) -> np.ndarray:
        """Sample actual IBCSO bed elevations after transforming WGS84 points."""
        import rasterio
        from rasterio.warp import transform
        from rasterio.sample import sample_gen

        path = os.path.join(self.model_dir, "IBCSO_bed.tif")
        if not os.path.exists(path):
            return np.full((nav.GRID_H, nav.GRID_W), -2500.0, dtype=np.float32)
        with rasterio.open(path) as raster:
            lats = []
            lons = []
            for row in range(nav.GRID_H):
                for col in range(nav.GRID_W):
                    lats.append(nav.LAT_NORTH - (row / (nav.GRID_H - 1)) * (nav.LAT_NORTH - nav.LAT_SOUTH))
                    lons.append(nav.LON_WEST + (col / (nav.GRID_W - 1)) * (nav.LON_EAST - nav.LON_WEST))
            xs, ys = transform("EPSG:4326", raster.crs, lons, lats)
            samples = sample_gen(raster, zip(xs, ys), indexes=1)
            values = np.array([float(sample[0]) for sample in samples], dtype=np.float32)
            values[values == float(raster.nodata)] = np.nan
        return values.reshape(nav.GRID_H, nav.GRID_W)

    def render_ice_overlay(self, step: int = 0) -> bytes:
        """Render a predicted sea-ice concentration step as a Cesium image."""
        from PIL import Image
        import matplotlib.pyplot as plt

        self._ensure_outputs()
        nav = self._load_navigator()
        land_mask = self._get_land_mask(nav)
        ocean_mask = ~land_mask & np.isfinite(self._last_depth) & (self._last_depth < 0)

        step = max(0, min(int(step), self._last_forecast.shape[0] - 1))
        grid = np.clip(self._last_forecast[step], 0.0, 1.0)
        
        # Blues_r colormap matches engine3: 0.0 is deep ocean blue, 1.0 is pure white pack ice
        cmap = plt.cm.Blues_r
        rgba = (cmap(grid) * 255).astype(np.uint8)

        # Alpha: transparent over open ocean (grid < 0.02) and over land
        alpha = np.where(
            ocean_mask & (grid >= 0.02),
            np.clip((grid - 0.02) / 0.98 * 190.0 + 40.0, 0, 230).astype(np.uint8),
            0
        )
        rgba[..., 3] = alpha

        # In Cesium SingleTileImageryProvider, Row 0 maps to northern edge (-50°S).
        # Our grid Row 0 is LAT_NORTH (-50°S). DO NOT flipud!
        image = Image.fromarray(rgba, mode="RGBA").resize((1024, 512), Image.Resampling.BICUBIC)
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        return output.getvalue()

    def render_bathymetry_overlay(self) -> bytes:
        """Render actual local IBCSO bed elevations as a shallow-to-deep overlay."""
        from PIL import Image
        import matplotlib.pyplot as plt

        self._ensure_outputs()
        nav = self._load_navigator()
        land_mask = self._get_land_mask(nav)
        depth = self._last_depth
        ocean_mask = ~land_mask & np.isfinite(depth) & (depth < 0)

        # Depth range: -5500m (abyssal plain) to 0m (sea level)
        clipped_depth = np.clip(np.nan_to_num(depth, nan=-5500.0), -5500.0, 0.0)
        normalized = (clipped_depth - (-5500.0)) / 5500.0

        cmap = plt.cm.viridis
        rgba = (cmap(normalized) * 255).astype(np.uint8)

        # Alpha: strictly 0 over land and subglacial depressions; 205 over ocean
        rgba[..., 3] = np.where(ocean_mask, 205, 0).astype(np.uint8)

        # In Cesium SingleTileImageryProvider, Row 0 maps to northern edge (-50°S).
        # DO NOT flipud!
        image = Image.fromarray(rgba, mode="RGBA").resize((1024, 512), Image.Resampling.BICUBIC)
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        return output.getvalue()

    def render_pipeline_plot(self, dpi: int = 150) -> bytes:
        """Render polar stereographic plot of Engine 1 ice, Engine 2 drift, and Engine 3 route."""
        from model import engine3

        self._ensure_outputs()
        sic_day0 = self._last_forecast[0] if self._last_forecast is not None else np.zeros((256, 256), dtype=np.float32)
        iceberg_tracks = self._last_iceberg_tracks
        optimal_path = self._last_optimal_path
        departure = getattr(self, "_last_departure", (-70.77, 11.73))
        arrival = getattr(self, "_last_arrival", (-69.41, 76.19))

        return engine3.render_polar_pipeline_plot(
            sic_day0=sic_day0,
            iceberg_tracks=iceberg_tracks,
            optimal_path=optimal_path,
            departure=departure,
            arrival=arrival,
            dpi=dpi,
        )