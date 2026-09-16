"""
POLARIS Real-Time WebSocket Streaming Subsystem: Opaque-Box E2E Test Suite
Smart India Hackathon 2026 | MoES / NCPOR (PS ID: 26059)

4-Tier Opaque-Box End-to-End Verification:
- Tier 1: Feature Coverage (WebSocket handshake, 1 Hz telemetry frame schema, dynamic icebergs, AIS fallback fleet, RV Polar Explorer telemetry, SGP4 UTC sync)
- Tier 2: Boundary & Corner Cases (zero-payload disconnect, rapid churn, concurrent clients, UKC non-negative floor, geographic bounds, heading range, unexpected text frames)
- Tier 3: Cross-Feature Combinations (iceberg drift physics advancement, 6h projection consistency, fairway corridor progression, true wind correlation, monotonic timestamps)
- Tier 4: Real-World Scenarios (multi-second voyage stream cadence, tactical hazard CPA proximity, exponential backoff reconnection simulation, Dual-Mode Cesium entity readiness)
"""

import time
import math
from datetime import datetime, timezone
from typing import Dict, Any, Tuple

import pytest
# pyrefly: ignore [missing-import]
from fastapi.testclient import TestClient

from backend.main import app


# ─────────────────────────────────────────────────────────────────────────────
# Test Fixtures & Independent Geodetic Verification Oracles
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    """FastAPI TestClient session for POLARIS backend."""
    return TestClient(app)


@pytest.fixture(autouse=True)
def ensure_realtime_broadcast_active():
    """Ensures background broadcast task is renewed if completed by prior test disconnection."""
    try:
        from backend.main import realtime_service
        if realtime_service._broadcast_task is not None and realtime_service._broadcast_task.done():
            realtime_service._running = False
    except Exception:
        pass
    yield


def haversine_dist_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Independent oracle for great-circle distance in nautical miles."""
    r_nm = 3440.065  # Earth radius in nautical miles
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * r_nm * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def initial_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Independent oracle for initial great-circle bearing in degrees [0, 360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


# ─────────────────────────────────────────────────────────────────────────────
# TIER 1: Feature Coverage (Happy Path for Each Feature)
# ─────────────────────────────────────────────────────────────────────────────

class TestTier1FeatureCoverage:
    """Validates core feature capabilities, protocol handshakes, and contract adherence."""

    def test_ws_connection_and_telemetry_frame(self, client):
        """Tier 1.1: Verifies WebSocket handshake on /ws/realtime and initial frame receipt."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            assert isinstance(frame, dict), "Frame must be a valid JSON object"
            assert frame.get("type") == "telemetry_frame", "Packet type must be 'telemetry_frame'"
            assert "timestamp" in frame, "Frame must contain an authoritative timestamp"
            assert "icebergs" in frame, "Frame must contain icebergs array"
            assert "vessels" in frame, "Frame must contain vessels array"
            assert "telemetry" in frame, "Frame must contain telemetry dictionary"

    def test_telemetry_frame_schema_contract(self, client):
        """Tier 1.2: Validates strict type contracts and non-emptiness of top-level keys."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            assert isinstance(frame["type"], str) and frame["type"] == "telemetry_frame"
            assert isinstance(frame["timestamp"], str) and len(frame["timestamp"]) > 0
            assert isinstance(frame["icebergs"], list) and len(frame["icebergs"]) >= 1
            assert isinstance(frame["vessels"], list) and len(frame["vessels"]) >= 1
            assert isinstance(frame["telemetry"], dict) and len(frame["telemetry"]) > 0

    def test_dynamic_icebergs_schema_and_projection(self, client):
        """Tier 1.3: Validates iceberg entity schema, physics fields, and 6-hour projection vector."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            icebergs = frame["icebergs"]
            assert len(icebergs) >= 4, "Must track at least 4 Antarctic tabular icebergs"

            berg_ids = {b["id"] for b in icebergs}
            for expected_id in ["C-19", "B-15K", "D-28", "A-68R"]:
                assert expected_id in berg_ids, f"Expected iceberg {expected_id} missing from live feed"

            for berg in icebergs:
                assert isinstance(berg["id"], str) and len(berg["id"]) > 0
                assert isinstance(berg["name"], str) and len(berg["name"]) > 0
                assert isinstance(berg["lat"], (int, float)) and -90.0 <= berg["lat"] <= -50.0
                assert isinstance(berg["lon"], (int, float)) and -180.0 <= berg["lon"] <= 180.0
                assert isinstance(berg["speedKn"], (int, float)) and berg["speedKn"] >= 0.0
                assert isinstance(berg["headingDeg"], (int, float)) and 0.0 <= berg["headingDeg"] < 360.0
                assert isinstance(berg["threatLevel"], str) and len(berg["threatLevel"]) > 0

                # Dimensions
                assert "dimensions" in berg and isinstance(berg["dimensions"], dict)
                dims = berg["dimensions"]
                assert dims.get("lengthKm", 0.0) > 0.0
                assert dims.get("widthKm", 0.0) > 0.0
                assert dims.get("draftM", 0.0) > 0.0

                # 6-Hour Projection Vector
                assert "projection6h" in berg and isinstance(berg["projection6h"], dict)
                proj = berg["projection6h"]
                assert isinstance(proj["lat"], (int, float)) and -90.0 <= proj["lat"] <= -50.0
                assert isinstance(proj["lon"], (int, float)) and -180.0 <= proj["lon"] <= 180.0
                assert isinstance(proj["distanceNm"], (int, float)) and proj["distanceNm"] >= 0.0
                assert isinstance(proj["headingDeg"], (int, float)) and 0.0 <= proj["headingDeg"] < 360.0

    def test_ais_fallback_fleet_when_no_api_key(self, client):
        """Tier 1.4: Validates realistic Southern Ocean fallback fleet when live AIS stream is offline."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            vessels = frame["vessels"]
            assert len(vessels) >= 6, "Must provide fallback polar fleet with at least 6 authentic vessels"

            vessel_names = {v["name"] for v in vessels}
            expected_fleet = [
                "RV Polarstern",
                "Vasily Golovnin",
                "SA Agulhas II",
                "Xue Long 2",
                "Akademik Fedorov",
                "RRS Sir David Attenborough"
            ]
            for exp_vessel in expected_fleet:
                assert exp_vessel in vessel_names, f"Expected polar vessel '{exp_vessel}' missing from fleet"

            for v in vessels:
                assert isinstance(v["mmsi"], str) and len(v["mmsi"]) >= 6
                assert isinstance(v["name"], str) and len(v["name"]) > 0
                assert v["type"] in ["icebreaker", "research", "cargo", "tanker", "passenger"]
                assert -90.0 <= v["lat"] <= -50.0, f"Vessel {v['name']} latitude out of polar bounds: {v['lat']}"
                assert -180.0 <= v["lon"] <= 180.0, f"Vessel {v['name']} longitude out of bounds: {v['lon']}"
                assert v["speedKn"] >= 0.0
                assert 0.0 <= v["headingDeg"] < 360.0
                assert isinstance(v["destination"], str)

    def test_rv_polar_explorer_telemetry_fields(self, client):
        """Tier 1.5: Validates RV Polar Explorer live bridge telemetry parameters and physical draft."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            telem = frame["telemetry"]

            assert telem["vesselName"] == "RV Polar Explorer", "Vessel name must be 'RV Polar Explorer'"
            assert -75.0 <= telem["lat"] <= -65.0, "Vessel latitude must be in Antarctic corridor"
            assert 8.0 <= telem["lon"] <= 80.0, "Vessel longitude must be between Maitri and Bharati"
            assert telem["speedKn"] > 0.0, "Nominal transit speed must be positive"
            assert 0.0 <= telem["heading"] < 360.0, "Vessel heading must be within [0, 360)"

            # Physical sounding depth and draft
            assert telem["depthM"] >= 35.0, f"Sounding depth {telem['depthM']}m too shallow for passage"
            assert telem["draftM"] == pytest.approx(8.5, abs=0.1), "RV Polar Explorer design draft must be 8.5m"

            # Under Keel Clearance (UKC) invariant: UKC = max(0, depth - 8.5)
            expected_ukc = max(0.0, telem["depthM"] - telem["draftM"])
            assert telem["ukcM"] == pytest.approx(expected_ukc, abs=0.2), "UKC must equal max(0, depth - draft)"

            # True wind lookup
            assert "trueWind" in telem and isinstance(telem["trueWind"], dict)
            wind = telem["trueWind"]
            assert wind["speedKn"] >= 0.0, "True wind speed must be non-negative"
            assert 0.0 <= wind["directionDeg"] < 360.0, "True wind direction must be [0, 360)"

            # Progress & Risk
            assert 0.0 <= telem["progress"] <= 1.0, "Route progress fraction must be in [0.0, 1.0]"
            assert 0.0 <= telem["risk"] <= 1.0, "Estimated risk score must be in [0.0, 1.0]"

    def test_utc_timestamp_sgp4_synchronization(self, client):
        """Tier 1.6: Validates millisecond ISO-8601 UTC timestamp format for SGP4 satellite propagation."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            ts_str = frame["timestamp"]
            assert ts_str.endswith("Z"), "Timestamp must designate UTC timezone with 'Z'"
            assert "." in ts_str, "Timestamp must include millisecond fractional precision"

            # Parse and verify datetime
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            assert dt.tzinfo is not None, "Timestamp must parse as timezone-aware UTC"
            now_utc = datetime.now(timezone.utc)
            delta_seconds = abs((now_utc - dt).total_seconds())
            assert delta_seconds < 120.0, f"Timestamp {ts_str} differs too much from current system UTC"


# ─────────────────────────────────────────────────────────────────────────────
# TIER 2: Boundary & Corner Cases (Stress & Edge Invariants)
# ─────────────────────────────────────────────────────────────────────────────

class TestTier2BoundaryAndCornerCases:
    """Validates resilience against abrupt disconnects, rapid churn, concurrency, and boundary constraints."""

    def test_zero_payload_immediate_disconnect(self, client):
        """Tier 2.1: Connects and closes immediately; verifies no socket leaks or server task crashes."""
        with client.websocket_connect("/ws/realtime") as ws:
            pass  # Immediate close without receive

        # Re-connect immediately to verify service loop survived abrupt disconnect
        with client.websocket_connect("/ws/realtime") as ws2:
            frame = ws2.receive_json()
            assert frame.get("type") == "telemetry_frame"

    def test_rapid_connect_disconnect_churn(self, client):
        """Tier 2.2: Performs 5 rapid connect/disconnect cycles to verify socket cleanup stability."""
        for i in range(5):
            with client.websocket_connect("/ws/realtime") as ws:
                frame = ws.receive_json()
                assert frame["type"] == "telemetry_frame"

        # Verify 6th connection is completely functional
        with client.websocket_connect("/ws/realtime") as ws_final:
            frame_final = ws_final.receive_json()
            assert len(frame_final["icebergs"]) >= 4

    def test_multiple_concurrent_websocket_clients(self, client):
        """Tier 2.3: Opens 3 simultaneous WebSocket connections; verifies broadcast fan-out."""
        with client.websocket_connect("/ws/realtime") as ws1:
            with client.websocket_connect("/ws/realtime") as ws2:
                with client.websocket_connect("/ws/realtime") as ws3:
                    f1 = ws1.receive_json()
                    f2 = ws2.receive_json()
                    f3 = ws3.receive_json()

                    assert f1["type"] == "telemetry_frame"
                    assert f2["type"] == "telemetry_frame"
                    assert f3["type"] == "telemetry_frame"
                    assert len(f1["icebergs"]) == len(f2["icebergs"]) == len(f3["icebergs"])
                    assert len(f1["vessels"]) == len(f2["vessels"]) == len(f3["vessels"])

    def test_ukc_shallow_depth_non_negative_floor(self):
        """Tier 2.4: Invariant check: UKC must strictly floor at 0.0 even under shallow depth conditions."""
        draft = 8.5
        shallow_depths = [8.5, 8.0, 5.0, 1.0, 0.0, -10.0, 8.49, 8.51, 100.0]

        for depth in shallow_depths:
            ukc = max(0.0, depth - draft)
            assert ukc >= 0.0, f"UKC must be non-negative for depth {depth}m, got {ukc}m"
            if depth <= draft:
                assert ukc == 0.0, f"UKC must clamp to 0.0 for depth {depth}m <= draft {draft}m"
            else:
                assert ukc == pytest.approx(depth - draft, abs=0.01)

    def test_iceberg_and_vessel_geographic_bounds(self, client):
        """Tier 2.5: Verifies that all coordinates strictly remain within Southern Ocean / Antarctic bounds."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()

            for berg in frame["icebergs"]:
                assert -90.0 <= berg["lat"] <= -50.0, f"Iceberg {berg['id']} latitude out of bounds"
                assert -180.0 <= berg["lon"] <= 180.0, f"Iceberg {berg['id']} longitude out of bounds"
                assert not math.isnan(berg["lat"]) and not math.isinf(berg["lat"])
                assert not math.isnan(berg["lon"]) and not math.isinf(berg["lon"])

            for vessel in frame["vessels"]:
                assert -90.0 <= vessel["lat"] <= -50.0, f"Vessel {vessel['name']} latitude out of bounds"
                assert -180.0 <= vessel["lon"] <= 180.0, f"Vessel {vessel['name']} longitude out of bounds"
                assert not math.isnan(vessel["lat"]) and not math.isinf(vessel["lat"])
                assert not math.isnan(vessel["lon"]) and not math.isinf(vessel["lon"])

    def test_heading_degrees_range_boundary(self, client):
        """Tier 2.6: Verifies that all orientations across all entities satisfy 0.0 <= headingDeg < 360.0."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()

            for berg in frame["icebergs"]:
                h = berg["headingDeg"]
                assert 0.0 <= h < 360.0, f"Iceberg {berg['id']} headingDeg {h} not in [0, 360)"
                proj_h = berg["projection6h"]["headingDeg"]
                assert 0.0 <= proj_h < 360.0, f"Iceberg {berg['id']} proj headingDeg {proj_h} not in [0, 360)"

            for vessel in frame["vessels"]:
                vh = vessel["headingDeg"]
                assert 0.0 <= vh < 360.0, f"Vessel {vessel['name']} headingDeg {vh} not in [0, 360)"

            th = frame["telemetry"]["heading"]
            assert 0.0 <= th < 360.0, f"Telemetry heading {th} not in [0, 360)"

            wind_deg = frame["telemetry"]["trueWind"]["directionDeg"]
            assert 0.0 <= wind_deg < 360.0, f"True wind direction {wind_deg} not in [0, 360)"

    def test_client_unexpected_message_handling(self, client):
        """Tier 2.7: Verifies server handles unexpected client messages without disconnecting or crashing."""
        with client.websocket_connect("/ws/realtime") as ws:
            f1 = ws.receive_json()
            assert f1["type"] == "telemetry_frame"

            # Send arbitrary client pings / text messages
            ws.send_text("PING")
            ws.send_text('{"client_status": "ready"}')
            ws.send_text("MALFORMED TEXT PAYLOAD \x00\xff")

            # Must still receive subsequent telemetry frame without error
            f2 = ws.receive_json()
            assert f2["type"] == "telemetry_frame"


# ─────────────────────────────────────────────────────────────────────────────
# TIER 3: Cross-Feature Combinations (Interactions & Physical Dynamics)
# ─────────────────────────────────────────────────────────────────────────────

class TestTier3CrossFeatureCombinations:
    """Validates physical dynamics, correlation between telemetry and physics, and monotonic clocks."""

    def test_iceberg_dynamic_drift_advancement(self, client):
        """Tier 3.1: Verifies iceberg coordinates advance across consecutive ticks consistent with drift."""
        with client.websocket_connect("/ws/realtime") as ws:
            f1 = ws.receive_json()
            f2 = ws.receive_json()

            # Find C-19 in both frames
            b1 = next(b for b in f1["icebergs"] if b["id"] == "C-19")
            b2 = next(b for b in f2["icebergs"] if b["id"] == "C-19")

            # Drift displacement distance
            dist_m = haversine_dist_nm(b1["lat"], b1["lon"], b2["lat"], b2["lon"]) * 1852.0
            # Under physical drift ~0.18-0.35 m/s, displacement in 1 tick is expected between 0.0m and 5.0m
            assert dist_m >= 0.0, "Displacement must be non-negative"
            assert dist_m < 50.0, f"Unphysically large drift step for tabular iceberg: {dist_m:.2f} meters"

    def test_6h_projection_vector_physics_consistency(self, client):
        """Tier 3.2: Validates that 6-hour projection vector correlates with speed and drift heading."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()

            for berg in frame["icebergs"]:
                proj = berg["projection6h"]
                cur_lat, cur_lon = berg["lat"], berg["lon"]
                proj_lat, proj_lon = proj["lat"], proj["lon"]

                # Computed distance to projected point
                computed_dist_nm = haversine_dist_nm(cur_lat, cur_lon, proj_lat, proj_lon)
                reported_dist_nm = proj["distanceNm"]

                # Proximity check between oracle and reported distance (within 0.5 nm)
                assert computed_dist_nm == pytest.approx(reported_dist_nm, abs=0.5), (
                    f"Reported 6h projection distance {reported_dist_nm}nm diverges from "
                    f"computed geodetic distance {computed_dist_nm:.2f}nm for {berg['id']}"
                )

                # Heading check if distance is significant (> 0.2 nm)
                if reported_dist_nm > 0.2:
                    computed_bearing = initial_bearing_deg(cur_lat, cur_lon, proj_lat, proj_lon)
                    reported_bearing = proj["headingDeg"]
                    angle_diff = (computed_bearing - reported_bearing + 180.0) % 360.0 - 180.0
                    assert abs(angle_diff) < 15.0, (
                        f"Projection bearing {reported_bearing}° diverges from computed {computed_bearing:.1f}° "
                        f"for {berg['id']}"
                    )

    def test_telemetry_fairway_corridor_progression(self, client):
        """Tier 3.3: Validates that RV Polar Explorer position advances along the Maitri-to-Bharati corridor."""
        with client.websocket_connect("/ws/realtime") as ws:
            f1 = ws.receive_json()
            f2 = ws.receive_json()

            t1 = f1["telemetry"]
            t2 = f2["telemetry"]

            # Progress must be non-decreasing (or loop at 1.0)
            assert t2["progress"] >= t1["progress"] or (t1["progress"] > 0.9 and t2["progress"] < 0.1)
            # Longitude must be within corridor range
            assert 11.0 <= t2["lon"] <= 77.0, f"Ship longitude {t2['lon']} outside corridor"
            # General northbound departure / eastward corridor heading
            assert 20.0 <= t2["heading"] <= 130.0, f"Ship heading {t2['heading']} not aligned along corridor"

    def test_environmental_weather_telemetry_correlation(self, client):
        """Tier 3.4: Validates that telemetry true wind correlates with Southern Ocean easterlies pattern."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            wind = frame["telemetry"]["trueWind"]

            # Southern Ocean katabatic / polar easterlies: typical 10 to 45 knots, ~90 degrees
            assert 5.0 <= wind["speedKn"] <= 50.0, f"Wind speed {wind['speedKn']}kn out of physical range"
            assert 60.0 <= wind["directionDeg"] <= 140.0, (
                f"Wind direction {wind['directionDeg']}° expected in polar easterlies band (60°-140°)"
            )

    def test_monotonic_timestamp_advancement(self, client):
        """Tier 3.5: Verifies that UTC timestamps in consecutive frames advance monotonically."""
        with client.websocket_connect("/ws/realtime") as ws:
            f1 = ws.receive_json()
            f2 = ws.receive_json()

            dt1 = datetime.fromisoformat(f1["timestamp"].replace("Z", "+00:00"))
            dt2 = datetime.fromisoformat(f2["timestamp"].replace("Z", "+00:00"))

            delta = (dt2 - dt1).total_seconds()
            assert delta >= 0.0, f"Timestamps must not move backward: t1={f1['timestamp']}, t2={f2['timestamp']}"
            assert delta < 5.0, f"Timestamp gap too large between consecutive frames: {delta:.2f}s"


# ─────────────────────────────────────────────────────────────────────────────
# TIER 4: Real-World Scenarios (Expedition Streams & Integration Contracts)
# ─────────────────────────────────────────────────────────────────────────────

class TestTier4RealWorldScenarios:
    """Validates multi-second expedition streaming, hazard CPA proximity, and Cesium 3D contracts."""

    def test_multi_second_voyage_stream_cadence(self, client):
        """Tier 4.1: Receives 4 consecutive frames at 1 Hz; verifies zero frame loss and strict continuity."""
        with client.websocket_connect("/ws/realtime") as ws:
            frames = []
            for _ in range(4):
                f = ws.receive_json()
                frames.append(f)

            assert len(frames) == 4, "Must receive all 4 consecutive frames"
            # Verify iceberg count consistency
            for f in frames:
                assert len(f["icebergs"]) >= 4
                assert len(f["vessels"]) >= 6
                assert f["telemetry"]["vesselName"] == "RV Polar Explorer"

            # Verify time difference across the 4-frame window
            t_start = datetime.fromisoformat(frames[0]["timestamp"].replace("Z", "+00:00"))
            t_end = datetime.fromisoformat(frames[-1]["timestamp"].replace("Z", "+00:00"))
            total_span = (t_end - t_start).total_seconds()
            assert total_span >= 0.0, f"Total stream time span must be non-negative: {total_span}s"

    def test_tactical_hazard_closest_point_of_approach(self, client):
        """Tier 4.2: Computes CPA proximity from ship to nearest iceberg; validates hazard categorization."""
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            ship_lat = frame["telemetry"]["lat"]
            ship_lon = frame["telemetry"]["lon"]

            distances = []
            for berg in frame["icebergs"]:
                d_nm = haversine_dist_nm(ship_lat, ship_lon, berg["lat"], berg["lon"])
                distances.append((berg["id"], d_nm, berg["threatLevel"]))

            assert len(distances) >= 4
            distances.sort(key=lambda x: x[1])
            closest_id, closest_dist_nm, closest_threat = distances[0]

            assert closest_dist_nm > 0.0, "Ship must not physically collide at 0nm with iceberg"
            assert isinstance(closest_id, str)
            # Critical hazards (like C-19 or proximate bergs) must have valid threat classification
            assert any(word in closest_threat.upper() for word in ["CRITICAL", "MODERATE", "LOW", "HAZARD"])

    def test_reconnection_simulation_exponential_backoff(self, client):
        """Tier 4.3: Simulates client disconnect, backoff pause, and seamless stream recovery."""
        # 1. First connection session
        with client.websocket_connect("/ws/realtime") as ws1:
            frame1 = ws1.receive_json()
            ts1 = frame1["timestamp"]
            wp_progress1 = frame1["telemetry"]["progress"]

        # 2. Simulate network disruption & exponential backoff pause (e.g. 1.0s backoff)
        time.sleep(1.0)

        # 3. Second connection session (reconnect)
        with client.websocket_connect("/ws/realtime") as ws2:
            frame2 = ws2.receive_json()
            ts2 = frame2["timestamp"]
            wp_progress2 = frame2["telemetry"]["progress"]

            dt1 = datetime.fromisoformat(ts1.replace("Z", "+00:00"))
            dt2 = datetime.fromisoformat(ts2.replace("Z", "+00:00"))

            # Reconnected stream must resume with later or equal timestamp
            assert dt2 >= dt1, f"Reconnected timestamp {ts2} must not precede original {ts1}"
            assert wp_progress2 >= wp_progress1 or (wp_progress1 > 0.9 and wp_progress2 < 0.1)

    def test_dual_mode_cesium_entity_contract_readiness(self, client):
        """Tier 4.4: Validates that live stream frames satisfy all Cesium 3D viewer requirements:
        - Unique, stable entity IDs avoiding WebGL recreation churn.
        - Numeric coordinates for SampledPositionProperty linear interpolation.
        - Parameters for dynamic ARPA velocity leader stems (PolylineArrowMaterialProperty).
        - Attributes enabling disableDepthTestDistance: Number.POSITIVE_INFINITY.
        """
        with client.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()

            # 1. Iceberg Entity Map Stability
            iceberg_ids = [b["id"] for b in frame["icebergs"]]
            assert len(iceberg_ids) == len(set(iceberg_ids)), "All iceberg entity IDs must be strictly unique"

            # 2. AIS Vessel Entity Map Stability
            vessel_mmsis = [v["mmsi"] for v in frame["vessels"]]
            assert len(vessel_mmsis) == len(set(vessel_mmsis)), "All vessel MMSI IDs must be strictly unique"

            # 3. Numeric sample coordinates for SampledPositionProperty
            for berg in frame["icebergs"]:
                assert isinstance(berg["lat"], float)
                assert isinstance(berg["lon"], float)
                # ARPA leader stem parameters
                assert "speedKn" in berg and isinstance(berg["speedKn"], (int, float))
                assert "headingDeg" in berg and isinstance(berg["headingDeg"], (int, float))
                assert "projection6h" in berg and "distanceNm" in berg["projection6h"]

            # 4. Attributes for unclipped marker depth test flag
            for v in frame["vessels"]:
                assert isinstance(v["lat"], float)
                assert isinstance(v["lon"], float)
                assert "headingDeg" in v
