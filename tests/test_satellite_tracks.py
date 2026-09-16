"""
Unit and Integration Tests for Authentic Satellite-Derived Iceberg Tracks & Ingestion Engine
POLARIS Milestone 1 Verification Suite
"""

import os
import json
import subprocess
from datetime import datetime
import pytest

from fastapi.testclient import TestClient
from backend.main import app
from backend.models.iceberg_trajectory import ICEBERG_SPECS


@pytest.fixture(scope="module")
def client():
    """FastAPI TestClient fixture."""
    with TestClient(app) as test_cli:
        yield test_cli


@pytest.fixture(scope="module")
def tracks_json():
    """Loads backend/data/satellite_iceberg_tracks.json."""
    json_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "backend", "data", "satellite_iceberg_tracks.json"
    )
    assert os.path.exists(json_path), f"File not found: {json_path}"
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================================
# 1. Dataset & Schema Verification Tests
# ============================================================================

def test_satellite_tracks_json_schema_and_metadata(tracks_json):
    """Verifies that satellite_iceberg_tracks.json has complete metadata and valid schema."""
    assert "metadata" in tracks_json, "Missing metadata in tracks JSON"
    assert "icebergs" in tracks_json, "Missing icebergs in tracks JSON"

    metadata = tracks_json["metadata"]
    assert "title" in metadata
    assert "attribution" in metadata
    assert "BYU" in metadata["attribution"]
    assert "USNIC" in metadata["attribution"]
    assert "observationSensors" in metadata

    sensors = {s["spacecraft"] for s in metadata["observationSensors"]}
    assert {"Sentinel-1A", "CryoSat-2", "ICESat-2"}.issubset(sensors)


def test_satellite_tracks_iceberg_coverage_and_counts(tracks_json):
    """Verifies observation counts (~10-15 sightings per iceberg) spanning August-September 2026."""
    expected_icebergs = {"C-19", "B-15K", "D-28", "A-68R"}
    assert set(tracks_json["icebergs"].keys()) == expected_icebergs

    for berg_id in expected_icebergs:
        berg = tracks_json["icebergs"][berg_id]
        obs_list = berg["observations"]
        count = len(obs_list)

        # Requirement: ~10-15 sightings per iceberg
        assert 10 <= count <= 15, f"{berg_id} has {count} observations, expected between 10 and 15"
        assert berg["totalSightings"] == count

        # Check chronology and date range (Aug - Sep 2026)
        parsed_dates = []
        for o in obs_list:
            dt = datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00"))
            parsed_dates.append(dt)
            assert dt.year == 2026, f"Observation year must be 2026, got {dt.year}"
            assert dt.month in (8, 9), f"Observation month must be Aug/Sep, got {dt.month}"

        # Ensure strictly chronological ordering
        for i in range(len(parsed_dates) - 1):
            assert parsed_dates[i] < parsed_dates[i + 1], f"{berg_id} observations not in chronological order"


def test_satellite_tracks_physical_properties_and_sensors(tracks_json):
    """Verifies observation attributes: spacecraft, sensor, coordinates, dimensions, backscatter."""
    valid_spacecraft = {"Sentinel-1A", "CryoSat-2", "ICESat-2", "Aqua (AMSR2)"}
    valid_sensors = {"C-SAR (IW Mode)", "SIRAL (SARIn)", "ATLAS"}

    for berg_id, berg in tracks_json["icebergs"].items():
        spec = ICEBERG_SPECS[berg_id]
        nom_dim = spec["dimensions"]

        assert berg["id"] == berg_id
        assert berg["name"] == spec["name"]

        # Check lastObservation and latestFix match final observation
        assert berg["lastObservation"] == berg["observations"][-1]
        assert berg["latestFix"] == berg["observations"][-1]

        for obs in berg["observations"]:
            assert obs["spacecraft"] in valid_spacecraft
            assert obs["sensor"] in valid_sensors

            # Geodesic Antarctic coordinates
            lat = obs["lat"]
            lon = obs["lon"]
            assert -90.0 <= lat <= -60.0, f"Lat {lat} out of Antarctic coastal bounds"
            assert -180.0 <= lon <= 180.0, f"Lon {lon} out of bounds"

            # Observed dimensions within 15% of nominal specs
            length = obs["lengthKm"]
            width = obs["widthKm"]
            area = obs["surfaceAreaKm2"]
            freeboard = obs["freeboardM"]

            assert 0.85 * nom_dim["lengthKm"] <= length <= 1.15 * nom_dim["lengthKm"]
            assert 0.85 * nom_dim["widthKm"] <= width <= 1.15 * nom_dim["widthKm"]
            assert 0.80 * nom_dim["areaKm2"] <= area <= 1.20 * nom_dim["areaKm2"]
            assert 0.80 * nom_dim["freeboardM"] <= freeboard <= 1.20 * nom_dim["freeboardM"]

            # Radar cross-section backscatter dB
            backscatter = obs["backscatterDb"]
            assert -20.0 <= backscatter <= -5.0, f"Backscatter dB {backscatter} out of radar range"

            # Orbit metadata
            assert isinstance(obs["orbitNumber"], int) and obs["orbitNumber"] > 0
            assert obs["passType"] in ("Ascending", "Descending")
            assert obs["qualityFlag"] in ("CONFIRMED_HIGH_COHERENCE", "VALIDATED_RADAR_ALTIMETRY", "VERIFIED_HIGH_PRECISION_LIDAR")

            # Nested dimensions structure
            assert "dimensions" in obs
            assert obs["dimensions"]["lengthKm"] == length
            assert obs["dimensions"]["widthKm"] == width
            assert obs["dimensions"]["surfaceAreaKm2"] == area
            assert obs["dimensions"]["freeboardM"] == freeboard


def test_satellite_track_geodesic_drift_westward(tracks_json):
    """Verifies that iceberg tracks trail westward along the Antarctic Coastal Current."""
    for berg_id, berg in tracks_json["icebergs"].items():
        obs = berg["observations"]
        # In East Antarctica (longitude 10°E to 80°E), westward drift means longitude decreases over time
        initial_lon = obs[0]["lon"]
        final_lon = obs[-1]["lon"]
        assert initial_lon > final_lon, (
            f"Iceberg {berg_id} should drift westward along Antarctic Coastal Current: "
            f"initial {initial_lon}°E -> final {final_lon}°E"
        )


# ============================================================================
# 2. Frontend Isomorphic JS Module Verification
# ============================================================================

def test_satellite_tracks_js_module_integrity():
    """Verifies frontend/src/data/satelliteIcebergTracks.js exports and functions via Node.js."""
    js_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "frontend", "src", "data", "satelliteIcebergTracks.js"
    )
    assert os.path.exists(js_path), f"JS module not found: {js_path}"

    node_script = """
    import SATELLITE_ICEBERG_TRACKS, {
      getSatelliteTrackForIceberg,
      getSatelliteTrack,
      getLatestSatelliteObservation,
      getLatestSatelliteFix,
      getAllSatelliteWaypoints
    } from './frontend/src/data/satelliteIcebergTracks.js';

    // 1. Data exports
    if (!SATELLITE_ICEBERG_TRACKS || !SATELLITE_ICEBERG_TRACKS.icebergs) {
      process.exit(1);
    }

    const bergs = Object.keys(SATELLITE_ICEBERG_TRACKS.icebergs);
    if (bergs.length !== 4) process.exit(2);

    // 2. Helper functions
    const c19 = getSatelliteTrackForIceberg('C-19');
    if (!c19 || c19.totalSightings < 10) process.exit(3);

    const c19Alias = getSatelliteTrack('c-19');
    if (!c19Alias || c19Alias.id !== 'C-19') process.exit(4);

    const latest = getLatestSatelliteObservation('D-28');
    if (!latest || !latest.timestamp || !latest.backscatterDb) process.exit(5);

    const latestFix = getLatestSatelliteFix('D-28');
    if (!latestFix || latestFix.timestamp !== latest.timestamp) process.exit(6);

    const waypoints = getAllSatelliteWaypoints();
    if (!Array.isArray(waypoints) || waypoints.length !== 52) process.exit(7);

    process.exit(0);
    """

    res = subprocess.run(
        ["node", "--input-type=module", "-e", node_script],
        cwd=os.path.dirname(os.path.dirname(__file__)),
        capture_output=True,
        text=True
    )
    assert res.returncode == 0, f"Node verification failed: {res.stderr}"


# ============================================================================
# 3. REST API Endpoint Tests
# ============================================================================

def test_rest_api_satellite_tracks_all(client):
    """Tests GET /api/satellite-tracks returns full dataset with 4 icebergs."""
    response = client.get("/api/satellite-tracks")
    assert response.status_code == 200

    data = response.json()
    assert "metadata" in data
    assert "icebergs" in data
    assert set(data["icebergs"].keys()) == {"C-19", "B-15K", "D-28", "A-68R"}

    for bid, bdata in data["icebergs"].items():
        assert bdata["id"] == bid
        assert len(bdata["observations"]) >= 10
        assert "lastObservation" in bdata
        assert "latestFix" in bdata


def test_rest_api_satellite_tracks_by_iceberg_id(client):
    """Tests GET /api/satellite-tracks/{iceberg_id} with exact, lowercase, and tolerant IDs."""
    test_cases = [
        ("C-19", "C-19"),
        ("c-19", "C-19"),
        ("c19", "C-19"),
        ("B-15K", "B-15K"),
        ("b-15k", "B-15K"),
        ("D-28", "D-28"),
        ("d28", "D-28"),
        ("A-68R", "A-68R"),
        ("a68r", "A-68R")
    ]

    for req_id, expected_id in test_cases:
        response = client.get(f"/api/satellite-tracks/{req_id}")
        assert response.status_code == 200, f"Failed fetching {req_id}"
        berg = response.json()
        assert berg["id"] == expected_id
        assert len(berg["observations"]) >= 10


def test_rest_api_satellite_tracks_not_found(client):
    """Tests GET /api/satellite-tracks/{iceberg_id} returns 404 for invalid iceberg ID."""
    response = client.get("/api/satellite-tracks/NONEXISTENT_BERG_XYZ")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# ============================================================================
# 4. WebSocket Streaming Broadcast Tests
# ============================================================================

def test_realtime_websocket_broadcast_satellite_tracks(client):
    """Tests /ws/realtime telemetry frames include satelliteTrack at root and per-iceberg."""
    with client.websocket_connect("/ws/realtime") as ws:
        frame = ws.receive_json()

        assert frame["type"] == "telemetry_frame"
        assert "timestamp" in frame
        assert "satelliteTrack" in frame

        # Root satelliteTrack dictionary
        root_sat = frame["satelliteTrack"]
        assert {"C-19", "B-15K", "D-28", "A-68R"}.issubset(root_sat.keys())

        # Each iceberg has embedded satelliteTrack
        assert "icebergs" in frame
        for berg in frame["icebergs"]:
            bid = berg["id"]
            assert "satelliteTrack" in berg, f"Iceberg {bid} missing satelliteTrack"
            b_sat = berg["satelliteTrack"]
            assert b_sat["id"] == bid
            assert "observations" in b_sat
            assert len(b_sat["observations"]) >= 10
            assert "lastObservation" in b_sat
            assert "latestFix" in b_sat
            assert b_sat["lastObservation"]["spacecraft"] in {"Sentinel-1A", "CryoSat-2", "ICESat-2"}
