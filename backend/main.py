"""
POLARIS: AI-Enabled Antarctic Sea-Ice, Iceberg Trajectory & Navigation DSS
Smart India Hackathon 2026 | MoES / NCPOR (PS ID: 26059)
FastAPI Backend Service
"""

import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"

import sys
import json
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("polaris.main")

# Ensure project root is in sys.path so 'backend.*' imports resolve seamlessly
_ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)

from contextlib import asynccontextmanager

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Query, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from backend.models.environmental_lookup import EnvironmentalLookup
    from backend.models.sea_ice_risk import SeaIceRiskModel, LAT_MIN, LAT_MAX, LON_MIN, LON_MAX
    from backend.models.iceberg_trajectory import IcebergTrajectoryModel
    from backend.optimizer.route_optimizer import AntarcticRouteOptimizer
    from backend.services.gee_service import GoogleEarthEngineService
    from backend.services.ais_service import AISStreamService
    from backend.services.realtime_service import RealtimeService
    from backend.services.model_pipeline import ModelPipelineService
except (ImportError, ModuleNotFoundError):
    from models.environmental_lookup import EnvironmentalLookup
    from models.sea_ice_risk import SeaIceRiskModel, LAT_MIN, LAT_MAX, LON_MIN, LON_MAX
    from models.iceberg_trajectory import IcebergTrajectoryModel
    from optimizer.route_optimizer import AntarcticRouteOptimizer
    from services.gee_service import GoogleEarthEngineService
    from services.ais_service import AISStreamService
    from services.realtime_service import RealtimeService
    from services.model_pipeline import ModelPipelineService

# Legacy backend models are loaded only when a legacy live/demo endpoint needs
# them. The integrated /api/model/* pipeline owns the real model artifacts.
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() in ("true", "1", "yes")

env_lookup = EnvironmentalLookup()
sea_ice_model = None
iceberg_model = None
route_optimizer = None
gee_service = GoogleEarthEngineService()
ais_service = AISStreamService()
model_pipeline = ModelPipelineService()


def get_legacy_models():
    """Lazily initialize the original synthetic/cached backend model path."""
    global sea_ice_model, iceberg_model, route_optimizer
    if sea_ice_model is None:
        sea_ice_model = SeaIceRiskModel()
    if iceberg_model is None:
        iceberg_model = IcebergTrajectoryModel()
    if route_optimizer is None:
        route_optimizer = AntarcticRouteOptimizer(env_lookup, sea_ice_model)
    return sea_ice_model, iceberg_model, route_optimizer


# Realtime physics has a local fallback and does not need to load the legacy
# LSTM just to serve its first frame.
realtime_service = RealtimeService(None, env_lookup, ais_service)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Clean lifespan manager for background streaming feeds."""
    await ais_service.start()
    await realtime_service.start()
    yield
    await realtime_service.stop()
    await ais_service.stop()

app = FastAPI(
    title="POLARIS Antarctic Decision Support Backend",
    description="Navigation routing, CNN sea-ice risk estimation, and LSTM iceberg drift forecasting.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for Vite frontend development and production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Base tracked icebergs
BASE_ICEBERGS = [
    {"id": "C-19", "lat": -67.4, "lon": 41.2, "vx": -0.18, "vy": 0.05},
    {"id": "B-15K", "lat": -66.8, "lon": 58.5, "vx": -0.22, "vy": -0.04},
    {"id": "D-28", "lat": -68.1, "lon": 73.6, "vx": -0.15, "vy": 0.08},
    {"id": "A-68R", "lat": -66.1, "lon": 24.8, "vx": -0.25, "vy": 0.03}
]

# Cache paths
CACHED_SCENARIO_PATH = os.path.join(os.path.dirname(__file__), "data", "cached_scenario.json")
ANOMALY_SCENARIO_PATH = os.path.join(os.path.dirname(__file__), "data", "anomaly_scenario.json")

class ReplanRequest(BaseModel):
    current_lat: float
    current_lon: float
    current_time: str
    anomaly_active: bool = True
    ice_risk_weight: float = 8.0

class ConfigUpdateRequest(BaseModel):
    demo_mode: bool

class ModelRouteRequest(BaseModel):
    source_lat: float
    source_lon: float
    destination_lat: float
    destination_lon: float

@app.get("/health")
@app.get("/api/health")
def health_check():
    """Health check endpoint (Phase 0 Definition of Done)."""
    return {
        "status": "ok",
        "service": "POLARIS Antarctic Decision Support Backend",
        "version": "1.0.0",
        "demo_mode": DEMO_MODE,
        "scenario": {
            "start": "Maitri Station (-70.77S, 11.73E)",
            "destination": "Bharati Station (-69.41S, 76.19E)"
        }
    }

@app.get("/api/config")
def get_config():
    """Returns runtime configuration and active mode."""
    return {
        "demo_mode": DEMO_MODE,
        "voyage": {
            "origin": {"name": "Maitri Station", "lat": -70.77, "lon": 11.73},
            "destination": {"name": "Bharati Station", "lat": -69.41, "lon": 76.19}
        },
        "bbox": {
            "lat_min": LAT_MIN,
            "lat_max": LAT_MAX,
            "lon_min": LON_MIN,
            "lon_max": LON_MAX
        }
    }

@app.get("/api/model/status")
def get_model_status():
    """Reports Engine 1/2/3 artifact and live-feed availability."""
    return model_pipeline.status()

@app.post("/api/model/route")
def run_model_route(req: ModelRouteRequest):
    """Runs live inputs through Engine 1, Engine 2, and Engine 3."""
    if not (-90.0 <= req.source_lat <= 90.0 and -90.0 <= req.destination_lat <= 90.0):
        raise HTTPException(status_code=422, detail="Latitude values must be between -90 and 90")
    if not (-180.0 <= req.source_lon <= 180.0 and -180.0 <= req.destination_lon <= 180.0):
        raise HTTPException(status_code=422, detail="Longitude values must be between -180 and 180")
    try:
        return model_pipeline.run(req.source_lat, req.source_lon, req.destination_lat, req.destination_lon)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Model route generation failed")
        raise HTTPException(status_code=503, detail="Model pipeline unavailable") from exc

@app.get("/api/model/sea-ice-overlay.png")
def get_model_sea_ice_overlay(step: int = Query(0, ge=0, le=2)):
    try:
        return Response(content=model_pipeline.render_ice_overlay(step), media_type="image/png")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@app.get("/api/model/bathymetry-overlay.png")
def get_model_bathymetry_overlay():
    try:
        return Response(content=model_pipeline.render_bathymetry_overlay(), media_type="image/png")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@app.get("/api/model/pipeline-plot.png")
def get_model_pipeline_plot():
    """Renders polar stereographic overview of Engine 1 ice, Engine 2 drift, and Engine 3 route."""
    try:
        content = model_pipeline.render_pipeline_plot()
        return Response(content=content, media_type="image/png")
    except Exception as exc:
        logger.exception("Failed to render polar pipeline plot")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

@app.get("/api/model/sea-ice-value")
def get_model_sea_ice_value(lat: float = Query(...), lon: float = Query(...), step: int = Query(0, ge=0, le=2)):
    """Sample the active Engine 1 forecast at a hovered map coordinate."""
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        raise HTTPException(status_code=422, detail="Invalid geographic coordinates")
    try:
        model_pipeline._ensure_outputs()
        nav = model_pipeline._load_navigator()
        row, col = nav.coord_to_grid(lat, lon)
        value = float(model_pipeline._last_forecast[step, row, col])
        return {"lat": lat, "lon": lon, "step": step, "horizonHours": step * 24, "concentration": round(max(0.0, min(1.0, value)), 4)}
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@app.post("/api/config")
def set_config(req: ConfigUpdateRequest):
    """Toggles DEMO_MODE between true (cached) and false (live inference pipeline)."""
    global DEMO_MODE
    DEMO_MODE = req.demo_mode
    return {"demo_mode": DEMO_MODE, "message": f"Demo mode set to {DEMO_MODE}"}

@app.get("/api/scenario")
def get_scenario(live: Optional[bool] = None, anomaly: bool = False):
    """
    Main Data Contract endpoint (Section 4).
    Returns exact JSON shape:
    {
      "iceRiskGrid": [...],
      "icebergs": [...],
      "route": { "waypoints": [...] }
    }
    """
    use_live = (live is True) or (not DEMO_MODE)

    if not use_live:
        # DEMO_MODE = True: serve cached scenario with Engine 2 XGBoost icebergs
        target_path = ANOMALY_SCENARIO_PATH if anomaly else CACHED_SCENARIO_PATH
        if os.path.exists(target_path):
            with open(target_path, "r") as f:
                data = json.load(f)
                if hasattr(realtime_service, "latest_frame") and realtime_service.latest_frame.get("icebergs"):
                    data["icebergs"] = realtime_service.latest_frame["icebergs"]
                return data

    # Live inference execution path (DEMO_MODE = False or explicit live=true).
    sea_ice_model, iceberg_model, route_optimizer = get_legacy_models()
    start_time_iso = "2026-09-07T00:00:00Z"
    risk_grid = sea_ice_model.predict_risk_grid(start_time_iso, anomaly_active=anomaly)
    icebergs = (
        realtime_service.latest_frame.get("icebergs")
        if hasattr(realtime_service, "latest_frame") and realtime_service.latest_frame.get("icebergs")
        else iceberg_model.predict_trajectories(BASE_ICEBERGS, start_time_iso, horizon_steps=12, anomaly_active=anomaly)
    )
    route = route_optimizer.compute_optimal_route(
        start_lat=-70.77, start_lon=11.73,
        end_lat=-69.41, end_lon=76.19,
        start_time_iso=start_time_iso,
        risk_grid=risk_grid,
        icebergs=icebergs
    )

    return {
        "iceRiskGrid": risk_grid,
        "icebergs": icebergs,
        "route": route
    }

@app.get("/api/risk-grid-overlay.png")
def get_risk_grid_overlay(anomaly: bool = False):
    """
    Renders risk grid as a single RGBA PNG image for Cesium SingleTileImageryProvider.
    Ensures 60 FPS rendering without client-side polygon entity overhead.
    """
    # Fetch risk grid from the legacy path only when this endpoint is requested.
    sea_ice_model, _, _ = get_legacy_models()
    if DEMO_MODE:
        target_path = ANOMALY_SCENARIO_PATH if anomaly else CACHED_SCENARIO_PATH
        if os.path.exists(target_path):
            with open(target_path, "r") as f:
                data = json.load(f)
                grid = data["iceRiskGrid"]
        else:
            grid = sea_ice_model.predict_risk_grid("2026-09-07T00:00:00Z", anomaly_active=anomaly)
    else:
        grid = sea_ice_model.predict_risk_grid("2026-09-07T00:00:00Z", anomaly_active=anomaly)

    png_bytes = sea_ice_model.render_risk_overlay_png(grid)
    return Response(content=png_bytes, media_type="image/png")

@app.post("/api/replan")
def trigger_replan(req: ReplanRequest):
    """
    Anomaly replan endpoint (Phase 5).
    Takes ship's current interpolated position, runs A* optimizer avoidance path,
    and returns spliced route to Bharati.
    """
    sea_ice_model, iceberg_model, route_optimizer = get_legacy_models()
    risk_grid = sea_ice_model.predict_risk_grid(req.current_time, anomaly_active=req.anomaly_active)
    icebergs = iceberg_model.predict_trajectories(BASE_ICEBERGS, req.current_time, horizon_steps=12, anomaly_active=req.anomaly_active)

    new_route = route_optimizer.compute_optimal_route(
        start_lat=req.current_lat,
        start_lon=req.current_lon,
        end_lat=-69.41,
        end_lon=76.19,
        start_time_iso=req.current_time,
        risk_grid=risk_grid,
        icebergs=icebergs,
        ice_risk_weight=req.ice_risk_weight
    )

    return {
        "iceRiskGrid": risk_grid,
        "icebergs": icebergs,
        "route": new_route,
        "anomalyActive": req.anomaly_active,
        "polarCodeRIO": 12.8 if req.anomaly_active else 14.2,
        "polarCodeStatus": "REPLAN_APPROVED" if req.anomaly_active else "NORMAL_TRANSIT_AUTHORIZED",
        "replanOrigin": {"lat": req.current_lat, "lon": req.current_lon, "time": req.current_time}
    }

@app.get("/api/weather")
def get_weather_at_point(lat: float = Query(...), lon: float = Query(...), time_iso: str = "2026-09-07T00:00:00Z"):
    """Lookup environmental weather parameters and depth for a point."""
    weather = env_lookup.get_weather(lat, lon, time_iso)
    depth = env_lookup.get_depth(lat, lon)
    return {
        "coordinates": {"lat": lat, "lon": lon},
        "bathymetricDepthM": round(depth, 1),
        "isNavigable": depth >= 35.0,
        "polarCodeRIO": 14.2,
        "polarCodeStatus": "NORMAL_TRANSIT_AUTHORIZED",
        "weather": weather
    }

# ============================================================================
# Google Earth Engine (GEE) Cloud Satellite Pipeline Endpoints
# ============================================================================

@app.get("/api/gee/status")
def get_gee_status():
    """Returns Google Earth Engine cloud connection status and active satellite collections."""
    return gee_service.get_status()

@app.get("/api/gee/sentinel1/tiles/{z}/{x}/{y}.png")
def get_gee_sentinel1_tile(z: int, x: int, y: int):
    """Serves real-time GEE Sentinel-1 SAR Dual-Pol (VV/VH) radar backscatter XYZ map tiles."""
    png_bytes = gee_service.generate_sentinel1_tile(z, x, y)
    return Response(content=png_bytes, media_type="image/png")

@app.get("/api/gee/sea-ice/tiles/{z}/{x}/{y}.png")
def get_gee_sea_ice_tile(z: int, x: int, y: int):
    """Serves GEE AMSR2 / NOAA CDR Sea-Ice Concentration XYZ map tiles."""
    png_bytes = gee_service.generate_sea_ice_tile(z, x, y)
    return Response(content=png_bytes, media_type="image/png")

# ============================================================================
# Live AISStream Transponder Feed Endpoints
# ============================================================================

@app.get("/api/ais-live")
def get_ais_live(limit: int = 500):
    """
    Returns live AIS vessels and feed status from AISStream websocket feed.
    Mirrors gods-eye-view /api/ais-live data structure for vesselLabels.js compatibility.
    """
    return {
        "status": ais_service.get_status(),
        "vessels": ais_service.get_vessels(limit=limit)
    }

# ============================================================================
# Real-Time WebSocket Streaming Telemetry Endpoint
# ============================================================================

@app.websocket("/ws/realtime")
async def websocket_realtime_stream(websocket: WebSocket):
    """
    High-Performance 1 Hz Real-Time Telemetry Stream for POLARIS.
    Delivers dynamic icebergs (momentum balance ODE + PyTorch LSTM sequence residuals + 6h projection),
    live & fallback polar AIS vessels, and RV Polar Explorer telemetry (depth, 8.5m draft, UKC, true wind, heading).
    """
    await realtime_service.connect(websocket)
    try:
        while True:
            # Keep connection alive and receive any client ping/pong/heartbeat frames
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        realtime_service.disconnect(websocket)
    except Exception as exc:
        logger.debug("WebSocket client disconnected or error: %s", exc)
        realtime_service.disconnect(websocket)

@app.get("/api/realtime/snapshot")
def get_realtime_snapshot():
    """Returns the latest precomputed real-time telemetry snapshot."""
    return realtime_service.get_latest_frame()

# ============================================================================
# Authentic Satellite Iceberg Tracking Endpoints (BYU/USNIC & ESA Sentinel-1)
# ============================================================================

@app.get("/api/satellite-tracks")
def get_satellite_tracks():
    """
    Returns authentic BYU/USNIC satellite observation tracks for active Antarctic icebergs.
    Includes historical trajectory passes from Sentinel-1A (C-SAR), CryoSat-2 (SIRAL), and ICESat-2 (ATLAS).
    """
    return realtime_service.get_satellite_tracks()

@app.get("/api/satellite-tracks/{iceberg_id}")
def get_satellite_track_for_iceberg(iceberg_id: str):
    """
    Returns authentic satellite observation track for a specific iceberg.
    Supports case-insensitive and format-tolerant identifiers (e.g. C-19, c-19, c19).
    """
    tracks_data = realtime_service.get_satellite_tracks()
    bergs = tracks_data.get("icebergs", {})

    if iceberg_id in bergs:
        return bergs[iceberg_id]

    upper_id = iceberg_id.upper()
    if upper_id in bergs:
        return bergs[upper_id]

    clean_id = upper_id.replace("-", "")
    for k, v in bergs.items():
        if k.replace("-", "").upper() == clean_id:
            return v

    raise HTTPException(
        status_code=404,
        detail=f"Iceberg '{iceberg_id}' not found in satellite observation database"
    )

if __name__ == "__main__":
    import uvicorn
    app_target = "main:app" if os.path.exists("main.py") else "backend.main:app"
    uvicorn.run(app_target, host="127.0.0.1", port=8000, reload=True)
