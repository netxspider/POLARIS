# POLARIS Real-Time Streaming Subsystem: E2E Test Infrastructure (TEST_INFRA.md)

## 1. Overview
This document outlines the test architecture, methodology, and execution framework for the **POLARIS Real-Time Streaming Subsystem**. The test suite validates the 1 Hz WebSocket feed (`/ws/realtime`), physics-driven iceberg drift, live & fallback AIS vessel telemetry, RV Polar Explorer bridge parameters, and 3D Cesium visualization readiness according to `ORIGINAL_REQUEST.md` and `PROJECT.md`.

## 2. Test Architecture & Harness
- **Test Framework**: `pytest` (v9.1.1)
- **Client Protocol**: `fastapi.testclient.TestClient` using WebSocket context manager `websocket_connect("/ws/realtime")`
- **Application Under Test**: `backend.main.app`
- **Integrity Level**: Opaque-box E2E testing against external API contracts without relying on internal private implementation details.
- **Location**: `tests/test_realtime_e2e.py`

## 3. 4-Tier Testing Methodology

### Tier 1: Feature Coverage (Core Capabilities & Data Contracts)
Covers the happy path for each required feature as defined in the interface contract:
1. `test_ws_connection_and_telemetry_frame`: Establishes WebSocket handshake on `/ws/realtime` and receives initial frame.
2. `test_telemetry_frame_schema_contract`: Validates top-level JSON schema (`type: "telemetry_frame"`, `timestamp`, `icebergs`, `vessels`, `telemetry`).
3. `test_dynamic_icebergs_schema_and_projection`: Validates iceberg entities (`id`, `name`, `lat`, `lon`, `speedKn`, `headingDeg`, `threatLevel`, `dimensions`, `projection6h`).
4. `test_ais_fallback_fleet_when_no_api_key`: Validates fallback polar fleet (`RV Polarstern`, `Vasily Golovnin`, `SA Agulhas II`, `Xue Long 2`, `Akademik Fedorov`, `RRS Sir David Attenborough`).
5. `test_rv_polar_explorer_telemetry_fields`: Validates vessel telemetry (`vesselName`, `lat`, `lon`, `speedKn`, `heading`, `depthM`, `draftM` = 8.5m, `ukcM`, `trueWind`, `progress`, `risk`).
6. `test_utc_timestamp_sgp4_synchronization`: Validates authoritative ISO-8601 UTC timestamp format with millisecond precision for satellite SGP4 propagation.

### Tier 2: Boundary & Corner Cases (Resilience & Edge Conditions)
Tests boundary conditions, stress points, and edge cases:
1. `test_zero_payload_immediate_disconnect`: Immediate disconnect after handshake; confirms clean socket closure and no unhandled server exceptions.
2. `test_rapid_connect_disconnect_churn`: 5 rapid consecutive connect/disconnect cycles; validates against socket leaks and connection manager deadlocks.
3. `test_multiple_concurrent_websocket_clients`: 3 concurrent clients connected simultaneously; verifies broadcast fan-out without starvation or mutual interference.
4. `test_ukc_shallow_depth_non_negative_floor`: Validates the physical constraint $\text{UKC} = \max(0.0, \text{depth} - 8.5)$, ensuring UKC is never negative even in shallow waters ($\text{depth} \le 8.5\text{m}$).
5. `test_iceberg_and_vessel_geographic_bounds`: Validates all entity coordinates strictly lie within the Southern Ocean / Antarctic domain ($-90.0 \le \text{lat} \le -50.0$, $-180.0 \le \text{lon} \le 180.0$).
6. `test_heading_degrees_range_boundary`: Validates all heading and bearing values strictly adhere to $0.0 \le \text{headingDeg} < 360.0$.

### Tier 3: Cross-Feature Combinations (Integration & Physical Dynamics)
Tests interactions between concurrent subsystems:
1. `test_iceberg_dynamic_drift_advancement`: Verifies that iceberg coordinates advance over consecutive seconds $(lat_{t+1}, lon_{t+1}) \neq (lat_t, lon_t)$ matching velocity direction.
2. `test_6h_projection_vector_physics_consistency`: Validates that the 6-hour projection vector $[lat_{6h}, lon_{6h}]$ points in the direction of heading and spans approximately $6 \times speedKn$ nautical miles.
3. `test_telemetry_fairway_corridor_progression`: Validates that RV Polar Explorer coordinates and heading follow the Maitri ($-70.77^\circ\text{S}, 11.73^\circ\text{E}$) $\to$ Bharati ($-69.41^\circ\text{S}, 76.19^\circ\text{E}$) transit fairway.
4. `test_environmental_weather_telemetry_correlation`: Validates that `trueWind` in vessel telemetry correlates with meteorological wind patterns for the Southern Ocean corridor.
5. `test_monotonic_timestamp_advancement`: Validates that UTC timestamps in consecutive frames are strictly increasing ($t_{n+1} > t_n$).

### Tier 4: Real-World Scenarios (End-to-End Operational Flows)
Tests realistic operational scenarios and frontend integration readiness:
1. `test_multi_second_voyage_stream_cadence`: Streams multiple consecutive frames over 3+ seconds, verifying 1 Hz broadcast cadence, frame continuity, and zero dropped fields.
2. `test_tactical_hazard_closest_point_of_approach`: Calculates great-circle Closest Point of Approach (CPA) / distance between RV Polar Explorer and closest iceberg hazard (e.g. C-19), verifying mathematical consistency.
3. `test_reconnection_simulation_exponential_backoff`: Simulates a client network disconnect, exponential backoff delay, and reconnection, validating that the stream seamlessly resumes with updated time and positions.
4. `test_dual_mode_cesium_entity_contract_readiness`: Validates data contract readiness for Cesium 3D viewer (unique stable entity IDs, numeric coordinate tuples for `SampledPositionProperty`, ARPA vector parameters, and attributes for `disableDepthTestDistance: Number.POSITIVE_INFINITY`).

## 4. Execution Command
```powershell
python -m pytest tests/test_realtime_e2e.py -v
```

## 5. Escalation & Defect Reporting Protocol
In accordance with QA / Test Writer guidelines:
- Test Writer writes test code only and never modifies implementation code.
- If `/ws/realtime` is missing or fails contract validation, the exact defect is captured and escalated to Worker Milestone 1 (`worker_m1`) and Orchestrator (`orchestrator_1`).
