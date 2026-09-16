"""
Integration Test Suite for POLARIS Real-Time WebSocket Streaming Engine
smart-india-hackathon-2026 | MoES / NCPOR (PS ID: 26059)

Verifies:
1. /ws/realtime connection lifecycle and M1 <-> M2 telemetry frame structure.
2. Dynamic iceberg physics drift and 6-hour projection vector calculations.
3. Fallback polar AIS fleet transponders and navigation attributes.
4. RV Polar Explorer live telemetry (depth, 8.5m draft, UKC, true wind, heading).
5. Monotonic millisecond ISO-8601 UTC timestamp synchronization.
"""

import time
import pytest
from datetime import datetime
from fastapi.testclient import TestClient

from backend.main import app, realtime_service, ais_service

client = TestClient(app)


def test_websocket_realtime_connection_and_schema():
    """Verifies that /ws/realtime accepts connections and emits valid M1<->M2 frames."""
    with TestClient(app) as test_cli:
        with test_cli.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()

            # Top-level frame structure
            assert frame["type"] == "telemetry_frame"
            assert "timestamp" in frame
            assert "icebergs" in frame
            assert "vessels" in frame
            assert "telemetry" in frame

            # UTC ISO-8601 Millisecond Timestamp
            ts = frame["timestamp"]
            assert ts.endswith("Z")
            assert "T" in ts
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            assert dt.year >= 2026

            # Icebergs list
            assert isinstance(frame["icebergs"], list)
            assert len(frame["icebergs"]) == 4

            # AIS Vessels list
            assert isinstance(frame["vessels"], list)
            assert len(frame["vessels"]) >= 6

            # Telemetry object
            assert isinstance(frame["telemetry"], dict)


def test_iceberg_physical_data_and_projection():
    """Verifies physical properties, drift speed/heading, and 6-hour forward projection vector."""
    with TestClient(app) as test_cli:
        with test_cli.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            icebergs = frame["icebergs"]

            berg_ids = {b["id"] for b in icebergs}
            assert {"C-19", "B-15K", "D-28", "A-68R"}.issubset(berg_ids)

            for b in icebergs:
                # Identification and threat level
                assert "id" in b and isinstance(b["id"], str)
                assert "name" in b and isinstance(b["name"], str)
                assert "threatLevel" in b and isinstance(b["threatLevel"], str)

                # Coordinates
                assert -75.0 <= b["lat"] <= -60.0
                assert 10.0 <= b["lon"] <= 80.0

                # Velocity & drift parameters
                assert b["speedKn"] >= 0.0
                assert 0.0 <= b["headingDeg"] <= 360.0
                assert "driftSpeedKn" in b and b["driftSpeedKn"] == b["speedKn"]
                assert "driftHeadingDeg" in b and b["driftHeadingDeg"] == b["headingDeg"]

                # Dimensions
                dims = b["dimensions"]
                assert dims["lengthKm"] > 0.0
                assert dims["widthKm"] > 0.0
                assert dims["draftM"] > 0.0

                # 6-Hour forward projection vector
                proj = b["projection6h"]
                assert "lat" in proj and "lon" in proj
                assert "distanceNm" in proj and proj["distanceNm"] >= 0.0
                assert "headingDeg" in proj and 0.0 <= proj["headingDeg"] <= 360.0
                assert -75.0 <= proj["lat"] <= -60.0


def test_dynamic_iceberg_coordinate_drift_step():
    """Verifies that iceberg coordinates advance genuinely under physics and LSTM ODE."""
    c19_before = realtime_service.icebergs["C-19"]
    lat_before = c19_before["lat"]
    lon_before = c19_before["lon"]

    # Advance simulation by 60 seconds of real physics
    frame_after = realtime_service.step(dt=60.0)
    c19_after = next(b for b in frame_after["icebergs"] if b["id"] == "C-19")

    lat_after = c19_after["lat"]
    lon_after = c19_after["lon"]

    # Position must advance genuinely based on velocity (vx = -0.18 m/s, vy = 0.05 m/s)
    assert lat_after != lat_before or lon_after != lon_before
    # Distance moved over 60s at ~0.2 m/s should be ~12 meters (~0.0001 degrees)
    assert abs(lat_after - lat_before) > 1e-6 or abs(lon_after - lon_before) > 1e-6


def test_realtime_websocket_cadence():
    """Verifies that consecutive frames are emitted with updated timestamps."""
    with TestClient(app) as test_cli:
        with test_cli.websocket_connect("/ws/realtime") as ws:
            f1 = ws.receive_json()
            f2 = ws.receive_json()

            t1 = datetime.fromisoformat(f1["timestamp"].replace("Z", "+00:00"))
            t2 = datetime.fromisoformat(f2["timestamp"].replace("Z", "+00:00"))

            # Must be strictly monotonic and roughly 1 second apart
            delta_sec = (t2 - t1).total_seconds()
            assert 0.8 <= delta_sec <= 2.5


def test_ais_fallback_fleet_composition():
    """Verifies that realistic polar supply ships and icebreakers populate the stream."""
    with TestClient(app) as test_cli:
        with test_cli.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            vessels = frame["vessels"]

            v_names = {v["name"] for v in vessels}
            expected_ships = {
                "RV Polarstern",
                "Vasily Golovnin",
                "SA Agulhas II",
                "Xue Long 2",
                "Akademik Fedorov",
                "RRS Sir David Attenborough"
            }
            assert expected_ships.issubset(v_names)

            for v in vessels:
                assert "mmsi" in v and len(v["mmsi"]) > 0
                assert "name" in v and len(v["name"]) > 0
                assert v["type"] in ("icebreaker", "research", "cargo")
                assert -72.0 <= v["lat"] <= -60.0
                assert v["speedKn"] > 0.0
                assert 0.0 <= v["headingDeg"] <= 360.0
                assert "destination" in v


def test_rv_polar_explorer_telemetry():
    """Verifies RV Polar Explorer telemetry including depth, draft, UKC, and wind."""
    with TestClient(app) as test_cli:
        with test_cli.websocket_connect("/ws/realtime") as ws:
            frame = ws.receive_json()
            telemetry = frame["telemetry"]

            assert telemetry["vesselName"] == "RV Polar Explorer"
            assert -72.0 <= telemetry["lat"] <= -65.0
            assert 10.0 <= telemetry["lon"] <= 80.0
            assert telemetry["speedKn"] > 0.0
            assert 0.0 <= telemetry["heading"] <= 360.0

            # Sounding depth and Under Keel Clearance with 8.5m draft
            assert telemetry["depthM"] > 0.0
            assert telemetry["draftM"] == 8.5
            expected_ukc = round(max(0.0, telemetry["depthM"] - 8.5), 1)
            assert telemetry["ukcM"] == expected_ukc

            # True wind parameters
            wind = telemetry["trueWind"]
            assert wind["speedKn"] > 0.0
            assert 0.0 <= wind["directionDeg"] <= 360.0

            # Route progress and risk
            assert 0.0 <= telemetry["progress"] <= 1.0
            assert 0.0 <= telemetry["risk"] <= 1.0


def test_realtime_snapshot_http_endpoint():
    """Verifies GET /api/realtime/snapshot returns valid current state."""
    res = client.get("/api/realtime/snapshot")
    assert res.status_code == 200
    data = res.json()
    assert data["type"] == "telemetry_frame"
    assert "timestamp" in data
    assert len(data["icebergs"]) == 4
    assert len(data["vessels"]) >= 6
    assert data["telemetry"]["vesselName"] == "RV Polar Explorer"


def test_ais_live_endpoint_with_polar_fleet():
    """Verifies GET /api/ais-live includes the polar fallback fleet."""
    res = client.get("/api/ais-live")
    assert res.status_code == 200
    data = res.json()
    assert "status" in data
    assert "vessels" in data
    assert len(data["vessels"]) >= 6
    assert any(v["name"] == "RV Polarstern" for v in data["vessels"])
