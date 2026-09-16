"""
Antarctic Maritime Route Optimizer (A* & Dijkstra Pathfinder)
Solves multi-objective safe, fuel-efficient paths between Antarctic Research Stations:
- Maitri Station (70.77°S, 11.73°E)
- Bharati Station (69.41°S, 76.19°E)
Subject to:
1. Geodesic distance (Haversine metric)
2. Bathymetric depth clearance (BEDMAP2 / GEBCO shelf constraints)
3. Sea-ice risk field (CNN model output)
4. Dynamic iceberg safety buffer zones
"""

import math
import heapq
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple, Optional
import numpy as np

# Coordinates of Anchor Stations
MAITRI_COORD = {"lat": -70.77, "lon": 11.73, "name": "Maitri Station"}
BHARATI_COORD = {"lat": -69.41, "lon": 76.19, "name": "Bharati Station"}

class AntarcticRouteOptimizer:
    def __init__(self, environmental_lookup, sea_ice_model):
        self.env = environmental_lookup
        self.sea_ice = sea_ice_model

        # Define optimization search graph grid
        # Southern ocean corridor from 8°E to 80°E, 72°S to 63°S
        self.n_lat = 45
        self.n_lon = 140
        self.lats = np.linspace(-71.5, -63.5, self.n_lat)
        self.lons = np.linspace(9.0, 78.0, self.n_lon)

    @staticmethod
    def haversine_distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Computes great-circle distance in Nautical Miles (NM)."""
        r_earth_nm = 3440.065
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0)**2
        c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
        return r_earth_nm * c

    def _find_nearest_node(self, lat: float, lon: float) -> Tuple[int, int]:
        i = int(np.argmin(np.abs(self.lats - lat)))
        j = int(np.argmin(np.abs(self.lons - lon)))
        return (i, j)

    @staticmethod
    def _interpolate_iceberg_position(berg: Dict[str, Any], hours_elapsed: float) -> Tuple[float, float]:
        """Interpolates iceberg position at a specific future hour along its trajectory."""
        track = berg.get("predictedTrack", [])
        if not track or hours_elapsed <= 0.0:
            return float(berg["lat"]), float(berg["lon"])

        if hours_elapsed >= track[-1].get("hours", 72.0):
            return float(track[-1]["lat"]), float(track[-1]["lon"])

        for idx, pt in enumerate(track):
            pt_hrs = float(pt.get("hours", 6 * (idx + 1)))
            if pt_hrs >= hours_elapsed:
                if idx == 0:
                    prev_lat, prev_lon, prev_hrs = float(berg["lat"]), float(berg["lon"]), 0.0
                else:
                    prev_pt = track[idx - 1]
                    prev_lat = float(prev_pt["lat"])
                    prev_lon = float(prev_pt["lon"])
                    prev_hrs = float(prev_pt.get("hours", 6 * idx))

                d_h = max(0.1, pt_hrs - prev_hrs)
                alpha = (hours_elapsed - prev_hrs) / d_h
                interp_lat = prev_lat + alpha * (float(pt["lat"]) - prev_lat)
                interp_lon = prev_lon + alpha * (float(pt["lon"]) - prev_lon)
                return interp_lat, interp_lon

        return float(track[-1]["lat"]), float(track[-1]["lon"])

    def _is_segment_clear(self, lat1: float, lon1: float, lat2: float, lon2: float, risk_matrix: np.ndarray, num_samples: int = 8) -> bool:
        """Verifies that a straight line between two waypoints maintains bathymetric clearance and does not cut land."""
        for s in range(1, num_samples):
            frac = s / float(num_samples)
            sample_lat = lat1 + frac * (lat2 - lat1)
            sample_lon = lon1 + frac * (lon2 - lon1)
            depth = self.env.get_depth(sample_lat, sample_lon)
            if depth < 35.0:
                return False
            # Check ice barrier
            i, j = self._find_nearest_node(sample_lat, sample_lon)
            if float(risk_matrix[i, j]) >= 0.94:
                return False
        return True

    def compute_optimal_route(
        self,
        start_lat: float = MAITRI_COORD["lat"],
        start_lon: float = MAITRI_COORD["lon"],
        end_lat: float = BHARATI_COORD["lat"],
        end_lon: float = BHARATI_COORD["lon"],
        start_time_iso: str = "2026-09-07T00:00:00Z",
        risk_grid: Optional[List[Dict[str, Any]]] = None,
        icebergs: Optional[List[Dict[str, Any]]] = None,
        ice_risk_weight: float = 8.0,
        safety_margin_nm: float = 15.0
    ) -> Dict[str, Any]:
        """
        Executes 4D Spatiotemporal A* search on the navigation cost graph (x, y, t).
        Evaluates dynamic iceberg avoidance at the estimated vessel arrival time,
        preventing artificial blockages from static trajectory corridors.
        """
        start_dt = datetime.fromisoformat(start_time_iso.replace("Z", "+00:00"))

        # Build risk lookup table
        risk_matrix = np.zeros((self.n_lat, self.n_lon), dtype=np.float32)
        if risk_grid is not None:
            for item in risk_grid:
                i = int(np.argmin(np.abs(self.lats - item["lat"])))
                j = int(np.argmin(np.abs(self.lons - item["lon"])))
                risk_matrix[i, j] = max(risk_matrix[i, j], item["risk"])

        # Check if start is inland near Maitri (-70.77S, 11.73E)
        # Establish marine departure at India Bay (-69.90S, 11.95E) on the ice shelf barrier
        is_maitri_departure = abs(start_lat - (-70.77)) < 0.3 and abs(start_lon - 11.73) < 0.5
        marine_start_lat = -69.90 if is_maitri_departure else start_lat
        marine_start_lon = 11.95 if is_maitri_departure else start_lon

        start_node = self._find_nearest_node(marine_start_lat, marine_start_lon)
        end_node = self._find_nearest_node(end_lat, end_lon)

        directions = [
            (-1, 0), (1, 0), (0, -1), (0, 1),
            (-1, -1), (-1, 1), (1, -1), (1, 1)
        ]

        # Priority queue for 4D A*: (f_score, cost_g, node, elapsed_hours)
        open_set = []
        start_h = self.haversine_distance_nm(
            self.lats[start_node[0]], self.lons[start_node[1]],
            self.lats[end_node[0]], self.lons[end_node[1]]
        )
        heapq.heappush(open_set, (start_h, 0.0, start_node, 0.0))

        came_from: Dict[Tuple[int, int], Tuple[int, int]] = {}
        g_score: Dict[Tuple[int, int], float] = {start_node: 0.0}
        time_elapsed_hours: Dict[Tuple[int, int], float] = {start_node: 0.0}
        visited = set()
        base_speed_kn = 14.0

        while open_set:
            _, current_g, current, current_t = heapq.heappop(open_set)

            if current in visited:
                continue
            visited.add(current)

            if current == end_node:
                break

            ci, cj = current
            curr_lat, curr_lon = self.lats[ci], self.lons[cj]

            for di, dj in directions:
                ni, nj = ci + di, cj + dj
                if not (0 <= ni < self.n_lat and 0 <= nj < self.n_lon):
                    continue

                neighbor = (ni, nj)
                if neighbor in visited:
                    continue

                next_lat, next_lon = self.lats[ni], self.lons[nj]

                # 1. Bathymetric Feasibility (BEDMAP2 / GEBCO shelf)
                depth = self.env.get_depth(next_lat, next_lon)
                if depth < 35.0:
                    continue

                # 2. Step Geodesic Distance
                step_dist = self.haversine_distance_nm(curr_lat, curr_lon, next_lat, next_lon)

                # 3. Sea-Ice Risk & Vessel Transit Speed
                cell_risk = float(risk_matrix[ni, nj])
                if cell_risk >= 0.95:
                    continue

                step_speed = max(4.0, base_speed_kn * (1.0 - 0.7 * cell_risk))
                step_dt_hours = max(0.1, step_dist / step_speed)
                tentative_t = current_t + step_dt_hours

                # 4. 4D Spatiotemporal Dynamic Iceberg Avoidance
                # Evaluates iceberg distance precisely at the vessel's arrival time window
                berg_penalty = 0.0
                if icebergs:
                    for berg in icebergs:
                        # Query iceberg location at arrival time window [t - 2h, t + 2h]
                        for offset in (0.0, -2.0, 2.0):
                            eval_t = max(0.0, tentative_t + offset)
                            b_lat, b_lon = self._interpolate_iceberg_position(berg, eval_t)
                            b_dist = self.haversine_distance_nm(next_lat, next_lon, b_lat, b_lon)
                            if b_dist < safety_margin_nm:
                                factor = ((safety_margin_nm - b_dist) / safety_margin_nm) ** 2
                                berg_penalty = max(berg_penalty, 85.0 * factor)

                shallow_factor = max(0.0, (150.0 - depth) / 100.0) * 1.5 if depth < 150.0 else 0.0
                step_cost = step_dist * (1.0 + ice_risk_weight * (cell_risk ** 1.8) + shallow_factor) + berg_penalty

                tentative_g = current_g + step_cost

                if neighbor not in g_score or tentative_g < g_score[neighbor]:
                    g_score[neighbor] = tentative_g
                    time_elapsed_hours[neighbor] = tentative_t
                    came_from[neighbor] = current
                    h = self.haversine_distance_nm(
                        next_lat, next_lon,
                        self.lats[end_node[0]], self.lons[end_node[1]]
                    )
                    heapq.heappush(open_set, (tentative_g + h, tentative_g, neighbor, tentative_t))

        # Reconstruct path
        path_nodes = []
        curr = end_node
        if curr not in came_from and curr != start_node:
            if visited:
                best_node = min(visited, key=lambda n: self.haversine_distance_nm(self.lats[n[0]], self.lons[n[1]], end_lat, end_lon))
                curr = best_node
            else:
                curr = start_node

        while curr in came_from:
            path_nodes.append(curr)
            curr = came_from[curr]
        path_nodes.append(start_node)
        path_nodes.reverse()

        # Bathymetry-Safe Line-of-Sight Waypoint Simplification
        # Replaces naive striding with safety-verified intermediate points
        simplified_nodes = [path_nodes[0]]
        i = 0
        while i < len(path_nodes) - 1:
            # Look ahead up to 12 nodes for a clear navigable straight sightline
            max_lookahead = min(len(path_nodes) - 1, i + 10)
            next_idx = i + 1
            for j in range(max_lookahead, i + 1, -1):
                p1_lat, p1_lon = float(self.lats[path_nodes[i][0]]), float(self.lons[path_nodes[i][1]])
                p2_lat, p2_lon = float(self.lats[path_nodes[j][0]]), float(self.lons[path_nodes[j][1]])
                if self._is_segment_clear(p1_lat, p1_lon, p2_lat, p2_lon, risk_matrix):
                    next_idx = j
                    break
            simplified_nodes.append(path_nodes[next_idx])
            i = next_idx

        if path_nodes[-1] not in simplified_nodes:
            simplified_nodes.append(path_nodes[-1])

        # Generate timestamps, speeds, and depths along route
        waypoints = []
        current_time = start_dt

        # If departing from Maitri inland station, insert station anchor + overland ice-traverse leg
        if is_maitri_departure:
            waypoints.append({
                "lat": round(start_lat, 4),
                "lon": round(start_lon, 4),
                "time": current_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "speedKn": 8.0,
                "name": "Maitri Station (Schirmacher Oasis)",
                "leg": "overland_traverse",
                "depthM": 50.0
            })
            # 3 hours for coastal logistics traverse to India Bay ice shelf
            current_time += timedelta(hours=3.0)

        prev_lat = marine_start_lat
        prev_lon = marine_start_lon

        for idx, node in enumerate(simplified_nodes):
            if idx == 0 and not is_maitri_departure:
                wp_lat, wp_lon = start_lat, start_lon
            elif idx == len(simplified_nodes) - 1:
                wp_lat, wp_lon = end_lat, end_lon
            else:
                wp_lat = float(self.lats[node[0]])
                wp_lon = float(self.lons[node[1]])

            seg_dist = self.haversine_distance_nm(prev_lat, prev_lon, wp_lat, wp_lon)
            node_i, node_j = node
            local_risk = float(risk_matrix[node_i, node_j])
            speed = max(4.0, base_speed_kn * (1.0 - 0.7 * local_risk))

            if idx > 0 or is_maitri_departure:
                hours_needed = max(0.2, seg_dist / speed)
                current_time += timedelta(hours=hours_needed)

            node_depth = round(float(self.env.get_depth(wp_lat, wp_lon)), 1)

            waypoints.append({
                "lat": round(wp_lat, 4),
                "lon": round(wp_lon, 4),
                "time": current_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "speedKn": round(speed, 1),
                "depthM": node_depth,
                "risk": round(local_risk, 3),
                "leg": "marine_fairway"
            })

            prev_lat, prev_lon = wp_lat, wp_lon

        return {"waypoints": waypoints}
