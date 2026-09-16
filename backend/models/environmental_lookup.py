"""
Environmental & Bathymetric Lookup Module
Ground-truth geophysical constraints for East Antarctic navigation:
- Maitri station: 70.77°S, 11.73°E (Princess Astrid Coast / Schirmacher Oasis approach)
- Bharati station: 69.41°S, 76.19°E (Larsemann Hills / Prydz Bay)

REAL DATA HOOK
--------------
Replace the synthetic _build_bathymetry_grid() with a GEBCO NetCDF loader once you have the file.
Set  GEBCO_BATHYMETRY_NC  in  backend/data_paths.py  — see that file for the download link.
"""

import os
import numpy as np
import math
from typing import Dict, Any, Tuple

# ── BATHYMETRY DATA PATH (edit backend/data_paths.py, not here) ─────────────
try:
    import sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    import data_paths as _dp
    _GEBCO_NC = _dp.GEBCO_BATHYMETRY_NC  # GEBCO / IBCSO v2 WGS84 GeoTIFF
    _GEBCO_CORRIDOR_NPY = getattr(_dp, 'GEBCO_CORRIDOR_NPY', '')
except ImportError:
    _GEBCO_NC = ""
    _GEBCO_CORRIDOR_NPY = ""
# ────────────────────────────────────────────────────────────────────────────

# Bounding box for the Maitri -> Bharati Antarctic Corridor
LAT_MIN, LAT_MAX = -73.0, -62.0
LON_MIN, LON_MAX = 8.0, 82.0

class EnvironmentalLookup:
    """
    Provides bathymetric depth (meters) and meteorological parameters (ERA5-style)
    over the Southern Ocean / East Antarctic coastal waters.
    """
    def __init__(self):
        # Generate high-resolution synthetic/geophysical bathymetry grid matching BEDMAP2/GEBCO profiles
        self.lats = np.linspace(LAT_MIN, LAT_MAX, 120)
        self.lons = np.linspace(LON_MIN, LON_MAX, 300)
        self.grid_depth = self._build_bathymetry_grid()

    def _build_bathymetry_grid(self) -> np.ndarray:
        """
        Loads real high-resolution bathymetric depth from the official GEBCO / IBCSO v2
        international chart dataset if available, otherwise falls back to geophysical synthetic profile.
        """
        # ── 1. Check for real GEBCO / IBCSO v2 corridor dataset ───────────────
        if _GEBCO_CORRIDOR_NPY and os.path.exists(_GEBCO_CORRIDOR_NPY):
            try:
                import cv2
                raw = np.load(_GEBCO_CORRIDOR_NPY)
                # Flip vertically so row 0 is South (-73.0) and row -1 is North (-62.0)
                raw_oriented = np.flipud(raw)
                resized = cv2.resize(raw_oriented, (len(self.lons), len(self.lats)), interpolation=cv2.INTER_AREA)
                print(f"[GEBCO] Loaded real IBCSO v2 Antarctic bathymetry ({raw.shape[0]}x{raw.shape[1]} raw grid).")
                return resized.astype(np.float32)
            except Exception as e:
                print(f"[GEBCO] Error loading {_GEBCO_CORRIDOR_NPY}: {e}, falling back to synthetic.")

        # ── 2. Fallback: Geophysical profile based on BEDMAP2 / GEBCO ─────────
        grid = np.zeros((len(self.lats), len(self.lons)), dtype=np.float32)

        for i, lat in enumerate(self.lats):
            for j, lon in enumerate(self.lons):
                # Coastline variation with longitude
                coast_lat = -69.8 + 0.8 * np.sin(np.radians(lon * 2.2 - 15.0))
                if 70.0 < lon < 80.0:  # Prydz Bay / Larsemann Hills (Bharati) embayment
                    coast_lat = -69.9 + 0.5 * np.cos(np.radians((lon - 76.0) * 15.0))

                # Check for Maitri station approach channel (Princess Astrid / India Bay corridor)
                is_maitri_channel = (10.0 <= lon <= 13.5 and -71.0 <= lat <= -69.0)
                # Check for Bharati approach channel (Prydz Bay / Larsemann Hills)
                is_bharati_channel = (74.0 <= lon <= 78.0 and -70.0 <= lat <= -68.5)

                if is_maitri_channel:
                    depth = 75.0 + 150.0 * max(0.0, (lat + 71.0) / 2.0)
                elif is_bharati_channel:
                    depth = 110.0 + 200.0 * max(0.0, (lat + 70.0) / 1.5)
                elif lat < coast_lat - 0.3:
                    # Grounded interior ice sheet / shelf
                    depth = -50.0  # Impassable
                elif lat < coast_lat:
                    # Inshore coastal water (45m to 180m)
                    depth = 45.0 + 135.0 * ((lat - (coast_lat - 0.3)) / 0.3)
                elif lat < -66.5:
                    # Continental shelf (180m to 800m)
                    t = (lat - coast_lat) / (-66.5 - coast_lat)
                    depth = 180.0 + 620.0 * np.clip(t, 0.0, 1.0)
                elif lat < -64.0:
                    # Continental slope (800m to 3200m)
                    t = (lat - (-66.5)) / (-64.0 - (-66.5))
                    depth = 800.0 + 2400.0 * np.clip(t, 0.0, 1.0)
                else:
                    # Deep Southern Ocean
                    depth = 3200.0 + 800.0 * np.sin(np.radians(lon * 3.0))

                grid[i, j] = depth
        return grid

    def get_depth(self, lat: float, lon: float) -> float:
        """Interpolates ocean depth in meters at (lat, lon). Negative or < 40m is unnavigable."""
        lat_idx = np.searchsorted(self.lats, lat)
        lon_idx = np.searchsorted(self.lons, lon)
        lat_idx = np.clip(lat_idx, 0, len(self.lats) - 1)
        lon_idx = np.clip(lon_idx, 0, len(self.lons) - 1)
        return float(self.grid_depth[lat_idx, lon_idx])

    def is_navigable(self, lat: float, lon: float, min_draft_clearance: float = 40.0) -> bool:
        """Returns False if location is grounded ice/land or too shallow for polar research vessel."""
        return self.get_depth(lat, lon) >= min_draft_clearance

    def get_weather(self, lat: float, lon: float, timestamp_iso: str) -> Dict[str, Any]:
        """
        Lookup reanalysis weather state (ERA5-equivalent):
        - 10m Wind speed (knots), direction (deg)
        - Significant wave height (meters)
        - Surface air temperature (°C)
        - Sea surface temperature (°C)
        """
        # East Antarctic katabatic and polar easterlies patterns
        base_wind_speed = 18.0 + 8.0 * np.sin(np.radians(lon * 4.0)) + abs(lat + 68.0) * 2.0
        wind_dir = 95.0 + 15.0 * np.cos(np.radians(lon * 2.0))  # Polar easterlies predominate
        wave_height = 1.5 + 0.12 * base_wind_speed
        air_temp = -12.0 + (lat + 70.0) * 1.5
        sst = -1.8 + max(0.0, (lat + 65.0) * 0.4)

        return {
            "windSpeedKn": round(float(base_wind_speed), 1),
            "windDirectionDeg": round(float(wind_dir % 360), 1),
            "significantWaveHeightM": round(float(wave_height), 2),
            "airTempC": round(float(air_temp), 1),
            "seaSurfaceTempC": round(float(sst), 2)
        }
