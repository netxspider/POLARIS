/**
 * @module ui
 * @description Master UI & Style State Coordinator for POLARIS.
 * Ported and adapted from Gods-Eye-View (src/ui.js) for React + Cesium architecture.
 *
 * Coordinates:
 * - ECDIS palette post-processing stages (Normal/Day, Night, Radar SAR, Snow/Blizzard)
 * - Map imagery styles (Google Satellite HD, Google Hybrid, ESRI World Imagery)
 * - Camera motion, presets, and globe resets
 * - Audio-tactical cues, bloom/sharpen post-processing effects, and HUD state management
 */

import * as Cesium from 'cesium';
import { CAMERA_PRESETS, flyToPreset, flyToShipCamera } from './camera';

/**
 * Display labels shown in the mini-status readout for each active style.
 * Matches gods-eye-view STYLE_STATUS_LABELS exactly.
 */
export const STYLE_STATUS_LABELS = Object.freeze({
  normal: 'ECDIS DAY STANDARD',
  night: 'ECDIS NIGHT WATCH',
  radar: 'RADAR SAR ICE DISCRIMINATION',
  snow: 'POLAR BLIZZARD',
});

/**
 * Baseline post-processing settings applied on load.
 * Matches gods-eye-view GLOBAL_POST_DEFAULTS.
 */
export const GLOBAL_POST_DEFAULTS = Object.freeze({
  bloom: { enabled: false, intensity: 0.35 },
  sharpen: { enabled: true, intensity: 49 },
  hudVariant: 'tactical',
  hudVisible: true,
  detectionMode: 'DENSE',
  detectionDensity: 75,
  detectionAllocation: 'ELASTIC',
});

/**
 * Tactical Style Manager
 * Coordinates active post-process stages and transitions on Cesium Viewer.
 */
export class StyleManager {
  /**
   * @param {Cesium.Viewer} viewer - The CesiumJS viewer instance.
   * @param {object} [options]
   */
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.activeStyle = options.initialStyle || 'normal';
    this.stages = {};
    this.options = options;
    this._listeners = new Set();
  }

  /**
   * Register available post-process stages.
   * @param {Record<string, Cesium.PostProcessStage>} stageMap
   */
  registerStages(stageMap) {
    this.stages = stageMap || {};
  }

  /**
   * Subscribe to style changes.
   * @param {Function} callback
   * @returns {Function} unsubscribe
   */
  subscribe(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  /**
   * Get the active tactical style identifier.
   * @returns {string}
   */
  getStyle() {
    return this.activeStyle;
  }

  /**
   * Get human-readable label for current style.
   * @returns {string}
   */
  getStyleLabel() {
    return STYLE_STATUS_LABELS[this.activeStyle] || 'NORMAL';
  }

  /**
   * Activate a specific tactical post-processing stage.
   * @param {string} styleName - 'normal' | 'surveillance' | 'thermal' | 'retro' | 'snow'
   */
  setStyle(styleName) {
    if (this.activeStyle === styleName && this.stages[styleName]?.enabled) return;

    this.activeStyle = styleName;

    // Enable target stage and disable others
    Object.entries(this.stages).forEach(([name, stage]) => {
      if (stage) {
        stage.enabled = name === styleName;
      }
    });

    // Notify listeners
    this._listeners.forEach((cb) => cb(styleName, STYLE_STATUS_LABELS[styleName]));
  }

  /**
   * Reset camera back to synoptic global view directly over Antarctica.
   */
  resetGlobe() {
    if (!this.viewer || this.viewer.isDestroyed()) return;
    flyToPreset(this.viewer, 'orbitalGodsEye', 1.8);
  }

  /**
   * Fly directly to follow the research vessel RV Polar Explorer.
   * @param {Cesium.Entity} shipEntity
   */
  focusShip(shipEntity) {
    if (!this.viewer || this.viewer.isDestroyed() || !shipEntity) return;
    flyToShipCamera(this.viewer, shipEntity, {
      rangeM: 1600.0,
      pitchDeg: -22.0,
      duration: 1.5,
    });
  }

  /**
   * Fly to one of the canonical Antarctic operational locations.
   * @param {'maitri'|'bharati'|'polarCorridor'|'prydzBay'} locationKey
   */
  flyToLocation(locationKey) {
    if (!this.viewer || this.viewer.isDestroyed()) return;
    flyToPreset(this.viewer, locationKey);
  }

  /**
   * Clean up observers, timers, and listeners.
   */
  dispose() {
    this._listeners.clear();
    Object.values(this.stages).forEach((stage) => {
      if (stage && !this.viewer.isDestroyed()) {
        stage.enabled = false;
      }
    });
  }
}

/**
 * Singleton factory function to instantiate or access StyleManager.
 * @param {Cesium.Viewer} viewer
 * @param {object} [options]
 * @returns {StyleManager}
 */
export function initUI(viewer, options = {}) {
  return new StyleManager(viewer, options);
}
