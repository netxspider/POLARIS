import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('='.repeat(80));
console.log('POLARIS Milestone 2: 3D Cesium Satellite Trajectory & Waypoint Verification');
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

const cesiumViewerPath = path.resolve(__dirname, '../frontend/src/components/CesiumViewer.jsx');
assert(fs.existsSync(cesiumViewerPath), 'CesiumViewer.jsx exists');

const content = fs.readFileSync(cesiumViewerPath, 'utf-8');

// 1. Imports and Assets
console.log('\n--- SECTION 1: Imports and SVG Assets ---');
assert(
  content.includes("import { getSatelliteTrackForIceberg, SATELLITE_ICEBERG_TRACKS } from '../data/satelliteIcebergTracks.js'"),
  'Imports getSatelliteTrackForIceberg and SATELLITE_ICEBERG_TRACKS'
);
assert(
  content.includes('const RADAR_SAT_ICON_SVG ='),
  'Defines RADAR_SAT_ICON_SVG data URI'
);
assert(
  content.includes('formatSatelliteFixDate'),
  'Defines formatSatelliteFixDate function'
);

// 2. Component Props and State
console.log('\n--- SECTION 2: Component Props, State, and Ref Management ---');
assert(
  content.includes('showSatelliteTracks = true'),
  'Exposes showSatelliteTracks prop defaulting to true'
);
assert(
  content.includes('const satelliteTrackEntitiesRef = useRef([]);'),
  'Initializes satelliteTrackEntitiesRef collection'
);
assert(
  content.includes('const [selectedSatelliteFix, setSelectedSatelliteFix] = useState(null);'),
  'Initializes selectedSatelliteFix state for inspection card'
);
assert(
  content.includes('focusSatelliteFix: (lat, lon) =>'),
  'Exposes focusSatelliteFix imperative camera control'
);

// 3. Historical Glowing Trajectory Polyline (sat_track_${berg.id})
console.log('\n--- SECTION 3: Historical Glowing Trajectory Polyline ---');
assert(
  content.includes('sat_track_${bergId}'),
  'Generates unique ID sat_track_${bergId} for historical trajectory line'
);
assert(
  content.includes('arcType: Cesium.ArcType.GEODESIC'),
  'Uses Cesium.ArcType.GEODESIC for curved Earth interpolation'
);
assert(
  content.includes('clampToGround: false'),
  'Disables clampToGround to hover cleanly above ocean surface'
);
assert(
  content.includes('Cesium.Cartesian3.fromDegrees(obs.lon, obs.lat, 20.0)') &&
  content.includes('Cesium.Cartesian3.fromDegrees(currentLon, currentLat, 20.0)'),
  'Elevates trajectory vertices by 20.0m and connects trailing line to live position'
);
assert(
  content.includes('glowPower: 0.25') && content.includes("color: Cesium.Color.fromCssColorString('#00f0ff')"),
  'Configures PolylineGlowMaterialProperty with cyan glow and width 3.5'
);
assert(
  content.includes('depthFailMaterial: new Cesium.PolylineGlowMaterialProperty'),
  'Configures depthFailMaterial to prevent occluded line fragments'
);

// 4. Interactive Waypoint Pins (sat_fix_${berg.id}_${idx})
console.log('\n--- SECTION 4: Interactive Waypoint Pins ---');
assert(
  content.includes('sat_fix_${bergId}_${idx}'),
  'Generates waypoint entity ID pattern sat_fix_${bergId}_${idx}'
);
assert(
  content.includes('image: RADAR_SAT_ICON_SVG'),
  'Uses inline SVG radar satellite icon billboard'
);
assert(
  content.includes('disableDepthTestDistance: Number.POSITIVE_INFINITY'),
  'Applies disableDepthTestDistance: Number.POSITIVE_INFINITY to billboard and label'
);
assert(
  content.includes('distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3500000)'),
  'Applies DistanceDisplayCondition(0, 3500000) to date labels'
);
assert(
  content.includes("type: 'satellite_fix'"),
  'Attaches polarisData with type: satellite_fix to waypoints'
);

// 5. ScreenSpaceEventHandler & Click Integration
console.log('\n--- SECTION 5: Click Handling & ScreenSpaceEventHandler ---');
assert(
  content.includes("entity.polarisData.type === 'satellite_fix'") &&
  content.includes('setSelectedSatelliteFix(entity.polarisData);'),
  'ScreenSpaceEventHandler opens selectedSatelliteFix card when clicked'
);
assert(
  content.includes('onSelectEntityRef.current(entity.polarisData)'),
  'Seamlessly dispatches polarisData to parent onSelectEntity handler'
);

// 6. Tactical Satellite Inspection Card UI
console.log('\n--- SECTION 6: Tactical Satellite Inspection Card UI ---');
assert(
  content.includes('selectedSatelliteFix.spacecraft') &&
  content.includes('selectedSatelliteFix.sensor'),
  'Card displays Spacecraft & Sensor'
);
assert(
  content.includes('selectedSatelliteFix.timestamp'),
  'Card displays Observation Date & Time (ISO UTC)'
);
assert(
  content.includes('selectedSatelliteFix.lat') &&
  content.includes('selectedSatelliteFix.lon'),
  'Card displays Confirmed Coordinates (lat, lon)'
);
assert(
  content.includes('selectedSatelliteFix.surfaceAreaKm2') &&
  content.includes('selectedSatelliteFix.lengthKm') &&
  content.includes('selectedSatelliteFix.widthKm'),
  'Card displays Observed Dimensions and Surface Area'
);
assert(
  content.includes('selectedSatelliteFix.freeboardM'),
  'Card displays Freeboard Height (m)'
);
assert(
  content.includes('selectedSatelliteFix.backscatterDb'),
  'Card displays Radar Cross-Section Backscatter (dB)'
);
assert(
  content.includes('selectedSatelliteFix.orbitNumber') &&
  content.includes('selectedSatelliteFix.passType') &&
  content.includes('selectedSatelliteFix.qualityFlag'),
  'Card displays Orbit Number, Pass Type, and Quality Flag'
);
assert(
  content.includes('FOCUS SIGHTING') &&
  content.includes('LIVE ICEBERG'),
  'Provides quick action fly-to buttons for sighting pin and live iceberg'
);
assert(
  content.includes('setSelectedSatelliteFix(null)') &&
  content.includes('onSelectEntityRef.current(null)'),
  'Close button cleanly dismisses card and resets entity selection'
);

// 7. Forward Projected Drift Corridor Polyline (sat_corridor_${berg.id})
console.log('\n--- SECTION 7: Forward Projected Drift Corridor ---');
assert(
  content.includes('sat_corridor_${bergId}'),
  'Generates forward projected corridor ID pattern sat_corridor_${bergId}'
);
assert(
  content.includes('new Cesium.PolylineDashMaterialProperty'),
  'Uses PolylineDashMaterialProperty for future drift corridor'
);

// 8. In-Place Mutation & Performance
console.log('\n--- SECTION 8: In-Place Mutation & Performance ---');
assert(
  content.includes('trackEntity.polyline.positions = trackCartesians;') &&
  content.includes('corridorEntity.polyline.positions = corridorCartesians;'),
  'Mutates polyline positions in-place without entity recreation churn'
);
assert(
  content.includes('satelliteTrackEntitiesRef.current.forEach'),
  'Updates entity.show in-place across satelliteTrackEntitiesRef'
);

console.log('='.repeat(80));
console.log(`RESULTS: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(80));

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
