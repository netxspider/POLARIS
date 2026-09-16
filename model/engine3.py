"""Engine 3: global time-dependent A* route optimization.

This module consumes real model/environment arrays. It never creates synthetic
sea ice, current, wind, or bathymetry data and never executes a demo on import.
Arrays use ``[forecast_day, channel, row, column]`` for vector fields and
``[forecast_day, row, column]`` for sea-ice concentration.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass
from typing import Dict, Iterable, Optional, Sequence, Tuple

import numpy as np

EARTH_RADIUS_NM = 3440.065
KNOTS_PER_MS = 1.94384
DEFAULT_SPEED_KTS = 14.0
DEFAULT_ICEBERG_BUFFER_NM = 6.0


def haversine_nmi(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlambda = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_NM * math.atan2(math.sqrt(a), math.sqrt(max(0, 1 - a)))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    x = math.sin(dlambda) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


@dataclass(frozen=True)
class RouteResult:
    path: list[tuple[float, float]]
    transit_hours: float
    cost: float


class GlobalAdaptiveRouter:
    """A* over a dynamically sized global grid with real environmental fields."""

    def __init__(
        self,
        sea_ice: np.ndarray,
        currents: np.ndarray,
        winds: np.ndarray,
        bathymetry: np.ndarray,
        iceberg_tracks: Optional[Dict[str, Sequence[Tuple[float, float]]]] = None,
        land_mask: Optional[np.ndarray] = None,
        grid_bounds: Optional[Tuple[float, float, float, float]] = None,
        iceberg_buffer_nm: float = DEFAULT_ICEBERG_BUFFER_NM,
        speed_kts: float = DEFAULT_SPEED_KTS,
    ):
        if sea_ice.ndim != 3 or currents.ndim != 4 or winds.ndim != 4 or bathymetry.ndim != 2:
            raise ValueError("Invalid Engine 3 array dimensions")
        if sea_ice.shape[1:] != bathymetry.shape or currents.shape[2:] != bathymetry.shape or winds.shape[2:] != bathymetry.shape:
            raise ValueError("Sea ice, vectors, and bathymetry grids must share spatial dimensions")
        if currents.shape[1] < 2 or winds.shape[1] < 2:
            raise ValueError("Current and wind arrays require u/v channels")
        self.sic = np.nan_to_num(sea_ice, nan=1.0)
        self.curr = np.nan_to_num(currents, nan=0.0)
        self.wind = np.nan_to_num(winds, nan=0.0)
        self.bathy = np.asarray(bathymetry, dtype=bool)
        self.land = np.asarray(land_mask, dtype=bool) if land_mask is not None else np.zeros_like(self.bathy)
        self.bergs = iceberg_tracks or {}
        self.buffer_nm = iceberg_buffer_nm
        self.speed_kts = speed_kts
        if grid_bounds is None:
            raise ValueError("grid_bounds=(lat_south, lat_north, lon_west, lon_east) is required")
        self.lat_south, self.lat_north, self.lon_west, self.lon_east = grid_bounds
        self.days = self.sic.shape[0]
        self.grid_h, self.grid_w = self.bathy.shape

    def coord_to_grid(self, lat: float, lon: float) -> tuple[int, int]:
        row = round((self.lat_north - lat) / (self.lat_north - self.lat_south) * (self.grid_h - 1))
        col = round((lon - self.lon_west) / (self.lon_east - self.lon_west) * (self.grid_w - 1))
        return int(np.clip(row, 0, self.grid_h - 1)), int(np.clip(col, 0, self.grid_w - 1))

    def grid_to_coord(self, row: int, col: int) -> tuple[float, float]:
        lat = self.lat_north - row / (self.grid_h - 1) * (self.lat_north - self.lat_south)
        lon = self.lon_west + col / (self.grid_w - 1) * (self.lon_east - self.lon_west)
        return lat, lon

    def _valid(self, row: int, col: int) -> bool:
        return not self.bathy[row, col] and not self.land[row, col]

    def nearest_water(self, lat: float, lon: float) -> tuple[float, float]:
        row, col = self.coord_to_grid(lat, lon)
        for radius in range(max(self.grid_h, self.grid_w)):
            for dr in range(-radius, radius + 1):
                for dc in range(-radius, radius + 1):
                    rr, cc = row + dr, col + dc
                    if 0 <= rr < self.grid_h and 0 <= cc < self.grid_w and self._valid(rr, cc):
                        return self.grid_to_coord(rr, cc)
        raise ValueError("No navigable water cell exists in the requested domain")

    def _time_index(self, hours: float) -> int:
        return min(int(hours // 24), self.days - 1)

    def _iceberg_clear(self, lat: float, lon: float, hours: float) -> bool:
        index = self._time_index(hours)
        for track in self.bergs.values():
            if not track:
                continue
            b_lat, b_lon = track[min(index, len(track) - 1)]
            if haversine_nmi(lat, lon, b_lat, b_lon) < self.buffer_nm:
                return False
        return True

    def _edge(self, row: int, col: int, next_row: int, next_col: int, hours: float) -> tuple[float, float]:
        if not self._valid(next_row, next_col):
            return math.inf, 0.0
        index = self._time_index(hours)
        lat1, lon1 = self.grid_to_coord(row, col)
        lat2, lon2 = self.grid_to_coord(next_row, next_col)
        if not self._iceberg_clear(lat2, lon2, hours):
            return math.inf, 0.0
        ice = float(np.clip(self.sic[index, next_row, next_col], 0, 1))
        if ice >= 0.95:
            return math.inf, 0.0
        distance = haversine_nmi(lat1, lon1, lat2, lon2)
        heading = math.radians(bearing_deg(lat1, lon1, lat2, lon2))
        hx, hy = math.sin(heading), math.cos(heading)
        current = (self.curr[index, 0, next_row, next_col] * hx + self.curr[index, 1, next_row, next_col] * hy) * KNOTS_PER_MS
        wind = (self.wind[index, 0, next_row, next_col] * hx + self.wind[index, 1, next_row, next_col] * hy) * KNOTS_PER_MS
        ground_speed = max(2.5, self.speed_kts * (1 - 0.7 * ice ** 1.5) + 0.7 * current)
        hours_needed = distance / ground_speed
        cost = distance * (1 + 10 * ice ** 2) * (1 + max(0, -wind) * 0.03)
        return cost, hours_needed

    def find_route(self, start_lat: float, start_lon: float, goal_lat: float, goal_lon: float) -> RouteResult:
        start = self.nearest_water(start_lat, start_lon)
        goal = self.nearest_water(goal_lat, goal_lon)
        start_node, goal_node = self.coord_to_grid(*start), self.coord_to_grid(*goal)
        queue = [(0.0, 0.0, 0.0, start_node[0], start_node[1])]
        came_from: Dict[tuple[int, int], tuple[int, int]] = {}
        best: Dict[tuple[int, int, int], float] = {}
        elapsed: Dict[tuple[int, int], float] = {start_node: 0.0}
        directions = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]
        while queue:
            _, cost_so_far, hours, row, col = heapq.heappop(queue)
            if (row, col) == goal_node:
                break
            state = (row, col, int(hours // 6))
            if best.get(state, math.inf) <= cost_so_far:
                continue
            best[state] = cost_so_far
            for dr, dc in directions:
                rr, cc = row + dr, col + dc
                if not (0 <= rr < self.grid_h and 0 <= cc < self.grid_w):
                    continue
                edge_cost, edge_hours = self._edge(row, col, rr, cc, hours)
                if not math.isfinite(edge_cost):
                    continue
                new_cost, new_hours = cost_so_far + edge_cost, hours + edge_hours
                if new_cost >= elapsed.get((rr, cc), math.inf):
                    continue
                elapsed[(rr, cc)] = new_cost
                came_from[(rr, cc)] = (row, col)
                lat, lon = self.grid_to_coord(rr, cc)
                heuristic = haversine_nmi(lat, lon, *goal)
                heapq.heappush(queue, (new_cost + heuristic, new_cost, new_hours, rr, cc))
        if goal_node not in came_from and goal_node != start_node:
            raise ValueError("No navigable route found")
        nodes = [goal_node]
        while nodes[-1] != start_node:
            nodes.append(came_from[nodes[-1]])
        nodes.reverse()
        path = [start, *[self.grid_to_coord(row, col) for row, col in nodes[1:-1]], goal]
        return RouteResult(path=path, transit_hours=elapsed.get(goal_node, 0.0), cost=best.get((goal_node[0], goal_node[1], int(elapsed.get(goal_node, 0.0) // 6)), 0.0))


# ==========================================
# SEA ICE CONCENTRATION & ROUTE PLOTTERS
# ==========================================

def plot_sea_ice_spatial_distribution(sic_data: np.ndarray, save_path: Optional[str] = None):
    """
    Plots the 2D spatial distribution of sea ice concentration mapped correctly
    over the Antarctic coordinate region (Latitude -80°S to -50°S, Longitude 0°E to 90°E).
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, 3, figsize=(20, 6.5))
    days = ["Day 1 Forecast", "Day 2 Forecast", "Day 3 Forecast"]
    im = None

    for i in range(min(3, len(sic_data))):
        ax = axes[i]
        im = ax.imshow(
            np.clip(sic_data[i], 0.0, 1.0) * 100,
            cmap="Blues_r",
            origin="upper",  # Row 0 is -50°S (North), Row max is -80°S (South)
            extent=[0.0, 90.0, -80.0, -50.0],
            vmin=0,
            vmax=100
        )
        ax.set_title(f"Antarctic Sea Ice Concentration - {days[i]}", fontsize=12, fontweight="bold")
        ax.set_xlabel("Longitude (°E)")
        ax.set_ylabel("Latitude (°S)")
        ax.grid(True, linestyle="--", alpha=0.5)

    if im is not None:
        cbar_ax = fig.add_axes([0.92, 0.15, 0.02, 0.7])
        fig.colorbar(im, cax=cbar_ax, label="Sea Ice Concentration (%)")

    plt.suptitle("Spatial Evolution of Antarctic Sea Ice Concentration (Latitude -80°S to -50°S)", fontsize=15, fontweight="bold", y=1.02)
    if save_path:
        fig.savefig(save_path, bbox_inches="tight", dpi=300)
    return fig


def plot_antarctic_polar_projection(sic_data: np.ndarray, save_path: Optional[str] = None):
    """
    Plots South Polar Stereographic projection of Antarctic Sea Ice Concentration
    centered near 45°E over 0°E to 90°E, -80°S to -50°S.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import cartopy.crs as ccrs
    import cartopy.feature as cfeature

    projection = ccrs.SouthPolarStereo(central_longitude=45.0)
    fig, axes = plt.subplots(1, 3, figsize=(20, 8), subplot_kw={"projection": projection})
    days = ["Day 1 Forecast", "Day 2 Forecast", "Day 3 Forecast"]
    im = None

    lons = np.linspace(0.0, 90.0, sic_data.shape[-1])
    lats = np.linspace(-50.0, -80.0, sic_data.shape[-2])
    lon_grid, lat_grid = np.meshgrid(lons, lats)

    for i in range(min(3, len(sic_data))):
        ax = axes[i]
        ax.set_extent([0.0, 90.0, -80.0, -50.0], crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND, facecolor="lightgray", edgecolor="black")
        ax.gridlines(draw_labels=True, linestyle="--", alpha=0.5)

        im = ax.pcolormesh(
            lon_grid,
            lat_grid,
            np.clip(sic_data[i], 0.0, 1.0) * 100,
            cmap="Blues_r",
            transform=ccrs.PlateCarree(),
            shading="auto",
            vmin=0,
            vmax=100,
            alpha=0.85
        )
        ax.set_title(f"Antarctic SIC - {days[i]}", fontsize=12, fontweight="bold")

    if im is not None:
        cbar_ax = fig.add_axes([0.93, 0.2, 0.02, 0.6])
        fig.colorbar(im, cax=cbar_ax, label="Sea Ice Concentration (%)")

    plt.suptitle("True Polar Stereographic Projection of Antarctic Sea Ice Concentration", fontsize=16, fontweight="bold", y=0.95)
    if save_path:
        fig.savefig(save_path, bbox_inches="tight", dpi=300)
    return fig


def render_polar_pipeline_plot(
    sic_day0: np.ndarray,
    iceberg_tracks: Dict[str, Sequence[Tuple[float, float]]],
    optimal_path: Sequence[Tuple[float, float]],
    departure: Tuple[float, float] = (-70.77, 11.73),
    arrival: Tuple[float, float] = (-69.41, 76.19),
    dpi: int = 150
) -> bytes:
    """
    Renders the exact POLARIS Full Pipeline Route Generation figure:
    (ML Iceberg Predictions + ConvLSTM SIC Forecast)
    on South Polar Stereographic projection, returning PNG bytes.
    """
    import io
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import cartopy.crs as ccrs
    import cartopy.feature as cfeature

    projection = ccrs.SouthPolarStereo(central_longitude=45.0)
    fig, ax = plt.subplots(figsize=(12, 10), subplot_kw={"projection": projection})
    ax.set_extent([0.0, 90.0, -80.0, -50.0], crs=ccrs.PlateCarree())

    # Add geography
    ax.add_feature(cfeature.LAND, facecolor="lightgray", edgecolor="black")
    ax.gridlines(draw_labels=True, linestyle="--", alpha=0.5)

    # 1. Overlay Sea Ice Concentration Heatmap
    grid_h, grid_w = sic_day0.shape
    lons = np.linspace(0.0, 90.0, grid_w)
    # Row 0 is North (-50), Row max is South (-80)
    lats = np.linspace(-50.0, -80.0, grid_h)
    lon_grid, lat_grid = np.meshgrid(lons, lats)

    im = ax.pcolormesh(
        lon_grid,
        lat_grid,
        np.clip(sic_day0, 0.0, 1.0) * 100.0,
        cmap="Blues_r",
        transform=ccrs.PlateCarree(),
        shading="auto",
        vmin=0,
        vmax=100,
        alpha=0.85
    )

    # 2. Plot Iceberg Trajectories (Engine 2 XGBoost)
    for idx, (b_id, track) in enumerate(iceberg_tracks.items()):
        if not track:
            continue
        b_lats = [pt[0] for pt in track]
        b_lons = [pt[1] for pt in track]
        ax.plot(b_lons, b_lats, color="magenta", linestyle=":", linewidth=2, label="Engine 2 Drift Track" if idx == 0 else None, transform=ccrs.PlateCarree())
        ax.scatter(
            b_lons[0],
            b_lats[0],
            color="red",
            marker="X",
            s=120,
            label="Iceberg Initial Position" if idx == 0 else None,
            transform=ccrs.PlateCarree(),
            zorder=6
        )
        ax.text(b_lons[0] + 0.6, b_lats[0] + 0.3, b_id, color="#990000", fontsize=9, fontweight="bold", transform=ccrs.PlateCarree())

    # 3. Plot Optimal Maritime Passage Plan
    if optimal_path:
        p_lats = [pt[0] for pt in optimal_path]
        p_lons = [pt[1] for pt in optimal_path]
        ax.plot(p_lons, p_lats, color="#eab308", linewidth=4, label="Optimal Path", transform=ccrs.PlateCarree(), zorder=5)

    ax.scatter(departure[1], departure[0], color="green", marker="o", s=150, label="Departure", transform=ccrs.PlateCarree(), zorder=7)
    ax.scatter(arrival[1], arrival[0], color="darkorange", marker="*", s=200, label="Arrival", transform=ccrs.PlateCarree(), zorder=7)

    fig.colorbar(im, ax=ax, shrink=0.65, label="Sea Ice Concentration (%)")
    ax.set_title("POLARIS Full Pipeline Route Generation\n(ML Iceberg Predictions + ConvLSTM SIC Forecast)", fontsize=14, fontweight="bold", pad=12)
    ax.legend(loc="lower left", framealpha=0.9)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=dpi)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()

