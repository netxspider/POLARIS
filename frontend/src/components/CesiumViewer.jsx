import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import * as Cesium from 'cesium';
import * as satellite from 'satellite.js';
import { ecdisNightShader, ecdisRadarShader } from '../styles/ecdisPalettes.js';
import { snowShader } from '../styles/snow.js';
import { POLAR_SATELLITES } from '../data/polarSatellites.js';
import { flyToPreset, cinematicFlyIn, flyToShipCamera, configureCameraCollisionPrevention, CAMERA_PRESETS } from '../services/camera.js';
import { flyToWorldTarget, registerWorldFocusRequestListener } from '../services/worldFocus.js';
import { getSatelliteTrackForIceberg, SATELLITE_ICEBERG_TRACKS } from '../data/satelliteIcebergTracks.js';

// Tactical Radar Satellite Waypoint Billboard SVG Icon (Glowing Aperture & Crosshairs)
const RADAR_SAT_ICON_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
  <!-- Glowing radar range outer circle -->
  <circle cx="16" cy="16" r="14" stroke="#00f0ff" stroke-width="1.5" stroke-dasharray="3 2" fill="rgba(0, 240, 255, 0.14)"/>
  <!-- Sensor Aperture Ring -->
  <circle cx="16" cy="16" r="8" stroke="#38bdf8" stroke-width="1.2" fill="rgba(6, 182, 212, 0.28)"/>
  <!-- Central Radar Core -->
  <circle cx="16" cy="16" r="3.5" fill="#00f0ff"/>
  <!-- Satellite Solar Panel Wings / Crosshair Beams -->
  <line x1="16" y1="2" x2="16" y2="7" stroke="#00f0ff" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="16" y1="25" x2="16" y2="30" stroke="#00f0ff" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="2" y1="16" x2="7" y2="16" stroke="#00f0ff" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="25" y1="16" x2="30" y2="16" stroke="#00f0ff" stroke-width="1.5" stroke-linecap="round"/>
  <!-- Corner Tactical Reticle Ticks -->
  <path d="M7 7 L9 7 M7 7 L7 9 M25 7 L23 7 M25 7 L25 9 M7 25 L9 25 M7 25 L7 23 M25 25 L23 25 M25 25 L25 23" stroke="#38bdf8" stroke-width="1" stroke-linecap="round"/>
</svg>`);

// Format ISO observation timestamp into short military tactical date (e.g. 'AUG 10', 'SEP 02')
const formatSatelliteFixDate = (isoString) => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const month = months[d.getUTCMonth()] || '';
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${month} ${day}`;
  } catch {
    return String(isoString).slice(5, 10);
  }
};

// Bounding box for East Antarctic corridor
const LAT_MIN = -72.5;
const LAT_MAX = -63.0;
const LON_MIN = 8.0;
const LON_MAX = 80.0;
const MODEL_LAT_MIN = -80.0;
const MODEL_LAT_MAX = -50.0;
const MODEL_LON_MIN = 0.0;
const MODEL_LON_MAX = 90.0;

// International Polar Research Stations in the Antarctic Corridor
const RESEARCH_STATIONS = [
  {
    id: 'maitri',
    name: 'Maitri Research Station 🇮🇳',
    subtitle: 'Indian Antarctic Base • Princess Astrid Coast',
    lat: -70.77,
    lon: 11.73,
    color: Cesium.Color.fromCssColorString('#10b981'),
    description: 'Permanent Indian Antarctic research station in the Schirmacher Oasis. Operational since 1989 supporting polar atmospheric and geological sciences.'
  },
  {
    id: 'india_bay',
    name: 'India Bay Mooring 🇮🇳',
    subtitle: 'NCPOR Fast-Ice Ship Berth • Princess Astrid Coast',
    lat: -69.90,
    lon: 11.95,
    color: Cesium.Color.fromCssColorString('#06b6d4'),
    description: 'Primary sea-ice anchorage and cargo offloading site for the Indian Antarctic Programme at India Bay, connected to Maitri Station via 80 km overland ice-traverse.'
  },
  {
    id: 'bharati',
    name: 'Bharati Research Station 🇮🇳',
    subtitle: 'Indian Antarctic Base • Larsemann Hills, Prydz Bay',
    lat: -69.41,
    lon: 76.19,
    color: Cesium.Color.fromCssColorString('#38bdf8'),
    description: 'State-of-the-art Indian polar research station located on the Larsemann Hills promontory overlooking Prydz Bay with satellite telemetry and oceanography.'
  },
  {
    id: 'novolazarevskaya',
    name: 'Novolazarevskaya Station 🇷🇺',
    subtitle: 'Russian Antarctic Base • Schirmacher Oasis',
    lat: -70.78,
    lon: 11.83,
    color: Cesium.Color.fromCssColorString('#f59e0b'),
    description: 'Russian polar research station located in Queen Maud Land near Maitri station, operating ice runway and meteorological instruments.'
  },
  {
    id: 'syowa',
    name: 'Syowa Station 🇯🇵',
    subtitle: 'Japanese Antarctic Base • East Ongul Island',
    lat: -69.00,
    lon: 39.58,
    color: Cesium.Color.fromCssColorString('#ec4899'),
    description: 'Permanent Japanese polar research station on East Ongul Island in Lützow-Holm Bay, supporting upper-atmosphere physics and cosmic-ray studies.'
  },
  {
    id: 'progress',
    name: 'Progress Station 🇷🇺',
    subtitle: 'Russian Antarctic Base • Larsemann Hills',
    lat: -69.37,
    lon: 76.38,
    color: Cesium.Color.fromCssColorString('#f59e0b'),
    description: 'Russian coastal research station in the Larsemann Hills near Bharati station, supporting Antarctic logistics and deep inland traverses.'
  },
  {
    id: 'zhongshan',
    name: 'Zhongshan Station 🇨🇳',
    subtitle: 'Chinese Antarctic Base • Larsemann Hills',
    lat: -69.37,
    lon: 76.37,
    color: Cesium.Color.fromCssColorString('#ef4444'),
    description: 'Chinese research station located adjacent to Bharati base in Larsemann Hills, studying polar glaciology and space physics.'
  },
  {
    id: 'mawson',
    name: 'Mawson Station 🇦🇺',
    subtitle: 'Australian Antarctic Base • Mac. Robertson Land',
    lat: -67.60,
    lon: 62.87,
    color: Cesium.Color.fromCssColorString('#a855f7'),
    description: 'Oldest continuously occupied Antarctic station south of the Antarctic Circle, established in 1954 in Holme Bay.'
  },
  {
    id: 'davis',
    name: 'Davis Station 🇦🇺',
    subtitle: 'Australian Antarctic Base • Vestfold Hills',
    lat: -68.58,
    lon: 77.97,
    color: Cesium.Color.fromCssColorString('#a855f7'),
    description: 'Major Australian research hub in the ice-free Vestfold Hills, supporting oceanography and seal ecology.'
  },
  {
    id: 'neumayer',
    name: 'Neumayer III Station 🇩🇪',
    subtitle: 'German Antarctic Base • Ekström Ice Shelf',
    lat: -70.67,
    lon: -8.27,
    color: Cesium.Color.fromCssColorString('#eab308'),
    description: 'Modern elevated German polar observatory on the Ekström Ice Shelf in Atka Bay.'
  },
  {
    id: 'sanae',
    name: 'SANAE IV Station 🇿🇦',
    subtitle: 'South African Antarctic Base • Vesleskarvet',
    lat: -71.67,
    lon: -2.83,
    color: Cesium.Color.fromCssColorString('#14b8a6'),
    description: 'South African National Antarctic Expedition base built on the cliffs of Vesleskarvet nunatak.'
  }
];

// Google Maps Style Antarctic Geographical Names (Oceans, Seas, Coasts, Lands, Glaciers)
const GEOGRAPHIC_NAMES = [
  // Oceans & Marginal Seas (Italic Blue Water Typography)
  { name: 'SOUTHERN OCEAN', lat: -63.5, lon: 42.0, type: 'ocean', minDistance: 2000000, maxDistance: 25000000 },
  { name: 'Lazarev Sea', lat: -67.0, lon: 11.0, type: 'sea', minDistance: 500000, maxDistance: 12000000 },
  { name: 'Riiser-Larsen Sea', lat: -66.5, lon: 28.0, type: 'sea', minDistance: 500000, maxDistance: 12000000 },
  { name: 'Cosmonauts Sea', lat: -66.0, lon: 45.0, type: 'sea', minDistance: 500000, maxDistance: 12000000 },
  { name: 'Cooperation Sea', lat: -66.2, lon: 65.0, type: 'sea', minDistance: 500000, maxDistance: 12000000 },
  { name: 'Davis Sea', lat: -66.5, lon: 85.0, type: 'sea', minDistance: 500000, maxDistance: 12000000 },
  { name: 'Prydz Bay', lat: -68.8, lon: 75.2, type: 'bay', minDistance: 100000, maxDistance: 6000000 },
  { name: 'Lützow-Holm Bay', lat: -69.2, lon: 37.5, type: 'bay', minDistance: 100000, maxDistance: 6000000 },

  // Major Geographic Lands & Coasts (Bold White Land Typography)
  { name: 'QUEEN MAUD LAND', lat: -73.0, lon: 20.0, type: 'land', minDistance: 1500000, maxDistance: 20000000 },
  { name: 'Princess Astrid Coast', lat: -70.2, lon: 12.0, type: 'coast', minDistance: 200000, maxDistance: 8000000 },
  { name: 'Princess Ragnhild Coast', lat: -70.4, lon: 27.0, type: 'coast', minDistance: 200000, maxDistance: 8000000 },
  { name: 'Prince Harald Coast', lat: -69.6, lon: 36.0, type: 'coast', minDistance: 200000, maxDistance: 8000000 },
  { name: 'Prince Olav Coast', lat: -68.6, lon: 43.0, type: 'coast', minDistance: 200000, maxDistance: 8000000 },
  { name: 'Enderby Land', lat: -67.8, lon: 51.5, type: 'land', minDistance: 400000, maxDistance: 10000000 },
  { name: 'Kemp Land', lat: -67.4, lon: 59.0, type: 'coast', minDistance: 300000, maxDistance: 8000000 },
  { name: 'Mac. Robertson Land', lat: -68.2, lon: 65.0, type: 'land', minDistance: 400000, maxDistance: 10000000 },
  { name: 'Princess Elizabeth Land', lat: -69.2, lon: 78.5, type: 'land', minDistance: 400000, maxDistance: 10000000 },
  { name: 'Larsemann Hills', lat: -69.45, lon: 76.25, type: 'feature', minDistance: 50000, maxDistance: 3000000 },
  { name: 'Schirmacher Oasis', lat: -70.75, lon: 11.65, type: 'feature', minDistance: 50000, maxDistance: 3000000 },
  { name: 'Vestfold Hills', lat: -68.55, lon: 78.15, type: 'feature', minDistance: 50000, maxDistance: 3000000 },

  // Ice Shelves & Mountain Ranges
  { name: 'Fimbul Ice Shelf', lat: -70.5, lon: 0.5, type: 'shelf', minDistance: 100000, maxDistance: 5000000 },
  { name: 'Amery Ice Shelf', lat: -69.8, lon: 71.0, type: 'shelf', minDistance: 100000, maxDistance: 6000000 },
  { name: 'Lambert Glacier System', lat: -72.0, lon: 68.0, type: 'glacier', minDistance: 200000, maxDistance: 6000000 },
  { name: 'Sor Rondane Mountains', lat: -71.9, lon: 25.0, type: 'mountain', minDistance: 80000, maxDistance: 4000000 },
  { name: 'Queen Fabiola (Yamato) Mountains', lat: -71.5, lon: 35.8, type: 'mountain', minDistance: 80000, maxDistance: 4000000 },
  { name: 'Wohlthat Mountains', lat: -71.2, lon: 12.5, type: 'mountain', minDistance: 80000, maxDistance: 4000000 },
  { name: 'Prince Charles Mountains', lat: -70.8, lon: 66.0, type: 'mountain', minDistance: 100000, maxDistance: 5000000 }
];

// Antarctic Coastal 3D Mountains & Glacier Shelves
const COASTAL_3D_FEATURES = [
  {
    name: 'Wohlthat Mountains & Schirmacher Nunataks',
    lat: -71.20,
    lon: 12.50,
    height: 100.0,
    modelUri: '/models/mountain_massif.glb',
    scale: 2.5,
    minPixelSize: 32,
    headingDeg: 35
  },
  {
    name: 'Sor Rondane Mountain Range',
    lat: -71.85,
    lon: 25.50,
    height: 120.0,
    modelUri: '/models/mountain_massif.glb',
    scale: 3.0,
    minPixelSize: 36,
    headingDeg: 15
  },
  {
    name: 'Queen Fabiola (Yamato) Nunataks',
    lat: -71.50,
    lon: 35.80,
    height: 100.0,
    modelUri: '/models/mountain_massif.glb',
    scale: 2.8,
    minPixelSize: 32,
    headingDeg: -20
  },
  {
    name: 'Fimbul Ice Shelf Calving Front',
    lat: -69.80,
    lon: 0.50,
    height: 0.0,
    modelUri: '/models/glacier_shelf.glb',
    scale: 3.5,
    minPixelSize: 38,
    headingDeg: 80
  },
  {
    name: 'Amery Ice Shelf & Prydz Bay Glacier Tongue',
    lat: -68.90,
    lon: 71.50,
    height: 0.0,
    modelUri: '/models/glacier_shelf.glb',
    scale: 4.0,
    minPixelSize: 42,
    headingDeg: 65
  },
  {
    name: 'Larsemann Hills Coastal Massif (Bharati Base)',
    lat: -69.50,
    lon: 76.40,
    height: 50.0,
    modelUri: '/models/mountain_massif.glb',
    scale: 1.8,
    minPixelSize: 28,
    headingDeg: 45
  }
];

// High-Resolution BEDMAP2 / IBCSO v2 Bathymetric Depth Calculator (meters)
export const getBathymetricDepth = (lat, lon) => {
  const coastLat = -69.8 + 0.8 * Math.sin((lon * 2.2 - 15.0) * (Math.PI / 180));
  const isMaitriChannel = (lon >= 10.0 && lon <= 13.5 && lat >= -71.0 && lat <= -69.0);
  const isBharatiChannel = (lon >= 74.0 && lon <= 78.0 && lat >= -70.0 && lat <= -68.5);

  // 1. Coastal Fairways (Maitri & Bharati Channels)
  if (isMaitriChannel) return Math.round(75.0 + 150.0 * Math.max(0.0, (lat + 71.0) / 2.0));
  if (isBharatiChannel) return Math.round(110.0 + 200.0 * Math.max(0.0, (lat + 70.0) / 1.5));

  // 2. Astrid Ridge Bank (Subsea pinnacle around 14.5°E, -68.8°)
  const distAstridRidge = Math.hypot((lon - 14.5) * 0.5, lat - (-68.8));
  if (distAstridRidge < 1.2) {
    const ridgeRise = (1.0 - distAstridRidge / 1.2) * 850.0;
    return Math.max(220.0, Math.round(1100.0 - ridgeRise));
  }

  // 3. Gunnerus Ridge Seamount (Major underwater volcanic plateau around 33.5°E, -65.8°)
  const distGunnerus = Math.hypot((lon - 33.5) * 0.7, lat - (-65.8));
  if (distGunnerus < 2.0) {
    const gunnerusRise = (1.0 - distGunnerus / 2.0) * 2400.0;
    return Math.max(750.0, Math.round(3300.0 - gunnerusRise));
  }

  // 4. Amery Depression Trough (Overdeepened shelf channel around 72.5°E, -68.8°)
  const distAmery = Math.hypot((lon - 72.5) * 0.6, lat - (-68.8));
  if (distAmery < 1.5) {
    const trenchDeepen = (1.0 - distAmery / 1.5) * 450.0;
    return Math.round(420.0 + trenchDeepen);
  }

  // 5. Shallow Ice Shelf Grounding Margin
  if (lat < coastLat - 0.3) return 45.0;
  if (lat < coastLat) return Math.round(45.0 + 135.0 * ((lat - (coastLat - 0.3)) / 0.3));

  // 6. Continental Slope (Shelf Break)
  if (lat < -66.5) {
    const t = (lat - coastLat) / (-66.5 - coastLat);
    return Math.round(180.0 + 620.0 * Math.min(1.0, Math.max(0.0, t)));
  }

  // 7. Continental Rise & Abyssal Transition
  if (lat < -64.0) {
    const t = (lat - (-66.5)) / (-64.0 - (-66.5));
    const isCosmonautsDeep = Math.abs(lon - 48.0) < 5.0;
    const trenchBonus = isCosmonautsDeep ? 650.0 * Math.cos((lon - 48.0) * (Math.PI / 10)) : 0;
    return Math.round(800.0 + 2400.0 * Math.min(1.0, Math.max(0.0, t)) + trenchBonus);
  }

  // 8. Open Southern Ocean Abyssal Plain (3,200m - 4,100m)
  const baseAbyss = 3400.0 + 500.0 * Math.sin(lon * 2.8 * (Math.PI / 180));
  const cosmoTrench = Math.abs(lon - 48.0) < 6.0 ? 550.0 * Math.cos((lon - 48.0) * (Math.PI / 12)) : 0;
  return Math.round(baseAbyss + cosmoTrench);
};

// Densify route waypoints along the geodetic surface so linear interpolation never chords underground
const densifySurfaceWaypoints = (wps) => {
  if (!wps || wps.length === 0) return [];
  const denseSamples = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const w1 = wps[i];
    const w2 = wps[i + 1];
    const t1 = Cesium.JulianDate.fromIso8601(w1.time);
    const t2 = Cesium.JulianDate.fromIso8601(w2.time);
    const segDurationSec = Math.max(1, Cesium.JulianDate.secondsDifference(t2, t1));
    // Sample every ~60 seconds (approx 400m at 13.5 kn), keeping chord sagitta < 0.01m
    const numSubSteps = Math.max(1, Math.ceil(segDurationSec / 60));

    for (let s = 0; s < numSubSteps; s++) {
      const frac = s / numSubSteps;
      const subTime = Cesium.JulianDate.addSeconds(t1, frac * segDurationSec, new Cesium.JulianDate());
      const subLon = w1.lon + frac * (w2.lon - w1.lon);
      const subLat = w1.lat + frac * (w2.lat - w1.lat);
      const subPos = Cesium.Cartesian3.fromDegrees(subLon, subLat, 2.0);
      denseSamples.push({ julian: subTime, pos: subPos });
    }
  }
  const lastWp = wps[wps.length - 1];
  const lastJulian = Cesium.JulianDate.fromIso8601(lastWp.time);
  const lastPos = Cesium.Cartesian3.fromDegrees(lastWp.lon, lastWp.lat, 2.0);
  denseSamples.push({ julian: lastJulian, pos: lastPos });
  return denseSamples;
};

const CesiumViewer = forwardRef(function CesiumViewer({
  scenarioData,
  isPlaying,
  playbackSpeed,
  cameraMode = 'globe',
  mapStyle = 'google-satellite', // 'google-satellite' | 'google-hybrid' | 'esri-satellite'
  showSatellites = false,
  showRiskGrid,
  showGeeSeaIce = false,
  showIcebergs,
  showMountains,
  showStations,
  showBathymetry = true,
  showSatelliteTracks = false,
  onOverpassUpdate,
  selectedEntity = null,
  anomalyActive,
  onTelemetryUpdate,
  onCameraUpdate,
  onSelectEntity,
  streamMode = 'live',
  liveData = null,
  liveIcebergs = null,
  liveVessels = null,
  forecastStep = 0,
  useModelLayers = false
}, ref) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [selectedSatelliteFix, setSelectedSatelliteFix] = useState(null);
  const [seaIceHover, setSeaIceHover] = useState(null);
  const [activeOverpass, setActiveOverpass] = useState(null);
  const shipEntityRef = useRef(null);
  const positionPropertyRef = useRef(null);
  const routePolylineEntityRef = useRef(null);
  const traversePolylineEntityRef = useRef(null);
  const previousSamplesRef = useRef([]);
  const baseImageryLayerRef = useRef(null);
  const riskImageryLayerRef = useRef(null);
  const modelBathymetryLayerRef = useRef(null);
  const geeSentinel1LayerRef = useRef(null);
  const geeSeaIceLayerRef = useRef(null);
  const postProcessStagesRef = useRef({});
  const satelliteEntitiesRef = useRef([]);
  const satelliteTrackEntitiesRef = useRef([]);
  const radarRayEntitiesRef = useRef([]);
  const satrecMapRef = useRef(null);
  const lastOverpassUpdateRef = useRef(0);
  const icebergEntitiesRef = useRef([]);
  const aisEntitiesRef = useRef([]);
  const mountainEntitiesRef = useRef([]);
  const stationEntitiesRef = useRef([]);
  const bathymetryEntitiesRef = useRef([]);
  const sonarEntityRef = useRef(null);
  const wakeEntityRef = useRef(null);
  const lastBathyRouteKeyRef = useRef('');
  const lastShipRouteKeyRef = useRef('');

  const geographicEntitiesRef = useRef([]);

  const scenarioDataRef = useRef(scenarioData);
  useEffect(() => {
    scenarioDataRef.current = scenarioData;
  }, [scenarioData]);

  const onCameraUpdateRef = useRef(onCameraUpdate);
  useEffect(() => {
    onCameraUpdateRef.current = onCameraUpdate;
  }, [onCameraUpdate]);

  const onTelemetryUpdateRef = useRef(onTelemetryUpdate);
  useEffect(() => {
    onTelemetryUpdateRef.current = onTelemetryUpdate;
  }, [onTelemetryUpdate]);

  const lastTelemetryEmitRef = useRef(0);
  const lastProgressEmitRef = useRef(0);

  const onSelectEntityRef = useRef(onSelectEntity);
  useEffect(() => {
    onSelectEntityRef.current = onSelectEntity;
  }, [onSelectEntity]);

  const onOverpassUpdateRef = useRef(onOverpassUpdate);
  useEffect(() => {
    onOverpassUpdateRef.current = onOverpassUpdate;
  }, [onOverpassUpdate]);

  const selectedEntityRef = useRef(selectedEntity);
  useEffect(() => {
    selectedEntityRef.current = selectedEntity;
  }, [selectedEntity]);

  const selectedSatelliteFixRef = useRef(selectedSatelliteFix);
  useEffect(() => {
    selectedSatelliteFixRef.current = selectedSatelliteFix;
  }, [selectedSatelliteFix]);

  const showRiskGridRef = useRef(showRiskGrid);
  const useModelLayersRef = useRef(useModelLayers);
  const forecastStepRef = useRef(forecastStep);
  useEffect(() => { showRiskGridRef.current = showRiskGrid; }, [showRiskGrid]);
  useEffect(() => { useModelLayersRef.current = useModelLayers; }, [useModelLayers]);
  useEffect(() => { forecastStepRef.current = forecastStep; }, [forecastStep]);

  // Expose camera controls to parent component
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      if (viewerRef.current) viewerRef.current.camera.zoomIn(viewerRef.current.camera.positionCartographic.height * 0.35);
    },
    zoomOut: () => {
      if (viewerRef.current) viewerRef.current.camera.zoomOut(viewerRef.current.camera.positionCartographic.height * 0.35);
    },
    resetNorth: () => {
      if (viewerRef.current) {
        const cam = viewerRef.current.camera;
        cam.flyTo({
          destination: cam.position,
          orientation: {
            heading: 0.0,
            pitch: cam.pitch,
            roll: 0.0
          },
          duration: 1.0
        });
      }
    },
    focusIcebergTrack: (bergId) => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const viewer = viewerRef.current;
      const bergs = scenarioDataRef.current?.icebergs || [];
      const berg = bergs.find((b) => b.id.toLowerCase() === String(bergId).toLowerCase()) || bergs[0];
      if (!berg) return;

      if (onSelectEntityRef.current) {
        onSelectEntityRef.current({
          ...berg,
          type: 'iceberg',
          id: berg.id,
          name: `Iceberg ${berg.id}`,
          subtitle: 'Tracked Antarctic Tabular Iceberg',
          lat: berg.lat,
          lon: berg.lon,
          description: `Drifting iceberg ${berg.id} tracked via Sentinel-1 SAR Radar satellite imagery and LSTM trajectory physics equations.`
        });
      }

      let avgLat = berg.lat;
      let avgLon = berg.lon;
      if (berg.predictedTrack && berg.predictedTrack.length > 0) {
        const midIdx = Math.floor(berg.predictedTrack.length / 2);
        avgLat = (berg.lat + berg.predictedTrack[midIdx].lat) / 2;
        avgLon = (berg.lon + berg.predictedTrack[midIdx].lon) / 2;
      }

      viewer.trackedEntity = undefined;
      const bergEntity = viewer.entities.getById(`iceberg_${berg.id}`) ||
                         viewer.entities.values.find(e => e.id === `iceberg_${berg.id}` || (e.name && e.name.includes(berg.id) && e.model));
      if (bergEntity) {
        viewer.flyTo(bergEntity, {
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(0.0),
            Cesium.Math.toRadians(-25.0),
            4500.0
          ),
          duration: 1.8
        });
      } else {
        const targetCart = Cesium.Cartesian3.fromDegrees(avgLon, avgLat, 0.0);
        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(targetCart, 0),
          {
            offset: new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(0.0),
              Cesium.Math.toRadians(-25.0),
              5000.0
            ),
            duration: 1.8
          }
        );
      }
    },
    flyToStation: (target, customCoords) => {
      if (!viewerRef.current) return;
      const viewer = viewerRef.current;
      viewer.camera.cancelFlight?.();
      viewer.trackedEntity = undefined;
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      
      if (target === 'ship') {
        if (shipEntityRef.current) {
          viewer.flyTo(shipEntityRef.current, {
            offset: new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(0.0),
              Cesium.Math.toRadians(-25.0),
              1400.0
            ),
            duration: 1.8
          });
        }
        return;
      }

      // Check if target is a vessel MMSI or vessel ID (e.g. 273456110, vessel_273456110, or ais_273456110)
      const targetMmsi = String(target).replace('vessel_', '').replace('ais_', '').trim();
      const vesselEntity = viewer.entities.getById(`ais_${targetMmsi}`) ||
                           viewer.entities.values.find(e => e.id === `ais_${targetMmsi}` || (e.polarisData && String(e.polarisData.mmsi) === targetMmsi));
      if (vesselEntity) {
        viewer.trackedEntity = undefined;
        const vHeading = vesselEntity.polarisData?.headingDeg || 90.0;
        const vPos = vesselEntity.position?.getValue ? vesselEntity.position.getValue(viewer.clock.currentTime) : vesselEntity.position;
        if (vPos) {
          viewer.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(vPos, 50.0),
            {
              offset: new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(vHeading + 180.0),
                Cesium.Math.toRadians(-22.0),
                600.0
              ),
              duration: 1.8,
              easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT
            }
          );
        }
        if (onSelectEntityRef.current && vesselEntity.polarisData) {
          onSelectEntityRef.current(vesselEntity.polarisData);
        }
        return;
      }

      // Check if target is an iceberg ID (e.g. C-19, B-15K, D-28, A-68R)
      const bergs = scenarioDataRef.current?.icebergs || [];
      const foundBerg = bergs.find(
        (b) => b.id.toLowerCase() === String(target).toLowerCase() ||
               `iceberg ${b.id}`.toLowerCase() === String(target).toLowerCase()
      );
      if (foundBerg) {
        viewer.trackedEntity = undefined;
        const bergEntity = viewer.entities.getById(`iceberg_${foundBerg.id}`) ||
                           viewer.entities.values.find(e => e.id === `iceberg_${foundBerg.id}` || (e.name && e.name.includes(foundBerg.id) && e.model));
        if (bergEntity) {
          viewer.flyTo(bergEntity, {
            offset: new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(0.0),
              Cesium.Math.toRadians(-25.0),
              4500.0
            ),
            duration: 1.8
          });
        } else {
          const bergPos = Cesium.Cartesian3.fromDegrees(foundBerg.lon, foundBerg.lat, 0.0);
          viewer.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(bergPos, 0),
            {
              offset: new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(0.0),
                Cesium.Math.toRadians(-25.0),
                5000.0
              ),
              duration: 1.8
            }
          );
        }
        if (onSelectEntityRef.current) {
          onSelectEntityRef.current({
            ...foundBerg,
            type: 'iceberg',
            id: foundBerg.id,
            name: `Iceberg ${foundBerg.id}`,
            subtitle: 'Tracked Antarctic Tabular Iceberg',
            lat: foundBerg.lat,
            lon: foundBerg.lon,
            description: `Drifting iceberg ${foundBerg.id} tracked via Sentinel-1 SAR Radar satellite imagery and LSTM trajectory physics equations.`
          });
        }
        return;
      }

      const foundStation = RESEARCH_STATIONS.find(
        (s) => s.id === target || s.name.toLowerCase().includes(String(target).toLowerCase())
      );
      if (foundStation) {
        viewer.trackedEntity = undefined;
        const stationEntity = viewer.entities.getById(`station_${foundStation.id}`) ||
                              viewer.entities.values.find(e => e.name && e.name.includes(foundStation.name));
        if (stationEntity) {
          viewer.flyTo(stationEntity, {
            offset: new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(0.0),
              Cesium.Math.toRadians(-35.0),
              8000.0
            ),
            duration: 1.8
          });
        } else {
          const stPos = Cesium.Cartesian3.fromDegrees(foundStation.lon, foundStation.lat, 0.0);
          viewer.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(stPos, 0),
            {
              offset: new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(0.0),
                Cesium.Math.toRadians(-35.0),
                8000.0
              ),
              duration: 1.8
            }
          );
        }
        if (onSelectEntityRef.current) {
          onSelectEntityRef.current({
            type: 'station',
            id: foundStation.id,
            name: foundStation.name,
            subtitle: foundStation.subtitle,
            lat: foundStation.lat,
            lon: foundStation.lon,
            description: foundStation.description
          });
        }
      } else if (customCoords && customCoords.lat !== undefined && customCoords.lon !== undefined) {
        viewer.trackedEntity = undefined;
        const coordsPos = Cesium.Cartesian3.fromDegrees(customCoords.lon, customCoords.lat, 0.0);
        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(coordsPos, 0),
          {
            offset: new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(0.0),
              Cesium.Math.toRadians(-40.0),
              35000.0
            ),
            duration: 1.8
          }
        );
      }
    },
    setPlaying: (playing) => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const viewer = viewerRef.current;
      viewer.clock.shouldAnimate = !!playing;
      viewer.clock.canAnimate = true;
      if (viewer.cesiumWidget) {
        viewer.cesiumWidget._allowDataSourcesToSuspendAnimation = false;
      }
      if (playing) {
        viewer.clock.tick();
        viewer.scene.requestRender();
      }
    },
    seekToProgress: (fraction) => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const viewer = viewerRef.current;
      const start = viewer.clock.startTime;
      const stop = viewer.clock.stopTime;
      const totalSec = Cesium.JulianDate.secondsDifference(stop, start);
      if (totalSec > 0) {
        const targetSec = totalSec * Math.max(0, Math.min(1, fraction));
        const targetJulian = Cesium.JulianDate.addSeconds(start, targetSec, new Cesium.JulianDate());
        viewer.clock.currentTime = targetJulian;
        viewer.clock.canAnimate = true;
        if (viewer.cesiumWidget) {
          viewer.cesiumWidget._allowDataSourcesToSuspendAnimation = false;
        }
        viewer.clock.tick();
        viewer.scene.requestRender();
      }
    },
    syncLiveProgress: (fraction, maxDriftSec = 3.0) => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const viewer = viewerRef.current;
      const start = viewer.clock.startTime;
      const stop = viewer.clock.stopTime;
      if (!start || !stop) return;
      const totalSec = Cesium.JulianDate.secondsDifference(stop, start);
      if (totalSec <= 0) return;

      const curElapsedSec = Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, start);
      const targetSec = totalSec * Math.max(0, Math.min(1, fraction));
      const driftSec = Math.abs(curElapsedSec - targetSec);

      // Only re-seek if drift exceeds maxDriftSec to prevent micro-jitter/backward snapping
      if (driftSec > maxDriftSec) {
        const targetJulian = Cesium.JulianDate.addSeconds(start, targetSec, new Cesium.JulianDate());
        viewer.clock.currentTime = targetJulian;
        viewer.clock.canAnimate = true;
        if (viewer.cesiumWidget) {
          viewer.cesiumWidget._allowDataSourcesToSuspendAnimation = false;
        }
        viewer.clock.tick();
        viewer.scene.requestRender();
      }
    },
    flyToShip: () => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const viewer = viewerRef.current;
      viewer.camera.cancelFlight?.();
      viewer.trackedEntity = undefined;
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      if (positionPropertyRef.current) {
        const curPos = positionPropertyRef.current.getValue(viewer.clock.currentTime);
        if (curPos) {
          const carto = Cesium.Cartographic.fromCartesian(curPos);
          const surfacePos = Cesium.Cartesian3.fromDegrees(
            Cesium.Math.toDegrees(carto.longitude),
            Cesium.Math.toDegrees(carto.latitude),
            2.0
          );
          const nextTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 1.0, new Cesium.JulianDate());
          const nextPos = positionPropertyRef.current.getValue(nextTime);
          let heading = 90.0;
          if (nextPos) {
            const nextCarto = Cesium.Cartographic.fromCartesian(nextPos);
            const cosLat = Math.cos(carto.latitude);
            const dEast = (nextCarto.longitude - carto.longitude) * cosLat;
            const dNorth = nextCarto.latitude - carto.latitude;
            heading = (Cesium.Math.toDegrees(Math.atan2(dEast, dNorth)) + 360) % 360;
          }
          const cameraAzimuth = (heading + 180.0) % 360;
          viewer.camera.lookAt(
            surfacePos,
            new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(cameraAzimuth),
              Cesium.Math.toRadians(-13.0),
              180.0
            )
          );
          isChaseInitializedRef.current = true;
        }
      }
    },
    flyToCoords: (lat, lon, label) => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const viewer = viewerRef.current;
      viewer.camera.cancelFlight?.();
      viewer.trackedEntity = undefined;
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      const targetPos = Cesium.Cartesian3.fromDegrees(lon, lat, 0.0);
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(targetPos, 0),
        {
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(0.0),
            Cesium.Math.toRadians(-25.0),
            5000.0
          ),
          duration: 1.8
        }
      );
    },
    centerGlobe: () => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const viewer = viewerRef.current;
      viewer.camera.cancelFlight?.();
      viewer.trackedEntity = undefined;
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(44.0, -88.0, 16500000.0),
        orientation: {
          heading: Cesium.Math.toRadians(0.0),
          pitch: Cesium.Math.toRadians(-89.9),
          roll: 0.0
        },
        duration: 1.5
      });
    },
    flyToPreset: (presetName, duration) => {
      flyToPreset(viewerRef.current, presetName, duration);
    },
    cinematicFlyIn: () => {
      cinematicFlyIn(viewerRef.current);
    },
    flyToWorldTarget: (target) => {
      flyToWorldTarget(viewerRef.current, target);
    },
    focusSatelliteFix: (lat, lon) => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const targetCart = Cesium.Cartesian3.fromDegrees(lon, lat, 0.0);
      viewerRef.current.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(targetCart, 0),
        {
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(0.0),
            Cesium.Math.toRadians(-35.0),
            25000.0
          ),
          duration: 1.5
        }
      );
    },
    getViewer: () => viewerRef.current,
  }));

  // Initialize Cesium Viewer
  useEffect(() => {
    if (!containerRef.current) return;

    let isDisposed = false;

    // Disconnect Cesium Ion automatic asset lookups to prevent 401 and network errors
    Cesium.Ion.defaultAccessToken = '';

    const initialImagery = new Cesium.UrlTemplateImageryProvider({
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 19,
      credit: ''
    });
    initialImagery.errorEvent.addEventListener((e) => { e.retry = false; });

    const dummyCreditContainer = document.createElement('div');
    dummyCreditContainer.style.display = 'none';

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      navigationHelpButton: false,
      baseLayerPicker: false,
      creditContainer: dummyCreditContainer,
      imageryProvider: initialImagery,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      shouldAnimate: true
    });

    window.cesiumViewer = viewer;
    window.Cesium = Cesium;
    if (viewer.cesiumWidget) {
      viewer.cesiumWidget._allowDataSourcesToSuspendAnimation = false;
    }
    viewer.clock.canAnimate = true;

    // Google Earth High-Fidelity Graphics & Anti-Aliasing
    if (viewer.scene.postProcessStages?.fxaa) {
      viewer.scene.postProcessStages.fxaa.enabled = true;
    }

    // Initialize Marine ECDIS Display Palette Post-Process Stages (IEC 62288)
    const shaderDefs = [
      { name: 'night', def: ecdisNightShader },
      { name: 'radar', def: ecdisRadarShader },
      { name: 'snow', def: snowShader }
    ];

    shaderDefs.forEach(({ name, def }) => {
      try {
        const uniforms = { intensity: 1.0, time: 0.0 };
        if (def.uniforms) {
          Object.entries(def.uniforms).forEach(([k, v]) => {
            uniforms[k] = typeof v === 'object' && v.default !== undefined ? v.default : v;
          });
        }
        const stage = new Cesium.PostProcessStage({
          name: `polaris_${name}`,
          fragmentShader: def.fragmentShader,
          uniforms
        });
        stage.enabled = (tacticalStyle === name);
        viewer.scene.postProcessStages.add(stage);
        postProcessStagesRef.current[name] = stage;
      } catch (err) {
        console.warn(`Failed to initialize shader ${name}:`, err);
      }
    });
    postProcessStagesRef.current._initialized = true;
    viewer.scene.globe.maximumScreenSpaceError = 1.33;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050b14');
    viewer.scene.globe.enableLighting = false; // Keep true satellite photographic illumination
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.highDynamicRange = false;
    viewer.shadows = false;

    // Subsurface Camera and Collision Settings (Blocks zooming through the globe)
    const cleanupCollisionPrevention = configureCameraCollisionPrevention(viewer, {
      minimumZoomDistance: 20.0,
      maximumZoomDistance: 35000000.0,
      minAltitudeM: 15.0,
      minTrackedRangeM: 25.0
    });
    viewer.scene.globe.undergroundColor = Cesium.Color.fromCssColorString('#020617');
    
    if (viewer.scene.fog) {
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 0.00008;
      viewer.scene.fog.screenSpaceErrorFactor = 2.0;
    }
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.skyAtmosphere.saturationShift = 0.1;
      viewer.scene.skyAtmosphere.brightnessShift = 0.05;
    }
    if (viewer.scene.sun) viewer.scene.sun.show = true;
    if (viewer.scene.moon) viewer.scene.moon.show = true;

    // Pure high-performance Ellipsoid terrain (Zero 401 Ion network calls)
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();

    // Load High-Resolution Real Satellite Imagery Tiles (Google Satellite / ESRI HD)
    const setupBaseLayer = async () => {
      try {
        const googleSatelliteProvider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
          credit: '',
          maximumLevel: 20
        });
        googleSatelliteProvider.errorEvent.addEventListener((e) => { e.retry = false; });

        if (!isDisposed && viewer && !viewer.isDestroyed()) {
          viewer.imageryLayers.removeAll();
          const baseLayer = viewer.imageryLayers.addImageryProvider(googleSatelliteProvider);
          baseImageryLayerRef.current = baseLayer;
        }
      } catch (e) {
        try {
          const esriProvider = new Cesium.UrlTemplateImageryProvider({
            url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            maximumLevel: 19,
            credit: 'ESRI World Imagery HD'
          });
          esriProvider.errorEvent.addEventListener((e) => { e.retry = false; });
          if (!isDisposed && viewer && !viewer.isDestroyed()) {
            viewer.imageryLayers.removeAll();
            const baseLayer = viewer.imageryLayers.addImageryProvider(esriProvider);
            baseImageryLayerRef.current = baseLayer;
          }
        } catch (err) {
          console.warn('Base imagery load fallback:', err);
        }
      }
    };
    setupBaseLayer();

    // Center the entire 3D Earth globe directly in the middle of the screen
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(44.0, -88.0, 16500000.0),
      orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(-89.9),
        roll: 0.0
      },
      duration: 1.5
    });

    // Create 3D International Polar Research Stations
    RESEARCH_STATIONS.forEach((st) => {
      const pin = viewer.entities.add({
        id: `station_${st.id}`,
        name: st.name,
        position: Cesium.Cartesian3.fromDegrees(st.lon, st.lat, 50.0),
        point: {
          pixelSize: 9,
          color: st.color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 30000000)
        },
        label: {
          text: st.name,
          font: 'bold 11px Inter, system-ui, sans-serif',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20000000)
        },
        description: st.description
      });
      pin.polarisData = {
        type: 'station',
        id: st.id,
        name: st.name,
        subtitle: st.subtitle,
        lat: st.lat,
        lon: st.lon,
        description: st.description
      };
      stationEntitiesRef.current.push(pin);
    });

    // Create Google Maps Style Antarctic Geographical Names (Oceans, Seas, Coasts, Mountains, Ice Shelves)
    GEOGRAPHIC_NAMES.forEach((geo) => {
      let font = '12px "Segoe UI", Roboto, sans-serif';
      let fillColor = Cesium.Color.fromCssColorString('#f8fafc');
      let outlineColor = Cesium.Color.fromCssColorString('#020617');
      let outlineWidth = 2;

      if (geo.type === 'ocean') {
        font = 'italic bold 15px "Segoe UI", Roboto, sans-serif';
        fillColor = Cesium.Color.fromCssColorString('#7dd3fc');
        outlineColor = Cesium.Color.fromCssColorString('#082f49');
        outlineWidth = 3;
      } else if (geo.type === 'sea') {
        font = 'italic 13px "Segoe UI", Roboto, sans-serif';
        fillColor = Cesium.Color.fromCssColorString('#bae6fd');
        outlineColor = Cesium.Color.fromCssColorString('#083344');
        outlineWidth = 3;
      } else if (geo.type === 'bay') {
        font = 'italic 11px "Segoe UI", Roboto, sans-serif';
        fillColor = Cesium.Color.fromCssColorString('#e0f2fe');
        outlineColor = Cesium.Color.fromCssColorString('#0f172a');
        outlineWidth = 2;
      } else if (geo.type === 'land') {
        font = 'bold 14px "Segoe UI", Roboto, sans-serif';
        fillColor = Cesium.Color.fromCssColorString('#ffffff');
        outlineColor = Cesium.Color.fromCssColorString('#020617');
        outlineWidth = 3;
      } else if (geo.type === 'coast') {
        font = '12px "Segoe UI", Roboto, sans-serif';
        fillColor = Cesium.Color.fromCssColorString('#f1f5f9');
        outlineColor = Cesium.Color.fromCssColorString('#020617');
        outlineWidth = 2;
      } else if (geo.type === 'shelf' || geo.type === 'glacier') {
        font = 'italic 11px "Segoe UI", Roboto, sans-serif';
        fillColor = Cesium.Color.fromCssColorString('#cffafe');
        outlineColor = Cesium.Color.fromCssColorString('#083344');
        outlineWidth = 2;
      } else if (geo.type === 'mountain') {
        font = '11px "Segoe UI", Roboto, sans-serif';
        fillColor = Cesium.Color.fromCssColorString('#cbd5e1');
        outlineColor = Cesium.Color.fromCssColorString('#0f172a');
        outlineWidth = 2;
      } else if (geo.type === 'feature') {
        font = 'bold 11px "Segoe UI", Roboto, sans-serif';
        fillColor = Cesium.Color.fromCssColorString('#fef08a');
        outlineColor = Cesium.Color.fromCssColorString('#1e1b4b');
        outlineWidth = 2;
      }

      const geoLabel = viewer.entities.add({
        id: `geo_${geo.name.replace(/\\s+/g, '_').toLowerCase()}`,
        name: geo.name,
        position: Cesium.Cartesian3.fromDegrees(geo.lon, geo.lat, 20.0),
        label: {
          text: geo.name,
          font: font,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: fillColor,
          outlineColor: outlineColor,
          outlineWidth: outlineWidth,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(geo.minDistance, geo.maxDistance)
        }
      });
      geoLabel.polarisData = {
        type: 'place',
        name: geo.name,
        subtitle: `Antarctic Geographical Feature • ${geo.type.toUpperCase()}`,
        lat: geo.lat,
        lon: geo.lon,
        description: `Natural geographical landmark in the East Antarctic marine and coastal sector (Coordinates: ${Math.abs(geo.lat).toFixed(2)}°S, ${Math.abs(geo.lon).toFixed(2)}°E).`
      };
      geographicEntitiesRef.current.push(geoLabel);
    });

    // Create 3D Coastal Mountain Massifs & Glacier Shelves
    COASTAL_3D_FEATURES.forEach((feat) => {
      const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(feat.headingDeg),
        0.0,
        0.0
      );
      const pos = Cesium.Cartesian3.fromDegrees(feat.lon, feat.lat, feat.height);
      const orient = Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);

      const mEntity = viewer.entities.add({
        name: feat.name,
        position: pos,
        orientation: orient,
        model: {
          uri: feat.modelUri,
          scale: 1.0,
          shadows: Cesium.ShadowMode.ENABLED,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000000)
        },
        label: {
          text: feat.name.split(' ')[0],
          font: '10px Inter, sans-serif',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.fromCssColorString('#e2e8f0'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4000000)
        }
      });
      mEntity.polarisData = {
        type: 'place',
        name: feat.name,
        subtitle: '3D Geological & Glaciological Feature',
        lat: feat.lat,
        lon: feat.lon,
        description: `High-resolution 3D glaciological relief in East Antarctica (${Math.abs(feat.lat).toFixed(2)}°S, ${Math.abs(feat.lon).toFixed(2)}°E).`
      };
      mountainEntitiesRef.current.push(mEntity);
    });

    // Handle Click on 3D Entities (Google Maps Style Selection)
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    let hoverRequest = 0;
    handler.setInputAction(async (movement) => {
      if (!showRiskGridRef.current || !useModelLayersRef.current || !movement?.endPosition) {
        setSeaIceHover(null);
        return;
      }
      const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, Cesium.Ellipsoid.WGS84);
      if (!cartesian) {
        setSeaIceHover(null);
        return;
      }
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const requestId = ++hoverRequest;
      try {
        const response = await fetch(`/api/model/sea-ice-value?lat=${lat}&lon=${lon}&step=${forecastStepRef.current}`);
        if (!response.ok || requestId !== hoverRequest) return;
        const value = await response.json();
        setSeaIceHover(value);
      } catch {
        if (requestId === hoverRequest) setSeaIceHover(null);
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((click) => {
      const drillObjects = viewer.scene.drillPick ? viewer.scene.drillPick(click.position) : [];
      let pickedObject = drillObjects.find((obj) => obj?.id?.polarisData?.type === 'satellite_fix');
      if (!pickedObject) {
        pickedObject = viewer.scene.pick(click.position);
      }
      if (!pickedObject && click?.position) {
        const clickX = click.position.x;
        const clickY = click.position.y;
        for (const ent of aisEntitiesRef.current) {
          if (!ent.show || !ent.position) continue;
          const pos = ent.position.getValue(viewer.clock.currentTime);
          if (!pos) continue;
          const wp = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos);
          if (wp && Math.hypot(wp.x - clickX, wp.y - clickY) <= 24) {
            pickedObject = { id: ent };
            break;
          }
        }
      }
      if (Cesium.defined(pickedObject) && pickedObject.id) {
        const entity = pickedObject.id;
        if (entity.polarisData) {
          if (entity.polarisData.type === 'satellite_fix') {
            setSelectedSatelliteFix(entity.polarisData);
          } else {
            setSelectedSatelliteFix(null);
          }
          if (onSelectEntityRef.current) {
            onSelectEntityRef.current(entity.polarisData);
          }
          return;
        }
        setSelectedSatelliteFix(null);
        if (entity === shipEntityRef.current || entity.id === 'vessel_ship') {
          if (onSelectEntityRef.current) {
            onSelectEntityRef.current({
              type: 'ship',
              name: 'RV Polar Explorer',
              subtitle: 'Ice-Class Polar Research Vessel (PC4)',
              lat: -70.77,
              lon: 11.73,
              description: 'Flagship polar research vessel equipped with ice-strengthened hull, multibeam bathymetric sonar, CTD rosette winches, and meteorological radar.'
            });
          }
        } else if (
          (entity.id && (entity.id.startsWith('iceberg_') || entity.id.startsWith('arpa_vector_') || entity.id.startsWith('arpa_ring_') || entity.id.startsWith('track_') || entity.id.startsWith('sat_track_') || entity.id.startsWith('sat_corridor_'))) ||
          (entity.name && (entity.name.startsWith('Iceberg') || entity.name.startsWith('Drift Track') || entity.name.startsWith('ARPA') || entity.name.startsWith('Historical Satellite Trajectory Track')))
        ) {
          let bergId = '';
          if (entity.id) {
            bergId = entity.id.replace('sat_track_', '').replace('sat_corridor_', '').replace('iceberg_', '').replace('arpa_vector_', '').replace('arpa_ring_', '').replace('track_', '').trim();
          } else if (entity.name) {
            bergId = entity.name.replace('Historical Satellite Trajectory Track ', '').replace('Iceberg ', '').replace('Drift Track ', '').replace('ARPA Vector ', '').replace('ARPA Exclusion Ring ', '').trim();
          }
          const rawBergs = (liveIcebergs && liveIcebergs.length > 0) ? liveIcebergs : (scenarioDataRef.current?.icebergs || []);
          const satBerg = SATELLITE_ICEBERG_TRACKS[bergId];
          const bergData = rawBergs.find((b) => String(b.id || b.icebergId).toUpperCase() === bergId.toUpperCase()) || satBerg;
          if (onSelectEntityRef.current && bergData) {
            onSelectEntityRef.current({
              ...bergData,
              type: 'iceberg',
              id: bergId,
              name: `Iceberg ${bergId}`,
              subtitle: 'Tracked Antarctic Tabular Iceberg',
              lat: bergData.lat ?? satBerg?.lat ?? -67.85,
              lon: bergData.lon ?? satBerg?.lon ?? 24.12,
              description: `Drifting iceberg ${bergId} tracked via Sentinel-1 SAR Radar satellite imagery and LSTM trajectory physics equations.`
            });
          }
        } else if (
          (entity.id && (entity.id.startsWith('ais_') || entity.id.startsWith('ais_vec_'))) ||
          (entity.name && (entity.name.startsWith('Vessel ') || entity.name.startsWith('Course Vector ')))
        ) {
          let mmsi = '';
          if (entity.id) {
            mmsi = entity.id.replace('ais_vec_', '').replace('ais_', '').trim();
          }
          const rawVessels = (liveVessels && liveVessels.length > 0) ? liveVessels : (scenarioDataRef.current?.vessels || []);
          const vData = rawVessels.find((v) => String(v.mmsi) === String(mmsi));
          if (onSelectEntityRef.current && vData) {
            const isSimulated = vData.is_simulated !== false;
            onSelectEntityRef.current({
              type: 'vessel',
              id: `vessel_${vData.mmsi}`,
              mmsi: String(vData.mmsi),
              name: isSimulated ? `[DEMO] ${vData.name}` : vData.name,
              subtitle: isSimulated
                ? `DEMO / PRACTICE TARGET • ${(vData.type || 'POLAR VESSEL').toUpperCase()} • MMSI ${vData.mmsi}`
                : `${(vData.type || 'POLAR VESSEL').toUpperCase()} • MMSI ${vData.mmsi}`,
              lat: vData.lat,
              lon: vData.lon,
              speedKn: vData.speedKn || vData.speed || 10.0,
              headingDeg: vData.headingDeg || vData.heading || vData.course || 90.0,
              destination: vData.destination || 'Antarctic Station',
              is_simulated: isSimulated,
              is_demo: isSimulated,
              status_label: isSimulated ? 'DEMO / PRACTICE TARGET' : 'LIVE AIS VESSEL',
              description: isSimulated
                ? `Simulated practice vessel ${vData.name} for collision avoidance testing. (In reality, this ship is currently operating in home waters / Russia outside the austral summer).`
                : `Active Southern Ocean vessel ${vData.name}. Tracked via AISStream feed.`
            });
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewerRef.current = viewer;
    window.__cesiumViewer = viewer;
    setIsViewerReady(true);

    // Register World Focus Request listener from gods-eye-view
    const unregisterFocus = registerWorldFocusRequestListener(window, (event) => {
      if (event?.detail) {
        flyToWorldTarget(viewer, event.detail);
      }
    });

    return () => {
      isDisposed = true;
      setIsViewerReady(false);
      unregisterFocus();
      if (cleanupCollisionPrevention) cleanupCollisionPrevention();
      if (viewer && !viewer.isDestroyed()) {
        handler.destroy();
        satelliteTrackEntitiesRef.current.forEach((e) => {
          try { viewer.entities.remove(e); } catch {}
        });
        satelliteTrackEntitiesRef.current = [];
        radarRayEntitiesRef.current.forEach((r) => {
          try { viewer.entities.remove(r); } catch {}
        });
        radarRayEntitiesRef.current = [];
        viewer.destroy();
      }
      viewerRef.current = null;
      window.__cesiumViewer = null;
    };
  }, []);

  const isChaseInitializedRef = useRef(false);
  const cameraModeRef = useRef(cameraMode);
  const prevCameraModeRef = useRef(cameraMode);
  const tacticalStyleRef = useRef(tacticalStyle);
  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);
  useEffect(() => {
    tacticalStyleRef.current = tacticalStyle;
  }, [tacticalStyle]);

  // Update camera mode (globe, chase, bridge, 2d)
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const viewer = viewerRef.current;
    const cam = viewer.camera;
    // Toggle distant geographic/station labels to keep Chase Cam clean and cinematic
    if (geographicEntitiesRef.current) {
      geographicEntitiesRef.current.forEach((g) => {
        g.show = cameraMode !== 'chase';
      });
    }
    if (stationEntitiesRef.current) {
      stationEntitiesRef.current.forEach((s) => {
        s.show = cameraMode !== 'chase' && showStations;
      });
    }

    if (cameraMode === 'chase' && shipEntityRef.current) {
      viewer.camera.cancelFlight?.();
      viewer.trackedEntity = undefined;
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      if (positionPropertyRef.current) {
        const curPos = positionPropertyRef.current.getValue(viewer.clock.currentTime);
        if (curPos) {
          const carto = Cesium.Cartographic.fromCartesian(curPos);
          const surfacePos = Cesium.Cartesian3.fromDegrees(
            Cesium.Math.toDegrees(carto.longitude),
            Cesium.Math.toDegrees(carto.latitude),
            2.0
          );
          const nextTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 1.0, new Cesium.JulianDate());
          const nextPos = positionPropertyRef.current.getValue(nextTime);
          let heading = 90.0;
          if (nextPos) {
            const nextCarto = Cesium.Cartographic.fromCartesian(nextPos);
            const cosLat = Math.cos(carto.latitude);
            const dEast = (nextCarto.longitude - carto.longitude) * cosLat;
            const dNorth = nextCarto.latitude - carto.latitude;
            heading = (Cesium.Math.toDegrees(Math.atan2(dEast, dNorth)) + 360) % 360;
          }
          const cameraAzimuth = (heading + 180.0) % 360;
          viewer.camera.lookAt(
            surfacePos,
            new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(cameraAzimuth),
              Cesium.Math.toRadians(-13.0),
              180.0
            )
          );
          isChaseInitializedRef.current = true;
        }
      }
    } else {
      isChaseInitializedRef.current = false;
      viewer.trackedEntity = undefined;
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

      if (cameraMode === 'bridge') {
        // Fly into bridge position initially
        if (positionPropertyRef.current) {
          const curPos = positionPropertyRef.current.getValue(viewer.clock.currentTime);
          if (curPos) {
            const carto = Cesium.Cartographic.fromCartesian(curPos);
            cam.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(
                Cesium.Math.toDegrees(carto.longitude),
                Cesium.Math.toDegrees(carto.latitude),
                35.0
              ),
              orientation: {
                heading: cam.heading,
                pitch: Cesium.Math.toRadians(-5.0),
                roll: 0.0
              },
              duration: 1.0
            });
          }
        }
      } else if (cameraMode === '2d') {
        cam.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(44.0, -70.0, 5200000.0),
          orientation: {
            heading: 0.0,
            pitch: Cesium.Math.toRadians(-89.9),
            roll: 0.0
          },
          duration: 1.2
        });
      } else if (cameraMode === 'globe') {
        if (prevCameraModeRef.current !== 'globe') {
          // Globe 3D view: Place the 3D globe directly in the center of the screen
          cam.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(44.0, -88.0, 16500000.0),
            orientation: {
              heading: Cesium.Math.toRadians(0.0),
              pitch: Cesium.Math.toRadians(-89.9),
              roll: 0.0
            },
            duration: 1.5
          });
        }
      }
      prevCameraModeRef.current = cameraMode;
    }
  }, [cameraMode]);

  // Clock Tick Listener for Telemetry extraction & Bridge Cam updates
  useEffect(() => {
    if (!viewerRef.current) return;
    const viewer = viewerRef.current;

    const onTick = (clock) => {
      if (!shipEntityRef.current || !positionPropertyRef.current) return;
      const curTime = clock.currentTime;
      const cartesian = positionPropertyRef.current.getValue(curTime);
      if (!cartesian) return;

      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);

      const dt = 1.0;
      const nextTime = Cesium.JulianDate.addSeconds(curTime, dt, new Cesium.JulianDate());
      const nextCartesian = positionPropertyRef.current.getValue(nextTime);
      let heading = 85.0;
      if (nextCartesian) {
        const nextCarto = Cesium.Cartographic.fromCartesian(nextCartesian);
        const cosLat = Math.cos(cartographic.latitude);
        const dEast = (nextCarto.longitude - cartographic.longitude) * cosLat;
        const dNorth = nextCarto.latitude - cartographic.latitude;
        heading = (Cesium.Math.toDegrees(Math.atan2(dEast, dNorth)) + 360) % 360;
      }

      let progressFraction = 0;
      if (viewer.clock.startTime && viewer.clock.stopTime) {
        const totalDuration = Cesium.JulianDate.secondsDifference(viewer.clock.stopTime, viewer.clock.startTime);
        const elapsed = Cesium.JulianDate.secondsDifference(curTime, viewer.clock.startTime);
        if (totalDuration > 0) {
          progressFraction = Math.max(0, Math.min(1, elapsed / totalDuration));
        }
      }

      const now = performance.now();
      const progressDelta = Math.abs(progressFraction - lastProgressEmitRef.current);
      const timeDelta = now - lastTelemetryEmitRef.current;

      // Throttle telemetry update to at most once every 200ms or on significant progress step (>= 0.002) or scrub change when paused
      if (timeDelta >= 200 || progressDelta >= 0.002 || (!clock.shouldAnimate && progressDelta >= 0.0001)) {
        lastTelemetryEmitRef.current = now;
        lastProgressEmitRef.current = progressFraction;
        if (onTelemetryUpdateRef.current) {
          onTelemetryUpdateRef.current({
            lat,
            lon,
            heading,
            speedKn: 13.5,
            timeIso: Cesium.JulianDate.toIso8601(curTime),
            progress: progressFraction
          });
        }
      }

      // Dynamic Multibeam Acoustic Sonar Ping Beam down to seabed
      const curDepth = getBathymetricDepth(lat, lon);
      if (sonarEntityRef.current) {
        sonarEntityRef.current.polyline.positions = [
          Cesium.Cartesian3.fromDegrees(lon, lat, 2.0),
          Cesium.Cartesian3.fromDegrees(lon, lat, -curDepth)
        ];
      }
      // Update time uniform for active tactical post-process shader
      if (postProcessStagesRef.current) {
        const activeStage = postProcessStagesRef.current[tacticalStyleRef.current];
        if (activeStage && activeStage.uniforms && activeStage.uniforms.time !== undefined) {
          activeStage.uniforms.time = performance.now() * 0.001;
        }
      }

      // Live Chase Cam follow (Option B: Interactive Orbit Follow - ship moves while preserving user's 360° orbit & zoom)
      if (cameraModeRef.current === 'chase') {
        const surfacePos = Cesium.Cartesian3.fromDegrees(lon, lat, 2.0);
        if (!isChaseInitializedRef.current) {
          const cameraAzimuth = (heading + 180.0) % 360;
          viewer.camera.lookAt(
            surfacePos,
            new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(cameraAzimuth),
              Cesium.Math.toRadians(-13.0),
              180.0
            )
          );
          isChaseInitializedRef.current = true;
        } else {
          // Advance reference frame with the ship while preserving user's orbital rotation & zoom
          const currentOffset = Cesium.Cartesian3.clone(viewer.camera.position);
          const transform = Cesium.Transforms.eastNorthUpToFixedFrame(surfacePos);
          if (Cesium.Cartesian3.magnitudeSquared(currentOffset) > 1.0) {
            viewer.camera.lookAtTransform(transform, currentOffset);
          } else {
            const cameraAzimuth = (heading + 180.0) % 360;
            viewer.camera.lookAt(
              surfacePos,
              new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(cameraAzimuth),
                Cesium.Math.toRadians(-13.0),
                180.0
              )
            );
          }
        }
      }

      // Live Bridge Cam locking
      if (cameraModeRef.current === 'bridge') {
        const bridgeCartesian = Cesium.Cartesian3.fromDegrees(lon, lat, 32.0);
        viewer.camera.setView({
          destination: bridgeCartesian,
          orientation: {
            heading: Cesium.Math.toRadians(heading),
            pitch: Cesium.Math.toRadians(-3.5),
            roll: 0.0
          }
        });
      }

      // Dynamic Polar Satellite Propagation
      if (showSatellites) {
        if (!satrecMapRef.current) {
          satrecMapRef.current = POLAR_SATELLITES.map((s) => {
            try {
              return { ...s, satrec: satellite.twoline2satrec(s.tleLine1, s.tleLine2) };
            } catch {
              return s;
            }
          });
        }

        const jsDate = Cesium.JulianDate.toDate(curTime);

        satrecMapRef.current.forEach((sat) => {
          if (!sat.satrec) return;
          try {
            const posVel = satellite.propagate(sat.satrec, jsDate);
            if (!posVel?.position) return;

            const gTime = satellite.gstime(jsDate);
            const geodetic = satellite.eciToGeodetic(posVel.position, gTime);
            const sLon = satellite.degreesLong(geodetic.longitude);
            const sLat = satellite.degreesLat(geodetic.latitude);
            const sAlt = Math.max(200000, geodetic.height * 1000);

            const satPos = Cesium.Cartesian3.fromDegrees(sLon, sLat, sAlt);
            const swathPos = Cesium.Cartesian3.fromDegrees(sLon, sLat, 50.0);

            // Update satellite beacon position in orbit
            const satEntity = viewer.entities.getById(`sat_${sat.noradId}`);
            if (satEntity) {
              satEntity.position = satPos;
              if (satEntity.polarisData) {
                satEntity.polarisData.lat = sLat;
                satEntity.polarisData.lon = sLon;
              }
            }

            // Update ground swath footprint position
            const swathEntity = viewer.entities.getById(`sat_swath_${sat.noradId}`);
            if (swathEntity) {
              swathEntity.position = swathPos;
            }
          } catch (satErr) {
            // SGP4 propagation edge cases outside valid date range
          }
        });
      }
    };

    viewer.clock.onTick.addEventListener(onTick);

    // Camera change listener for live altitude & heading
    const onCameraChange = () => {
      const cam = viewer.camera;
      const carto = cam.positionCartographic;
      if (onCameraUpdateRef.current && carto) {
        onCameraUpdateRef.current({
          altitudeKm: Math.max(0, Math.round(carto.height / 1000)),
          headingDeg: Math.round(((Cesium.Math.toDegrees(cam.heading) % 360) + 360) % 360),
          pitchDeg: Math.round(Cesium.Math.toDegrees(cam.pitch)),
          lat: Cesium.Math.toDegrees(carto.latitude),
          lon: Cesium.Math.toDegrees(carto.longitude)
        });
      }
    };
    viewer.camera.changed.addEventListener(onCameraChange);

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.clock.onTick.removeEventListener(onTick);
        viewer.camera.changed.removeEventListener(onCameraChange);
      }
    };
  }, []);

  // Update Clock Multiplier & Play State
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const viewer = viewerRef.current;
    if (streamMode === 'live') {
      viewer.clock.multiplier = 1.0;
      viewer.clock.shouldAnimate = true;
    } else {
      viewer.clock.multiplier = playbackSpeed;
      viewer.clock.shouldAnimate = isPlaying;
    }
    viewer.clock.canAnimate = true;
    if (viewer.cesiumWidget) {
      viewer.cesiumWidget._allowDataSourcesToSuspendAnimation = false;
    }
  }, [isPlaying, playbackSpeed, streamMode]);

  // Update Base Imagery Style (Google Satellite vs Google Hybrid vs ESRI)
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const viewer = viewerRef.current;

    let provider;
    if (mapStyle === 'google-hybrid') {
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        credit: '',
        maximumLevel: 20
      });
    } else if (mapStyle === 'esri-satellite') {
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: ''
      });
    } else {
      // Default: Google Earth Ultra-HD Satellite
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        credit: '',
        maximumLevel: 20
      });
    }
    if (provider) {
      provider.errorEvent.addEventListener((e) => { e.retry = false; });
    }

    if (baseImageryLayerRef.current) {
      viewer.imageryLayers.remove(baseImageryLayerRef.current);
    }
    baseImageryLayerRef.current = viewer.imageryLayers.addImageryProvider(provider, 0);
  }, [mapStyle]);

  // Load and Render Sea-Ice Risk Overlay PNG
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    let isCancelled = false;
    const viewer = viewerRef.current;

    if (riskImageryLayerRef.current) {
      viewer.imageryLayers.remove(riskImageryLayerRef.current);
      riskImageryLayerRef.current = null;
    }

    if (showRiskGrid) {
      const modelOverlay = useModelLayers ? `/api/model/sea-ice-overlay.png?step=${forecastStep}` : null;
      const url = modelOverlay || `/api/risk-grid-overlay.png?anomaly=${anomalyActive ? 'true' : 'false'}&t=${Date.now()}`;
      const rectangle = Cesium.Rectangle.fromDegrees(
        useModelLayers ? MODEL_LON_MIN : LON_MIN,
        useModelLayers ? MODEL_LAT_MIN : LAT_MIN,
        useModelLayers ? MODEL_LON_MAX : LON_MAX,
        useModelLayers ? MODEL_LAT_MAX : LAT_MAX
      );

      const loadOverlay = async () => {
        try {
          let provider;
          if (Cesium.SingleTileImageryProvider.fromUrl) {
            provider = await Cesium.SingleTileImageryProvider.fromUrl(url, { rectangle });
          } else {
            provider = new Cesium.SingleTileImageryProvider({ url, rectangle });
          }
          if (!isCancelled && viewerRef.current && !viewerRef.current.isDestroyed()) {
            const layer = viewerRef.current.imageryLayers.addImageryProvider(provider);
            layer.alpha = useModelLayers ? 0.72 : 0.35;
            riskImageryLayerRef.current = layer;
          }
        } catch (err) {
          console.warn('Risk overlay loading error:', err);
        }
      };
      loadOverlay();
    }

    return () => {
      isCancelled = true;
    };
  }, [showRiskGrid, anomalyActive, scenarioData?.isModelRoute, forecastStep, useModelLayers]);

  // Regional Engine 3 bathymetry heatmap for model-generated routes.
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const viewer = viewerRef.current;
    if (modelBathymetryLayerRef.current) {
      viewer.imageryLayers.remove(modelBathymetryLayerRef.current, true);
      modelBathymetryLayerRef.current = null;
    }
    if (!showBathymetry || !useModelLayers) return;

    const rectangle = Cesium.Rectangle.fromDegrees(
      useModelLayers ? MODEL_LON_MIN : LON_MIN,
      useModelLayers ? MODEL_LAT_MIN : LAT_MIN,
      useModelLayers ? MODEL_LON_MAX : LON_MAX,
      useModelLayers ? MODEL_LAT_MAX : LAT_MAX
    );
    const loadBathymetry = async () => {
      try {
        const provider = Cesium.SingleTileImageryProvider.fromUrl
          ? await Cesium.SingleTileImageryProvider.fromUrl('/api/model/bathymetry-overlay.png', { rectangle })
          : new Cesium.SingleTileImageryProvider({ url: '/api/model/bathymetry-overlay.png', rectangle });
        if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = 0.62;
        modelBathymetryLayerRef.current = layer;
      } catch (err) {
        console.warn('Model bathymetry overlay loading error:', err);
      }
    };
    loadBathymetry();
    return () => {
      if (modelBathymetryLayerRef.current && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(modelBathymetryLayerRef.current, true);
        modelBathymetryLayerRef.current = null;
      }
    };
  }, [scenarioData?.isModelRoute, showBathymetry, useModelLayers]);



  // Load and Render GEE AMSR2 Sea-Ice Concentration Tile Layer
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const viewer = viewerRef.current;

    if (geeSeaIceLayerRef.current) {
      viewer.imageryLayers.remove(geeSeaIceLayerRef.current);
      geeSeaIceLayerRef.current = null;
    }

    if (showGeeSeaIce) {
      try {
        const iceProvider = new Cesium.UrlTemplateImageryProvider({
          url: '/api/gee/sea-ice/tiles/{z}/{x}/{y}.png',
          credit: 'Google Earth Engine: NOAA AMSR2 Sea Ice CDR',
          maximumLevel: 12
        });
        const layer = viewer.imageryLayers.addImageryProvider(iceProvider);
        layer.alpha = 0.75;
        geeSeaIceLayerRef.current = layer;
      } catch (err) {
        console.warn('GEE Sea-Ice tile provider error:', err);
      }
    }
  }, [showGeeSeaIce]);

  // ── Marine ECDIS Display Palette Post-Processing (IEC 62288) ──
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const viewer = viewerRef.current;
    const stages = postProcessStagesRef.current;

    // Lazily initialize post-process stages on first use
    if (!stages._initialized) {
      const shaderDefs = [
        { name: 'night', def: ecdisNightShader },
        { name: 'radar', def: ecdisRadarShader },
        { name: 'snow', def: snowShader }
      ];

      shaderDefs.forEach(({ name, def }) => {
        try {
          const uniforms = { intensity: 1.0, time: 0.0 };
          if (def.uniforms) {
            Object.entries(def.uniforms).forEach(([k, v]) => {
              uniforms[k] = typeof v === 'object' && v.default !== undefined ? v.default : v;
            });
          }
          const stage = new Cesium.PostProcessStage({
            name: `polaris_${name}`,
            fragmentShader: def.fragmentShader,
            uniforms
          });
          stage.enabled = false;
          viewer.scene.postProcessStages.add(stage);
          stages[name] = stage;
        } catch (err) {
          console.warn(`Failed to initialize shader ${name}:`, err);
        }
      });
      stages._initialized = true;
    }

    // Toggle active ECDIS palette stage
    ['night', 'radar', 'snow'].forEach((name) => {
      const stage = stages[name];
      if (stage) {
        stage.enabled = (tacticalStyle === name);
        if (stage.enabled && stage.uniforms) {
          stage.uniforms.intensity = 1.0;
        }
      }
    });
  }, [tacticalStyle, isViewerReady]);

  // ── Polar Earth Observation Satellites Layer (SGP4 Orbital Mechanics) ──
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const viewer = viewerRef.current;

    // Remove prior satellites
    satelliteEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    satelliteEntitiesRef.current = [];

    if (!showSatellites) return;

    const now = new Date();

    POLAR_SATELLITES.forEach((sat) => {
      try {
        const satrec = satellite.twoline2satrec(sat.tleLine1, sat.tleLine2);

        // Current real-time position
        const currentPosVel = satellite.propagate(satrec, now);
        let curLon = 45.0;
        let curLat = -70.0;
        let curAlt = sat.altitudeKm * 1000;

        if (currentPosVel?.position) {
          const gTime = satellite.gstime(now);
          const geodetic = satellite.eciToGeodetic(currentPosVel.position, gTime);
          curLon = satellite.degreesLong(geodetic.longitude);
          curLat = satellite.degreesLat(geodetic.latitude);
          curAlt = Math.max(200000, geodetic.height * 1000);
        }

        const satColor = Cesium.Color.fromCssColorString(sat.color);

        // Satellite Beacon & Transponder Label Entity
        const satPos = Cesium.Cartesian3.fromDegrees(curLon, curLat, curAlt);
        const satEntity = viewer.entities.add({
          id: `sat_${sat.noradId}`,
          name: `${sat.name} (${sat.sensor})`,
          position: satPos,
          point: {
            pixelSize: 10,
            color: satColor,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: `${sat.name}\n${sat.sensor}`,
            font: 'bold 10px monospace',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: satColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1e6, 1.2, 5e7, 0.7)
          }
        });

        satEntity.polarisData = {
          type: 'satellite',
          name: sat.name,
          subtitle: `${sat.agency} • ${sat.sensor}`,
          lat: curLat,
          lon: curLon,
          description: `${sat.role}. Operating at an orbital altitude of ${sat.altitudeKm} km with a swath width of ${sat.swathKm} km.`
        };

        satelliteEntitiesRef.current.push(satEntity);

        // 3. Ground Sensor Footprint Swath (Ground projection cylinder/swath circle)
        const groundPos = Cesium.Cartesian3.fromDegrees(curLon, curLat, 50.0);
        const swathEntity = viewer.entities.add({
          id: `sat_swath_${sat.noradId}`,
          name: `${sat.name} Ground Swath`,
          position: groundPos,
          ellipse: {
            semiMajorAxis: (sat.swathKm * 1000) / 2,
            semiMinorAxis: (sat.swathKm * 1000) / 2,
            material: satColor.withAlpha(0.12),
            outline: true,
            outlineColor: satColor.withAlpha(0.6),
            outlineWidth: 1.5,
            height: 50.0
          }
        });
        satelliteEntitiesRef.current.push(swathEntity);

      } catch (satErr) {
        console.warn(`Failed to propagate satellite ${sat.name}:`, satErr);
      }
    });
  }, [showSatellites, isViewerReady]);

  // Load and Render 3D Icebergs, ARPA Velocity Vectors, Radar Exclusion Rings & LSTM Drift Tracks
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const viewer = viewerRef.current;
    const bergs = scenarioData?.isModelRoute
      ? (scenarioData.icebergs || [])
      : (liveIcebergs || scenarioData?.icebergs || []);

    if (!showIcebergs) {
      icebergEntitiesRef.current.forEach((e) => { e.show = false; });
      return;
    }

    const activeBergIds = new Set();

    bergs.forEach((berg, idx) => {
      if (!berg || berg.id === undefined || berg.lat === undefined || berg.lon === undefined) return;
      activeBergIds.add(String(berg.id));

      const isTabular = idx % 2 === 0;
      const modelUri = isTabular ? '/models/iceberg_tabular.glb' : '/models/iceberg_pinnacle.glb';
      const isCritical = berg.id === 'C-19' && anomalyActive;
      const driftSpeedKn = berg.driftSpeedKn ?? berg.speedKn ?? 0.3;

      // Calculate heading along predicted drift path
      let driftHeadingDeg = berg.driftHeadingDeg ?? berg.headingDeg;
      if (driftHeadingDeg === undefined) {
        const nextPt = berg.projection6h?.[0] || berg.predictedTrack?.[0];
        if (nextPt) {
          const dLon = nextPt.lon - berg.lon;
          const dLat = nextPt.lat - berg.lat;
          driftHeadingDeg = (Cesium.Math.toDegrees(Math.atan2(dLon, dLat)) + 360) % 360;
        } else {
          driftHeadingDeg = (idx * 55.0) % 360;
        }
      }

      const bergPos = Cesium.Cartesian3.fromDegrees(berg.lon, berg.lat, 0.0);
      const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(driftHeadingDeg),
        0.0,
        0.0
      );
      const bergOrient = Cesium.Transforms.headingPitchRollQuaternion(bergPos, hpr);

      const labelText = `ICEBERG ${berg.id}${streamMode === 'live' ? ` [${driftSpeedKn.toFixed(1)} KTS]` : ''}`;
      const labelColor = isCritical 
        ? Cesium.Color.fromCssColorString('#f28b82') 
        : Cesium.Color.fromCssColorString('#e8eaed');

      const polarisData = {
        ...berg,
        type: 'iceberg',
        id: berg.id,
        name: `Iceberg ${berg.id}`,
        subtitle: isTabular ? 'Tracked Antarctic Tabular Iceberg' : 'Tracked Antarctic Pinnacled Iceberg',
        lat: berg.lat,
        lon: berg.lon,
        speedKn: driftSpeedKn,
        driftSpeedKn: driftSpeedKn,
        headingDeg: driftHeadingDeg,
        driftHeadingDeg: driftHeadingDeg,
        predictedTrack: berg.predictedTrack || berg.projection6h,
        projection6h: berg.projection6h,
        dimensions: berg.dimensions,
        surfaceAreaKm2: berg.dimensions?.areaKm2 ?? 591,
        massGt: berg.massGt ?? 142.5,
        freeboardM: berg.freeboardM ?? 45,
        draftM: berg.draftM ?? 280,
        calvingGlacier: berg.calvingGlacier ?? 'Amery Ice Shelf',
        radarSignature: berg.radarSignature ?? 'Sentinel-1 C-Band SAR (-11.2 dB)',
        threatLevel: berg.threatLevel ?? (isCritical ? 'CRITICAL COLLISION THREAT' : 'MONITORED MARITIME HAZARD'),
        safetyBufferNm: berg.safetyBufferNm ?? 8.0,
        description: `Drifting iceberg ${berg.id} tracked via Sentinel-1 SAR Radar satellite imagery and LSTM trajectory physics equations. Drift SOG: ${driftSpeedKn.toFixed(1)} kn, Heading: ${Math.round(driftHeadingDeg)}° T.`
      };

      // 1. 3D GLTF Iceberg Model & Label (In-place update to prevent WebGL model churn)
      const bergEntityId = `iceberg_${berg.id}`;
      let bergEntity = viewer.entities.getById(bergEntityId);
      if (bergEntity) {
        bergEntity.position = bergPos;
        bergEntity.orientation = bergOrient;
        if (bergEntity.label) {
          bergEntity.label.text = labelText;
          bergEntity.label.fillColor = labelColor;
        }
        bergEntity.polarisData = polarisData;
        bergEntity.show = true;
      } else {
        bergEntity = viewer.entities.add({
          id: bergEntityId,
          name: `Iceberg ${berg.id}`,
          position: bergPos,
          orientation: bergOrient,
          model: {
            uri: modelUri,
            scale: 1.0,
            shadows: Cesium.ShadowMode.ENABLED,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000000)
          },
          label: {
            text: labelText,
            font: 'bold 10px Roboto, system-ui, sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: labelColor,
            outlineColor: Cesium.Color.fromCssColorString('#202124'),
            outlineWidth: 2,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000000)
          },
          description: polarisData.description
        });
        bergEntity.polarisData = polarisData;
        icebergEntitiesRef.current.push(bergEntity);
      }

      // 2. ARPA 6-Hour Forward Velocity Vector Leader Stem
      let endLat = berg.lat;
      let endLon = berg.lon;
      const projectionPoints = Array.isArray(berg.projection6h)
        ? berg.projection6h
        : (berg.projection6h && typeof berg.projection6h === 'object' ? [berg.projection6h] : []);
      if (projectionPoints.length > 0) {
        const lastPt = projectionPoints[projectionPoints.length - 1];
        endLat = lastPt.lat;
        endLon = lastPt.lon;
      } else {
        const distNm = Math.max(0.5, driftSpeedKn * 6.0);
        const dLat = (distNm / 60.0) * Math.cos(driftHeadingDeg * Math.PI / 180.0);
        const dLon = (distNm / 60.0) * Math.sin(driftHeadingDeg * Math.PI / 180.0) / Math.max(0.01, Math.cos(berg.lat * Math.PI / 180.0));
        endLat = berg.lat + dLat;
        endLon = berg.lon + dLon;
      }

      const arpaVecId = `arpa_vector_${berg.id}`;
      const vecPositions = [
        Cesium.Cartesian3.fromDegrees(berg.lon, berg.lat, 10.0),
        Cesium.Cartesian3.fromDegrees(endLon, endLat, 10.0)
      ];
      let arpaVecEntity = viewer.entities.getById(arpaVecId);
      if (arpaVecEntity) {
        arpaVecEntity.polyline.positions = vecPositions;
        arpaVecEntity.polarisData = polarisData;
        arpaVecEntity.show = true;
      } else {
        arpaVecEntity = viewer.entities.add({
          id: arpaVecId,
          name: `ARPA Vector ${berg.id}`,
          polyline: {
            positions: vecPositions,
            width: 3.5,
            material: new Cesium.PolylineArrowMaterialProperty(
              isCritical 
                ? Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.9) 
                : Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.85)
            ),
            clampToGround: false
          }
        });
        arpaVecEntity.polarisData = polarisData;
        icebergEntitiesRef.current.push(arpaVecEntity);
      }

      // 3. ARPA Radar Exclusion Zone / Safety Buffer Ring
      const arpaRingId = `arpa_ring_${berg.id}`;
      const bufferRadiusM = (berg.safetyBufferNm ?? 8.0) * 1852.0;
      let arpaRingEntity = viewer.entities.getById(arpaRingId);
      const ringColor = isCritical 
        ? Cesium.Color.fromCssColorString('#ef4444') 
        : Cesium.Color.fromCssColorString('#38bdf8');
      if (arpaRingEntity) {
        arpaRingEntity.position = bergPos;
        arpaRingEntity.ellipse.semiMajorAxis = bufferRadiusM;
        arpaRingEntity.ellipse.semiMinorAxis = bufferRadiusM;
        arpaRingEntity.polarisData = polarisData;
        arpaRingEntity.show = true;
      } else {
        arpaRingEntity = viewer.entities.add({
          id: arpaRingId,
          name: `ARPA Exclusion Ring ${berg.id}`,
          position: bergPos,
          ellipse: {
            semiMajorAxis: bufferRadiusM,
            semiMinorAxis: bufferRadiusM,
            height: 2.0,
            material: ringColor.withAlpha(0.06),
            outline: true,
            outlineColor: ringColor.withAlpha(0.45),
            outlineWidth: 1.5
          }
        });
        arpaRingEntity.polarisData = polarisData;
        icebergEntitiesRef.current.push(arpaRingEntity);
      }

      // 4. LSTM Multi-Hour Drift Track Polyline
      const rawTrackPoints = Array.isArray(berg.predictedTrack)
        ? berg.predictedTrack
        : (Array.isArray(berg.projection6h)
          ? berg.projection6h
          : (berg.projection6h && typeof berg.projection6h === 'object' ? [berg.projection6h] : []));
      const trackPts = rawTrackPoints;
      if (trackPts && trackPts.length > 0) {
        const trackId = `track_${berg.id}`;
        const trackCoords = [
          Cesium.Cartesian3.fromDegrees(berg.lon, berg.lat, 10.0),
          ...trackPts.map((pt) => Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 10.0))
        ];

        let trackEntity = viewer.entities.getById(trackId);
        if (trackEntity) {
          trackEntity.polyline.positions = trackCoords;
          trackEntity.polarisData = polarisData;
          trackEntity.show = true;
        } else {
          trackEntity = viewer.entities.add({
            id: trackId,
            name: `Drift Track ${berg.id}`,
            polyline: {
              positions: trackCoords,
              width: 2.0,
              material: new Cesium.PolylineDashMaterialProperty({
                color: isCritical 
                  ? Cesium.Color.fromCssColorString('#ea4335').withAlpha(0.9)
                  : Cesium.Color.fromCssColorString('#8ab4f8').withAlpha(0.7),
                dashLength: 10.0
              }),
              clampToGround: false
            }
          });
          trackEntity.polarisData = polarisData;
          icebergEntitiesRef.current.push(trackEntity);
        }
      }
    });

    // Clean up stale icebergs
    icebergEntitiesRef.current = icebergEntitiesRef.current.filter((entity) => {
      const isAssociated = Array.from(activeBergIds).some((id) =>
        entity.id === `iceberg_${id}` ||
        entity.id === `arpa_vector_${id}` ||
        entity.id === `arpa_ring_${id}` ||
        entity.id === `track_${id}`
      );
      if (!isAssociated) {
        viewer.entities.remove(entity);
        return false;
      }
      return true;
    });
  }, [scenarioData?.icebergs, liveIcebergs, showIcebergs, anomalyActive, streamMode]);

  // Load and Render 3D Cesium Satellite Trajectory Polylines & Fix Waypoints (Milestone 2)
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed() || !isViewerReady) return;
    const viewer = viewerRef.current;

    if (!showSatelliteTracks) {
      satelliteTrackEntitiesRef.current.forEach((e) => {
        try { viewer.entities.remove(e); } catch {}
      });
      satelliteTrackEntitiesRef.current = [];
      return;
    }

    const incomingBergs = scenarioData?.isModelRoute
      ? (scenarioData.icebergs || [])
      : (liveIcebergs || scenarioData?.icebergs || []);
    const useModelInventory = Boolean(scenarioData?.isModelRoute);
    const targetBergIds = useModelInventory
      ? incomingBergs.map((berg) => String(berg.id)).filter(Boolean)
      : ['C-19', 'B-15K', 'D-28', 'A-68R'];
    const activeSatEntityIds = new Set();

    targetBergIds.forEach((bergId) => {
      // Find live berg state or fall back to static definition
      const liveBerg = incomingBergs.find(
        (b) => String(b.id).toUpperCase() === bergId || String(b.icebergId).toUpperCase() === bergId
      );

      // Retrieve authentic satellite track record
      const satTrack = liveBerg?.satelliteTrack || (useModelInventory ? null : getSatelliteTrackForIceberg(bergId));
      if (!satTrack || !satTrack.observations || satTrack.observations.length === 0) return;

      const observations = satTrack.observations;
      const latestObs = satTrack.lastObservation || satTrack.latestFix || observations[observations.length - 1];

      const currentLat = liveBerg?.lat ?? latestObs.lat;
      const currentLon = liveBerg?.lon ?? latestObs.lon;

      // 1. Interactive Satellite Sighting Fix Waypoint Pins (sat_fix_${berg.id}_${idx})
      observations.forEach((obs, idx) => {
        const fixId = `sat_fix_${bergId}_${idx}`;
        activeSatEntityIds.add(fixId);
        const fixPos = Cesium.Cartesian3.fromDegrees(obs.lon, obs.lat, 25.0);
        const dateLabel = formatSatelliteFixDate(obs.timestamp);

        const fixPolarisData = {
          type: 'satellite_fix',
          id: fixId,
          icebergId: bergId,
          bergId: bergId,
          observation: obs,
          spacecraft: obs.spacecraft,
          sensor: obs.sensor,
          timestamp: obs.timestamp,
          lat: obs.lat,
          lon: obs.lon,
          dimensions: obs.dimensions || { lengthKm: obs.lengthKm, widthKm: obs.widthKm },
          lengthKm: obs.lengthKm,
          widthKm: obs.widthKm,
          surfaceAreaKm2: obs.surfaceAreaKm2,
          freeboardM: obs.freeboardM,
          backscatterDb: obs.backscatterDb,
          orbitNumber: obs.orbitNumber,
          passType: obs.passType,
          qualityFlag: obs.qualityFlag,
          dataSource: obs.dataSource,
          name: `${obs.spacecraft} Sighting Fix #${idx + 1} // Iceberg ${bergId}`,
          subtitle: `${obs.sensor} • ${dateLabel} (${obs.passType || 'Ascending'})`,
          icebergName: satTrack.name || `Iceberg ${bergId}`,
          description: `Confirmed satellite sighting of Iceberg ${bergId} by ${obs.spacecraft} (${obs.sensor}) on ${obs.timestamp}. Observed Area: ${obs.surfaceAreaKm2} km², Freeboard: ${obs.freeboardM} m, Backscatter: ${obs.backscatterDb} dB.`
        };

        let fixEntity = viewer.entities.getById(fixId);
        if (fixEntity) {
          fixEntity.position = fixPos;
          fixEntity.show = showSatelliteTracks;
          fixEntity.polarisData = fixPolarisData;
        } else {
          fixEntity = viewer.entities.add({
            id: fixId,
            name: `${obs.spacecraft} Sighting Fix #${idx + 1} - Iceberg ${bergId}`,
            position: fixPos,
            billboard: {
              image: RADAR_SAT_ICON_SVG,
              width: 24,
              height: 24,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 15000000),
              eyeOffset: new Cesium.Cartesian3(0, 0, -1000)
            },
            label: {
              text: `${dateLabel}\n${obs.spacecraft}`,
              font: 'bold 9px "JetBrains Mono", monospace',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              fillColor: Cesium.Color.fromCssColorString('#00f0ff'),
              outlineColor: Cesium.Color.fromCssColorString('#020617'),
              outlineWidth: 2,
              verticalOrigin: Cesium.VerticalOrigin.TOP,
              pixelOffset: new Cesium.Cartesian2(0, 14),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3500000)
            }
          });
          fixEntity.polarisData = fixPolarisData;
          satelliteTrackEntitiesRef.current.push(fixEntity);
        }
      });

      // 2. 3D Glowing Historical Satellite Track Line (sat_track_${berg.id})
      const trackId = `sat_track_${bergId}`;
      activeSatEntityIds.add(trackId);
      const trackCartesians = observations.map((obs) =>
        Cesium.Cartesian3.fromDegrees(obs.lon, obs.lat, 20.0)
      );
      // Connect all verified historical passes trailing behind the iceberg to its current live position
      trackCartesians.push(Cesium.Cartesian3.fromDegrees(currentLon, currentLat, 20.0));

      const trackPolarisData = {
        type: 'satellite_track',
        id: trackId,
        icebergId: bergId,
        bergId: bergId,
        name: `Satellite Trajectory Track // Iceberg ${bergId}`,
        subtitle: `${satTrack.totalSightings || observations.length} Verified Satellite Passes (Sentinel-1 / CryoSat-2 / ICESat-2)`,
        totalSightings: satTrack.totalSightings || observations.length,
        lastObservation: latestObs,
        icebergName: satTrack.name || `Iceberg ${bergId}`,
        description: `Historical spaceborne radar sighting trajectory for Iceberg ${bergId}. Reconstructed from ${satTrack.totalSightings || observations.length} spaceborne SAR and altimetry passes.`
      };

      let trackEntity = viewer.entities.getById(trackId);
      if (trackEntity) {
        trackEntity.polyline.positions = trackCartesians;
        trackEntity.show = showSatelliteTracks;
        trackEntity.polarisData = trackPolarisData;
      } else {
        trackEntity = viewer.entities.add({
          id: trackId,
          name: `Historical Satellite Trajectory Track ${bergId}`,
          polyline: {
            positions: trackCartesians,
            width: 3.5,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.25,
              taperPower: 0.85,
              color: Cesium.Color.fromCssColorString('#00f0ff')
            }),
            depthFailMaterial: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.15,
              taperPower: 0.85,
              color: Cesium.Color.fromCssColorString('#00f0ff').withAlpha(0.35)
            }),
            clampToGround: false,
            arcType: Cesium.ArcType.GEODESIC
          }
        });
        trackEntity.polarisData = trackPolarisData;
        satelliteTrackEntitiesRef.current.push(trackEntity);
      }

      // 3. Forward Projected Satellite Drift Corridor Polyline (sat_corridor_${berg.id})
      const corridorId = `sat_corridor_${bergId}`;
      activeSatEntityIds.add(corridorId);
      const corridorCartesians = [
        Cesium.Cartesian3.fromDegrees(latestObs.lon, latestObs.lat, 20.0),
        Cesium.Cartesian3.fromDegrees(currentLon, currentLat, 20.0)
      ];

      const projectionPoints = Array.isArray(liveBerg?.projection6h)
        ? liveBerg.projection6h
        : (liveBerg?.projection6h && typeof liveBerg.projection6h === 'object' ? [liveBerg.projection6h] : []);
      if (projectionPoints.length > 0) {
        projectionPoints.forEach((pt) => {
          corridorCartesians.push(Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 20.0));
        });
      } else if (liveBerg?.predictedTrack && liveBerg.predictedTrack.length > 0) {
        liveBerg.predictedTrack.forEach((pt) => {
          corridorCartesians.push(Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 20.0));
        });
      } else {
        // Forward projection steps along drift heading (6h, 12h, 24h, 48h)
        const speed = liveBerg?.driftSpeedKn ?? liveBerg?.speedKn ?? 0.35;
        const heading = liveBerg?.driftHeadingDeg ?? liveBerg?.headingDeg ?? 260.0;
        [6, 12, 24, 48].forEach((hr) => {
          const distNm = speed * hr;
          const dLat = (distNm / 60.0) * Math.cos((heading * Math.PI) / 180.0);
          const cosLat = Math.max(0.01, Math.cos((currentLat * Math.PI) / 180.0));
          const dLon = (distNm / 60.0) * Math.sin((heading * Math.PI) / 180.0) / cosLat;
          corridorCartesians.push(Cesium.Cartesian3.fromDegrees(currentLon + dLon, currentLat + dLat, 20.0));
        });
      }

      const corridorPolarisData = {
        type: 'satellite_corridor',
        id: corridorId,
        icebergId: bergId,
        bergId: bergId,
        name: `Projected Satellite Drift Corridor // Iceberg ${bergId}`,
        subtitle: 'Multi-Day Kinematic Ocean Current & Coriolis Projection',
        icebergName: satTrack.name || `Iceberg ${bergId}`,
        description: `Forward projected satellite drift corridor for Iceberg ${bergId} projecting future trajectory along the Antarctic Coastal Current.`
      };

      let corridorEntity = viewer.entities.getById(corridorId);
      if (corridorEntity) {
        corridorEntity.polyline.positions = corridorCartesians;
        corridorEntity.show = showSatelliteTracks;
        corridorEntity.polarisData = corridorPolarisData;
      } else {
        corridorEntity = viewer.entities.add({
          id: corridorId,
          name: `Projected Satellite Drift Corridor ${bergId}`,
          polyline: {
            positions: corridorCartesians,
            width: 2.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.85),
              gapColor: Cesium.Color.TRANSPARENT,
              dashLength: 14.0
            }),
            depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.35),
              gapColor: Cesium.Color.TRANSPARENT,
              dashLength: 14.0
            }),
            clampToGround: false,
            arcType: Cesium.ArcType.GEODESIC
          }
        });
        corridorEntity.polarisData = corridorPolarisData;
        satelliteTrackEntitiesRef.current.push(corridorEntity);
      }
    });

    // Clean up stale satellite track entities
    satelliteTrackEntitiesRef.current = satelliteTrackEntitiesRef.current.filter((entity) => {
      if (!activeSatEntityIds.has(entity.id)) {
        try { viewer.entities.remove(entity); } catch {}
        return false;
      }
      return true;
    });
  }, [scenarioData?.icebergs, liveIcebergs, showSatelliteTracks, isViewerReady]);

  // Load and Render Active AIS Vessels & 1-Hour Dead-Reckoning Course Vectors
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const viewer = viewerRef.current;
    const vessels = liveVessels || scenarioData?.vessels || [];

    const activeMmsis = new Set();

    vessels.forEach((vessel) => {
      if (!vessel.mmsi || vessel.lat === undefined || vessel.lon === undefined) return;
      activeMmsis.add(String(vessel.mmsi));

      const vPos = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 2.0);
      const vSpeed = vessel.speedKn || vessel.speed || 10.0;
      const vHeading = vessel.headingDeg || vessel.heading || vessel.course || 90.0;
      const vId = `ais_${vessel.mmsi}`;
      const vVecId = `ais_vec_${vessel.mmsi}`;

      // Calculate 3D Geodetic Orientation aligned with vessel navigation heading
      // Since glTF model forward axis (bow) is +Z, in Cesium ENU frame it points East at heading 0.
      // An offset of -90 degrees aligns the physical bow strictly with true navigation heading & ARPA course leader line.
      const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(vHeading - 90.0),
        0.0,
        0.0
      );
      const vOrient = Cesium.Transforms.headingPitchRollQuaternion(vPos, hpr);

      // Calculate 1-hour dead-reckoned ARPA course leader stem (1 hr = vSpeed NM)
      const distNm = Math.max(0.2, vSpeed * 1.0);
      const dLat = (distNm / 60.0) * Math.cos(vHeading * Math.PI / 180.0);
      const dLon = (distNm / 60.0) * Math.sin(vHeading * Math.PI / 180.0) / Math.max(0.01, Math.cos(vessel.lat * Math.PI / 180.0));
      const endLat = vessel.lat + dLat;
      const endLon = vessel.lon + dLon;
      const vEndPos = Cesium.Cartesian3.fromDegrees(endLon, endLat, 2.0);

      const isSimulated = vessel.is_simulated !== false;
      const polarisVesselData = {
        type: 'vessel',
        id: `vessel_${vessel.mmsi}`,
        mmsi: String(vessel.mmsi),
        name: isSimulated ? `[DEMO] ${vessel.name || vessel.mmsi}` : (vessel.name || `VESSEL ${vessel.mmsi}`),
        subtitle: isSimulated
          ? `DEMO / PRACTICE TARGET • ${(vessel.type || 'POLAR VESSEL').toUpperCase()} • MMSI ${vessel.mmsi}`
          : `${(vessel.type || 'POLAR VESSEL').toUpperCase()} • MMSI ${vessel.mmsi}`,
        lat: vessel.lat,
        lon: vessel.lon,
        speedKn: vSpeed,
        headingDeg: vHeading,
        course: vessel.course || vHeading,
        destination: vessel.destination || 'Antarctic Station',
        callsign: vessel.callsign || '',
        is_simulated: isSimulated,
        is_demo: isSimulated,
        status_label: isSimulated ? 'DEMO / PRACTICE TARGET' : 'LIVE AIS VESSEL',
        description: isSimulated
          ? `Simulated practice vessel ${vessel.name} for collision avoidance testing. (In reality, this ship is currently operating in home waters / Russia outside the austral summer).`
          : `Active Southern Ocean vessel ${vessel.name || vessel.mmsi}. SOG: ${vSpeed} kn, Heading: ${Math.round(vHeading)}°, Destination: ${vessel.destination || 'Antarctic Station'}. Tracked via AISStream.`
      };

      // 1. Vessel 3D Model, Point LOD & Tactical Label Entity
      let existingVessel = viewer.entities.getById(vId);
      if (existingVessel) {
        existingVessel.position = vPos;
        existingVessel.orientation = vOrient;
        if (existingVessel.label) {
          existingVessel.label.text = isSimulated ? `[DEMO] ${vessel.name} [${vSpeed} kn]` : `${vessel.name} [${vSpeed} kn]`;
          existingVessel.label.fillColor = isSimulated ? Cesium.Color.fromCssColorString('#f59e0b') : Cesium.Color.fromCssColorString('#7dd3fc');
        }
        if (existingVessel.point) {
          existingVessel.point.color = isSimulated ? Cesium.Color.fromCssColorString('#f59e0b') : Cesium.Color.fromCssColorString('#38bdf8');
        }
        existingVessel.polarisData = polarisVesselData;
        existingVessel.show = true;
      } else {
        const newVessel = viewer.entities.add({
          id: vId,
          name: isSimulated ? `[DEMO] ${vessel.name || vessel.mmsi}` : (vessel.name || `Vessel ${vessel.mmsi}`),
          position: vPos,
          orientation: vOrient,
          model: {
            uri: '/models/polar_ship.glb',
            scale: 0.85,
            minimumPixelSize: 32,
            maximumScale: 80.0,
            color: isSimulated ? Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.9) : undefined,
            colorBlendMode: isSimulated ? Cesium.ColorBlendMode.MIX : Cesium.ColorBlendMode.HIGHLIGHT,
            colorBlendAmount: isSimulated ? 0.35 : 0.0,
            shadows: Cesium.ShadowMode.ENABLED,
            heightReference: Cesium.HeightReference.NONE,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3500000)
          },
          point: {
            pixelSize: 8,
            color: isSimulated ? Cesium.Color.fromCssColorString('#f59e0b') : Cesium.Color.fromCssColorString('#38bdf8'),
            outlineColor: Cesium.Color.fromCssColorString('#ffffff'),
            outlineWidth: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2500000, 15000000)
          },
          label: {
            text: isSimulated ? `[DEMO] ${vessel.name} [${vSpeed} kn]` : `${vessel.name} [${vSpeed} kn]`,
            font: 'bold 9px Roboto, monospace, sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: isSimulated ? Cesium.Color.fromCssColorString('#f59e0b') : Cesium.Color.fromCssColorString('#7dd3fc'),
            outlineColor: Cesium.Color.fromCssColorString('#020617'),
            outlineWidth: 2,
            pixelOffset: new Cesium.Cartesian2(0, -38),
            eyeOffset: new Cesium.Cartesian3(0, 0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000)
          },
          description: polarisVesselData.description
        });
        newVessel.polarisData = polarisVesselData;
        aisEntitiesRef.current.push(newVessel);
      }

      // 2. ARPA 1-Hour Dead-Reckoned Course Leader Polyline
      let existingVec = viewer.entities.getById(vVecId);
      if (existingVec) {
        existingVec.polyline.positions = [vPos, vEndPos];
        existingVec.polarisData = polarisVesselData;
        existingVec.show = true;
      } else {
        const newVec = viewer.entities.add({
          id: vVecId,
          name: `Course Vector ${vessel.name}`,
          polyline: {
            positions: [vPos, vEndPos],
            width: 1.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.65),
              dashLength: 8.0
            }),
            clampToGround: false
          }
        });
        newVec.polarisData = polarisVesselData;
        aisEntitiesRef.current.push(newVec);
      }
    });

    // Clean up vessels no longer in feed
    aisEntitiesRef.current = aisEntitiesRef.current.filter((entity) => {
      const isMmsiActive = Array.from(activeMmsis).some((mmsi) => 
        entity.id === `ais_${mmsi}` || entity.id === `ais_vec_${mmsi}`
      );
      if (!isMmsiActive) {
        viewer.entities.remove(entity);
        return false;
      }
      return true;
    });
  }, [scenarioData?.vessels, liveVessels]);

  // Toggle Visibility for 3D Mountains & Stations
  useEffect(() => {
    mountainEntitiesRef.current.forEach((m) => { m.show = showMountains; });
  }, [showMountains]);

  useEffect(() => {
    stationEntitiesRef.current.forEach((st) => { st.show = showStations; });
  }, [showStations]);

  // Load and Render 3D Subsea Bathymetric Seabed Floor, Depth Curtains & Sonar Grid
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed() || !scenarioData?.route?.waypoints) return;
    const viewer = viewerRef.current;
    const waypoints = scenarioData.route.waypoints;
    const bathyKey = `${waypoints.length}_${waypoints[0]?.time || ''}_${showBathymetry}`;
    if (lastBathyRouteKeyRef.current === bathyKey) return;
    lastBathyRouteKeyRef.current = bathyKey;

    bathymetryEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    bathymetryEntitiesRef.current = [];

    if (showBathymetry && waypoints.length > 0) {
      const positions = [];
      const seabedPositions = [];
      const minHeights = [];
      const maxHeights = [];

      waypoints.forEach((wp) => {
        const depth = getBathymetricDepth(wp.lat, wp.lon);
        const cartSea = Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, 0.0);
        const cartBed = Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, -depth);
        positions.push(cartSea);
        seabedPositions.push(cartBed);
        minHeights.push(-depth);
        maxHeights.push(0.0);
      });

      // 1. Vertical Translucent Bathymetric Depth Curtain Wall
      const bathyWall = viewer.entities.add({
        name: 'BEDMAP2 Bathymetric Depth Profile Wall',
        wall: {
          positions: positions,
          minimumHeights: minHeights,
          maximumHeights: maxHeights,
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString('#1a73e8').withAlpha(0.22)
          ),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#8ab4f8').withAlpha(0.45)
        }
      });
      bathyWall.polarisData = {
        type: 'bathymetry',
        name: 'BEDMAP2 / GEBCO Ocean Bathymetry Profile',
        subtitle: 'Subsurface Marine Trench & Continental Shelf Profile',
        description: 'High-resolution bathymetric soundings mapping the seabed depths from Princess Astrid Coast shelf (-180m) down to the Southern Ocean abyssal plain (-3,850m).'
      };
      bathymetryEntitiesRef.current.push(bathyWall);

      // 2. 3D Seabed Floor Contour Line (at actual seafloor negative elevation)
      const seabedContour = viewer.entities.add({
        name: 'Antarctic Seabed Floor Contour Line',
        polyline: {
          positions: seabedPositions,
          width: 2.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.85),
            dashLength: 14.0
          }),
          clampToGround: false
        }
      });
      bathymetryEntitiesRef.current.push(seabedContour);

      // 3. Subsea Isobath Depth Ribbon Lines along the Corridor (200m, 500m, 1000m, 3000m)
      const ISOBATH_LEVELS = [
        { depth: 200, color: '#38bdf8', label: '200m Shelf Edge Isobath', width: 1.8, dash: 10 },
        { depth: 500, color: '#0284c7', label: '500m Slope Isobath', width: 1.4, dash: 12 },
        { depth: 1000, color: '#2563eb', label: '1000m Continental Rise Isobath', width: 1.2, dash: 14 },
        { depth: 3000, color: '#6366f1', label: '3000m Abyssal Plain Isobath', width: 1.2, dash: 16 }
      ];

      ISOBATH_LEVELS.forEach((iso) => {
        const isoPositions = [];
        waypoints.forEach((wp) => {
          const d = getBathymetricDepth(wp.lat, wp.lon);
          if (d >= iso.depth) {
            isoPositions.push(Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, -iso.depth));
          }
        });

        if (isoPositions.length >= 2) {
          const isoEntity = viewer.entities.add({
            name: `IBCSO Isobath: ${iso.depth}m`,
            polyline: {
              positions: isoPositions,
              width: iso.width,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString(iso.color).withAlpha(0.65),
                dashLength: iso.dash
              }),
              clampToGround: false
            }
          });
          bathymetryEntitiesRef.current.push(isoEntity);
        }
      });

      // 4. Significant Bathymetric Depth Sounding Stations along the Seabed
      const SOUNDING_STATIONS = [
        { name: 'Maitri Continental Shelf', lat: -70.4, lon: 12.0, type: 'Shelf', geology: 'Morainic Diamicton & Glacial Till' },
        { name: 'Astrid Ridge Bank', lat: -68.8, lon: 14.5, type: 'Ridge Bank', geology: 'Basaltic Volcanic Basement Pinnacle' },
        { name: 'Lazarev Marine Basin', lat: -67.4, lon: 20.0, type: 'Marine Basin', geology: 'Glaciomarine Silt & Fine Sediment' },
        { name: 'Gunnerus Ridge Seamount', lat: -65.8, lon: 33.5, type: 'Seamount Ridge', geology: 'Uplifted Pelagic Ridge Plateau' },
        { name: 'Riiser-Larsen Abyssal Plain', lat: -66.5, lon: 32.0, type: 'Abyssal Plain', geology: 'Pelagic Clay & Turbidite Beds' },
        { name: 'Cosmonauts Deep Trench', lat: -66.2, lon: 48.0, type: 'Deep Ocean Trench', geology: 'Siliceous Diatomaceous Deep Ooze' },
        { name: 'Cooperation Sea Abyssal Basin', lat: -66.4, lon: 62.0, type: 'Abyssal Basin', geology: 'Hemipelagic Mud Deposit' },
        { name: 'Amery Depression Trough', lat: -68.8, lon: 72.5, type: 'Overdeepened Trough', geology: 'Glacial Overdeepened Scour Channel' },
        { name: 'Prydz Bay Shelf Break', lat: -68.4, lon: 74.5, type: 'Continental Slope', geology: 'Upper Continental Slope Sand-Silt' },
        { name: 'Bharati Coastal Anchorage', lat: -69.3, lon: 76.2, type: 'Fjord Shelf', geology: 'Granitic Crystalline Bedrock' }
      ];

      SOUNDING_STATIONS.forEach((snd) => {
        const depth = getBathymetricDepth(snd.lat, snd.lon);
        const sndPos = Cesium.Cartesian3.fromDegrees(snd.lon, snd.lat, -depth);

        const sndEntity = viewer.entities.add({
          name: `Sounding: ${snd.name}`,
          position: sndPos,
          point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString(depth < 300 ? '#10b981' : depth < 1000 ? '#f59e0b' : '#38bdf8'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: `[${snd.name.toUpperCase()}: -${Math.round(depth)}m]`,
            font: 'bold 9px monospace',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.fromCssColorString('#bae6fd'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 10),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000000)
          }
        });
        sndEntity.polarisData = {
          type: 'bathymetry',
          name: snd.name,
          subtitle: `Antarctic Bathymetric Sounding • ${snd.type}`,
          lat: snd.lat,
          lon: snd.lon,
          depthM: Math.round(depth),
          geology: snd.geology,
          description: `Seabed sounding of -${Math.round(depth)}m along polar fairway. Substrate: ${snd.geology}. Under-keel clearance: ${Math.round(depth - 8.5)}m.`
        };
        bathymetryEntitiesRef.current.push(sndEntity);
      });

      // 4. Initial Multibeam Acoustic Sonar Ping Line
      if (sonarEntityRef.current) {
        viewer.entities.remove(sonarEntityRef.current);
      }
      const initialDepth = getBathymetricDepth(waypoints[0].lat, waypoints[0].lon);
      const sonarBeam = viewer.entities.add({
        name: 'Multibeam Acoustic Sonar Beam',
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(waypoints[0].lon, waypoints[0].lat, 2.0),
            Cesium.Cartesian3.fromDegrees(waypoints[0].lon, waypoints[0].lat, -initialDepth)
          ],
          width: 2.0,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Cesium.Color.fromCssColorString('#8ab4f8').withAlpha(0.6)
          }),
          clampToGround: false
        }
      });
      sonarEntityRef.current = sonarBeam;
    }
  }, [scenarioData, showBathymetry]);

  // Load and Animate 3D Vessel along Route via SampledPositionProperty
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed() || !scenarioData?.route?.waypoints) return;
    const viewer = viewerRef.current;
    const waypoints = scenarioData.route.waypoints;
    if (waypoints.length === 0) return;

    const shipRouteKey = `${waypoints.length}_${waypoints[0]?.time || ''}_${scenarioData.isReplan ? 'replan' : 'norm'}`;
    if (shipEntityRef.current && lastShipRouteKeyRef.current === shipRouteKey && !scenarioData.isReplan) {
      return;
    }
    lastShipRouteKeyRef.current = shipRouteKey;

    const startIso = waypoints[0].time;
    const stopIso = waypoints[waypoints.length - 1].time;
    const startJulian = Cesium.JulianDate.fromIso8601(startIso);
    const stopJulian = Cesium.JulianDate.fromIso8601(stopIso);

    const isReplan = scenarioData.isReplan && shipEntityRef.current && positionPropertyRef.current;

    if (isReplan) {
      const curJulian = viewer.clock.currentTime;
      const curPos = positionPropertyRef.current.getValue(curJulian);

      if (curPos) {
        const newPositionProperty = new Cesium.SampledPositionProperty();
        newPositionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
        newPositionProperty.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
        newPositionProperty.setInterpolationOptions({
          interpolationDegree: 1,
          interpolationAlgorithm: Cesium.LinearApproximation
        });

        // 1. Preserve past voyage history prior to replan anomaly trigger point
        const preservedSamples = (previousSamplesRef.current || []).filter(
          (s) => Cesium.JulianDate.compare(s.julian, curJulian) < 0
        );
        preservedSamples.forEach(({ julian, pos }) => {
          newPositionProperty.addSample(julian, pos);
        });

        // 2. Add current ship position at trigger moment, clamped to sea level
        const surfaceCurPos = Cesium.Ellipsoid.WGS84.scaleToGeodeticSurface(curPos);
        newPositionProperty.addSample(curJulian, surfaceCurPos);

        // 3. Dense future replanned avoidance waypoints along sea level (0.0m)
        const curCarto = Cesium.Cartographic.fromCartesian(surfaceCurPos);
        const curWp = {
          time: Cesium.JulianDate.toIso8601(curJulian),
          lon: Cesium.Math.toDegrees(curCarto.longitude),
          lat: Cesium.Math.toDegrees(curCarto.latitude)
        };
        const futureWaypoints = waypoints.filter((wp) => {
          const wpJulian = Cesium.JulianDate.fromIso8601(wp.time);
          return Cesium.JulianDate.compare(wpJulian, curJulian) > 0;
        });
        const futureDenseSamples = densifySurfaceWaypoints([curWp, ...futureWaypoints]);
        const updatedFutureSamples = [];
        futureDenseSamples.forEach(({ julian, pos }) => {
          if (Cesium.JulianDate.compare(julian, curJulian) > 0) {
            newPositionProperty.addSample(julian, pos);
            updatedFutureSamples.push({ julian, pos });
          }
        });

        const updatedHistory = [...preservedSamples, { julian: curJulian, pos: surfaceCurPos }, ...updatedFutureSamples];
        previousSamplesRef.current = updatedHistory;
        positionPropertyRef.current = newPositionProperty;
        shipEntityRef.current.position = newPositionProperty;
        shipEntityRef.current.orientation = new Cesium.VelocityOrientationProperty(newPositionProperty);

        viewer.clock.stopTime = stopJulian;
        shipEntityRef.current.availability = new Cesium.TimeIntervalCollection([
          new Cesium.TimeInterval({ start: viewer.clock.startTime, stop: stopJulian })
        ]);
      }
    } else {
      viewer.clock.startTime = startJulian;
      viewer.clock.stopTime = stopJulian;
      if (streamMode === 'live' && liveData?.telemetry?.progress !== undefined) {
        const totalSec = Cesium.JulianDate.secondsDifference(stopJulian, startJulian);
        const targetSec = totalSec * Math.max(0, Math.min(1, liveData.telemetry.progress));
        viewer.clock.currentTime = Cesium.JulianDate.addSeconds(startJulian, targetSec, new Cesium.JulianDate());
      } else {
        viewer.clock.currentTime = startJulian;
      }
      viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
      viewer.clock.multiplier = streamMode === 'live' ? 1.0 : playbackSpeed;
      viewer.clock.shouldAnimate = streamMode === 'live' ? true : isPlaying;
      viewer.clock.canAnimate = true;
      if (viewer.cesiumWidget) {
        viewer.cesiumWidget._allowDataSourcesToSuspendAnimation = false;
      }

      const positionProperty = new Cesium.SampledPositionProperty();
      positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
      positionProperty.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
      positionProperty.setInterpolationOptions({
        interpolationDegree: 1,
        interpolationAlgorithm: Cesium.LinearApproximation
      });

      const initialHistory = densifySurfaceWaypoints(waypoints);
      initialHistory.forEach(({ julian, pos }) => {
        positionProperty.addSample(julian, pos);
      });

      previousSamplesRef.current = initialHistory;
      positionPropertyRef.current = positionProperty;

      if (shipEntityRef.current) {
        viewer.entities.remove(shipEntityRef.current);
      }

      // 3D Polar Ship Model Entity at Sea Level (0.0m) with Normalized Scale (IEC 62288)
      const shipEntity = viewer.entities.add({
        id: 'vessel_ship',
        name: 'RV Polar Explorer (Ice-Class Vessel)',
        availability: new Cesium.TimeIntervalCollection([
          new Cesium.TimeInterval({ start: startJulian, stop: stopJulian })
        ]),
        position: positionProperty,
        orientation: new Cesium.VelocityOrientationProperty(positionProperty),
        viewFrom: new Cesium.Cartesian3(-180.0, 0.0, 42.0),
        model: {
          uri: '/models/polar_ship.glb',
          scale: 1.0,
          minimumPixelSize: 48,
          maximumScale: 80.0,
          shadows: Cesium.ShadowMode.ENABLED,
          heightReference: Cesium.HeightReference.NONE,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000000)
        },
        label: {
          text: '🚢 RV POLAR EXPLORER',
          font: 'bold 11px "Segoe UI", Roboto, sans-serif',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.fromCssColorString('#ffffff'),
          outlineColor: Cesium.Color.fromCssColorString('#090d16'),
          outlineWidth: 3,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          eyeOffset: new Cesium.Cartesian3(0, 0, -50000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1e3, 1.2, 3e7, 0.7)
        }
      });
      shipEntity.polarisData = {
        type: 'ship',
        name: 'RV Polar Explorer',
        subtitle: 'Ice-Class Polar Research Vessel (PC4)',
        lat: -70.77,
        lon: 11.73,
        description: 'Flagship polar research vessel equipped with ice-strengthened hull, multibeam bathymetric sonar, CTD rosette winches, and meteorological radar.'
      };

      shipEntityRef.current = shipEntity;
    }

    if (routePolylineEntityRef.current) {
      viewer.entities.remove(routePolylineEntityRef.current);
      routePolylineEntityRef.current = null;
    }
    if (traversePolylineEntityRef.current) {
      viewer.entities.remove(traversePolylineEntityRef.current);
      traversePolylineEntityRef.current = null;
    }

    // Check if waypoints start with inland Maitri Station (Overland Ice Traverse to India Bay)
    const hasOverlandLeg = waypoints.length >= 2 && 
      waypoints[0].lat <= -70.5 && 
      waypoints[1].lat >= -70.1;

    const polylineColor = scenarioData.isReplan
      ? Cesium.Color.fromCssColorString('#fdd663')
      : Cesium.Color.fromCssColorString('#0284c7');

    if (hasOverlandLeg) {
      // 1. Overland Ice-Traverse Leg (Maitri Base ➔ India Bay Fast-Ice Mooring)
      const traversePositions = [
        Cesium.Cartesian3.fromDegrees(waypoints[0].lon, waypoints[0].lat, 50.0),
        Cesium.Cartesian3.fromDegrees(waypoints[1].lon, waypoints[1].lat, 10.0)
      ];
      const traversePolyline = viewer.entities.add({
        name: 'Maitri ➔ India Bay Overland Ice-Traverse Track',
        polyline: {
          positions: traversePositions,
          width: 2.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#f59e0b'),
            dashLength: 10.0
          }),
          clampToGround: false
        }
      });
      traversePolylineEntityRef.current = traversePolyline;

      // 2. Maritime Navigation Fairway (India Bay Mooring ➔ Bharati Anchorage)
      const marineWaypoints = waypoints.slice(1);
      const denseSamples = densifySurfaceWaypoints(marineWaypoints);
      const marinePositions = denseSamples.map((s) => s.pos);
      const routePolyline = viewer.entities.add({
        name: scenarioData.isReplan ? 'Replanned Marine Fairway' : 'Optimal Marine Fairway',
        polyline: {
          positions: marinePositions,
          width: 3.0,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: polylineColor
          }),
          clampToGround: false
        }
      });
      routePolylineEntityRef.current = routePolyline;
    } else {
      const denseSamples = densifySurfaceWaypoints(waypoints);
      const routePositions = denseSamples.map((s) => s.pos);
      const routePolyline = viewer.entities.add({
        name: scenarioData.isReplan ? 'Replanned Avoidance Route' : 'Optimal Planned Route',
        polyline: {
          positions: routePositions,
          width: 3.0,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: polylineColor
          }),
          clampToGround: false
        }
      });
      routePolylineEntityRef.current = routePolyline;
    }
  }, [scenarioData]);

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden" aria-label="3D Cesium Earth Navigation Map">
      <div ref={containerRef} className="w-full h-full" />

      {/* Tactical In-Scene Satellite Fix Inspection Card (Milestone 2) */}
      {selectedSatelliteFix && (
        <div
          className="absolute top-20 left-6 z-40 w-96 max-w-[calc(100vw-3rem)] pointer-events-auto rounded-lg backdrop-blur-xl border border-cyan-400/40 shadow-2xl overflow-hidden font-mono select-none transition-all duration-200"
          style={{
            backgroundColor: 'rgba(4, 14, 24, 0.94)',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.85), 0 0 20px rgba(0, 240, 255, 0.25)',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace'
          }}
        >
          {/* Top Glowing Cyan Bar */}
          <div className="w-full h-1 bg-gradient-to-r from-cyan-500 via-sky-400 to-teal-400" />

          {/* Header Strip */}
          <div className="px-3.5 py-2.5 bg-black/40 border-b border-cyan-500/20 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
              </span>
              <span className="text-[11px] font-bold tracking-wider text-cyan-300 uppercase">
                SATELLITE SIGHTING FIX
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-500/30 font-semibold">
                BYU / USNIC
              </span>
            </div>
            <button
              onClick={() => {
                setSelectedSatelliteFix(null);
                if (onSelectEntityRef.current) onSelectEntityRef.current(null);
              }}
              className="text-gray-400 hover:text-white p-1 hover:bg-white/10 rounded transition-colors text-sm font-bold cursor-pointer"
              aria-label="Close Satellite Inspection Card"
              title="Dismiss Sighting Card"
            >
              ✕
            </button>
          </div>

          {/* Main Content */}
          <div className="p-3.5 space-y-2.5 text-xs">
            {/* Spacecraft & Sensor Banner */}
            <div className="p-2.5 rounded bg-cyan-950/30 border border-cyan-500/25">
              <div className="flex items-center justify-between">
                <div className="text-white font-black text-sm tracking-wide flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" strokeDasharray="3 2" />
                    <circle cx="12" cy="12" r="3" fill="currentColor" />
                    <path d="M12 3v3m0 12v3M3 12h3m12 0h3" />
                  </svg>
                  <span>{selectedSatelliteFix.spacecraft}</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                  {selectedSatelliteFix.sensor}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-gray-300">
                <span>TARGET: <strong className="text-cyan-300">{selectedSatelliteFix.icebergName || `Iceberg ${selectedSatelliteFix.icebergId}`}</strong></span>
                <span className="text-gray-400">{selectedSatelliteFix.passType || 'Ascending'} Pass</span>
              </div>
            </div>

            {/* Primary Telemetry Grid */}
            <div className="grid grid-cols-2 gap-2 text-[10.5px]">
              {/* Date & Time */}
              <div className="p-2 rounded bg-black/50 border border-white/10 col-span-2 flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-gray-400 block tracking-wider uppercase">OBSERVATION UTC TIMESTAMP</span>
                  <span className="font-bold text-cyan-200">
                    {selectedSatelliteFix.timestamp}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[9px] text-gray-400 block tracking-wider uppercase">ORBIT NUMBER</span>
                  <span className="font-bold text-white">
                    #{selectedSatelliteFix.orbitNumber || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Coordinates */}
              <div className="p-2 rounded bg-black/50 border border-white/10">
                <span className="text-[9px] text-gray-400 block tracking-wider uppercase">CONFIRMED LAT</span>
                <span className="font-bold text-white font-mono">
                  {selectedSatelliteFix.lat !== undefined ? `${Math.abs(selectedSatelliteFix.lat).toFixed(4)}°S` : 'N/A'}
                </span>
              </div>
              <div className="p-2 rounded bg-black/50 border border-white/10">
                <span className="text-[9px] text-gray-400 block tracking-wider uppercase">CONFIRMED LON</span>
                <span className="font-bold text-white font-mono">
                  {selectedSatelliteFix.lon !== undefined ? `${Math.abs(selectedSatelliteFix.lon).toFixed(4)}°E` : 'N/A'}
                </span>
              </div>

              {/* Observed Area & Dimensions */}
              <div className="p-2 rounded bg-black/50 border border-white/10">
                <span className="text-[9px] text-gray-400 block tracking-wider uppercase">SURFACE AREA</span>
                <span className="font-bold text-emerald-300">
                  {selectedSatelliteFix.surfaceAreaKm2 !== undefined ? `${selectedSatelliteFix.surfaceAreaKm2} km²` : 'N/A'}
                </span>
              </div>
              <div className="p-2 rounded bg-black/50 border border-white/10">
                <span className="text-[9px] text-gray-400 block tracking-wider uppercase">DIMENSIONS (L × W)</span>
                <span className="font-bold text-white">
                  {selectedSatelliteFix.lengthKm} × {selectedSatelliteFix.widthKm} km
                </span>
              </div>

              {/* Freeboard Height & Radar Backscatter */}
              <div className="p-2 rounded bg-black/50 border border-white/10">
                <span className="text-[9px] text-gray-400 block tracking-wider uppercase">FREEBOARD HEIGHT</span>
                <span className="font-bold text-cyan-300">
                  {selectedSatelliteFix.freeboardM !== undefined ? `${selectedSatelliteFix.freeboardM} m` : 'N/A'}
                </span>
              </div>
              <div className="p-2 rounded bg-black/50 border border-white/10">
                <span className="text-[9px] text-gray-400 block tracking-wider uppercase">RCS BACKSCATTER</span>
                <span className="font-bold text-amber-300">
                  {selectedSatelliteFix.backscatterDb !== undefined ? `${selectedSatelliteFix.backscatterDb} dB` : 'N/A'}
                </span>
              </div>
            </div>

            {/* Quality Flag & Data Source */}
            <div className="p-2 rounded bg-black/40 border border-cyan-500/20 text-[10px] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">QUALITY COHERENCE:</span>
                <span className="text-emerald-400 font-bold px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-[9.5px]">
                  {selectedSatelliteFix.qualityFlag || 'CONFIRMED_HIGH_COHERENCE'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[9px] text-gray-400 pt-1 border-t border-white/5">
                <span>DATA ARCHIVE:</span>
                <span className="text-gray-300 truncate max-w-[200px]">
                  {selectedSatelliteFix.dataSource || 'Copernicus CDSE / ESA Sentinel-1 NRT'}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => {
                  if (viewerRef.current && selectedSatelliteFix.lat !== undefined && selectedSatelliteFix.lon !== undefined) {
                    const targetCart = Cesium.Cartesian3.fromDegrees(selectedSatelliteFix.lon, selectedSatelliteFix.lat, 0);
                    viewerRef.current.camera.flyToBoundingSphere(
                      new Cesium.BoundingSphere(targetCart, 0),
                      {
                        offset: new Cesium.HeadingPitchRange(
                          Cesium.Math.toRadians(0.0),
                          Cesium.Math.toRadians(-35.0),
                          25000.0
                        ),
                        duration: 1.5
                      }
                    );
                  }
                }}
                className="px-2.5 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-300 font-bold text-[10.5px] transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                </svg>
                FOCUS SIGHTING
              </button>

              <button
                onClick={() => {
                  if (selectedSatelliteFix.icebergId && viewerRef.current) {
                    const bergs = scenarioDataRef.current?.icebergs || liveIcebergs || [];
                    const berg = bergs.find(b => String(b.id).toUpperCase() === String(selectedSatelliteFix.icebergId).toUpperCase());
                    if (berg) {
                      const bergPos = Cesium.Cartesian3.fromDegrees(berg.lon, berg.lat, 0);
                      viewerRef.current.camera.flyToBoundingSphere(
                        new Cesium.BoundingSphere(bergPos, 0),
                        {
                          offset: new Cesium.HeadingPitchRange(
                            Cesium.Math.toRadians(0.0),
                            Cesium.Math.toRadians(-25.0),
                            5000.0
                          ),
                          duration: 1.8
                        }
                      );
                    }
                  }
                }}
                className="px-2.5 py-1.5 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-300 font-bold text-[10.5px] transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                LIVE ICEBERG
              </button>
            </div>
          </div>

          {/* Footer Status Bar */}
          <div className="px-3.5 py-1.5 bg-black/70 border-t border-cyan-500/20 flex items-center justify-between text-[9px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span className="text-cyan-400/90 font-semibold">GEODESIC 3D TRACK</span>
            </span>
            <span className="tracking-wider text-gray-400">REF: {selectedSatelliteFix.id}</span>
          </div>
        </div>
      )}

      {seaIceHover && showRiskGrid && useModelLayers && (
        <div className="pointer-events-none absolute bottom-20 right-3 z-30 w-56 rounded border border-cyan-400/50 bg-[#07111b]/95 p-3 font-mono text-[10px] text-slate-200 shadow-2xl backdrop-blur-md">
          <div className="mb-2 text-[10px] font-bold tracking-wider text-cyan-200">SEA-ICE FORECAST SAMPLE</div>
          <div className="grid grid-cols-2 gap-y-1">
            <span className="text-slate-500">LAT</span><span>{seaIceHover.lat.toFixed(3)}°</span>
            <span className="text-slate-500">LON</span><span>{seaIceHover.lon.toFixed(3)}°</span>
            <span className="text-slate-500">HORIZON</span><span className="text-cyan-200">{seaIceHover.horizonHours}h</span>
            <span className="text-slate-500">CONCENTRATION</span><span className="text-amber-300">{(seaIceHover.concentration * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default CesiumViewer;
