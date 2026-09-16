/**
 * POLARIS Milestone 2 Empirical Adversarial Test: Drift Physics & Corridor Projection
 * Agent: challenger_m2_2_gen4
 * 
 * Verifies:
 * 1. Forward projected satellite drift corridors (sat_corridor_${berg.id}) extend from
 *    the latest satellite observation and live iceberg position into the future drift path
 *    without reversing direction.
 * 2. All 4 icebergs (C-19, B-15K, D-28, A-68R) have complete, continuous historical tracks
 *    and forward corridors.
 * 3. Edge cases: empty tracks, missing observations, null/undefined structures, malformed
 *    coordinates, zero speed, polar singularities.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import satellite iceberg tracks
const { SATELLITE_ICEBERG_TRACKS, getSatelliteTrackForIceberg } = await import(
  '../frontend/src/data/satelliteIcebergTracks.js'
);

// Load cached scenario
const scenarioData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../backend/data/cached_scenario.json'), 'utf8')
);

// Great circle bearing in degrees [0, 360)
function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180.0;
  const phi2 = (lat2 * Math.PI) / 180.0;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180.0;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180.0) / Math.PI + 360.0) % 360.0;
}

// Great circle distance in kilometers
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const dLat = ((lat2 - lat1) * Math.PI) / 180.0;
  const dLon = ((lon2 - lon1) * Math.PI) / 180.0;
  const a =
    Math.sin(dLat / 2.0) ** 2 +
    Math.cos((lat1 * Math.PI) / 180.0) *
      Math.cos((lat2 * Math.PI) / 180.0) *
      Math.sin(dLon / 2.0) ** 2;
  return 2.0 * R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0.0, 1.0 - a)));
}

// Smallest angle between two bearings [0, 180]
function bearingDelta(b1, b2) {
  let diff = Math.abs(b1 - b2) % 360.0;
  return diff > 180.0 ? 360.0 - diff : diff;
}

// Pure function replicating the exact corridor projection logic from CesiumViewer.jsx lines 2174–2201
function buildCorridorPoints(bergId, liveBerg, scenarioData, customSatTrack = null) {
  const satTrack = customSatTrack || liveBerg?.satelliteTrack || getSatelliteTrackForIceberg(bergId);
  if (!satTrack || !satTrack.observations || satTrack.observations.length === 0) {
    return null; // Graceful fallback
  }

  const observations = satTrack.observations;
  const latestObs =
    satTrack.lastObservation || satTrack.latestFix || observations[observations.length - 1];

  if (!latestObs || typeof latestObs.lat !== 'number' || typeof latestObs.lon !== 'number') {
    return null;
  }

  const currentLat = liveBerg?.lat ?? latestObs.lat;
  const currentLon = liveBerg?.lon ?? latestObs.lon;

  if (isNaN(currentLat) || isNaN(currentLon)) {
    return null;
  }

  const corridorPoints = [
    { lon: latestObs.lon, lat: latestObs.lat, alt: 20.0, label: 'latest_obs' },
    { lon: currentLon, lat: currentLat, alt: 20.0, label: 'live_position' }
  ];

  if (liveBerg?.projection6h && liveBerg.projection6h.length > 0) {
    liveBerg.projection6h.forEach((pt, idx) => {
      if (typeof pt.lat === 'number' && typeof pt.lon === 'number' && !isNaN(pt.lat) && !isNaN(pt.lon)) {
        corridorPoints.push({ lon: pt.lon, lat: pt.lat, alt: 20.0, label: `proj6h_${idx}` });
      }
    });
  } else if (liveBerg?.predictedTrack && liveBerg.predictedTrack.length > 0) {
    liveBerg.predictedTrack.forEach((pt, idx) => {
      if (typeof pt.lat === 'number' && typeof pt.lon === 'number' && !isNaN(pt.lat) && !isNaN(pt.lon)) {
        corridorPoints.push({ lon: pt.lon, lat: pt.lat, alt: 20.0, label: `predTrack_${idx}` });
      }
    });
  } else {
    // Forward projection steps along drift heading (6h, 12h, 24h, 48h)
    const speed = liveBerg?.driftSpeedKn ?? liveBerg?.speedKn ?? 0.35;
    const heading = liveBerg?.driftHeadingDeg ?? liveBerg?.headingDeg ?? 260.0;
    [6, 12, 24, 48].forEach((hr) => {
      const distNm = speed * hr;
      const dLat = (distNm / 60.0) * Math.cos((heading * Math.PI) / 180.0);
      const cosLat = Math.max(0.01, Math.cos((currentLat * Math.PI) / 180.0));
      const dLon = ((distNm / 60.0) * Math.sin((heading * Math.PI) / 180.0)) / cosLat;
      corridorPoints.push({
        lon: currentLon + dLon,
        lat: currentLat + dLat,
        alt: 20.0,
        label: `deadReckon_${hr}h`
      });
    });
  }

  return {
    bergId,
    latestObs,
    currentPos: { lat: currentLat, lon: currentLon },
    points: corridorPoints
  };
}

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failedTests++;
    throw new Error(message);
  } else {
    console.log(`✅ PASS: ${message}`);
    passedTests++;
  }
}

console.log('================================================================================');
console.log('POLARIS Milestone 2: Adversarial Drift Physics & Corridor Projection Challenge');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// SECTION 1: All 4 Icebergs Track Completeness & Continuity
// -----------------------------------------------------------------------------
console.log('--- SECTION 1: Track Completeness for C-19, B-15K, D-28, A-68R ---');
const targetBergs = ['C-19', 'B-15K', 'D-28', 'A-68R'];

targetBergs.forEach((id) => {
  const track = getSatelliteTrackForIceberg(id);
  assert(track !== null && track !== undefined, `Iceberg ${id} track exists in database`);
  assert(
    Array.isArray(track.observations) && track.observations.length >= 10,
    `Iceberg ${id} has multi-week observations (found ${track.observations?.length})`
  );
  assert(track.lastObservation !== undefined, `Iceberg ${id} has defined lastObservation`);
  assert(
    typeof track.lastObservation.lat === 'number' && typeof track.lastObservation.lon === 'number',
    `Iceberg ${id} lastObservation has valid coordinates`
  );

  // Check temporal monotonicity of historical track
  let prevTime = 0;
  track.observations.forEach((obs, idx) => {
    const t = new Date(obs.timestamp).getTime();
    assert(!isNaN(t), `Iceberg ${id} observation #${idx} has valid ISO timestamp`);
    assert(
      t >= prevTime,
      `Iceberg ${id} observation #${idx} (${obs.timestamp}) is monotonically ascending in time`
    );
    prevTime = t;
  });
});

// -----------------------------------------------------------------------------
// SECTION 2: Forward Corridor Direction & Non-Reversal (Scenario Playback Mode)
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 2: Corridor Forward Direction in Scenario Playback Mode ---');

scenarioData.icebergs.forEach((berg) => {
  const res = buildCorridorPoints(berg.id, berg, scenarioData);
  assert(res !== null, `Corridor generated for Iceberg ${berg.id}`);
  assert(res.points.length >= 3, `Corridor for ${berg.id} has >= 3 points (found ${res.points.length})`);

  // Verify Point 0 is latestObs and Point 1 is liveBerg
  assert(
    res.points[0].lat === res.latestObs.lat && res.points[0].lon === res.latestObs.lon,
    `Point 0 connects to latest observation for ${berg.id}`
  );
  assert(
    res.points[1].lat === berg.lat && res.points[1].lon === berg.lon,
    `Point 1 connects to live position for ${berg.id}`
  );

  // Check turning angles along predicted forward corridor (excluding zero-length initial segments)
  const nonZeroSegments = [];
  for (let i = 0; i < res.points.length - 1; i++) {
    const p1 = res.points[i];
    const p2 = res.points[i + 1];
    const dist = calculateDistanceKm(p1.lat, p1.lon, p2.lat, p2.lon);
    if (dist > 0.001) {
      const bearing = calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
      nonZeroSegments.push({ i, p1, p2, dist, bearing });
    }
  }

  assert(nonZeroSegments.length >= 2, `${berg.id} has at least 2 non-zero drift segments`);

  for (let s = 0; s < nonZeroSegments.length - 1; s++) {
    const segA = nonZeroSegments[s];
    const segB = nonZeroSegments[s + 1];
    const delta = bearingDelta(segA.bearing, segB.bearing);

    // Direction must not reverse (> 90 degrees turn is a reverse/hairpin)
    assert(
      delta < 90.0,
      `Corridor ${berg.id} segment ${segA.p1.label}->${segA.p2.label} (${segA.bearing.toFixed(1)}°) ` +
        `to ${segB.p1.label}->${segB.p2.label} (${segB.bearing.toFixed(1)}°) turning angle is ${delta.toFixed(1)}° < 90° (No reversal!)`
    );
  }
});

// -----------------------------------------------------------------------------
// SECTION 3: Forward Corridor Direction in Live Stream Mode (Dead Reckoning Fallback)
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 3: Corridor Forward Direction in Live Stream Mode ---');

targetBergs.forEach((id) => {
  // Simulate live iceberg incoming from WebSocket
  const mockLiveBerg = {
    id: id,
    lat: -67.42,
    lon: 41.15,
    driftSpeedKn: 0.42,
    driftHeadingDeg: 255.0,
    // Note: in realtime_service, projection6h is an object, not array
    projection6h: { lat: -67.44, lon: 41.05, distanceNm: 2.5, headingDeg: 255.0 }
  };

  const res = buildCorridorPoints(id, mockLiveBerg, scenarioData);
  assert(res !== null, `Live stream corridor generated for Iceberg ${id}`);
  assert(res.points.length === 6, `Live corridor has latestObs + live + 4 dead-reckoning steps (found ${res.points.length})`);

  // Check non-zero segments
  const nonZeroSegments = [];
  for (let i = 0; i < res.points.length - 1; i++) {
    const p1 = res.points[i];
    const p2 = res.points[i + 1];
    const dist = calculateDistanceKm(p1.lat, p1.lon, p2.lat, p2.lon);
    if (dist > 0.001) {
      const bearing = calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
      nonZeroSegments.push({ i, p1, p2, dist, bearing });
    }
  }

  // All dead reckoning steps (steps 1..4) should have identical or near-identical bearings
  for (let s = 1; s < nonZeroSegments.length - 1; s++) {
    const segA = nonZeroSegments[s];
    const segB = nonZeroSegments[s + 1];
    const delta = bearingDelta(segA.bearing, segB.bearing);
    assert(
      delta < 5.0,
      `Dead reckoning steps for ${id} maintain smooth straight corridor (delta: ${delta.toFixed(2)}°)`
    );
  }
});

// -----------------------------------------------------------------------------
// SECTION 4: Adversarial Edge Cases & Graceful Degradation
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 4: Adversarial Edge Cases & Malformed Inputs ---');

// Case 1: Empty observations array
{
  const res = buildCorridorPoints('C-19', { id: 'C-19', lat: -67.4, lon: 41.2 }, scenarioData, {
    icebergId: 'C-19',
    observations: []
  });
  assert(res === null, 'Gracefully handles empty observations array without throwing');
}

// Case 2: Null observations
{
  const res = buildCorridorPoints('C-19', { id: 'C-19', lat: -67.4, lon: 41.2 }, scenarioData, {
    icebergId: 'C-19',
    observations: null
  });
  assert(res === null, 'Gracefully handles null observations without throwing');
}

// Case 3: Completely missing satellite track
{
  const res = buildCorridorPoints('UNKNOWN_BERG', { id: 'UNKNOWN_BERG' }, scenarioData);
  assert(res === null, 'Gracefully handles unknown iceberg with no satellite track');
}

// Case 4: Missing lat/lon in liveBerg
{
  const res = buildCorridorPoints('C-19', { id: 'C-19' }, scenarioData);
  assert(res !== null, 'Falls back to latest observation coordinates if liveBerg lat/lon missing');
  assert(res.currentPos.lat === res.latestObs.lat, 'Uses latestObs.lat as fallback');
}

// Case 5: NaN in live coordinates
{
  const res = buildCorridorPoints('C-19', { id: 'C-19', lat: NaN, lon: 41.2 }, scenarioData);
  assert(res === null, 'Rejects NaN latitude gracefully without corrupting scene');
}

// Case 6: High latitude / Polar singularity (-89.9 degrees S)
{
  const polarBerg = {
    id: 'C-19',
    lat: -89.9,
    lon: 45.0,
    driftSpeedKn: 0.5,
    driftHeadingDeg: 180.0
  };
  const res = buildCorridorPoints('C-19', polarBerg, scenarioData);
  assert(res !== null, 'Handles near-pole coordinates (-89.9°S) without division by zero');
  res.points.forEach((pt, idx) => {
    assert(
      !isNaN(pt.lat) && !isNaN(pt.lon) && isFinite(pt.lat) && isFinite(pt.lon),
      `Point #${idx} near pole is finite and not NaN (lat: ${pt.lat}, lon: ${pt.lon})`
    );
  });
}

// Case 7: Zero drift speed
{
  const stationaryBerg = {
    id: 'C-19',
    lat: -67.4,
    lon: 41.2,
    driftSpeedKn: 0.0,
    driftHeadingDeg: 260.0
  };
  const res = buildCorridorPoints('C-19', stationaryBerg, scenarioData);
  assert(res !== null, 'Handles zero drift speed without crash');
  // All dead reckoning steps should collapse to live point
  res.points.slice(2).forEach((pt, idx) => {
    assert(
      pt.lat === stationaryBerg.lat && pt.lon === stationaryBerg.lon,
      `Step ${idx} with speed=0 collapses gracefully to current position`
    );
  });
}

// Case 8: Heading wrap-around boundaries (0°, 360°, 720°)
{
  [0.0, 360.0, 720.0, -90.0].forEach((h) => {
    const wrapBerg = {
      id: 'C-19',
      lat: -67.4,
      lon: 41.2,
      driftSpeedKn: 0.5,
      driftHeadingDeg: h
    };
    const res = buildCorridorPoints('C-19', wrapBerg, scenarioData);
    assert(res !== null, `Handles unusual heading ${h}° without error`);
    res.points.forEach((pt) => {
      assert(!isNaN(pt.lat) && !isNaN(pt.lon), `Heading ${h}° produces valid numbers`);
    });
  });
}

console.log('\n================================================================================');
console.log(`RESULTS: ${passedTests} passed, ${failedTests} failed`);
console.log('================================================================================');

if (failedTests > 0) {
  process.exit(1);
}
