# POLARIS: AI-Enabled Antarctic Sea-Ice, Iceberg Trajectory, and Navigation Decision Support System

[![Smart India Hackathon 2026](https://img.shields.io/badge/SIH-2026-blue.svg)](https://sih.gov.in)
[![Problem Statement ID](https://img.shields.io/badge/PS_ID-26059-indigo.svg)](https://sih.gov.in)
[![Ministry](https://img.shields.io/badge/Ministry-MoES_%2F_NCPOR-0284c7.svg)](https://ncpor.res.in)
[![Category](https://img.shields.io/badge/Category-Software-emerald.svg)]()
[![Theme](https://img.shields.io/badge/Theme-Transportation_%26_Logistics-amber.svg)]()

> **Prototype for SIH 2026 Demo**
> Real lat/lon-accurate 3D Antarctic navigation corridor forecasting sea-ice concentration, forecasting tabular iceberg trajectories with ocean currents & Coriolis drift, and computing safe, fuel-efficient routes between Indian Antarctic Research Stations: **Maitri** (70.77°S, 11.73°E) and **Bharati** (69.41°S, 76.19°E).

---

## 🧭 System Architecture & Fixed Stack

| Layer | Component | Description |
|---|---|---|
| **3D Globe / Geospatial UI** | **CesiumJS + React (Vite)** | Lat/Lon-accurate 3D globe rendering terrain, bathymetry, single-layer rasterized CNN risk overlays, and sampled position ship velocity orientation. |
| **Backend API Service** | **Python + FastAPI** | High-performance REST service serving Section 4 Data Contract, environmental ERA5 lookups, and orchestrating offline/live inference. |
| **Sea-Ice Risk Model** | **PyTorch CNN Segmentation** | Multi-channel passive microwave radiance inference estimating sea-ice concentration and mechanical ice compression risk fields. |
| **Iceberg Trajectory Model** | **LSTM + Physical Drift Mechanics** | Hybrid deep sequence + momentum balance ODE incorporating wind stress, ocean currents, mass, and Southern Hemisphere Coriolis force ($f = 2\Omega\sin\phi$). |
| **Route Optimizer** | **A\* Pathfinder on Weighted Graph** | Classical explainable multi-objective pathfinder over BEDMAP2/GEBCO bathymetry, CNN risk fields, and iceberg perimeter clearance buffers. |

---

## 📡 Section 4 Data Contract

All components communicate strictly through this JSON shape:

```json
{
  "iceRiskGrid": [
    { "lat": -66.2, "lon": 76.1, "time": "2026-09-07T00:00:00Z", "risk": 0.82 }
  ],
  "icebergs": [
    {
      "id": "C-19",
      "lat": -67.0,
      "lon": 78.4,
      "time": "2026-09-07T00:00:00Z",
      "predictedTrack": [
        { "lat": -67.1, "lon": 78.2, "time": "2026-09-07T06:00:00Z" }
      ]
    }
  ],
  "route": {
    "waypoints": [
      { "lat": -70.77, "lon": 11.73, "time": "2026-09-07T00:00:00Z", "speedKn": 14 },
      { "lat": -69.9, "lon": 30.0, "time": "2026-09-08T06:00:00Z", "speedKn": 12 }
    ]
  }
}
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Python 3.10+** (with `pip`)
- **Node.js 18+** (with `npm`)

---

### Step 1: Start Backend (FastAPI)

**Option A (From project root):**
```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

**Option B (From `backend` folder):**
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The backend starts at `http://127.0.0.1:8000`.
- Health Check: `http://127.0.0.1:8000/health`
- Swagger Docs: `http://127.0.0.1:8000/docs`

### Integrated real-model route

The model pipeline is exposed through the backend and uses the artifacts in `model/`:

- `POST /api/model/route` runs Engine 1 ConvLSTM, Engine 2 XGBoost, and Engine 3 dynamic A*.
- `GET /api/model/status` reports model artifacts and feed provenance.
- `GET /api/model/sea-ice-overlay.png?step=0` renders a forecast step.
- `GET /api/model/bathymetry-overlay.png` renders sampled `model/IBCSO_bed.tif` data.

The frontend's Model Route Solver sends source and destination coordinates to `/api/model/route`.
The default route is Maitri (`-70.77, 11.73`) to Bharati (`-69.41, 76.19`).
The standalone pipeline uses the same defaults and accepts `--source-lat`, `--source-lon`,
`--destination-lat`, and `--destination-lon` overrides.

The model pipeline uses the official USNIC Antarctic iceberg CSV by default:

`https://usicecenter.gov/File/DownloadCurrent?pId=134`

The downloaded dated file in `model/AntarcticIcebergs_20260910.csv` is used when
the live endpoint is unavailable. To override the feed URL, set:

```bash
export POLARIS_USNIC_ICEBERG_URL="<USNIC Antarctic iceberg CSV URL>"
```

The route response reports `sources.usnic`, including source, record count, URL, and
product date. Each iceberg includes `source: "USNIC"` after a successful live or dated
local CSV parse. Only when both are unavailable does the UI label positions as fallback.

---

### Step 2: Start Frontend (React + CesiumJS)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 🎯 Live Hackathon Demonstration Guide

1. **Baseline Voyage**:
   - The vessel `RV Polar Explorer` departs from **Maitri Station** (-70.77°S, 11.73°E) heading towards **Bharati Station** (-69.41°S, 76.19°E).
   - The ship animates smoothly using Cesium's `SampledPositionProperty` and auto-faces its direction of travel via `VelocityOrientationProperty`.
   - The Sea-Ice Risk overlay renders as a single high-performance `ImageryLayer` (rasterized server-side) at 60 FPS.

2. **Mid-Voyage Anomaly Replan (Centerpiece Demo)**:
   - Click the **"INJECT ANOMALY"** button in the top navigation bar.
   - Iceberg **C-19** is perturbed into the primary shipping corridor with accelerated northward drift.
   - The backend runs dynamic A* replanning from the vessel's current interpolated position.
   - The route smoothly course-corrects via the northern deep-water bypass without snapping.

3. **Live Inference vs Cached Demo Mode Toggle**:
   - Toggle the **"DEMO MODE: CACHED" / "LIVE INFERENCE"** switch in the top header.
   - When set to `LIVE INFERENCE` (`DEMO_MODE=false`), the backend invokes the live PyTorch CNN segmentation model and LSTM drift physics equations on request.

---

## 🧪 Automated Test Suite

Run the full end-to-end verification suite:

```bash
python backend/test_polaris.py
```

Validates:
- `[PASS] Phase 0 Health Check`
- `[PASS] Phase 1 & 2 Data Contract Conformance`
- `[PASS] Phase 3 Route Optimizer on BEDMAP2 Bathymetry`
- `[PASS] Phase 4 CNN & LSTM Model Output Shapes`
- `[PASS] Phase 5 Mid-Voyage Anomaly Dynamic Replan`
- `[PASS] Phase 6 Live Inference Toggle`
