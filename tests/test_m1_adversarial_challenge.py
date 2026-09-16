"""
POLARIS Milestone 1 Adversarial Challenge & Stress Test Suite
Empirical verification of coordinate bounds, physical boundary realism,
REST endpoint boundary & injection resistance, and WebSocket serialization under stress.
"""

import os
import json
import math
import time
import subprocess
from datetime import datetime
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.services.realtime_service import RealtimeService
from backend.models.iceberg_trajectory import IcebergTrajectoryModel, ICEBERG_SPECS
from backend.models.environmental_lookup import EnvironmentalLookup
from backend.services.ais_service import AISStreamService


@pytest.fixture(scope="module")
def client():
    """FastAPI TestClient for REST and WebSocket interactions."""
    with TestClient(app) as test_cli:
        yield test_cli


@pytest.fixture(scope="module")
def tracks_json():
    """Loads backend/data/satellite_iceberg_tracks.json."""
    json_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "backend", "data", "satellite_iceberg_tracks.json"
    )
    assert os.path.exists(json_path), f"Tracks file missing: {json_path}"
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================================
# 1. Coordinate Validity & Temporal Monotonicity
# ============================================================================

def test_adversarial_coordinates_within_antarctic_bounds(tracks_json):
    """
    Adversarial Challenge: Verify that ZERO coordinates violate Antarctic bounds.
    Latitudes must strictly reside within Antarctic bounds [-90.0, -60.0].
    Longitudes must strictly reside within [-180.0, 180.0].
    No coordinate can be NaN, null, or outside valid physical space.
    """
    icebergs = tracks_json.get("icebergs", {})
    assert len(icebergs) == 4, f"Expected 4 icebergs, found {len(icebergs)}"

    total_observations_tested = 0

    for berg_id, berg in icebergs.items():
        observations = berg.get("observations", [])
        assert len(observations) >= 10, f"{berg_id} has fewer than 10 observations"

        for idx, obs in enumerate(observations):
            total_observations_tested += 1
            lat = obs.get("lat")
            lon = obs.get("lon")

            assert lat is not None, f"{berg_id}[{idx}]: lat is None"
            assert lon is not None, f"{berg_id}[{idx}]: lon is None"
            assert isinstance(lat, (int, float)), f"{berg_id}[{idx}]: lat is not a float ({lat})"
            assert isinstance(lon, (int, float)), f"{berg_id}[{idx}]: lon is not a float ({lon})"
            assert not math.isnan(lat), f"{berg_id}[{idx}]: lat is NaN"
            assert not math.isnan(lon), f"{berg_id}[{idx}]: lon is NaN"
            assert not math.isinf(lat), f"{berg_id}[{idx}]: lat is Infinite"
            assert not math.isinf(lon), f"{berg_id}[{idx}]: lon is Infinite"

            # Antarctic geographic bounds: -90°S to -60°S
            assert -90.0 <= lat <= -60.0, (
                f"{berg_id}[{idx}]: Latitude {lat} outside Antarctic bounds [-90.0, -60.0]"
            )
            # Longitude bounds: -180° to +180°
            assert -180.0 <= lon <= 180.0, (
                f"{berg_id}[{idx}]: Longitude {lon} outside standard bounds [-180.0, 180.0]"
            )

    assert total_observations_tested == 52, f"Expected 52 observations tested, got {total_observations_tested}"


def test_adversarial_timestamp_strict_monotonicity(tracks_json):
    """
    Adversarial Challenge: Verify timestamps are strictly monotonically increasing.
    No time traveler observations, no zero-second identical timestamps, no unordered passes.
    """
    icebergs = tracks_json.get("icebergs", {})

    for berg_id, berg in icebergs.items():
        observations = berg.get("observations", [])
        prev_dt = None

        for idx, obs in enumerate(observations):
            ts_str = obs.get("timestamp")
            assert ts_str is not None, f"{berg_id}[{idx}]: timestamp is None"

            # Parse ISO-8601 UTC
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            except ValueError as e:
                pytest.fail(f"{berg_id}[{idx}]: Invalid ISO timestamp '{ts_str}': {e}")

            # Check strictly monotonic advance
            if prev_dt is not None:
                delta_sec = (dt - prev_dt).total_seconds()
                assert delta_sec > 0, (
                    f"{berg_id}[{idx}]: Non-monotonic timestamp! Prev: {prev_dt}, Curr: {dt}, Delta: {delta_sec}s"
                )
                assert delta_sec >= 3600, (
                    f"{berg_id}[{idx}]: Satellite passes suspiciously close ({delta_sec}s apart)"
                )

            prev_dt = dt

        # Verify lastObservation and latestFix match the final chronological observation
        last_obs = berg.get("lastObservation")
        latest_fix = berg.get("latestFix")
        assert last_obs is not None, f"{berg_id}: missing lastObservation"
        assert latest_fix is not None, f"{berg_id}: missing latestFix"
        assert last_obs["timestamp"] == observations[-1]["timestamp"], (
            f"{berg_id}: lastObservation timestamp does not match last observation"
        )
        assert latest_fix["timestamp"] == observations[-1]["timestamp"], (
            f"{berg_id}: latestFix timestamp does not match last observation"
        )


def test_adversarial_frontend_data_parity_with_backend():
    """
    Adversarial Challenge: Verify zero drift/desync between frontend JS and backend JSON.
    Runs a Node.js verification script comparing the exact values.
    """
    root_dir = os.path.dirname(os.path.dirname(__file__))
    node_script = """
    import fs from 'fs';
    import path from 'path';
    import SATELLITE_ICEBERG_TRACKS from './frontend/src/data/satelliteIcebergTracks.js';

    const jsonRaw = fs.readFileSync('./backend/data/satellite_iceberg_tracks.json', 'utf-8');
    const jsonTracks = JSON.parse(jsonRaw);

    const bergs = ['C-19', 'B-15K', 'D-28', 'A-68R'];
    for (const b of bergs) {
      const jsBerg = SATELLITE_ICEBERG_TRACKS.icebergs[b];
      const jsonBerg = jsonTracks.icebergs[b];
      if (!jsBerg || !jsonBerg) {
        console.error(`Missing iceberg ${b}`);
        process.exit(1);
      }
      if (jsBerg.observations.length !== jsonBerg.observations.length) {
        console.error(`Length mismatch on ${b}`);
        process.exit(2);
      }
      for (let i = 0; i < jsBerg.observations.length; i++) {
        const jsObs = jsBerg.observations[i];
        const jsonObs = jsonBerg.observations[i];
        if (jsObs.lat !== jsonObs.lat || jsObs.lon !== jsonObs.lon) {
          console.error(`Coordinate divergence on ${b}[${i}]`);
          process.exit(3);
        }
        if (jsObs.surfaceAreaKm2 !== jsonObs.surfaceAreaKm2 || jsObs.freeboardM !== jsonObs.freeboardM) {
          console.error(`Physical divergence on ${b}[${i}]`);
          process.exit(4);
        }
        if (jsObs.backscatterDb !== jsonObs.backscatterDb) {
          console.error(`Backscatter divergence on ${b}[${i}]`);
          process.exit(5);
        }
      }
    }
    process.exit(0);
    """

    res = subprocess.run(
        ["node", "--input-type=module", "-e", node_script],
        cwd=root_dir,
        capture_output=True,
        text=True
    )
    assert res.returncode == 0, f"Frontend and backend satellite data diverged: {res.stderr}"


# ============================================================================
# 2. Physical Boundary Realism & Radar Sensor Realism
# ============================================================================

def test_adversarial_physical_boundary_realism(tracks_json):
    """
    Adversarial Challenge: Stress test physical measurements against thermodynamic & hydrostatic bounds.
    - surfaceAreaKm2: Not NaN, > 0, and not unphysically extreme (< 2,000 km² and > 10 km²)
    - freeboardM: Not NaN, > 0, within hydrostatic limits for tabular icebergs [15m to 80m]
    - lengthKm and widthKm: length >= width > 0, aspect ratio >= 1.0
    - backscatterDb: Realistic SAR C-band radar backscatter on Antarctic ice [-35 dB to -4 dB], never 0.0 or positive
    """
    icebergs = tracks_json.get("icebergs", {})

    for berg_id, berg in icebergs.items():
        spec = ICEBERG_SPECS[berg_id]
        nom_area = spec["dimensions"]["areaKm2"]
        nom_freeboard = spec["dimensions"]["freeboardM"]

        for idx, obs in enumerate(berg["observations"]):
            area = obs.get("surfaceAreaKm2")
            freeboard = obs.get("freeboardM")
            length = obs.get("lengthKm")
            width = obs.get("widthKm")
            backscatter = obs.get("backscatterDb")

            # 1. Surface Area
            assert area is not None and not math.isnan(area), f"{berg_id}[{idx}]: surface area is NaN"
            assert area > 0.0, f"{berg_id}[{idx}]: surface area <= 0 ({area})"
            assert 10.0 <= area <= 2000.0, f"{berg_id}[{idx}]: unphysical surface area {area} km²"
            assert 0.75 * nom_area <= area <= 1.25 * nom_area, (
                f"{berg_id}[{idx}]: area {area} deviates excessively from nominal {nom_area}"
            )

            # 2. Freeboard Height
            assert freeboard is not None and not math.isnan(freeboard), f"{berg_id}[{idx}]: freeboard is NaN"
            assert freeboard > 0.0, f"{berg_id}[{idx}]: freeboard <= 0 ({freeboard})"
            assert 15.0 <= freeboard <= 80.0, f"{berg_id}[{idx}]: unphysical freeboard {freeboard} m"
            assert 0.75 * nom_freeboard <= freeboard <= 1.25 * nom_freeboard, (
                f"{berg_id}[{idx}]: freeboard {freeboard} deviates excessively from nominal {nom_freeboard}"
            )

            # 3. Dimensional geometry
            assert length is not None and width is not None
            assert length > 0.0 and width > 0.0
            assert length >= width, f"{berg_id}[{idx}]: length {length} < width {width}"

            # Check nested dimensions consistency
            dims = obs.get("dimensions", {})
            assert dims.get("surfaceAreaKm2") == area
            assert dims.get("freeboardM") == freeboard
            assert dims.get("lengthKm") == length
            assert dims.get("widthKm") == width

            # 4. Radar Backscatter dB
            assert backscatter is not None and not math.isnan(backscatter), f"{berg_id}[{idx}]: backscatter is NaN"
            assert backscatter < 0.0, f"{berg_id}[{idx}]: backscatter dB >= 0 ({backscatter} dB) is unphysical"
            assert -35.0 <= backscatter <= -4.0, (
                f"{berg_id}[{idx}]: backscatter dB {backscatter} outside realistic SAR range [-35, -4]"
            )


# ============================================================================
# 3. REST Endpoint Boundary & Adversarial Injection Resistance
# ============================================================================

def test_rest_api_valid_boundary_variations(client):
    """
    Adversarial Challenge: Verify endpoint resolves all legitimate case/separator permutations.
    """
    variations = [
        ("C-19", "C-19"),
        ("c-19", "C-19"),
        ("C19", "C-19"),
        ("c19", "C-19"),
        ("c--19", "C-19"),
        ("B-15K", "B-15K"),
        ("b-15k", "B-15K"),
        ("B15k", "B-15K"),
        ("b15K", "B-15K"),
        ("D-28", "D-28"),
        ("d-28", "D-28"),
        ("d28", "D-28"),
        ("A-68R", "A-68R"),
        ("a-68r", "A-68R"),
        ("a68r", "A-68R"),
        ("A68R", "A-68R"),
    ]

    for input_id, expected_canonical in variations:
        resp = client.get(f"/api/satellite-tracks/{input_id}")
        assert resp.status_code == 200, f"Failed resolving variation '{input_id}': status {resp.status_code}"
        data = resp.json()
        assert data["id"] == expected_canonical, f"Expected {expected_canonical}, got {data['id']}"
        assert len(data["observations"]) >= 10


def test_rest_api_adversarial_injection_and_fuzzing(client):
    """
    Adversarial Challenge: Send malicious, anomalous, and boundary inputs to /api/satellite-tracks/{iceberg_id}.
    The service must NEVER return 500 Internal Server Error, crash, or expose internals.
    Must return 404 Not Found (or 400/422).
    """
    adversarial_payloads = [
        # SQL injection vectors
        "' OR '1'='1",
        "C-19'; DROP TABLE icebergs; --",
        "' UNION SELECT * FROM users --",
        "1' AND 1=1 --",
        "admin'--",
        # Path traversal vectors
        "..",
        "../..",
        "windows%5Csystem32%5Ccmd.exe",
        "/etc/shadow",
        # HTML / XSS vectors
        "<script>alert(1)</script>",
        "<svg/onload=alert('xss')>",
        # NoSQL / JSON vectors
        '{"id": "C-19"}',
        '{"$gt": ""}',
        # Shell command injection vectors
        "; cat /etc/passwd",
        "| whoami",
        "`id`",
        "$(uname -a)",
        # Extreme string lengths (Buffer overflow / ReDoS attempts)
        "A" * 500,
        "C-19-" + ("X" * 5000),
        # Whitespace and formatting
        "   ",
        "\t",
        "\n",
        "%20%20",
        # Non-ASCII / Unicode / Homoglyphs
        "🧊",
        "С-19",  # Cyrillic capital Es (U+0421), not Latin C!
        "C—19",  # Em-dash (U+2014)
        "C–19",  # En-dash (U+2013)
        "nonexistent_berg_99999",
    ]

    import urllib.parse

    for payload in adversarial_payloads:
        start_t = time.perf_counter()
        # URL-encode the payload so it can be safely transmitted as a path component
        encoded_payload = urllib.parse.quote(payload, safe="")
        resp = client.get(f"/api/satellite-tracks/{encoded_payload}")
        duration_ms = (time.perf_counter() - start_t) * 1000.0

        # Assert no server crash
        assert resp.status_code != 500, (
            f"Adversarial payload '{payload}' triggered HTTP 500 Internal Server Error! Body: {resp.text}"
        )
        # Assert clean 404 or 422
        assert resp.status_code in (400, 404, 422), (
            f"Adversarial payload '{payload}' produced unexpected status code {resp.status_code}"
        )
        # Assert fast response (no ReDoS / Algorithmic DoS)
        assert duration_ms < 150.0, (
            f"Adversarial payload '{payload[:30]}...' took excessive time: {duration_ms:.2f}ms"
        )


# ============================================================================
# 4. WebSocket Frame Serialization & Concurrency Under Rapid Burst
# ============================================================================

def test_adversarial_rapid_frame_stepping_and_json_serialization():
    """
    Adversarial Challenge: Rapidly step RealtimeService physics and verify JSON frame serialization.
    Ensures zero non-serializable objects (PyTorch tensors, NaN, datetime objects, sets) leak into the broadcast.
    """
    env = EnvironmentalLookup()
    iceberg_model = IcebergTrajectoryModel()
    ais = AISStreamService()
    service = RealtimeService(iceberg_model, env, ais)

    # Perform 100 rapid consecutive simulation steps
    for step_num in range(100):
        frame = service.step(dt=1.0)

        # 1. Test JSON serialization directly
        try:
            serialized = json.dumps(frame)
        except TypeError as exc:
            pytest.fail(f"Frame at step {step_num} failed JSON serialization: {exc}")

        # 2. Test deserialization round-trip
        parsed = json.loads(serialized)
        assert parsed["type"] == "telemetry_frame"
        assert "satelliteTrack" in parsed
        assert "icebergs" in parsed
        assert len(parsed["icebergs"]) == 4

        # 3. Check for any NaN or Infinite values in serialized iceberg coordinates
        for berg in parsed["icebergs"]:
            lat = berg["lat"]
            lon = berg["lon"]
            assert not math.isnan(lat) and not math.isinf(lat), f"Step {step_num}: berg {berg['id']} lat is {lat}"
            assert not math.isnan(lon) and not math.isinf(lon), f"Step {step_num}: berg {berg['id']} lon is {lon}"
            assert -90.0 <= lat <= -60.0, f"Step {step_num}: berg {berg['id']} lat {lat} out of Antarctic bounds"

            # Check satellite track embedded in berg
            sat_track = berg.get("satelliteTrack", {})
            assert sat_track.get("id") == berg["id"], f"Step {step_num}: berg {berg['id']} missing matching satelliteTrack"
            assert len(sat_track.get("observations", [])) >= 10


def test_adversarial_websocket_concurrent_clients_rapid_frames(client):
    """
    Adversarial Challenge: Connect multiple WebSocket clients simultaneously and verify
    frame delivery under rapid concurrent requests without frame dropped/corrupted.
    """
    with client.websocket_connect("/ws/realtime") as ws1:
        with client.websocket_connect("/ws/realtime") as ws2:
            frame1 = ws1.receive_json()
            frame2 = ws2.receive_json()

            assert frame1["type"] == "telemetry_frame"
            assert frame2["type"] == "telemetry_frame"

            # Verify both clients received satelliteTrack
            assert "satelliteTrack" in frame1
            assert "satelliteTrack" in frame2
            assert set(frame1["satelliteTrack"]["icebergs"].keys()) == {"C-19", "B-15K", "D-28", "A-68R"}
            assert set(frame2["satelliteTrack"]["icebergs"].keys()) == {"C-19", "B-15K", "D-28", "A-68R"}


def test_adversarial_empty_and_trailing_slash_endpoints(client):
    """
    Adversarial Challenge: Test boundary slash handling and empty inputs.
    """
    # 1. Base endpoint with and without slash
    r1 = client.get("/api/satellite-tracks")
    assert r1.status_code == 200

    r2 = client.get("/api/satellite-tracks/")
    assert r2.status_code in (200, 307, 308)

    # 2. Double slash / empty iceberg ID (ASGI normalizes '//' to '/' which resolves to base endpoint or 404)
    r3 = client.get("/api/satellite-tracks//")
    assert r3.status_code in (200, 404, 307, 308)

    # 3. Trailing space or encoded space
    r4 = client.get("/api/satellite-tracks/%20")
    assert r4.status_code in (400, 404, 422)


def test_adversarial_websocket_high_frequency_client_pings(client):
    """
    Adversarial Challenge: Flood WebSocket connection with 50 rapid client messages
    and verify server does not throw unhandled exceptions or close abruptly.
    """
    with client.websocket_connect("/ws/realtime") as ws:
        # First frame should be valid telemetry frame
        initial_frame = ws.receive_json()
        assert initial_frame["type"] == "telemetry_frame"

        # Rapidly send 50 text frames to test receive loop resiliency
        for i in range(50):
            ws.send_text(f'{{"clientPing": {i}, "msg": "adversarial_stress"}}')

        # Send a malformed payload
        ws.send_text("NOT_EVEN_JSON_PLAIN_TEXT_BLOB")

        # Connection should remain open and healthy - sending further frame succeeds without error
        ws.send_text('{"healthCheck": "alive"}')



def test_adversarial_all_numeric_fields_no_nan_no_inf(tracks_json):
    """
    Adversarial Challenge: Recursively audit ALL numeric fields in the entire dataset.
    Every single number in the entire JSON database must satisfy math.isfinite(x).
    """
    nan_or_inf_locations = []

    def audit_recursive(obj, path):
        if isinstance(obj, dict):
            for k, v in obj.items():
                audit_recursive(v, f"{path}.{k}")
        elif isinstance(obj, list):
            for idx, item in enumerate(obj):
                audit_recursive(item, f"{path}[{idx}]")
        elif isinstance(obj, (int, float)):
            if not math.isfinite(obj):
                nan_or_inf_locations.append((path, obj))

    audit_recursive(tracks_json, "root")
    assert len(nan_or_inf_locations) == 0, f"Found NaN/Inf values: {nan_or_inf_locations}"