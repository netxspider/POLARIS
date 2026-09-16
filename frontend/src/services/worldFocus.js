/**
 * One-click camera transfer & focus management for layer-owned world targets.
 * Ported from gods-eye-view/src/worldFocus.js for polar vessels, ice hazards,
 * research stations, and orbital sensors.
 */
import * as Cesium from 'cesium';

export const WORLD_FOCUS_REQUEST_EVENT = 'polaris:world-request-focus';
export const WORLD_CLICK_FOCUS_DURATION_SEC = 2.0;

export const WORLD_FOCUS_FRAMING = Object.freeze({
  vessel: Object.freeze({ radiusM: 180, rangeM: 1600, pitchDeg: -28 }),
  iceberg: Object.freeze({ radiusM: 500, rangeM: 4500, pitchDeg: -32 }),
  station: Object.freeze({ radiusM: 350, rangeM: 6000, pitchDeg: -35 }),
  satellite: Object.freeze({ radiusM: 2000, rangeM: 45000, pitchDeg: -45 }),
  bathymetry: Object.freeze({ radiusM: 400, rangeM: 5000, pitchDeg: -40 }),
  hazard: Object.freeze({ radiusM: 600, rangeM: 5200, pitchDeg: -30 })
});

/** Validate a layer-owned focus target before camera policy can release tracking. */
export function isValidWorldFocusTarget(detail) {
  if (!detail) return false;
  const kind = detail.kind || detail.type;
  if (!WORLD_FOCUS_FRAMING[kind]) return false;
  if (!String(detail.id || detail.name || '').trim()) return false;

  let pos = detail.position;
  if (!pos && detail.lat !== undefined && detail.lon !== undefined) {
    const alt = detail.altitudeM || (kind === 'satellite' ? 700000 : 0);
    pos = Cesium.Cartesian3.fromDegrees(detail.lon, detail.lat, alt);
    detail.position = pos;
  }

  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
    return false;
  }

  const magnitude = Cesium.Cartesian3.magnitude(pos);
  return Number.isFinite(magnitude) && magnitude >= Cesium.Ellipsoid.WGS84.minimumRadius * 0.9;
}

/** Announce a valid user-click focus request across components. */
export function requestWorldFocus(detail, eventTarget = globalThis.window) {
  if (!isValidWorldFocusTarget(detail)) return false;
  if (typeof eventTarget?.dispatchEvent !== 'function') return false;
  eventTarget.dispatchEvent(new CustomEvent(WORLD_FOCUS_REQUEST_EVENT, { detail }));
  return true;
}

/** Register one listener and return an idempotent disposer. */
export function registerWorldFocusRequestListener(eventTarget, listener) {
  if (!eventTarget?.addEventListener || !eventTarget?.removeEventListener || typeof listener !== 'function') {
    return () => {};
  }
  eventTarget.addEventListener(WORLD_FOCUS_REQUEST_EVENT, listener);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    eventTarget.removeEventListener(WORLD_FOCUS_REQUEST_EVENT, listener);
  };
}

/** Route a valid request through the UI-owned camera policy. */
export function routeWorldFocusRequest(event, runExplicitFocus, fly) {
  const detail = event?.detail;
  if (!isValidWorldFocusTarget(detail)) return false;
  if (typeof runExplicitFocus !== 'function' || typeof fly !== 'function') return false;
  return runExplicitFocus(detail, () => fly(detail));
}

/** Fly to a world target with target-appropriate framing distance, angle, and easing. */
export function flyToWorldTarget(viewer, target = {}) {
  const camera = viewer?.camera;
  const kind = target.kind || target.type;
  const framing = WORLD_FOCUS_FRAMING[kind] || WORLD_FOCUS_FRAMING.vessel;
  if (!camera || !isValidWorldFocusTarget(target)) return false;

  const heading = Number.isFinite(camera.heading) ? camera.heading : 0;
  const duration = target.durationSec > 0 ? target.durationSec : WORLD_CLICK_FOCUS_DURATION_SEC;

  viewer.trackedEntity = undefined;
  camera.cancelFlight?.();
  camera.flyToBoundingSphere(
    new Cesium.BoundingSphere(target.position, framing.radiusM),
    {
      offset: new Cesium.HeadingPitchRange(
        heading,
        Cesium.Math.toRadians(framing.pitchDeg),
        framing.rangeM,
      ),
      duration,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    }
  );
  return true;
}
