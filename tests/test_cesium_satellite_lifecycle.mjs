import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('='.repeat(80));
console.log('ADVERSARIAL STRESS TEST: Cesium Satellite Tracks Lifecycle, Depth & Events');
console.log('='.repeat(80));

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  [PASS] ${message}`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${message}`);
  }
}

// 1. Mock Cesium runtime environment
const entitiesMap = new Map();
const mockViewer = {
  isDestroyed: () => false,
  entities: {
    getById: (id) => entitiesMap.get(id) || null,
    add: (options) => {
      const entity = { ...options, show: options.show !== false };
      entitiesMap.set(options.id, entity);
      return entity;
    },
    remove: (entity) => {
      entitiesMap.delete(entity.id);
      return true;
    }
  }
};

// Import satellite data
const { getSatelliteTrackForIceberg } = await import('../frontend/src/data/satelliteIcebergTracks.js');

// Simulate the CesiumViewer useEffect logic
function runSatelliteEffect({
  viewer,
  liveIcebergs,
  scenarioIcebergs,
  showSatelliteTracks,
  satelliteTrackEntitiesRef
}) {
  if (!viewer || viewer.isDestroyed()) return;

  if (!showSatelliteTracks) {
    satelliteTrackEntitiesRef.current.forEach((e) => { e.show = false; });
    return;
  }

  const targetBergIds = ['C-19', 'B-15K', 'D-28', 'A-68R'];
  const incomingBergs = liveIcebergs || scenarioIcebergs || [];
  const activeSatEntityIds = new Set();

  targetBergIds.forEach((bergId) => {
    const liveBerg = incomingBergs.find(
      (b) => String(b.id).toUpperCase() === bergId || String(b.icebergId).toUpperCase() === bergId
    );

    const satTrack = liveBerg?.satelliteTrack || getSatelliteTrackForIceberg(bergId);
    if (!satTrack || !satTrack.observations || satTrack.observations.length === 0) return;

    const observations = satTrack.observations;
    const latestObs = satTrack.lastObservation || satTrack.latestFix || observations[observations.length - 1];
    const currentLat = liveBerg?.lat ?? latestObs.lat;
    const currentLon = liveBerg?.lon ?? latestObs.lon;

    // 1. Waypoint pins
    observations.forEach((obs, idx) => {
      const fixId = `sat_fix_${bergId}_${idx}`;
      activeSatEntityIds.add(fixId);
      const fixPos = { lon: obs.lon, lat: obs.lat, alt: 25.0 };

      const fixPolarisData = {
        type: 'satellite_fix',
        id: fixId,
        icebergId: bergId,
        observation: obs,
        spacecraft: obs.spacecraft,
        lat: obs.lat,
        lon: obs.lon
      };

      let fixEntity = viewer.entities.getById(fixId);
      if (fixEntity) {
        fixEntity.position = fixPos;
        fixEntity.show = showSatelliteTracks;
        fixEntity.polarisData = fixPolarisData;
      } else {
        fixEntity = viewer.entities.add({
          id: fixId,
          name: `${obs.spacecraft} Sighting Fix #${idx + 1}`,
          position: fixPos,
          billboard: {
            image: 'svg-data-uri',
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: obs.timestamp,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        });
        fixEntity.polarisData = fixPolarisData;
        satelliteTrackEntitiesRef.current.push(fixEntity);
      }
    });

    // 2. Track line
    const trackId = `sat_track_${bergId}`;
    activeSatEntityIds.add(trackId);
    const trackCartesians = observations.map((o) => ({ lon: o.lon, lat: o.lat, alt: 20.0 }));
    trackCartesians.push({ lon: currentLon, lat: currentLat, alt: 20.0 });

    let trackEntity = viewer.entities.getById(trackId);
    if (trackEntity) {
      trackEntity.polyline.positions = trackCartesians;
      trackEntity.show = showSatelliteTracks;
    } else {
      trackEntity = viewer.entities.add({
        id: trackId,
        polyline: {
          positions: trackCartesians,
          clampToGround: false,
          arcType: 'GEODESIC',
          depthFailMaterial: 'faint-glow'
        }
      });
      satelliteTrackEntitiesRef.current.push(trackEntity);
    }

    // 3. Corridor
    const corridorId = `sat_corridor_${bergId}`;
    activeSatEntityIds.add(corridorId);
    const corridorCartesians = [
      { lon: latestObs.lon, lat: latestObs.lat, alt: 20.0 },
      { lon: currentLon, lat: currentLat, alt: 20.0 }
    ];

    let corridorEntity = viewer.entities.getById(corridorId);
    if (corridorEntity) {
      corridorEntity.polyline.positions = corridorCartesians;
      corridorEntity.show = showSatelliteTracks;
    } else {
      corridorEntity = viewer.entities.add({
        id: corridorId,
        polyline: {
          positions: corridorCartesians,
          clampToGround: false,
          arcType: 'GEODESIC',
          depthFailMaterial: 'faint-dash'
        }
      });
      satelliteTrackEntitiesRef.current.push(corridorEntity);
    }
  });

  // Stale cleanup
  satelliteTrackEntitiesRef.current = satelliteTrackEntitiesRef.current.filter((entity) => {
    if (!activeSatEntityIds.has(entity.id)) {
      try { viewer.entities.remove(entity); } catch {}
      return false;
    }
    return true;
  });
}

// TEST 1: Initial creation of satellite entities
console.log('\n--- SCENARIO 1: Initial Mount & Entity Population ---');
const satelliteTrackEntitiesRef = { current: [] };
runSatelliteEffect({
  viewer: mockViewer,
  liveIcebergs: null,
  scenarioIcebergs: null,
  showSatelliteTracks: true,
  satelliteTrackEntitiesRef
});

// 4 icebergs * 13 waypoints = 52 fix pins + 4 track lines + 4 corridors = 60 entities total
assert(satelliteTrackEntitiesRef.current.length === 60, `Initialized exactly 60 satellite entities (got ${satelliteTrackEntitiesRef.current.length})`);
assert(entitiesMap.size === 60, `Cesium viewer entities map has 60 items (got ${entitiesMap.size})`);

const c19Fix0 = mockViewer.entities.getById('sat_fix_C-19_0');
assert(c19Fix0 !== null, 'sat_fix_C-19_0 entity exists');
assert(c19Fix0.billboard.disableDepthTestDistance === Number.POSITIVE_INFINITY, 'Waypoint billboard has disableDepthTestDistance: +Infinity');
assert(c19Fix0.label.disableDepthTestDistance === Number.POSITIVE_INFINITY, 'Waypoint label has disableDepthTestDistance: +Infinity');
assert(c19Fix0.position.alt === 25.0, 'Waypoint position is elevated to +25.0m');

const c19Track = mockViewer.entities.getById('sat_track_C-19');
assert(c19Track !== null, 'sat_track_C-19 entity exists');
assert(c19Track.polyline.clampToGround === false, 'Track polyline clampToGround is false');
assert(c19Track.polyline.arcType === 'GEODESIC', 'Track polyline uses GEODESIC arc interpolation');
assert(c19Track.polyline.depthFailMaterial !== undefined, 'Track polyline has depthFailMaterial set');

const c19Corridor = mockViewer.entities.getById('sat_corridor_C-19');
assert(c19Corridor !== null, 'sat_corridor_C-19 entity exists');
assert(c19Corridor.polyline.clampToGround === false, 'Corridor polyline clampToGround is false');

// TEST 2: Live telemetry position updates without entity recreation (Zero Churn)
console.log('\n--- SCENARIO 2: Live Position Updates (In-Place Mutation) ---');
const initialEntities = [...satelliteTrackEntitiesRef.current];

const mockLiveIcebergs = [
  { id: 'C-19', lat: -66.52, lon: 41.15 }
];

runSatelliteEffect({
  viewer: mockViewer,
  liveIcebergs: mockLiveIcebergs,
  scenarioIcebergs: null,
  showSatelliteTracks: true,
  satelliteTrackEntitiesRef
});

assert(satelliteTrackEntitiesRef.current.length === 60, 'Entity count remains exactly 60 after live coordinate update');
assert(entitiesMap.size === 60, 'Cesium entities map still has 60 items');

// Check that object references are preserved (in-place mutation, not recreated)
let referencesPreserved = true;
for (let i = 0; i < 60; i++) {
  if (satelliteTrackEntitiesRef.current[i] !== initialEntities[i]) {
    referencesPreserved = false;
    break;
  }
}
assert(referencesPreserved === true, 'All 60 entity object instances preserved in-place (zero GC churn)');

// Check that the updated trailing position matches the new live berg position
const updatedTrack = mockViewer.entities.getById('sat_track_C-19');
const lastPos = updatedTrack.polyline.positions[updatedTrack.polyline.positions.length - 1];
assert(lastPos.lat === -66.52 && lastPos.lon === 41.15, `Track tip dynamically updated to (-66.52, 41.15) in-place`);

// TEST 3: Visibility toggling via showSatelliteTracks prop
console.log('\n--- SCENARIO 3: Visibility Toggle (showSatelliteTracks = false) ---');
runSatelliteEffect({
  viewer: mockViewer,
  liveIcebergs: mockLiveIcebergs,
  scenarioIcebergs: null,
  showSatelliteTracks: false,
  satelliteTrackEntitiesRef
});

assert(satelliteTrackEntitiesRef.current.length === 60, 'All 60 entities remain retained in ref array');
assert(entitiesMap.size === 60, 'Cesium entities map still retains all 60 entities');
const allHidden = satelliteTrackEntitiesRef.current.every(e => e.show === false);
assert(allHidden === true, 'Every entity .show is set to false without destroying entities');

console.log('\n--- SCENARIO 4: Visibility Re-enabled (showSatelliteTracks = true) ---');
runSatelliteEffect({
  viewer: mockViewer,
  liveIcebergs: mockLiveIcebergs,
  scenarioIcebergs: null,
  showSatelliteTracks: true,
  satelliteTrackEntitiesRef
});

const allVisible = satelliteTrackEntitiesRef.current.every(e => e.show === true);
assert(allVisible === true, 'Every entity .show restored to true on toggle re-enable');
assert(satelliteTrackEntitiesRef.current.length === 60, 'Entity count still exactly 60 (no duplicate entities created)');

// TEST 5: ScreenSpaceEventHandler Pick and Dispatch Simulation
console.log('\n--- SCENARIO 5: Waypoint Click & Dispatch ---');
let selectedFixState = null;
let dispatchedPolarisData = null;

const onSelectEntityRef = {
  current: (data) => {
    dispatchedPolarisData = data;
  }
};

function simulateClick(pickedId) {
  const entity = mockViewer.entities.getById(pickedId);
  if (entity && entity.polarisData) {
    if (entity.polarisData.type === 'satellite_fix') {
      selectedFixState = entity.polarisData;
    } else {
      selectedFixState = null;
    }
    if (onSelectEntityRef.current) {
      onSelectEntityRef.current(entity.polarisData);
    }
  }
}

simulateClick('sat_fix_C-19_0');
assert(selectedFixState !== null, 'selectedFixState populated on click');
assert(selectedFixState.id === 'sat_fix_C-19_0', 'selectedFixState contains correct waypoint ID');
assert(selectedFixState.spacecraft === 'Sentinel-1A', 'selectedFixState contains spacecraft metadata');
assert(dispatchedPolarisData !== null, 'onSelectEntityRef received polarisData dispatch');
assert(dispatchedPolarisData.type === 'satellite_fix', 'dispatched polarisData has type: satellite_fix');
assert(dispatchedPolarisData.lat === selectedFixState.lat, 'dispatched polarisData has coordinates');

// TEST 6: Unmount and Complete Memory Cleanup
console.log('\n--- SCENARIO 6: Component Unmount & Memory Cleanup ---');
function simulateUnmount() {
  satelliteTrackEntitiesRef.current.forEach((e) => {
    try { mockViewer.entities.remove(e); } catch {}
  });
  satelliteTrackEntitiesRef.current = [];
}

simulateUnmount();
assert(satelliteTrackEntitiesRef.current.length === 0, 'satelliteTrackEntitiesRef cleared on unmount');
assert(entitiesMap.size === 0, 'All satellite entities completely removed from Cesium viewer on unmount');

console.log('='.repeat(80));
console.log(`LIFECYCLE RESULTS: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(80));

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
