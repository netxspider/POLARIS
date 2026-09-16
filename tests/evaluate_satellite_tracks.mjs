import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import SATELLITE_ICEBERG_TRACKS, {
  getSatelliteTrackForIceberg,
  getSatelliteTrack,
  getLatestSatelliteObservation,
  getLatestSatelliteFix,
  getAllSatelliteWaypoints
} from '../frontend/src/data/satelliteIcebergTracks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('='.repeat(80));
console.log('POLARIS Milestone 1 Adversarial Challenge Harness');
console.log('Testing Frontend-Backend Parity, Helper Functions, and Drift Physics');
console.log('='.repeat(80));

let passCount = 0;
let failCount = 0;
const failureDetails = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  [PASS] ${message}`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${message}`);
    failureDetails.push(message);
  }
}

// -----------------------------------------------------------------------------
// SECTION 1: Exact Data Parity between backend JSON and frontend JS module
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 1: Exact Data Parity Check ---');
const backendJsonPath = path.resolve(__dirname, '../backend/data/satellite_iceberg_tracks.json');
assert(fs.existsSync(backendJsonPath), 'backend/data/satellite_iceberg_tracks.json exists');

const backendData = JSON.parse(fs.readFileSync(backendJsonPath, 'utf-8'));
const frontendData = SATELLITE_ICEBERG_TRACKS;

// 1.1 Complete Serialization Parity
const sBackend = JSON.stringify(backendData);
const sFrontend = JSON.stringify(frontendData);
assert(
  sBackend === sFrontend,
  'Full database byte-for-byte serialization match between backend and frontend'
);

// 1.2 Metadata Parity
assert(
  JSON.stringify(backendData.metadata) === JSON.stringify(frontendData.metadata),
  'Metadata exactly mirrors between backend JSON and frontend JS'
);

// 1.3 Iceberg Keys Parity
const backendBergKeys = Object.keys(backendData.icebergs || {}).sort();
const frontendBergKeys = Object.keys(frontendData.icebergs || {}).sort();
assert(
  JSON.stringify(backendBergKeys) === JSON.stringify(frontendBergKeys),
  `Iceberg keys match exactly: [${frontendBergKeys.join(', ')}]`
);

// 1.4 Per-Iceberg Top-Level Properties and Exact Waypoint Parity
let allWaypointsMatch = true;
let totalWaypointsChecked = 0;
const targetBergs = ['C-19', 'B-15K', 'D-28', 'A-68R'];

for (const bergId of targetBergs) {
  const bBerg = backendData.icebergs[bergId];
  const fBerg = frontendData.icebergs[bergId];

  assert(Boolean(bBerg && fBerg), `Iceberg ${bergId} exists in both datasets`);
  if (!bBerg || !fBerg) continue;

  // Check static attributes
  const staticKeys = [
    'id', 'icebergId', 'name', 'usnicId', 'byuId', 'origin',
    'classification', 'threatLevel', 'safetyBufferNm', 'calvingYear',
    'nominalDimensions', 'nominalRadarBackscatterDb', 'totalSightings'
  ];
  let bergPropsMatch = true;
  for (const k of staticKeys) {
    if (JSON.stringify(bBerg[k]) !== JSON.stringify(fBerg[k])) {
      bergPropsMatch = false;
      console.error(`    Mismatch in ${bergId} property ${k}: Backend=${JSON.stringify(bBerg[k])}, Frontend=${JSON.stringify(fBerg[k])}`);
    }
  }
  assert(bergPropsMatch, `Iceberg ${bergId} static properties match exactly`);

  // Check lastObservation and latestFix match
  assert(
    JSON.stringify(bBerg.lastObservation) === JSON.stringify(fBerg.lastObservation),
    `Iceberg ${bergId} lastObservation matches exactly`
  );
  assert(
    JSON.stringify(bBerg.latestFix) === JSON.stringify(fBerg.latestFix),
    `Iceberg ${bergId} latestFix matches exactly`
  );

  // Check observations array length
  const bObs = bBerg.observations || [];
  const fObs = fBerg.observations || [];
  assert(
    bObs.length === 13 && fObs.length === 13,
    `Iceberg ${bergId} has exactly 13 observations in both (b=${bObs.length}, f=${fObs.length})`
  );

  // Check every individual waypoint
  for (let i = 0; i < Math.max(bObs.length, fObs.length); i++) {
    totalWaypointsChecked++;
    const bWp = bObs[i];
    const fWp = fObs[i];
    const match = JSON.stringify(bWp) === JSON.stringify(fWp);
    if (!match) {
      allWaypointsMatch = false;
      console.error(`    Waypoint mismatch in ${bergId} at index ${i}:`);
      console.error(`      Backend : ${JSON.stringify(bWp)}`);
      console.error(`      Frontend: ${JSON.stringify(fWp)}`);
    }
  }
}
assert(allWaypointsMatch && totalWaypointsChecked === 52, `All ${totalWaypointsChecked} waypoints match byte-for-byte between backend and frontend`);

// -----------------------------------------------------------------------------
// SECTION 2: Helper Functions Comprehensive & Adversarial Stress Testing
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 2: Helper Functions Stress Testing ---');

// 2.1 getSatelliteTrackForIceberg & alias getSatelliteTrack
for (const id of ['C-19', 'B-15K', 'D-28', 'A-68R']) {
  const res = getSatelliteTrackForIceberg(id);
  assert(res && res.id === id, `getSatelliteTrackForIceberg('${id}') returns correct iceberg record`);
}

const tolerantCases = [
  ['c-19', 'C-19'],
  ['C19', 'C-19'],
  ['c19', 'C-19'],
  ['b-15k', 'B-15K'],
  ['B15K', 'B-15K'],
  ['b15k', 'B-15K'],
  ['d-28', 'D-28'],
  ['D28', 'D-28'],
  ['d28', 'D-28'],
  ['a-68r', 'A-68R'],
  ['A68R', 'A-68R'],
  ['a68r', 'A-68R']
];
for (const [query, expected] of tolerantCases) {
  const res = getSatelliteTrackForIceberg(query);
  assert(res && res.id === expected, `getSatelliteTrackForIceberg('${query}') tolerant lookup -> ${expected}`);
}

assert(getSatelliteTrack === getSatelliteTrackForIceberg, 'getSatelliteTrack is exact function alias for getSatelliteTrackForIceberg');
for (const [query, expected] of tolerantCases) {
  const res = getSatelliteTrack(query);
  assert(res && res.id === expected, `getSatelliteTrack('${query}') returns correct record`);
}

const adversarialInputs = [
  null,
  undefined,
  '',
  '   ',
  'NON_EXISTENT_ICEBERG',
  123,
  -19,
  {},
  [],
  true,
  false,
  'C-19; DROP TABLE icebergs;',
  'B-15K-Z999',
  '../../etc/passwd',
  NaN
];

let adversarialPassed = true;
for (const inv of adversarialInputs) {
  try {
    const res = getSatelliteTrackForIceberg(inv);
    if (res !== null) {
      adversarialPassed = false;
      console.error(`    Unexpected non-null result for input: ${inv} -> ${JSON.stringify(res)}`);
    }
  } catch (err) {
    adversarialPassed = false;
    console.error(`    Threw exception on input ${inv}: ${err.message}`);
  }
}
assert(adversarialPassed, 'getSatelliteTrackForIceberg handles all adversarial/invalid inputs gracefully returning null without throwing');

// 2.2 getLatestSatelliteObservation & alias getLatestSatelliteFix
for (const id of targetBergs) {
  const latest = getLatestSatelliteObservation(id);
  const berg = getSatelliteTrackForIceberg(id);
  const expectedLast = berg.observations[berg.observations.length - 1];

  assert(Boolean(latest), `getLatestSatelliteObservation('${id}') returns an observation`);
  assert(
    JSON.stringify(latest) === JSON.stringify(expectedLast),
    `getLatestSatelliteObservation('${id}') matches the 13th observation in array`
  );
  assert(
    JSON.stringify(latest) === JSON.stringify(berg.lastObservation),
    `getLatestSatelliteObservation('${id}') matches berg.lastObservation`
  );
  assert(
    JSON.stringify(latest) === JSON.stringify(berg.latestFix),
    `getLatestSatelliteObservation('${id}') matches berg.latestFix`
  );
}

assert(getLatestSatelliteFix === getLatestSatelliteObservation, 'getLatestSatelliteFix is exact alias for getLatestSatelliteObservation');

let latestAdvPassed = true;
for (const inv of [null, undefined, '', 'FAKE_ID', 999]) {
  try {
    const res = getLatestSatelliteObservation(inv);
    if (res !== null) {
      latestAdvPassed = false;
      console.error(`    getLatestSatelliteObservation(${inv}) returned non-null: ${JSON.stringify(res)}`);
    }
  } catch (err) {
    latestAdvPassed = false;
    console.error(`    getLatestSatelliteObservation(${inv}) threw: ${err.message}`);
  }
}
assert(latestAdvPassed, 'getLatestSatelliteObservation returns null safely on invalid inputs');

// 2.3 getAllSatelliteWaypoints
const allWps = getAllSatelliteWaypoints();
assert(Array.isArray(allWps), 'getAllSatelliteWaypoints() returns an Array');
assert(allWps.length === 52, `getAllSatelliteWaypoints() returns exactly 52 waypoints (got ${allWps.length})`);

let wpsDecoratedCorrectly = true;
let latestFlagCounts = 0;
const bergWaypointCounts = {};

for (const wp of allWps) {
  bergWaypointCounts[wp.icebergId] = (bergWaypointCounts[wp.icebergId] || 0) + 1;
  if (!wp.icebergId || !wp.icebergName || !wp.threatLevel || typeof wp.waypointIndex !== 'number') {
    wpsDecoratedCorrectly = false;
    console.error('    Missing decoration in waypoint:', wp);
  }
  if (wp.isLatest === true) {
    latestFlagCounts++;
    if (wp.waypointIndex !== 12) {
      wpsDecoratedCorrectly = false;
      console.error(`    Waypoint flagged as isLatest but waypointIndex is ${wp.waypointIndex} (expected 12)`);
    }
  } else if (wp.isLatest !== false) {
    wpsDecoratedCorrectly = false;
    console.error(`    Waypoint has non-boolean isLatest: ${wp.isLatest}`);
  }
}
assert(wpsDecoratedCorrectly, 'All waypoints decorated with icebergId, icebergName, threatLevel, waypointIndex, isLatest');
assert(latestFlagCounts === 4, `Exactly 4 waypoints flagged as isLatest=true (got ${latestFlagCounts})`);
assert(
  JSON.stringify(bergWaypointCounts) === JSON.stringify({ 'C-19': 13, 'B-15K': 13, 'D-28': 13, 'A-68R': 13 }),
  'Each iceberg contributes exactly 13 waypoints to getAllSatelliteWaypoints'
);

// -----------------------------------------------------------------------------
// SECTION 3: Geodesic Drift Physics & Trajectory Direction Verification
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 3: Geodesic Drift Physics & Trajectory Direction ---');

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function initialBearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return (theta * 180 / Math.PI + 360) % 360;
}

for (const bergId of targetBergs) {
  console.log(`\n  Evaluating Iceberg ${bergId}:`);
  const berg = frontendData.icebergs[bergId];
  const obs = berg.observations;

  let strictlyMonotonicWestward = true;
  let overallWestward = obs[0].lon > obs[obs.length - 1].lon;
  let totalDistanceKm = 0;
  let totalHours = (new Date(obs[obs.length - 1].timestamp) - new Date(obs[0].timestamp)) / (1000 * 3600);

  const stepStats = [];

  for (let i = 0; i < obs.length - 1; i++) {
    const wpEarlier = obs[i];
    const wpLater = obs[i + 1];

    const dLon = wpLater.lon - wpEarlier.lon;
    const dLat = wpLater.lat - wpEarlier.lat;
    const isStepWestward = wpEarlier.lon > wpLater.lon;

    if (!isStepWestward) {
      strictlyMonotonicWestward = false;
      console.error(`    [ANOMALY] Non-westward step in ${bergId} from wp[${i}] (${wpEarlier.lon}Â°E) to wp[${i+1}] (${wpLater.lon}Â°E)`);
    }

    const distKm = haversineDistanceKm(wpEarlier.lat, wpEarlier.lon, wpLater.lat, wpLater.lon);
    totalDistanceKm += distKm;

    const dtHours = (new Date(wpLater.timestamp) - new Date(wpEarlier.timestamp)) / (1000 * 3600);
    const speedKnots = (distKm / 1.852) / dtHours;
    const speedKmDay = (distKm / dtHours) * 24;
    const bearing = initialBearingDeg(wpEarlier.lat, wpEarlier.lon, wpLater.lat, wpLater.lon);

    stepStats.push({
      step: `${i} -> ${i+1}`,
      dtHours: dtHours.toFixed(1),
      distKm: distKm.toFixed(2),
      speedKnots: speedKnots.toFixed(3),
      speedKmDay: speedKmDay.toFixed(2),
      bearing: bearing.toFixed(1),
      dLon: dLon.toFixed(3),
      dLat: dLat.toFixed(3)
    });
  }

  assert(overallWestward, `${bergId}: Overall trajectory is westward (${obs[0].lon}Â°E -> ${obs[obs.length - 1].lon}Â°E, net ${(obs[0].lon - obs[obs.length - 1].lon).toFixed(3)}Â° westward)`);
  assert(strictlyMonotonicWestward, `${bergId}: Every single consecutive waypoint step moves monotonically westward (earlier is east of later)`);

  let strictlyChronological = true;
  for (let i = 0; i < obs.length - 1; i++) {
    const tEarlier = new Date(obs[i].timestamp).getTime();
    const tLater = new Date(obs[i + 1].timestamp).getTime();
    if (tLater <= tEarlier) {
      strictlyChronological = false;
      console.error(`    [ANOMALY] Chronology inverted between wp[${i}] and wp[${i+1}]`);
    }
  }
  assert(strictlyChronological, `${bergId}: Timestamps are strictly monotonically advancing from ${obs[0].timestamp} to ${obs[obs.length - 1].timestamp}`);

  const avgSpeedKnots = (totalDistanceKm / 1.852) / totalHours;
  const avgSpeedKmDay = (totalDistanceKm / totalHours) * 24;
  console.log(`    Total Distance: ${totalDistanceKm.toFixed(1)} km over ${totalHours.toFixed(1)} h (${(totalHours / 24).toFixed(1)} days)`);
  console.log(`    Mean Drift Speed: ${avgSpeedKnots.toFixed(3)} kn (${avgSpeedKmDay.toFixed(2)} km/day)`);

  assert(
    avgSpeedKnots >= 0.08 && avgSpeedKnots <= 1.0,
    `${bergId}: Mean drift speed ${avgSpeedKnots.toFixed(3)} kn is physically realistic for Antarctic Coastal Current (expected 0.08 - 1.0 kn)`
  );

  let allStepSpeedsRealistic = true;
  for (const s of stepStats) {
    const spd = parseFloat(s.speedKnots);
    // Physically realistic range for coastal drift: 0.01 kn (coastal deceleration/grounding) to 2.5 kn
    if (spd < 0.01 || spd > 2.5) {
      allStepSpeedsRealistic = false;
      console.error(`    [SPEED OUTLIER] Step ${s.step}: ${s.speedKnots} kn (${s.distKm} km in ${s.dtHours} h)`);
    }
  }
  assert(allStepSpeedsRealistic, `${bergId}: All individual step speeds (range: ${Math.min(...stepStats.map(s => parseFloat(s.speedKnots))).toFixed(3)} - ${Math.max(...stepStats.map(s => parseFloat(s.speedKnots))).toFixed(3)} kn) are physically plausible`);

  let allBearingsWestward = true;
  for (const s of stepStats) {
    const brg = parseFloat(s.bearing);
    if (brg < 180 || brg > 360) {
      allBearingsWestward = false;
      console.error(`    [BEARING ANOMALY] Step ${s.step} bearing ${s.bearing}Â° is not westward quadrant`);
    }
  }
  assert(allBearingsWestward, `${bergId}: All step headings (${stepStats.map(s => s.bearing + 'Â°').join(', ')}) point into the westward quadrant along the coastline`);

  let coordsInAntarcticShelf = true;
  for (let i = 0; i < obs.length; i++) {
    const { lat, lon } = obs[i];
    if (lat < -75.0 || lat > -63.0) {
      coordsInAntarcticShelf = false;
      console.error(`    [COORDINATE OUTLIER] Lat ${lat} outside typical East Antarctic coastal margin`);
    }
    if (lon < 10.0 || lon > 85.0) {
      coordsInAntarcticShelf = false;
      console.error(`    [COORDINATE OUTLIER] Lon ${lon} outside Maitri-Bharati corridor (10Â°E - 85Â°E)`);
    }
  }
  assert(coordsInAntarcticShelf, `${bergId}: All coordinates stay within authentic East Antarctic coastal shipping corridor`);

  let dimensionsConsistent = true;
  const firstDim = obs[0];
  const lastDim = obs[obs.length - 1];
  if (lastDim.surfaceAreaKm2 > firstDim.surfaceAreaKm2 * 1.01) {
    dimensionsConsistent = false;
    console.error(`    [PHYSICS ANOMALY] Iceberg grew in area: ${firstDim.surfaceAreaKm2} -> ${lastDim.surfaceAreaKm2} kmÂ²`);
  }
  assert(dimensionsConsistent, `${bergId}: Surface area does not unphysically increase over observation period (initial: ${firstDim.surfaceAreaKm2} kmÂ², final: ${lastDim.surfaceAreaKm2} kmÂ²)`);

  let backscatterConsistent = true;
  for (const o of obs) {
    if (o.backscatterDb < -16.0 || o.backscatterDb > -8.0) {
      backscatterConsistent = false;
      console.error(`    [BACKSCATTER OUTLIER] ${o.backscatterDb} dB`);
    }
  }
  assert(backscatterConsistent, `${bergId}: Radar backscatter values remain within valid C-band / Ku-band ice shelf range (-8 to -16 dB)`);
}

// -----------------------------------------------------------------------------
// SECTION 4: Final Summary and Verdict
// -----------------------------------------------------------------------------
console.log('\n' + '='.repeat(80));
console.log(`EVALUATION COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
console.log('='.repeat(80));

if (failCount === 0) {
  console.log('\nVERDICT: APPROVE');
  console.log('All frontend-backend data parity checks, helper functions, and drift physics verifications passed 100%.');
  process.exit(0);
} else {
  console.log('\nVERDICT: REQUEST_CHANGES');
  console.log('Failures detected:');
  failureDetails.forEach(d => console.log(`  - ${d}`));
  process.exit(1);
}
