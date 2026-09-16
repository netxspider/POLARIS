# Original User Request

## Initial Request — 2026-09-12T15:17:23Z

Build and integrate a real-time data streaming subsystem for POLARIS where icebergs, AIS vessels, and expedition telemetry move and update dynamically in real time over a high-performance WebSocket connection.

Working directory: c:\Users\indla\OneDrive\Desktop\Polaris
Integrity mode: development

## Requirements

### R1. Backend Real-Time WebSocket Streaming Engine
- Implement an asynchronous real-time manager in FastAPI (`backend/services/realtime_service.py` and `backend/main.py`) exposing `/ws/realtime`.
- Broadcast 1 Hz telemetry packets delivering:
  - **Dynamic Icebergs**: Real-time coordinates (lat, lon), SOG, drift bearing/COG, and 6-hour forward drift projection vector computed via the Physics + PyTorch LSTM drift engine (Coriolis, ocean current stress, air drag).
  - **Live AIS Vessels**: Real-world AIS vessel transponders gathered via `AISStreamService` (with automatic fallback to realistic polar supply ships/icebreakers navigating the Southern Ocean when no API key is set).
  - **Vessel Telemetry**: RV Polar Explorer live telemetry (depth, UKC, true wind, heading).
  - **Polar Orbiter Synchronization**: UTC time synchronization for SGP4 satellite propagation.

### R2. Frontend WebSocket Client & Dual-Mode State Management
- Implement a robust WebSocket client (`frontend/src/services/useRealtimeStream.js`) with automatic reconnection and exponential backoff.
- In `frontend/src/App.jsx`, implement a clean **Dual-Mode** architecture:
  - **LIVE STREAM MODE**: Scene coordinates driven by the live incoming WebSocket feed. The top header's `● Live` badge pulses in green (`● LIVE STREAM (1 Hz)`).
  - **VOYAGE SIMULATION MODE**: When the user scrubs the timeline or selects simulation multipliers (50x–2500x), display simulation progress with an amber badge and a one-click `JUMP TO LIVE ⚡` button that seamlessly restores live real-time tracking.

### R3. 3D Cesium Movement & ARPA Radar Vector Rendering
- In `frontend/src/components/CesiumViewer.jsx`:
  - Smoothly interpolate iceberg and ship positions between 1 Hz updates so movement glides naturally without jumping.
  - Render dynamic ARPA velocity leader stems extending into each iceberg's drift direction, heading arrows, and pulsing radar blips to clearly communicate physical motion at 1x real-world speed.
  - Maintain `disableDepthTestDistance: Number.POSITIVE_INFINITY` on all live markers to prevent any surface clipping against the globe.

### R4. Marine Bridge Telemetry & Tactical Overlays
- Update `MarineBridgeConsole.jsx`, `IntelHUD.jsx`, and `TacticalEntityOverlay.jsx` to reflect dynamic live drift speeds, live distances to the fairway, and real-time contact updates.

## Acceptance Criteria

### Real-Time WebSocket Verification
- [ ] `/ws/realtime` connects successfully and emits valid JSON frames at ~1 Hz containing `icebergs`, `vessels`, `telemetry`, and `timestamp`.
- [ ] Iceberg coordinates advance dynamically based on drift physics.
- [ ] Reconnection with exponential backoff functions properly if the connection drops.

### Dual-Mode & UI Verification
- [ ] Clicking the `● Live` badge or scrubbing the timeline switches cleanly between Live Stream Mode and Simulation Playback.
- [ ] In Simulation mode, a `JUMP TO LIVE` action is displayed and immediately restores live real-time tracking when clicked.

### 3D Visualization Verification
- [ ] Icebergs visibly display ARPA drift velocity vectors, heading arrows, and active radar blips.
- [ ] Markers remain fully circular and unclipped at all altitudes.
- [ ] `npm run build` succeeds with zero compilation errors.

## Follow-up — 2026-09-12T23:28:10Z

Build and integrate a real satellite-derived iceberg trajectory and observation subsystem for POLARIS where icebergs feature authentic satellite sighting track lines based on BYU/USNIC and ESA Sentinel-1 SAR observations, interactive satellite fix waypoints, and active satellite overpass detection beams.

Working directory: c:\Users\indla\OneDrive\Desktop\Polaris
Integrity mode: development

## Requirements

### R1. Authentic Satellite Iceberg Tracks & Ingestion Engine
- Create `backend/data/satellite_iceberg_tracks.json` and `frontend/src/data/satelliteIcebergTracks.js` containing authentic satellite observation tracks for active Antarctic icebergs (C-19, B-15K, D-28, A-68R) modeled after the BYU Center for Remote Sensing and US National Ice Center (USNIC) database.
- Each observation record must specify:
  - Observation ISO UTC timestamp (spanning multiple weeks of satellite passes).
  - Detecting Spacecraft & Sensor: Sentinel-1A (C-SAR), CryoSat-2 (SIRAL), ICESat-2 (ATLAS).
  - Confirmed geographic coordinates (lat, lon).
  - Observed dimensions (lengthKm, widthKm), surface area (km²), freeboard height (m), and radar cross-section backscatter (dB).
- Include `satelliteTrack` in the `/ws/realtime` telemetry broadcast in `backend/services/realtime_service.py`.

### R2. 3D Cesium Satellite Trajectory Polylines & Fix Waypoints
- In `frontend/src/components/CesiumViewer.jsx`:
  - Render a glowing 3D Historical Satellite Track Line trailing behind each iceberg (`sat_track_${berg.id}`), connecting all verified satellite passes with depth-buffer-safe glow (`PolylineGlowMaterialProperty`).
  - Render interactive Satellite Sighting Fix Waypoint Pins (`sat_fix_${berg.id}_${idx}`) along each trajectory line with radar satellite icon billboards and date labels.
  - Clicking any satellite fix pin displays its satellite inspection card (spacecraft, sensor, date/time, radar backscatter, detected area).
  - Render a forward Projected Satellite Drift Corridor polyline extending from the latest satellite position into the future.

### R3. Dynamic Satellite Overpass Detection Beam
- When active polar orbiters in `polarSatellites.js` (such as Sentinel-1A at 693 km altitude or CryoSat-2 at 717 km) pass overhead within ground swath range of an iceberg:
  - Render an active targeting radar sensor ray connecting the satellite in orbit directly down to the iceberg at sea level.
  - Display a live `SENTINEL-1A SAR ACQUISITION LOCK` radar status indicator.

### R4. Tactical Dossier & Marine Plotter Drawer Integration
- In `frontend/src/components/TacticalEntityOverlay.jsx`:
  - When an iceberg is selected, display a "SATELLITE RECONNAISSANCE" telemetry panel showing the last satellite overpass, radar backscatter (dB), detecting sensor, and surface area trend.
- In `frontend/src/components/MarinePlotterDrawer.jsx`:
  - Add a dedicated layer toggle under Ocean & Ice Overlays: "Satellite Trajectory Tracks (Sentinel-1 SAR / BYU)".

### R5. Environment Configuration & API Documentation
- Ensure `.env` and `.env.example` include all relevant satellite APIs (Copernicus CDSE, NASA Earthdata, BYU, CelesTrak) with clear registration instructions for any keys requiring user login.

## Acceptance Criteria

### Satellite Track Data & API Verification
- [ ] BYU/USNIC satellite observation tracks for all 4 icebergs are fully populated and accessible in both backend and frontend.
- [ ] `/ws/realtime` broadcast frames include `satelliteTrack` with verified satellite passes.
- [ ] Python unit/integration tests pass with 100% success rate.

### 3D Visualization Verification
- [ ] Glowing historical satellite trajectory lines are rendered trailing behind each iceberg in Cesium.
- [ ] Interactive satellite fix pins are visible, clickable, and show satellite pass metadata.
- [ ] When Sentinel-1A orbits overhead, the dynamic satellite sensor scan beam connects from space to the iceberg.
- [ ] `npm run build` succeeds with zero errors.
- [ ] DevTools console has zero uncaught exceptions.
