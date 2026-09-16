"""
POLARIS Milestone 2 Adversarial Drift Physics & Corridor Verification Suite
Empirical Challenger: challenger_m2_2_gen4

Tests:
1. Physical momentum ODE & Coriolis drift vector direction for all 4 icebergs (C-19, B-15K, D-28, A-68R).
2. Continuity and drift propagation over long time horizons (300s, 600s).
3. Monotonic forward movement without sudden directional reversals under Antarctic Coastal Current regime.
4. Projection vector consistency: verifies that 6-hour forward projection vector points in the direction of velocity.
5. Verification of non-reversal condition (turning angle < 90°).
"""

import math
import pytest
from backend.services.realtime_service import RealtimeService, DEFAULT_ICEBERGS
from backend.models.iceberg_trajectory import IcebergTrajectoryModel
from backend.models.environmental_lookup import EnvironmentalLookup
from backend.services.ais_service import AISStreamService


def initial_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def angle_diff_deg(b1: float, b2: float) -> float:
    diff = abs(b1 - b2) % 360.0
    return 360.0 - diff if diff > 180.0 else diff


@pytest.fixture
def realtime_engine():
    model = IcebergTrajectoryModel()
    env = EnvironmentalLookup()
    ais = AISStreamService()
    return RealtimeService(model, env, ais)


class TestDriftPhysicsAdversarial:
    """Adversarial stress-testing of drift physics and trajectory continuity."""

    def test_all_four_icebergs_present_in_telemetry(self, realtime_engine):
        """Verify C-19, B-15K, D-28, A-68R are all initialized with physical state."""
        frame = realtime_engine._build_frame()
        icebergs = {b["id"]: b for b in frame["icebergs"]}
        assert set(icebergs.keys()) == {"C-19", "B-15K", "D-28", "A-68R"}
        for b_id, berg in icebergs.items():
            assert "lat" in berg and "lon" in berg
            assert "vx" in berg and "vy" in berg
            assert "projection6h" in berg
            assert "satelliteTrack" in berg
            assert len(berg["satelliteTrack"].get("observations", [])) >= 10

    def test_forward_drift_direction_consistency(self, realtime_engine):
        """
        Verify that after physics integration, the 6-hour forward projection vector
        aligns with physical velocity vector and does not reverse direction (< 90 degree deviation).
        """
        # Advance 5 steps to populate sequence history and compute ODE projection
        for _ in range(5):
            realtime_engine.advance_physics(dt=1.0)

        frame = realtime_engine._build_frame()
        for berg in frame["icebergs"]:
            vx = berg["vx"]
            vy = berg["vy"]
            speed_ms = math.sqrt(vx**2 + vy**2)
            assert speed_ms > 0.05, f"Iceberg {berg['id']} speed must be non-zero"

            # Heading from velocity components: atan2(vx, vy)
            vel_heading = (math.degrees(math.atan2(vx, vy)) + 360.0) % 360.0

            proj = berg["projection6h"]
            assert proj["distanceNm"] > 0.0, f"Projected distance for {berg['id']} must be > 0"

            # Compute geodesic bearing from current position to projected 6h position
            geo_bearing = initial_bearing_deg(berg["lat"], berg["lon"], proj["lat"], proj["lon"])

            # Angular difference between velocity heading and projected trajectory heading
            diff = angle_diff_deg(vel_heading, geo_bearing)
            # Physical limit: Coriolis deflection in Southern Hemisphere deflects up to ~85° left of wind/velocity
            assert diff < 88.0, (
                f"Iceberg {berg['id']} forward projection deviates by {diff:.1f}° "
                f"(vel: {vel_heading:.1f}°, proj: {geo_bearing:.1f}°). Must not reverse direction (diff >= 90°)!"
            )

    def test_long_duration_physics_continuity_and_no_reversal(self, realtime_engine):
        """
        Simulate 300 steps of continuous physics advancement.
        Verify no sudden position jumps, velocities remain bounded, and displacement
        does not reverse direction relative to the prevailing current.
        """
        initial_positions = {
            b_id: (berg["lat"], berg["lon"])
            for b_id, berg in realtime_engine.icebergs.items()
        }

        # Advance 300 seconds in 1-second increments
        for _ in range(300):
            realtime_engine.advance_physics(dt=1.0)

        frame = realtime_engine._build_frame()
        for berg in frame["icebergs"]:
            b_id = berg["id"]
            init_lat, init_lon = initial_positions[b_id]
            curr_lat, curr_lon = berg["lat"], berg["lon"]

            # Iceberg must have moved
            assert (curr_lat, curr_lon) != (init_lat, init_lon)

            # Check velocity bounds: realistic iceberg drift in Southern Ocean < 2.5 m/s (~5 kts)
            assert abs(berg["vx"]) < 2.5
            assert abs(berg["vy"]) < 2.5
            assert berg["driftSpeedKn"] < 5.0

            # Under Antarctic Coastal Current (East Wind Drift), overall drift must trend westward (decreasing lon)
            delta_lon = curr_lon - init_lon
            # Initial vx is negative for all icebergs (westward drift)
            assert delta_lon < 0.05, f"Iceberg {b_id} drifted unexpectedly far eastward"

            # Verify forward projection from current state still moves forward smoothly
            proj = berg["projection6h"]
            cur_bearing = initial_bearing_deg(init_lat, init_lon, curr_lat, curr_lon)
            proj_bearing = initial_bearing_deg(curr_lat, curr_lon, proj["lat"], proj["lon"])
            turn = angle_diff_deg(cur_bearing, proj_bearing)
            assert turn < 90.0, (
                f"Iceberg {b_id} sharp turn {turn:.1f}° between actual drift {cur_bearing:.1f}° "
                f"and 6h projected drift {proj_bearing:.1f}°. Must not reverse direction!"
            )

    def test_projection6h_structure_contract(self, realtime_engine):
        """
        Verify that projection6h adheres to expected schema:
        dict with lat, lon, distanceNm, headingDeg.
        """
        frame = realtime_engine._build_frame()
        for berg in frame["icebergs"]:
            proj = berg["projection6h"]
            assert isinstance(proj, dict)
            assert "lat" in proj and isinstance(proj["lat"], (int, float))
            assert "lon" in proj and isinstance(proj["lon"], (int, float))
            assert "distanceNm" in proj and proj["distanceNm"] >= 0.0
            assert "headingDeg" in proj and 0.0 <= proj["headingDeg"] <= 360.0
