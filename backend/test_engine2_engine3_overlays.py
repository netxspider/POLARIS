"""
Test suite for POLARIS Engine 1 Sea-Ice Overlay, IBCSO Bathymetry Masking,
Engine 2 XGBoost Iceberg Drift Predictions, and Engine 3 Polar Pipeline Plot.
"""

import io
import pytest
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

from backend.main import app
from backend.services.model_pipeline import ModelPipelineService

client = TestClient(app)


def test_sea_ice_overlay_rendering():
    """Verify sea ice concentration overlay uses Blues_r, masks land, and has correct orientation."""
    response = client.get("/api/model/sea-ice-overlay.png?step=0")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    
    img = Image.open(io.BytesIO(response.content))
    assert img.size == (1024, 512)
    assert img.mode == "RGBA"
    
    arr = np.array(img)
    # The bottom 15% (deep inland Antarctica around -75 to -80S) should be land-masked (alpha == 0)
    bottom_strip_alpha = arr[int(512 * 0.88):, :, 3]
    assert np.all(bottom_strip_alpha == 0), "Inland Antarctica must be transparent in sea-ice overlay"


def test_bathymetry_overlay_land_mask():
    """Verify IBCSO bathymetry overlay is transparent over continental Antarctica and positive terrain."""
    response = client.get("/api/model/bathymetry-overlay.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    
    img = Image.open(io.BytesIO(response.content))
    assert img.size == (1024, 512)
    assert img.mode == "RGBA"
    
    arr = np.array(img)
    # Inland Antarctica bedrock (even subglacial negative trenches) must have alpha == 0
    bottom_strip_alpha = arr[int(512 * 0.88):, :, 3]
    assert np.all(bottom_strip_alpha == 0), "Continental Antarctica must have alpha=0 in bathymetry overlay"
    
    # Ocean areas (e.g. northern mid-ocean at row 100, col 500) must be visible (alpha > 0)
    ocean_alpha = arr[100, 500, 3]
    assert ocean_alpha > 0, "Ocean bathymetry must be visible"


def test_icebergs_from_engine2_xgboost():
    """Verify iceberg trajectories in scenario and realtime feeds originate from Engine 2 XGBoost."""
    response = client.get("/api/scenario")
    assert response.status_code == 200
    data = response.json()
    
    assert "icebergs" in data
    assert len(data["icebergs"]) > 0
    
    for berg in data["icebergs"]:
        assert berg.get("source") == "Engine 2 XGBoost", f"Berg {berg['id']} source must be Engine 2 XGBoost"
        track = berg.get("predictedTrack", [])
        assert len(track) == 12, f"Berg {berg['id']} must have 12 six-hour projection steps (72h)"
        
        # Verify track steps have valid keys and coordinates
        for step in track:
            assert "lat" in step and "lon" in step
            assert -90.0 <= step["lat"] <= -50.0
            assert "hours" in step and step["hours"] % 6 == 0


def test_polar_pipeline_plot_endpoint():
    """Verify /api/model/pipeline-plot.png generates the high-res South Polar Stereographic plot."""
    response = client.get("/api/model/pipeline-plot.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert len(response.content) > 50000, "Polar plot PNG must contain rich image data"
    
    img = Image.open(io.BytesIO(response.content))
    w, h = img.size
    assert w > 800 and h > 500, f"Polar plot must be a complete map figure, got {w}x{h}"
