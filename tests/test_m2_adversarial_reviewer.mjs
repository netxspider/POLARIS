/**
 * test_m2_adversarial_reviewer.mjs
 * Adversarial Stress & Integrity Test Suite for Milestone 2
 * Reviewer: reviewer_m2_1_gen4
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  SATELLITE_ICEBERG_TRACKS,
  getSatelliteTrackForIceberg,
  getLatestSatelliteObservation,
  getAllSatelliteWaypoints
} from '../frontend/src/data/satelliteIcebergTracks.js';

console.log('='.repeat(80));
console.log('MILIESTONE 2 ADVERSARIAL REVIEWER STRESS SUITE');
console.log('='.repeat(80));

let passes = 0;
let failures = 0;

function assert(condition, message) {
  if (condition) {
    passes++;
    console.log(`  [PASS] ${message}`);
  } else {
    failures++;
    console.error(`  [FAIL] ${message}`);
  }
}

// -----------------------------------------------------------------------------
// 1. INTEGRITY AUDIT: Anti-Cheating & Facade Detection
// -----------------------------------------------------------------------------
console.log('\n--- 1. INTEGRITY AUDIT: Anti-Cheating & Facade Detection ---');
const cesiumViewerContent = fs.readFileSync(
  path.resolve(__dirname, '../frontend/src/components/CesiumViewer.jsx'),
  'utf-8'
);

// Check that real logic is executed rather than returning hardcoded test flags
assert(
  !cesiumViewerContent.includes('// HARDCODED TEST RESULT') &&
  !cesiumViewerContent.includes('__MOCK_TEST_FLAG__'),
  'Source code contains no hardcoded test stubs or mock bypasses'
);

// Verify that all 4 active icebergs are handled dynamically
const bergs = ['C-19', 'B-15K', 'D-28', 'A-68R'];
bergs.forEach((id) => {
  const track = getSatelliteTrackForIceberg(id);
  assert(
    track && track.observations && track.observations.length >= 10,
    `Authentic track for ${id} contains genuine observations (${track?.observations?.length} passes)`
  );
});

// -----------------------------------------------------------------------------
// 2. ADVERSARIAL DRIFT CORRIDOR & PROJECTION MATH STRESS
// -----------------------------------------------------------------------------
console.log('\n--- 2. ADVERSARIAL DRIFT CORRIDOR & PROJECTION MATH STRESS ---');

// In CesiumViewer lines 2191-2201:
// const distNm = speed * hr;
// const dLat = (distNm / 60.0) * Math.cos((heading * Math.PI) / 180.0);
// const cosLat = Math.max(0.01, Math.cos((currentLat * Math.PI) / 180.0));
// const dLon = (distNm / 60.0) * Math.sin((heading * Math.PI) / 180.0) / cosLat;
function projectCorridor(currentLat, currentLon, speed, heading, hours = [6, 12, 24, 48]) {
  const pts = [];
  hours.forEach((hr) => {
    const distNm = speed * hr;
    const dLat = (distNm / 60.0) * Math.cos((heading * Math.PI) / 180.0);
    const cosLat = Math.max(0.01, Math.cos((currentLat * Math.PI) / 180.0));
    const dLon = (distNm / 60.0) * Math.sin((heading * Math.PI) / 180.0) / cosLat;
    pts.push({ lat: currentLat + dLat, lon: currentLon + dLon });
  });
  return pts;
}

// Test near South Pole boundary (-89.9° lat)
const polarProjection = projectCorridor(-89.9, 0, 1.0, 270.0);
assert(
  polarProjection.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)),
  'Corridor projection survives extreme polar singularity (-89.9° lat) without NaN or Infinity'
);

// Test zero speed
const zeroSpeedProjection = projectCorridor(-66.5, 40.0, 0, 260.0);
assert(
  zeroSpeedProjection.every(p => p.lat === -66.5 && p.lon === 40.0),
  'Corridor projection with zero speed remains stationary at anchor point'
);

// Test realistic iceberg speeds in East Antarctica (0.1 to 1.5 knots)
const normalProjection = projectCorridor(-66.5, 40.0, 0.4, 260.0);
assert(
  normalProjection.length === 4 &&
  normalProjection[3].lon < normalProjection[0].lon, // westward movement decreases lon
  'Normal projection progresses westward monotonically along Antarctic Coastal Current'
);

// -----------------------------------------------------------------------------
// 3. 1 Hz STREAMING SIMULATION & ENTITY LIFECYCLE REPLICATION
// -----------------------------------------------------------------------------
console.log('\n--- 3. 1 Hz STREAMING SIMULATION & IN-PLACE MUTATION AUDIT ---');

// Mock Cesium Entity Collection to verify in-place mutation and memory footprint
class MockEntityCollection {
  constructor() {
    this.entities = new Map();
    this.addCount = 0;
    this.removeCount = 0;
  }
  getById(id) {
    return this.entities.get(id) || null;
  }
  add(entityDef) {
    this.addCount++;
    const entity = {
      ...entityDef,
      polyline: entityDef.polyline ? { ...entityDef.polyline } : undefined
    };
    this.entities.set(entityDef.id, entity);
    return entity;
  }
  remove(entity) {
    this.removeCount++;
    this.entities.delete(entity.id);
  }
  get values() {
    return Array.from(this.entities.values());
  }
}

const mockViewer = {
  entities: new MockEntityCollection(),
  isDestroyed: () => false
};

// Replicate CesiumViewer satellite trajectory effect
function runSatelliteEffect(mockV, liveIcebergs, showSatelliteTracks, entitiesRef) {
  if (!showSatelliteTracks) {
    entitiesRef.current.forEach((e) => { e.show = false; });
    return;
  }

  const targetBergIds = ['C-19', 'B-15K', 'D-28', 'A-68R'];
  const activeSatEntityIds = new Set();

  targetBergIds.forEach((bergId) => {
    const liveBerg = liveIcebergs.find(
      (b) => String(b.id).toUpperCase() === bergId || String(b.icebergId).toUpperCase() === bergId
    );
    const satTrack = liveBerg?.satelliteTrack || getSatelliteTrackForIceberg(bergId);
    if (!satTrack || !satTrack.observations || satTrack.observations.length === 0) return;

    const observations = satTrack.observations;
    const latestObs = satTrack.lastObservation || satTrack.latestFix || observations[observations.length - 1];
    const currentLat = liveBerg?.lat ?? latestObs.lat;
    const currentLon = liveBerg?.lon ?? latestObs.lon;

    // Fixes
    observations.forEach((obs, idx) => {
      const fixId = `sat_fix_${bergId}_${idx}`;
      activeSatEntityIds.add(fixId);
      const fixPos = { lon: obs.lon, lat: obs.lat, height: 25.0 };
      let fixEntity = mockV.entities.getById(fixId);
      if (fixEntity) {
        fixEntity.position = fixPos;
        fixEntity.show = showSatelliteTracks;
      } else {
        fixEntity = mockV.entities.add({ id: fixId, position: fixPos, show: true });
        entitiesRef.current.push(fixEntity);
      }
    });

    // Track
    const trackId = `sat_track_${bergId}`;
    activeSatEntityIds.add(trackId);
    const trackCartesians = observations.map(o => ({ lon: o.lon, lat: o.lat, h: 20.0 }));
    trackCartesians.push({ lon: currentLon, lat: currentLat, h: 20.0 });

    let trackEntity = mockV.entities.getById(trackId);
    if (trackEntity) {
      trackEntity.polyline.positions = trackCartesians;
      trackEntity.show = showSatelliteTracks;
    } else {
      trackEntity = mockV.entities.add({
        id: trackId,
        polyline: { positions: trackCartesians, width: 3.5, clampToGround: false }
      });
      entitiesRef.current.push(trackEntity);
    }

    // Corridor
    const corridorId = `sat_corridor_${bergId}`;
    activeSatEntityIds.add(corridorId);
    const corridorCartesians = [
      { lon: latestObs.lon, lat: latestObs.lat, h: 20.0 },
      { lon: currentLon, lat: currentLat, h: 20.0 }
    ];
    let corridorEntity = mockV.entities.getById(corridorId);
    if (corridorEntity) {
      corridorEntity.polyline.positions = corridorCartesians;
      corridorEntity.show = showSatelliteTracks;
    } else {
      corridorEntity = mockV.entities.add({
        id: corridorId,
        polyline: { positions: corridorCartesians, width: 2.5, clampToGround: false }
      });
      entitiesRef.current.push(corridorEntity);
    }
  });

  entitiesRef.current = entitiesRef.current.filter((entity) => {
    if (!activeSatEntityIds.has(entity.id)) {
      try { mockV.entities.remove(entity); } catch {}
      return false;
    }
    return true;
  });
}

const entitiesRef = { current: [] };

// Initial frame
const initialLiveBergs = [
  { id: 'C-19', lat: -66.50, lon: 41.20, speedKn: 0.12 },
  { id: 'B-15K', lat: -67.85, lon: 58.50, speedKn: 0.14 },
  { id: 'D-28', lat: -68.30, lon: 73.60, speedKn: 0.10 },
  { id: 'A-68R', lat: -69.20, lon: 24.80, speedKn: 0.15 }
];

runSatelliteEffect(mockViewer, initialLiveBergs, true, entitiesRef);

const totalExpectedEntities = (13 * 4) + 4 + 4; // 52 fixes + 4 tracks + 4 corridors = 60 entities
assert(
  mockViewer.entities.entities.size === totalExpectedEntities,
  `Initial effect creation allocates exactly ${totalExpectedEntities} entities (got ${mockViewer.entities.entities.size})`
);
assert(
  mockViewer.entities.addCount === totalExpectedEntities,
  `Entity add count equals total entities created (${mockViewer.entities.addCount})`
);

// Simulate 60 seconds of 1 Hz WebSocket updates with advancing drift coordinates
console.log('Simulating 60 continuous 1 Hz WebSocket updates...');
for (let sec = 1; sec <= 60; sec++) {
  const updatedBergs = initialLiveBergs.map(b => ({
    ...b,
    lon: b.lon - (sec * 0.0001), // drifting west
    lat: b.lat + (Math.sin(sec) * 0.00005)
  }));
  runSatelliteEffect(mockViewer, updatedBergs, true, entitiesRef);
}

assert(
  mockViewer.entities.addCount === totalExpectedEntities,
  `ZERO new entities created during 60 1Hz updates (addCount remains ${mockViewer.entities.addCount})`
);
assert(
  mockViewer.entities.removeCount === 0,
  `ZERO entity removals during continuous updates (removeCount remains 0)`
);
assert(
  entitiesRef.current.length === totalExpectedEntities,
  `satelliteTrackEntitiesRef stays constant at ${totalExpectedEntities} (no memory leak)`
);

// Verify track positions tip updated in-place to the latest live berg lon
const c19Track = mockViewer.entities.getById('sat_track_C-19');
const lastPos = c19Track.polyline.positions[c19Track.polyline.positions.length - 1];
const expectedLon = initialLiveBergs[0].lon - (60 * 0.0001);
assert(
  Math.abs(lastPos.lon - expectedLon) < 1e-6,
  `Trailing track tip smoothly mutates in-place to latest live iceberg longitude (${lastPos.lon.toFixed(5)})`
);

// Test showSatelliteTracks toggle OFF
runSatelliteEffect(mockViewer, initialLiveBergs, false, entitiesRef);
assert(
  entitiesRef.current.every(e => e.show === false),
  'Toggling showSatelliteTracks=false sets entity.show=false across all 60 satellite entities'
);

// Test showSatelliteTracks toggle ON
runSatelliteEffect(mockViewer, initialLiveBergs, true, entitiesRef);
assert(
  entitiesRef.current.every(e => e.show === true),
  'Toggling showSatelliteTracks=true restores entity.show=true across all 60 satellite entities'
);

// -----------------------------------------------------------------------------
// 4. ADVERSARIAL CORRUPTED & PARTIAL SATELLITE TRACK PAYLOADS
// -----------------------------------------------------------------------------
console.log('\n--- 4. ADVERSARIAL CORRUPTED & PARTIAL SATELLITE TRACK PAYLOADS ---');

// Corrupted berg with empty observations array
const brokenBergList1 = [
  { id: 'C-19', satelliteTrack: { observations: [] } }
];
let threw1 = false;
try {
  runSatelliteEffect(mockViewer, brokenBergList1, true, entitiesRef);
} catch (e) {
  threw1 = true;
}
assert(!threw1, 'Empty observations array does not throw an exception');

// Berg with null satelliteTrack
const brokenBergList2 = [
  { id: 'C-19', satelliteTrack: null }
];
let threw2 = false;
try {
  runSatelliteEffect(mockViewer, brokenBergList2, true, entitiesRef);
} catch (e) {
  threw2 = true;
}
assert(!threw2, 'null satelliteTrack cleanly falls back to static authentic archive without throwing');

// Summary
console.log('='.repeat(80));
console.log(`RESULTS: ${passes} passed, ${failures} failed`);
console.log('='.repeat(80));

if (failures > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
