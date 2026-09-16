/**
 * POLARIS API Client
 * Interfaces with FastAPI backend adhering strictly to Section 4 Data Contract.
 */

const API_BASE = '/api';

export async function fetchHealth() {
  const res = await fetch('/health');
  if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
  return res.json();
}

export async function fetchConfig() {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error(`Config fetch failed: ${res.statusText}`);
  return res.json();
}

export async function setConfigDemoMode(demoMode) {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ demo_mode: demoMode })
  });
  if (!res.ok) throw new Error(`Set config failed: ${res.statusText}`);
  return res.json();
}

export async function fetchScenario(live = false, anomaly = false) {
  const params = new URLSearchParams();
  if (live) params.set('live', 'true');
  if (anomaly) params.set('anomaly', 'true');
  const res = await fetch(`${API_BASE}/scenario?${params.toString()}`);
  if (!res.ok) throw new Error(`Scenario fetch failed: ${res.statusText}`);
  return res.json();
}

export async function requestReplan(currentLat, currentLon, currentTime, anomalyActive = true) {
  const res = await fetch(`${API_BASE}/replan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      current_lat: currentLat,
      current_lon: currentLon,
      current_time: currentTime,
      anomaly_active: anomalyActive,
      ice_risk_weight: 9.5
    })
  });
  if (!res.ok) throw new Error(`Replan failed: ${res.statusText}`);
  return res.json();
}

export async function fetchWeather(lat, lon, timeIso) {
  const params = new URLSearchParams({ lat, lon, time_iso: timeIso });
  const res = await fetch(`${API_BASE}/weather?${params.toString()}`);
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.statusText}`);
  return res.json();
}

export async function fetchGeeStatus() {
  const res = await fetch(`${API_BASE}/gee/status`);
  if (!res.ok) throw new Error(`GEE status fetch failed: ${res.statusText}`);
  return res.json();
}

export async function fetchModelStatus() {
  const res = await fetch(`${API_BASE}/model/status`);
  if (!res.ok) throw new Error(`Model status fetch failed: ${res.statusText}`);
  return res.json();
}

export async function requestModelRoute(sourceLat, sourceLon, destinationLat, destinationLon) {
  const res = await fetch(`${API_BASE}/model/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_lat: Number(sourceLat),
      source_lon: Number(sourceLon),
      destination_lat: Number(destinationLat),
      destination_lon: Number(destinationLon)
    })
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Model route failed: ${res.statusText}`);
  }
  return res.json();
}

export function getGeeSentinel1TileUrl() {
  return `${API_BASE}/gee/sentinel1/tiles/{z}/{x}/{y}.png`;
}

export function getGeeSeaIceTileUrl() {
  return `${API_BASE}/gee/sea-ice/tiles/{z}/{x}/{y}.png`;
}

export async function fetchAisLive(limit = 500) {
  const res = await fetch(`${API_BASE}/ais-live?limit=${limit}`);
  if (!res.ok) throw new Error(`AIS fetch failed: ${res.statusText}`);
  return res.json();
}

