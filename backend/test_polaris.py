"""
POLARIS Automated Phase Verification & Data Contract Conformance Test Suite
Validates all phases (Phase 0 to Phase 6) against Section 4 Data Contract and requirements.
"""

import sys
import os
import json
import pytest
from fastapi.testclient import TestClient

# Ensure root workspace is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.main import app, DEMO_MODE
from backend.models.environmental_lookup import EnvironmentalLookup
from backend.models.sea_ice_risk import SeaIceRiskModel
from backend.models.iceberg_trajectory import IcebergTrajectoryModel
from backend.optimizer.route_optimizer import AntarcticRouteOptimizer

client = TestClient(app)

def test_phase_0_health_check():
    """Phase 0 DoD: Backend responds to health check."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "Maitri" in data["scenario"]["start"]
    assert "Bharati" in data["scenario"]["destination"]
    print("[PASS] Phase 0 Health Check Passed")

def test_phase_1_and_2_data_contract_conformance():
    """
    Phase 1 & 2 DoD: Exact Section 4 Data Contract Schema Conformance.
    Schema requires:
    - iceRiskGrid: list of { lat, lon, time, risk }
    - icebergs: list of { id, lat, lon, time, predictedTrack: list of { lat, lon, time } }
    - route: { waypoints: list of { lat, lon, time, speedKn } }
    """
    response = client.get("/api/scenario")
    assert response.status_code == 200
    data = response.json()

    # 1. iceRiskGrid validation
    assert "iceRiskGrid" in data
    assert isinstance(data["iceRiskGrid"], list)
    assert len(data["iceRiskGrid"]) > 0
    sample_risk = data["iceRiskGrid"][0]
    assert "lat" in sample_risk and isinstance(sample_risk["lat"], (int, float))
    assert "lon" in sample_risk and isinstance(sample_risk["lon"], (int, float))
    assert "time" in sample_risk and isinstance(sample_risk["time"], str)
    assert "risk" in sample_risk and isinstance(sample_risk["risk"], (int, float))
    assert 0.0 <= sample_risk["risk"] <= 1.0

    # 2. icebergs validation
    assert "icebergs" in data
    assert isinstance(data["icebergs"], list)
    assert len(data["icebergs"]) > 0
    sample_berg = data["icebergs"][0]
    assert "id" in sample_berg and isinstance(sample_berg["id"], str)
    assert "lat" in sample_berg and isinstance(sample_berg["lat"], (int, float))
    assert "lon" in sample_berg and isinstance(sample_berg["lon"], (int, float))
    assert "time" in sample_berg and isinstance(sample_berg["time"], str)
    assert "predictedTrack" in sample_berg and isinstance(sample_berg["predictedTrack"], list)
    if len(sample_berg["predictedTrack"]) > 0:
        sample_pt = sample_berg["predictedTrack"][0]
        assert "lat" in sample_pt
        assert "lon" in sample_pt
        assert "time" in sample_pt

    # 3. route.waypoints validation
    assert "route" in data and "waypoints" in data["route"]
    waypoints = data["route"]["waypoints"]
    assert isinstance(waypoints, list)
    assert len(waypoints) >= 2
    
    # Check start & end anchor station coordinates
    start_wp = waypoints[0]
    end_wp = waypoints[-1]
    assert abs(start_wp["lat"] - (-70.77)) < 0.1, f"Start lat mismatch: {start_wp['lat']}"
    assert abs(start_wp["lon"] - 11.73) < 0.1, f"Start lon mismatch: {start_wp['lon']}"
    assert abs(end_wp["lat"] - (-69.41)) < 0.1, f"End lat mismatch: {end_wp['lat']}"
    assert abs(end_wp["lon"] - 76.19) < 0.1, f"End lon mismatch: {end_wp['lon']}"

    for wp in waypoints:
        assert "lat" in wp and isinstance(wp["lat"], (int, float))
        assert "lon" in wp and isinstance(wp["lon"], (int, float))
        assert "time" in wp and isinstance(wp["time"], str)
        assert "speedKn" in wp and isinstance(wp["speedKn"], (int, float))
        assert wp["speedKn"] > 0

    print("[PASS] Phase 1 & 2 Data Contract Conformance Passed")

def test_phase_3_route_optimizer_bathymetry():
    """Phase 3 DoD: Route optimizer pathfinding on real BEDMAP2 bathymetry."""
    env = EnvironmentalLookup()
    sea_ice = SeaIceRiskModel()
    optimizer = AntarcticRouteOptimizer(env, sea_ice)

    route = optimizer.compute_optimal_route(
        start_lat=-70.77, start_lon=11.73,
        end_lat=-69.41, end_lon=76.19
    )
    waypoints = route["waypoints"]
    assert len(waypoints) >= 2
    # Verify bathymetric clearance along entire path
    for wp in waypoints:
        depth = env.get_depth(wp["lat"], wp["lon"])
        # All points in navigation path should be in navigable water
        assert depth >= 35.0 or abs(wp["lat"] - (-70.77)) < 0.2 or abs(wp["lat"] - (-69.41)) < 0.2
    print("[PASS] Phase 3 Route Optimizer on Bathymetry Passed")

def test_phase_4_trained_models():
    """Phase 4 DoD: Sea-Ice CNN and Iceberg LSTM models."""
    sea_ice = SeaIceRiskModel()
    grid = sea_ice.predict_risk_grid("2026-09-07T00:00:00Z")
    assert len(grid) == sea_ice.grid_h * sea_ice.grid_w
    png_bytes = sea_ice.render_risk_overlay_png(grid)
    assert len(png_bytes) > 1000
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"

    iceberg_model = IcebergTrajectoryModel()
    bergs = [
        {"id": "C-19", "lat": -67.4, "lon": 41.2, "vx": -0.18, "vy": 0.05}
    ]
    forecast = iceberg_model.predict_trajectories(bergs, "2026-09-07T00:00:00Z", horizon_steps=6)
    assert len(forecast) == 1
    assert len(forecast[0]["predictedTrack"]) == 6
    print("[PASS] Phase 4 ML Models Passed")

def test_phase_5_anomaly_replan():
    """Phase 5 DoD: Mid-voyage anomaly injection & dynamic course correction."""
    replan_req = {
        "current_lat": -67.2,
        "current_lon": 38.5,
        "current_time": "2026-09-07T12:00:00Z",
        "anomaly_active": True,
        "ice_risk_weight": 9.5
    }
    response = client.post("/api/replan", json=replan_req)
    assert response.status_code == 200
    data = response.json()
    assert "route" in data
    assert len(data["route"]["waypoints"]) > 1
    # Check that replan started at current ship location
    first_wp = data["route"]["waypoints"][0]
    assert abs(first_wp["lat"] - (-67.2)) < 0.1
    assert abs(first_wp["lon"] - 38.5) < 0.1
    print("[PASS] Phase 5 Anomaly Replan Passed")

def test_phase_6_live_inference_toggle():
    """Phase 6 DoD: DEMO_MODE toggle switch."""
    # Set to Live mode
    resp = client.post("/api/config", json={"demo_mode": False})
    assert resp.status_code == 200
    assert resp.json()["demo_mode"] is False

    # Fetch scenario in live mode
    live_scenario = client.get("/api/scenario?live=true")
    assert live_scenario.status_code == 200
    assert "route" in live_scenario.json()

    # Reset back to Demo mode
    resp_reset = client.post("/api/config", json={"demo_mode": True})
    assert resp_reset.status_code == 200
    assert resp_reset.json()["demo_mode"] is True
    print("[PASS] Phase 6 Live Inference Toggle Passed")

if __name__ == "__main__":
    test_phase_0_health_check()
    test_phase_1_and_2_data_contract_conformance()
    test_phase_3_route_optimizer_bathymetry()
    test_phase_4_trained_models()
    test_phase_5_anomaly_replan()
    test_phase_6_live_inference_toggle()
    print("\nALL POLARIS PHASES (0-6) PASSED SUCCESSFULLY!")
