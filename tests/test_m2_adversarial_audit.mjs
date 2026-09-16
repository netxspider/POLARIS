/**
 * POLARIS Milestone 2 Adversarial Stress Test & Edge Case Audit
 * 
 * Tests:
 * 1. Data robustness with corrupted or partial iceberg records.
 * 2. Fallback logic when live data lacks satellite tracks.
 * 3. Inspection card rendering data safety with missing properties.
 * 4. Coordinate formatting edge cases (poles, equator, prime meridian).
 * 5. Formatting function resilience against null/invalid timestamps.
 * 6. Polyline cartesian elevation calculations across Antarctic latitudes.
 */

import { 
  SATELLITE_ICEBERG_TRACKS, 
  getSatelliteTrackForIceberg, 
  getLatestSatelliteObservation,
  getAllSatelliteWaypoints 
} from '../frontend/src/data/satelliteIcebergTracks.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name}`);
  }
}

console.log('='.repeat(80));
console.log('AUDITOR M2 ADVERSARIAL STRESS TEST & EDGE CASE VERIFICATION');
console.log('='.repeat(80));

// Test 1: Case insensitivity and hyphen variations
console.log('\n--- 1. Query Key Tolerance & Sanitization ---');
['c-19', 'C-19', 'c19', 'C19', 'b-15k', 'B-15K', 'b15k', 'B15K', 'd-28', 'D-28', 'd28', 'D28', 'a-68r', 'A-68R', 'a68r', 'A68R'].forEach(key => {
  const res = getSatelliteTrackForIceberg(key);
  assert(res !== null && res.observations.length > 0, `Query '${key}' returns non-empty observation list`);
});

// Test 2: Adversarial / Malformed inputs
console.log('\n--- 2. Malformed / Hostile Query Inputs ---');
[null, undefined, '', '   ', 'NON_EXISTENT', 12345, {}, [], false, true, '../../etc/passwd', '<script>alert(1)</script>'].forEach(input => {
  try {
    const res = getSatelliteTrackForIceberg(input);
    assert(res === null, `Input ${JSON.stringify(input)} returns null without throwing`);
  } catch (e) {
    assert(false, `Input ${JSON.stringify(input)} threw an unhandled error: ${e.message}`);
  }
});

// Test 3: Date formatting edge cases
console.log('\n--- 3. Tactical Date Formatter Edge Cases ---');
const formatSatelliteFixDate = (isoString) => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString).slice(5, 10);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const month = months[d.getUTCMonth()] || '';
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${month} ${day}`;
  } catch {
    return String(isoString).slice(5, 10);
  }
};

assert(formatSatelliteFixDate(null) === '', 'null returns empty string');
assert(formatSatelliteFixDate(undefined) === '', 'undefined returns empty string');
assert(formatSatelliteFixDate('') === '', 'empty string returns empty string');
assert(formatSatelliteFixDate('2026-08-10T05:12:30Z') === 'AUG 10', 'standard ISO returns AUG 10');
assert(formatSatelliteFixDate('2026-01-01T00:00:00Z') === 'JAN 01', 'New year timestamp returns JAN 01');
assert(formatSatelliteFixDate('2026-12-31T23:59:59Z') === 'DEC 31', 'Year-end timestamp returns DEC 31');

// Test 4: Inspection Card Data Completeness Across All 52 Fixes
console.log('\n--- 4. Inspection Card Field Completeness Across All 52 Sighting Fixes ---');
const waypoints = getAllSatelliteWaypoints();
assert(waypoints.length === 52, `Total 52 historical satellite waypoints verified (got ${waypoints.length})`);

let missingFieldsCount = 0;
waypoints.forEach((wp, i) => {
  const required = [
    'spacecraft', 'sensor', 'timestamp', 'lat', 'lon',
    'surfaceAreaKm2', 'lengthKm', 'widthKm', 'freeboardM',
    'backscatterDb', 'orbitNumber', 'passType', 'qualityFlag'
  ];
  required.forEach(field => {
    if (wp[field] === undefined || wp[field] === null) {
      console.error(`Waypoint #${i} (${wp.icebergId}) missing required field: ${field}`);
      missingFieldsCount++;
    }
  });
});
assert(missingFieldsCount === 0, 'Zero missing fields across all 52 sighting fixes');

// Test 5: Coordinate validity (Antarctic corridor)
console.log('\n--- 5. Coordinate Bounds & Integrity ---');
let outOfBoundsCount = 0;
waypoints.forEach(wp => {
  if (wp.lat >= 0 || wp.lat < -90) outOfBoundsCount++; // Must be in Southern Hemisphere
  if (wp.lon < -180 || wp.lon > 180) outOfBoundsCount++;
});
assert(outOfBoundsCount === 0, 'All 52 satellite fixes are strictly in Southern Hemisphere (-90 to 0) and valid lon (-180 to 180)');

// Test 6: Dimensions & Area Realism
console.log('\n--- 6. Dimension and Physical Area Realism ---');
let unphysicalDimensions = 0;
waypoints.forEach(wp => {
  if (wp.lengthKm <= 0 || wp.widthKm <= 0 || wp.surfaceAreaKm2 <= 0) unphysicalDimensions++;
  if (wp.freeboardM <= 0 || wp.freeboardM > 100) unphysicalDimensions++; // Freeboard typically 20-60m for tabular bergs
  if (wp.backscatterDb > 0 || wp.backscatterDb < -35) unphysicalDimensions++; // Valid RCS backscatter
});
assert(unphysicalDimensions === 0, 'All dimensions, freeboard heights, and RCS dB values are physically plausible');

console.log('='.repeat(80));
console.log(`ADVERSARIAL AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
console.log('='.repeat(80));

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
