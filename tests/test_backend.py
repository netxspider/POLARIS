"""
Test Suite for POLARIS Backend
Verifies API contract adherence, model inference outputs, and route pathfinder correctness.
"""

import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "POLARIS" in data["service"]

def test_scenario_contract_structure():
    """Verifies Section 4 Data Contract exact structure."""
    response = client.get("/api/scenario")
    assert response.status_code == 200
    data = response.json()

    # 1. Check top-level keys
    assert "iceRiskGrid" in data
    assert "icebergs" in data
    assert "route" in data

    # 2. Check iceRiskGrid element structure
    assert len(data["iceRiskGrid"]) > 0
    grid_elem = data["iceRiskGrid"][0]
    assert "lat" in grid_elem and isinstance(grid_elem["lat"], (int, float))
    assert "lon" in grid_elem and isinstance(grid_elem["lon"], (int, float))
    assert "time" in grid_elem and isinstance(grid_elem["time"], str)
    assert "risk" in grid_elem and 0.0 <= grid_elem["risk"] <= 1.0

    # 3. Check icebergs element structure
    assert len(data["icebergs"]) > 0
    berg = data["icebergs"][0]
    assert "id" in berg and isinstance(berg["id"], str)
    assert "lat" in berg and isinstance(berg["lat"], (int, float))
    assert "lon" in berg and isinstance(berg["lon"], (int, float))
    assert "time" in berg and isinstance(berg["time"], str)
    assert "predictedTrack" in berg and isinstance(berg["predictedTrack"], list)
    assert len(berg["predictedTrack"]) > 0
    track_pt = berg["predictedTrack"][0]
    assert "lat" in track_pt and "lon" in track_pt and "time" in track_pt

    # 4. Check route element structure
    assert "waypoints" in data["route"]
    wps = data["route"]["waypoints"]
    assert len(wps) >= 2

    # Check anchor coordinates
    start_wp = wps[0]
    end_wp = wps[-1]
    assert pytest.approx(start_wp["lat"], abs=0.1) == -70.77
    assert pytest.approx(start_wp["lon"], abs=0.2) == 11.73
    assert pytest.approx(end_wp["lat"], abs=0.1) == -69.41
    assert pytest.approx(end_wp["lon"], abs=0.2) == 76.19
    assert "speedKn" in start_wp and start_wp["speedKn"] > 0

def test_risk_overlay_png():
    """Verifies server-side rasterization generates valid RGBA PNG."""
    response = client.get("/api/risk-grid-overlay.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    img = Image.open(io.BytesIO(response.content))
    assert img.format == "PNG"
    assert img.mode == "RGBA"
    assert img.size in [(512, 256), (1024, 512)]

def test_replan_endpoint():
    """Verifies mid-voyage anomaly replan generates valid continuation route."""
    payload = {
        "current_lat": -68.2,
        "current_lon": 38.5,
        "current_time": "2026-09-08T18:00:00Z",
        "anomaly_active": True,
        "ice_risk_weight": 10.0
    }
    response = client.post("/api/replan", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "route" in data
    assert "waypoints" in data["route"]
    wps = data["route"]["waypoints"]
    assert len(wps) >= 2
    assert pytest.approx(wps[0]["lat"], abs=0.1) == -68.2
    assert pytest.approx(wps[0]["lon"], abs=0.1) == 38.5
    assert pytest.approx(wps[-1]["lat"], abs=0.1) == -69.41
    assert pytest.approx(wps[-1]["lon"], abs=0.1) == 76.19

def test_config_and_demo_mode_toggle():
    """Verifies DEMO_MODE toggle endpoint."""
    res1 = client.post("/api/config", json={"demo_mode": False})
    assert res1.status_code == 200
    assert res1.json()["demo_mode"] is False

    res2 = client.get("/api/config")
    assert res2.status_code == 200
    assert res2.json()["demo_mode"] is False

    # Restore DEMO_MODE = True
    res3 = client.post("/api/config", json={"demo_mode": True})
    assert res3.status_code == 200
    assert res3.json()["demo_mode"] is True
