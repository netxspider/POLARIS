/**
 * @module vesselLabels
 * @description AIS vessel type formatting, tactical color mapping, and shared
 * world-overlay policy from gods-eye-view open source project.
 */

export const VESSEL_OVERLAY_SOURCE_ID = 'ais-live-vessels';
/** Existing selector grid size; one ambient winner is retained per cell. */
export const VESSEL_LABEL_GRID_PX = 118;
/** Existing environment-default ceiling for ambient vessel rows. */
export const VESSEL_DEFAULT_LABEL_LIMIT = 900;
/** Existing configured absolute ceiling; viewport grid demand is usually lower. */
export const VESSEL_OVERLAY_MAX_COHORT = VESSEL_DEFAULT_LABEL_LIMIT;
/** Existing ambient vessel-card distance fade reaches zero at 5000 km. */
export const VESSEL_CARD_FADE_DISTANCE_M = 5_000_000;

/**
 * AIS type family -> chevron hue + card accent. Single source of truth for
 * vessel type colors so billboard chevrons and host cards cannot drift apart.
 */
const TYPE_STYLES = [
  { pattern: /tanker/i, css: '#ffb347', accent: '255, 179, 71', hex: '#ffb347' },
  { pattern: /cargo|container|bulk|carrier/i, css: '#39d5ff', accent: '57, 213, 255', hex: '#39d5ff' },
  { pattern: /passenger|ferry|cruise/i, css: '#ff7adf', accent: '255, 122, 223', hex: '#ff7adf' },
  { pattern: /fishing/i, css: '#7cff9b', accent: '124, 255, 155', hex: '#7cff9b' },
  { pattern: /tug|tow|pilot|supply|service/i, css: '#f7f0a3', accent: '247, 240, 163', hex: '#f7f0a3' },
  { pattern: /research|icebreaker|polar/i, css: '#00f0ff', accent: '0, 240, 255', hex: '#00f0ff' },
];
const DEFAULT_STYLE = { css: '#39d5ff', accent: '57, 213, 255', hex: '#39d5ff' };

const NUMERIC_TYPE_SPECIALS = {
  30: 'FISHING', 31: 'TOWING', 32: 'TOWING', 33: 'DREDGER', 34: 'DIVE OPS',
  35: 'MILITARY', 36: 'SAILING', 37: 'PLEASURE',
  50: 'PILOT', 51: 'SAR', 52: 'TUG', 53: 'PORT TENDER', 54: 'ANTI-POLLUTION',
  55: 'LAW ENFORCE', 58: 'MEDICAL',
};
const NUMERIC_TYPE_FAMILIES = {
  4: 'HIGH-SPEED', 6: 'PASSENGER', 7: 'CARGO', 8: 'TANKER', 9: 'OTHER',
};

/**
 * Resolve an AIS type to display text: bare numeric ship-type codes map to
 * family names ("71" -> "CARGO"); text types pass through unchanged.
 * @param {string|number} type Raw AIS type.
 * @returns {string}
 */
export function normalizeVesselType(type) {
  const text = String(type || '').trim();
  if (!text || !/^\d{1,2}$/.test(text)) return text;
  const code = Number(text);
  if (code <= 0) return '';
  if (NUMERIC_TYPE_SPECIALS[code]) return NUMERIC_TYPE_SPECIALS[code];
  return NUMERIC_TYPE_FAMILIES[Math.floor(code / 10)] || 'OTHER';
}

/** AIS ship type -> CSS hex hue for the billboard chevron / icon. */
export function vesselTypeCss(type) {
  return styleForType(type).css;
}

/** AIS ship type -> "r, g, b" accent string for the host card. */
export function accentForVesselType(type) {
  return styleForType(type).accent;
}

/** AIS ship type -> hex color string. */
export function vesselColorHex(type) {
  return styleForType(type).hex;
}

function styleForType(type) {
  const text = normalizeVesselType(type);
  return TYPE_STYLES.find((entry) => entry.pattern.test(text)) || DEFAULT_STYLE;
}

/**
 * Derive the source's ambient cohort from the viewport grid.
 * @param {number} width CSS viewport width.
 * @param {number} height CSS viewport height.
 * @param {number} [rowLimit=900] Configured source row ceiling.
 * @returns {number}
 */
export function vesselOverlayCohortLimit(width, height, rowLimit = VESSEL_DEFAULT_LABEL_LIMIT) {
  const w = Number(width);
  const h = Number(height);
  const requested = Number(rowLimit);
  if (!(w > 0) || !(h > 0) || !(requested > 0)) return 0;
  const gridCapacity = Math.ceil(w / VESSEL_LABEL_GRID_PX) * Math.ceil(h / VESSEL_LABEL_GRID_PX);
  return Math.min(VESSEL_OVERLAY_MAX_COHORT, Math.floor(requested), gridCapacity);
}

/**
 * Add host-owned layout, fade, collision and paint-lane fields to a formatted
 * vessel card. Ambient and selected cards share `ambient-card`.
 * @param {Object} card Source-formatted vessel card.
 * @param {number} [fadeDistance=5000000] Ambient distance-fade endpoint.
 * @returns {Object}
 */
export function applyVesselOverlayPolicy(card, fadeDistance = VESSEL_CARD_FADE_DISTANCE_M) {
  const selected = card?.selected === true;
  const rawGap = Number(card?.gapPx) || 10;
  const gapPx = Math.max(12, rawGap + 8);
  return {
    ...card,
    variant: selected ? 'selected' : 'card',
    protected: selected,
    collisionGroup: 'ambient-card',
    cardStyle: 'tactical',
    gapPx,
    leaderOffsetPx: Math.max(2, gapPx - 6),
    verticalOnly: true,
    viewportMargin: 4,
    maxDistance: selected ? Number.POSITIVE_INFINITY : fadeDistance,
    distanceFadeStartRatio: 0.7,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    interactive: card?.actionable === true,
  };
}

/**
 * Formats speed in knots with unit string.
 * @param {number} knots
 * @returns {string} e.g. "14.2 kn"
 */
export function formatSpeed(knots) {
  if (!Number.isFinite(Number(knots)) || knots < 0) return '-- kn';
  return `${Number(knots).toFixed(1)} kn`;
}

/**
 * Build tactical card data for a vessel entity.
 * @param {Object} record - Vessel telemetry record.
 * @param {boolean} [selected=false] - Whether this card is for the selected vessel.
 * @returns {Object}
 */
export function buildVesselCardData(record, selected = false) {
  const normType = normalizeVesselType(record.type || record.vesselType || 'RESEARCH');
  const speed = record.speedKn ?? record.speed ?? 14.0;
  const heading = record.headingDeg ?? record.heading ?? 84.0;
  const accent = vesselTypeCss(normType);

  const details = [
    `${normType} · ${formatSpeed(speed)} · ${Math.round(heading)}°`,
  ];
  if (record.destination) {
    details.push(`-> ${record.destination}`);
  }
  if (record.mmsi) {
    details.push(`MMSI ${record.mmsi}`);
  }

  return {
    id: record.id || `vessel_${record.mmsi || 'polar'}`,
    name: record.name || 'VESSEL',
    type: 'ship',
    vesselType: normType,
    accent,
    color: accent,
    speedKn: speed,
    headingDeg: heading,
    lat: record.lat,
    lon: record.lon,
    details,
    selected,
    description: record.description || `${normType} operational vessel tracking in the polar maritime corridor.`,
  };
}
