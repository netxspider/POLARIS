import React, { useState, useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import {
  normalizeVesselType,
  vesselTypeCss,
  accentForVesselType,
  vesselColorHex,
  formatSpeed,
  buildVesselCardData,
} from '../services/vesselLabels';
import { getSatelliteTrackForIceberg } from '../data/satelliteIcebergTracks.js';

/**
 * Tactical Theme Color Map (Identical to IntelHUD & Gods-Eye-View palettes)
 */
const TACTICAL_THEMES = {
  night: {
    accent: '#fbbf24',
    glow: 'rgba(251, 191, 36, 0.5)',
    cardBg: 'rgba(24, 16, 4, 0.92)',
    border: 'rgba(251, 191, 36, 0.6)',
    tagBg: 'rgba(251, 191, 36, 0.18)',
    modeLabel: 'ECDIS NIGHT TARGET'
  },
  radar: {
    accent: '#34d399',
    glow: 'rgba(52, 211, 153, 0.5)',
    cardBg: 'rgba(4, 24, 16, 0.92)',
    border: 'rgba(52, 211, 153, 0.6)',
    tagBg: 'rgba(52, 211, 153, 0.18)',
    modeLabel: 'RADAR SAR CONTACT'
  },
  snow: {
    accent: '#7dd3fc',
    glow: 'rgba(125, 211, 252, 0.6)',
    cardBg: 'rgba(4, 18, 30, 0.92)',
    border: 'rgba(125, 211, 252, 0.65)',
    tagBg: 'rgba(125, 211, 252, 0.2)',
    modeLabel: 'POLAR BLIZZARD'
  },
  normal: {
    accent: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.5)',
    cardBg: 'rgba(8, 15, 26, 0.92)',
    border: 'rgba(56, 189, 248, 0.55)',
    tagBg: 'rgba(56, 189, 248, 0.18)',
    modeLabel: 'ECDIS DAY TARGET'
  }
};

/**
 * TacticalEntityOverlay
 * 
 * Implements the full God's Eye View multi-entity tactical overlay system:
 * 1. Ambient Detection Brackets & Callouts:
 *    - Visible across operational and orbital views (camera altitude <= 25,000 km),
 *      revealing full tactical corner brackets and callout badges for all contacts.
 *    - Clean typography: removed vertical green/color pill ticks.
 * 2. Focused Tracked Target Readout Card (when an entity is clicked or tracked):
 *    - Displays immediately in place at current zoom/camera level without forcing camera zoom.
 *    - Anchored cleanly with high-precision leader line, speed, altitude/draft, and description.
 */
export default function TacticalEntityOverlay({
  viewerRef,
  selectedEntity,
  onSelectEntity,
  onClose,
  tacticalStyle = 'normal',
  telemetry,
  scenarioData,
  streamMode = 'live',
  liveData = null,
  liveIcebergs = null,
  liveVessels = null,
  activeOverpass = null,
  isDrawerOpen = false
}) {
  const [activeScreenPos, setActiveScreenPos] = useState(null);
  const [ambientTargets, setAmbientTargets] = useState([]);
  const theme = TACTICAL_THEMES[tacticalStyle] || TACTICAL_THEMES.normal;

  useEffect(() => {
    if (!viewerRef?.current) return;

    const viewer = viewerRef.current.getViewer?.() || viewerRef.current._viewer;
    if (!viewer || viewer.isDestroyed()) return;

    const scene = viewer.scene;
    const scratch2D = new Cesium.Cartesian2();
    const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, scene.camera.positionWC);

    const updateProjection = () => {
      const cameraHeight = scene.camera.positionCartographic.height;
      // Ambient detection brackets & callouts visible across normal and regional view ranges
      const showAmbient = cameraHeight <= 25000000;

      // 1. Project Selected Active Entity (if any - always visible if on screen)
      let activePos = null;
      if (selectedEntity) {
        let cartesian = null;
        if (selectedEntity.type === 'ship') {
          const shipEntity = viewer.entities.getById('vessel_ship');
          if (shipEntity && shipEntity.position) {
            cartesian = shipEntity.position.getValue(viewer.clock.currentTime);
          }
        }
        if (!cartesian && selectedEntity.lat !== undefined && selectedEntity.lon !== undefined) {
          const alt = selectedEntity.altitudeM || (selectedEntity.type === 'satellite' ? 700000 : 50);
          cartesian = Cesium.Cartesian3.fromDegrees(selectedEntity.lon, selectedEntity.lat, alt);
        }

        if (cartesian && occluder.isPointVisible(cartesian)) {
          const camPos = scene.camera.positionWC;
          const camDir = scene.camera.directionWC;
          const toPoint = Cesium.Cartesian3.subtract(cartesian, camPos, new Cesium.Cartesian3());
          if (Cesium.Cartesian3.dot(toPoint, camDir) > 0) {
            const winCoord = Cesium.SceneTransforms.worldToWindowCoordinates(scene, cartesian, scratch2D);
            if (winCoord) {
              activePos = { x: Math.round(winCoord.x), y: Math.round(winCoord.y) };
            }
          }
        }
      }
      setActiveScreenPos(activePos);

      // 2. Project Ambient Detectable Entities (Only if zoomed in)
      if (!showAmbient) {
        setAmbientTargets([]);
        return;
      }

      const targets = [];
      const camPos = scene.camera.positionWC;
      const camDir = scene.camera.directionWC;
      const toPt = new Cesium.Cartesian3();

      const checkAndProject = (item) => {
        let cPos = null;
        if (item.type === 'ship') {
          const shipEntity = viewer.entities.getById('vessel_ship');
          if (shipEntity && shipEntity.position) {
            cPos = shipEntity.position.getValue(viewer.clock.currentTime);
          }
        } else if (item.lat !== undefined && item.lon !== undefined) {
          const alt = item.altM ?? 50;
          cPos = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, alt);
        }

        if (!cPos) return null;
        if (!occluder.isPointVisible(cPos)) return null;

        Cesium.Cartesian3.subtract(cPos, camPos, toPt);
        if (Cesium.Cartesian3.dot(toPt, camDir) <= 0) return null;

        const p2d = Cesium.SceneTransforms.worldToWindowCoordinates(scene, cPos, scratch2D);
        if (!p2d) return null;

        const sx = Math.round(p2d.x);
        const sy = Math.round(p2d.y);

        // Screen boundary filter
        if (sx < 40 || sx > window.innerWidth - 40 || sy < 60 || sy > window.innerHeight - 80) {
          return null;
        }

        return { sx, sy };
      };

      // A. Ship Entity (Vessel / Research Icebreaker)
      if (selectedEntity?.type !== 'ship') {
        const shipP = checkAndProject({ type: 'ship' });
        if (shipP) {
          const shipSpeed = telemetry ? telemetry.speedKn : 14.0;
          const shipHeading = telemetry ? telemetry.heading : 84.0;
          const vesselCard = buildVesselCardData({
            id: 'vessel_ship',
            name: 'RV Polar Explorer',
            type: 'research',
            speedKn: shipSpeed,
            headingDeg: shipHeading,
            lat: telemetry?.lat ?? -70.77,
            lon: telemetry?.lon ?? 11.73,
            destination: 'BHARATI STATION',
            mmsi: '419001234',
            description: 'Flagship polar research vessel equipped with ice-strengthened hull, multibeam bathymetric sonar, CTD rosette winches, and meteorological radar.'
          });

          targets.push({
            id: 'ship',
            primary: 'RV POLAR EXPLORER',
            micro: formatSpeed(shipSpeed),
            sub: normalizeVesselType('research'),
            x: shipP.sx,
            y: shipP.sy,
            boxW: 38,
            boxH: 30,
            color: vesselCard.accent || '#39d5ff',
            raw: vesselCard
          });
        }
      }

      // B. Icebergs (C-19, B-15K, D-28, A-68R)
      const bergs = scenarioData?.isModelRoute
        ? (scenarioData.icebergs || [])
        : (liveIcebergs || scenarioData?.icebergs || []);
      bergs.forEach((berg) => {
        if (selectedEntity?.id === berg.id) return;
        const p = checkAndProject({ lat: berg.lat, lon: berg.lon, altM: 50 });
        if (p) {
          const bSpeed = (berg.driftSpeedKn ?? berg.speedKn ?? 0.3).toFixed(1);
          targets.push({
            id: `iceberg_${berg.id}`,
            primary: berg.id,
            micro: `${bSpeed} KTS`,
            sub: 'TABULAR BERG',
            x: p.sx,
            y: p.sy,
            boxW: 34,
            boxH: 26,
            color: berg.id === 'C-19' ? '#ff6b6b' : '#ffb547',
            raw: {
              ...berg,
              type: 'iceberg',
              id: berg.id,
              name: `Iceberg ${berg.id}`,
              subtitle: 'Tracked Antarctic Tabular Iceberg',
              description: `Drifting iceberg ${berg.id} tracked via Sentinel-1 SAR Radar satellite imagery and LSTM trajectory physics equations.`
            }
          });
        }
      });

      // B2. Southern Ocean Active AIS Vessels
      const vessels = scenarioData?.isModelRoute
        ? (scenarioData.vessels || [])
        : (liveVessels || scenarioData?.vessels || []);
      vessels.forEach((v) => {
        if (!v.mmsi || selectedEntity?.id === `vessel_${v.mmsi}` || selectedEntity?.mmsi === v.mmsi) return;
        const p = checkAndProject({ lat: v.lat, lon: v.lon, altM: 50 });
        if (p) {
          const vSpeed = formatSpeed(v.speedKn || v.speed || 10.0);
          const vesselCard = buildVesselCardData({
            id: `vessel_${v.mmsi}`,
            name: v.name,
            type: v.type || 'cargo',
            speedKn: v.speedKn || v.speed || 10.0,
            headingDeg: v.headingDeg || v.heading || v.course || 90.0,
            lat: v.lat,
            lon: v.lon,
            destination: v.destination || 'Antarctic Station',
            mmsi: v.mmsi,
            description: `Active Southern Ocean vessel ${v.name} (MMSI: ${v.mmsi}). SOG: ${v.speedKn || 10} kn, Destination: ${v.destination || 'Antarctic Station'}. Tracked via AISStream.`
          });

          targets.push({
            id: `ais_${v.mmsi}`,
            primary: v.name?.toUpperCase() || `MMSI ${v.mmsi}`,
            micro: vSpeed,
            sub: normalizeVesselType(v.type || 'cargo'),
            x: p.sx,
            y: p.sy,
            boxW: 38,
            boxH: 30,
            color: vesselCard.accent || '#38bdf8',
            raw: vesselCard
          });
        }
      });

      // C. Antarctic Stations (Maitri, Bharati, Novolazarevskaya, etc.)
      const STATIONS = [
        { id: 'maitri', name: 'MAITRI 🇮🇳', lat: -70.77, lon: 11.73, sub: 'IN BASE' },
        { id: 'bharati', name: 'BHARATI 🇮🇳', lat: -69.41, lon: 76.19, sub: 'IN BASE' },
        { id: 'novolazarevskaya', name: 'NOVO 🇷🇺', lat: -70.78, lon: 11.83, sub: 'RU BASE' },
        { id: 'syowa', name: 'SYOWA 🇯🇵', lat: -69.00, lon: 39.58, sub: 'JP BASE' },
        { id: 'progress', name: 'PROGRESS 🇷🇺', lat: -69.37, lon: 76.38, sub: 'RU BASE' },
        { id: 'davis', name: 'DAVIS 🇦🇺', lat: -68.58, lon: 77.97, sub: 'AU BASE' }
      ];

      STATIONS.forEach((st) => {
        if (selectedEntity?.id === st.id) return;
        const p = checkAndProject({ lat: st.lat, lon: st.lon, altM: 100 });
        if (p) {
          targets.push({
            id: `station_${st.id}`,
            primary: st.name,
            micro: 'SURFACE',
            sub: st.sub,
            x: p.sx,
            y: p.sy,
            boxW: 32,
            boxH: 24,
            color: '#5dff9f',
            raw: {
              type: 'station',
              id: st.id,
              name: st.name,
              subtitle: `${st.sub} • Research Base`,
              lat: st.lat,
              lon: st.lon,
              description: `Permanent Antarctic research station supporting polar atmospheric and geological sciences.`
            }
          });
        }
      });

      // D. Polar Earth Observation Satellites
      const SATS = [
        { noradId: 39634, name: 'SENTINEL-1A', altKm: 693, color: '#00f0ff', sensor: 'C-SAR' },
        { noradId: 36508, name: 'CRYOSAT-2', altKm: 717, color: '#39ff14', sensor: 'SIRAL' },
        { noradId: 43613, name: 'ICESAT-2', altKm: 496, color: '#facc15', sensor: 'ATLAS' },
        { noradId: 27424, name: 'AQUA (AMSR2)', altKm: 705, color: '#ec4899', sensor: 'AMSR' },
        { noradId: 49260, name: 'LANDSAT 9', altKm: 705, color: '#a855f7', sensor: 'OLI-2' }
      ];

      SATS.forEach((sat) => {
        const satEntity = viewer.entities.getById(`sat_${sat.noradId}`);
        if (satEntity && satEntity.position) {
          const cPos = satEntity.position.getValue(viewer.clock.currentTime);
          if (cPos && occluder.isPointVisible(cPos)) {
            Cesium.Cartesian3.subtract(cPos, camPos, toPt);
            if (Cesium.Cartesian3.dot(toPt, camDir) > 0) {
              const p2d = Cesium.SceneTransforms.worldToWindowCoordinates(scene, cPos, scratch2D);
              if (p2d) {
                const sx = Math.round(p2d.x);
                const sy = Math.round(p2d.y);
                if (sx >= 40 && sx <= window.innerWidth - 40 && sy >= 60 && sy <= window.innerHeight - 80) {
                  targets.push({
                    id: `sat_${sat.noradId}`,
                    primary: sat.name,
                    micro: `FL${Math.round(sat.altKm * 32.8)}`,
                    sub: sat.sensor,
                    x: sx,
                    y: sy,
                    boxW: 30,
                    boxH: 22,
                    color: sat.color,
                    raw: {
                      type: 'satellite',
                      name: sat.name,
                      subtitle: `Orbital Sensor • ${sat.sensor}`,
                      description: `Reconnaissance polar satellite operating at ${sat.altKm} km altitude.`
                    }
                  });
                }
              }
            }
          }
        }
      });

      // Decollide label cards so they don't overlap when clustered
      targets.forEach((tgt, idx) => {
        const stagger = (idx % 3) * 18;
        tgt.leadY = tgt.y - (tgt.boxH / 2) - 24 - stagger;
        tgt.leadX = tgt.x + 16;
      });

      setAmbientTargets(targets);
    };

    updateProjection();
    const removeListener = scene.postRender.addEventListener(updateProjection);

    return () => {
      if (removeListener) removeListener();
    };
  }, [selectedEntity, viewerRef, scenarioData, telemetry]);

  // Render Selected Entity Focused Card Coordinates
  let activeCardInfo = null;
  if (selectedEntity && activeScreenPos) {
    const anchorX = activeScreenPos.x;
    const anchorY = activeScreenPos.y;
    const isRightHalf = anchorX > window.innerWidth * 0.65;
    const isBottomHalf = anchorY > window.innerHeight * 0.7;

    const isShip = selectedEntity.type === 'ship';
    const isBerg = selectedEntity.type === 'iceberg';
    const isStation = selectedEntity.type === 'station';
    const isSat = selectedEntity.type === 'satellite';
    const isVessel = selectedEntity.type === 'vessel';
    const isSatFix = selectedEntity.type === 'satellite_fix';
    const isSatTrack = selectedEntity.type === 'satellite_track' || selectedEntity.type === 'satellite_corridor';

    const satTrack = isBerg ? (selectedEntity.satelliteTrack || getSatelliteTrackForIceberg(selectedEntity.id || selectedEntity.icebergId)) : null;
    const lastObs = satTrack?.lastObservation || satTrack?.latestFix || satTrack?.observations?.[satTrack.observations.length - 1];

    const cardWidth = (isBerg || isSatFix || isSatTrack) ? 310 : 270;
    const cardHeight = isSatFix ? 230 : (isBerg ? 235 : 155);

    const offsetX = isRightHalf ? -cardWidth - 60 : 60;
    const offsetY = isBottomHalf ? -cardHeight - 20 : -50;

    const rawCardX = anchorX + offsetX;
    const rawCardY = anchorY + offsetY;

    // Viewport boundary clamping: prevent overlap with top bridge header (48px) and bottom console (56px)
    const minX = isDrawerOpen ? 404 : 16;
    const maxX = Math.max(minX, (window.innerWidth || 1200) - cardWidth - 16);
    const minY = 56;
    const maxY = Math.max(minY, (window.innerHeight || 800) - cardHeight - 64);

    const cardX = Math.max(minX, Math.min(maxX, rawCardX));
    const cardY = Math.max(minY, Math.min(maxY, rawCardY));

    const elbowX = isRightHalf ? cardX + cardWidth + 15 : cardX - 15;
    const elbowY = Math.max(minY, Math.min(maxY + cardHeight, anchorY + (offsetY * 0.4)));
    const cardAttachX = isRightHalf ? cardX + cardWidth : cardX;
    const cardAttachY = cardY + 24;

    const leaderPoints = `${anchorX},${anchorY} ${elbowX},${elbowY} ${cardAttachX},${cardAttachY}`;

    const liveLat = isShip && telemetry ? telemetry.lat : selectedEntity.lat;
    const liveLon = isShip && telemetry ? telemetry.lon : selectedEntity.lon;
    const liveHeading = isShip && telemetry ? telemetry.heading : (selectedEntity.headingDeg ?? selectedEntity.heading ?? selectedEntity.course ?? 84.5);
    const liveSpeed = isShip && telemetry ? telemetry.speedKn : (isBerg ? (selectedEntity.driftSpeedKn ?? selectedEntity.speedKn ?? 0.3) : (isVessel ? (selectedEntity.speedKn ?? selectedEntity.speed ?? 10.0) : 0));

    activeCardInfo = {
      anchorX,
      anchorY,
      cardX,
      cardY,
      cardWidth,
      cardHeight,
      cardAttachX,
      cardAttachY,
      leaderPoints,
      isShip,
      isBerg,
      isStation,
      isSat,
      isVessel,
      isSatFix,
      isSatTrack,
      satTrack,
      lastObs,
      liveLat,
      liveLon,
      liveHeading,
      liveSpeed
    };
  }

  return (
    <div
      className="fixed inset-0 pointer-events-none z-40 overflow-hidden font-mono select-none"
      style={{
        '--tactical-accent': theme.accent,
        '--tactical-glow': theme.glow
      }}
    >
      {/* 1. AMBIENT DETECTIONS (Subtle corner brackets without names/text cluttering globe) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
        <defs>
          <filter id="gev-callout-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={theme.accent} floodOpacity="0.8" />
          </filter>
        </defs>

        {ambientTargets.map((tgt) => {
          const { x, y, boxW, boxH, color } = tgt;
          const halfW = boxW / 2;
          const halfH = boxH / 2;
          // Exact Gods-Eye-View segment calculation:
          // const seg = Math.max(4, Math.floor(Math.min(halfW, halfH) * 0.55));
          const seg = Math.max(4, Math.floor(Math.min(halfW, halfH) * 0.55));

          const x0 = x - halfW;
          const y0 = y - halfH;
          const x1 = x + halfW;
          const y1 = y + halfH;

          // Four L-bracket paths matching detectionDraw.js appendCornerBracket
          const dTopLeft = `M ${x0} ${y0 + seg} L ${x0} ${y0} L ${x0 + seg} ${y0}`;
          const dTopRight = `M ${x1 - seg} ${y0} L ${x1} ${y0} L ${x1} ${y0 + seg}`;
          const dBottomRight = `M ${x1} ${y1 - seg} L ${x1} ${y1} L ${x1 - seg} ${y1}`;
          const dBottomLeft = `M ${x0 + seg} ${y1} L ${x0} ${y1} L ${x0} ${y1 - seg}`;

          return (
            <g
              key={tgt.id}
              role="button"
              tabIndex={0}
              aria-label={`Select tactical contact ${tgt.primary || tgt.id}`}
              className="cursor-pointer pointer-events-auto transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-sky-400"
              onClick={() => {
                onSelectEntity?.(tgt.raw);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectEntity?.(tgt.raw);
                }
              }}
            >
              {/* Invisible touch/click target area */}
              <rect
                x={x0 - 6}
                y={y0 - 6}
                width={boxW + 12}
                height={boxH + 12}
                fill="transparent"
              />
              {/* Corner Brackets (┌ ┐ └ ┘) from gods-eye-view */}
              <g stroke={color} strokeWidth="1.6" fill="none" opacity="0.82" filter="drop-shadow(0 0 2px rgba(0,0,0,0.9))">
                <path d={dTopLeft} />
                <path d={dTopRight} />
                <path d={dBottomRight} />
                <path d={dBottomLeft} />
              </g>
            </g>
          );
        })}
      </svg>

      {/* 2. ACTIVE SELECTED ENTITY (Reticle, brackets & comprehensive readout card from gods-eye-view) */}
      {activeCardInfo && (
        <>
          <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
            {/* Center Anchor Point Dot */}
            <circle
              cx={activeCardInfo.anchorX}
              cy={activeCardInfo.anchorY}
              r="2.5"
              fill="#ffffff"
              stroke={theme.accent}
              strokeWidth="1"
            />

            {/* Corner Brackets for selected entity (gods-eye-view appendCornerBracket style) */}
            {(() => {
              const ax = activeCardInfo.anchorX;
              const ay = activeCardInfo.anchorY;
              const hw = 30;
              const hh = 26;
              const seg = Math.max(6, Math.floor(Math.min(hw, hh) * 0.55));
              const x0 = ax - hw;
              const y0 = ay - hh;
              const x1 = ax + hw;
              const y1 = ay + hh;
              return (
                <g stroke={theme.accent} strokeWidth="2" fill="none" filter="url(#gev-callout-glow)">
                  {/* Top-Left */}
                  <path d={`M ${x0} ${y0 + seg} L ${x0} ${y0} L ${x0 + seg} ${y0}`} />
                  {/* Top-Right */}
                  <path d={`M ${x1 - seg} ${y0} L ${x1} ${y0} L ${x1} ${y0 + seg}`} />
                  {/* Bottom-Right */}
                  <path d={`M ${x1} ${y1 - seg} L ${x1} ${y1} L ${x1 - seg} ${y1}`} />
                  {/* Bottom-Left */}
                  <path d={`M ${x0 + seg} ${y1} L ${x0} ${y1} L ${x0} ${y1 - seg}`} />
                </g>
              );
            })()}

            {/* Tactical Leader Line (matching drawLeader in worldOverlayDraw.js) */}
            <polyline
              points={activeCardInfo.leaderPoints}
              fill="none"
              stroke={theme.accent}
              strokeWidth="1.5"
              strokeDasharray="4 2"
              opacity="0.85"
              filter="url(#gev-callout-glow)"
            />

            {/* Terminal Dot at Card Attachment */}
            <circle
              cx={activeCardInfo.cardAttachX}
              cy={activeCardInfo.cardAttachY}
              r="2.5"
              fill={theme.accent}
            />
          </svg>

          {/* Focused Readout Glass Card (Exact WORLD_OVERLAY_STYLE / paintTracked from gods-eye-view) */}
          <div
            className="absolute pointer-events-auto backdrop-blur-md rounded transition-all duration-150 shadow-2xl overflow-hidden"
            style={{
              left: `${activeCardInfo.cardX}px`,
              top: `${activeCardInfo.cardY}px`,
              width: `${activeCardInfo.cardWidth}px`,
              backgroundColor: 'rgba(4, 12, 16, 0.88)', // WORLD_OVERLAY_STYLE.background
              border: `1px solid ${theme.border}`, // WORLD_OVERLAY_STYLE.selectedBorder
              boxShadow: `0 8px 32px rgba(0, 0, 0, 0.8), 0 0 16px ${theme.glow}`,
              fontFamily: '"JetBrains Mono", monospace'
            }}
          >
            {/* Top 2px Accent Rule Bar (Exact roundedRectPath(ctx, x, y, w, 2, 1) from paintTracked) */}
            <div
              className="w-full h-[2px]"
              style={{ backgroundColor: theme.accent }}
            />

            {/* Header Strip */}
            <div
              className="flex items-center justify-between px-3 py-1.5 border-b text-[10px] font-bold uppercase tracking-wider bg-black/30"
              style={{ borderColor: 'rgba(255, 255, 255, 0.08)', color: theme.accent }}
            >
              <div className="flex items-center space-x-1.5">
                <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: theme.accent }} />
                <span className="font-semibold">{selectedEntity.type || 'CONTACT'} // {theme.modeLabel}</span>
              </div>
              {onClose && (
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-white px-1.5 py-0.5 hover:bg-white/10 rounded transition-colors text-xs font-mono"
                  title="Dismiss Tracked Contact"
                >
                  ×
                </button>
              )}
            </div>

            {/* Body */}
            <div className="p-3 space-y-2.5 text-xs">
              <div>
                <div className="text-white font-bold text-[13px] tracking-wide flex items-center justify-between">
                  <span>{selectedEntity.name || 'TARGET CONTACT'}</span>
                  {selectedEntity.id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium" style={{ backgroundColor: theme.tagBg, color: theme.accent }}>
                      {selectedEntity.id}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-gray-400 truncate mt-0.5">
                  {selectedEntity.subtitle || 'Tactical Tracked Presentation'}
                </div>
              </div>

              {/* Explicit Demo / Practice Target Warning Banner */}
              {(selectedEntity.is_simulated || selectedEntity.is_demo || activeCardInfo.isVessel || selectedEntity.type === 'vessel') && (
                <div className="p-2 rounded bg-amber-950/80 border border-amber-500/60 space-y-1 text-amber-300 font-mono text-[10px]">
                  <div className="flex items-center space-x-1.5 font-bold tracking-wider text-amber-300">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
                    <span>⚠️ DEMO / PRACTICE TARGET (SIMULATED)</span>
                  </div>
                  <div className="text-[9px] text-amber-200/90 leading-tight">
                    NOTE: Synthetic position for ARPA radar collision avoidance testing. In the real world, this vessel operates in home waters (e.g. Russia) outside the austral summer.
                  </div>
                </div>
              )}

              {/* Coordinates & Telemetry (General contacts) */}
              {!activeCardInfo.isSatFix && (
                <div className="grid grid-cols-2 gap-2 p-2 rounded bg-black/50 border border-white/10 text-[10.5px]">
                  <div>
                    <span className="text-gray-400 text-[9px] block">LATITUDE</span>
                    <span className="font-bold text-white font-mono">
                      {activeCardInfo.liveLat !== undefined ? `${Math.abs(activeCardInfo.liveLat).toFixed(4)}°S` : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 text-[9px] block">LONGITUDE</span>
                    <span className="font-bold text-white font-mono">
                      {activeCardInfo.liveLon !== undefined ? `${Math.abs(activeCardInfo.liveLon).toFixed(4)}°E` : 'N/A'}
                    </span>
                  </div>

                  <div>
                    <span className="text-gray-400 text-[9px] block">
                      {activeCardInfo.isShip || activeCardInfo.isVessel ? 'SOG / SPEED' : activeCardInfo.isBerg ? 'DRIFT SPEED' : activeCardInfo.isSat ? 'ALTITUDE' : 'STATUS'}
                    </span>
                    <span className="font-bold font-mono" style={{ color: theme.accent }}>
                      {activeCardInfo.isShip || activeCardInfo.isVessel ? `${activeCardInfo.liveSpeed.toFixed(1)} kn` : activeCardInfo.isBerg ? `${activeCardInfo.liveSpeed.toFixed(1)} kn` : activeCardInfo.isSat ? '705 km' : 'ACTIVE'}
                    </span>
                  </div>

                  <div>
                    <span className="text-gray-400 text-[9px] block">
                      {activeCardInfo.isShip || activeCardInfo.isVessel ? 'COURSE / HEADING' : activeCardInfo.isBerg ? 'KEEL DRAFT' : activeCardInfo.isSat ? 'INCLINATION' : 'SECTOR'}
                    </span>
                    <span className="font-bold text-white font-mono">
                      {activeCardInfo.isShip || activeCardInfo.isVessel ? `${activeCardInfo.liveHeading.toFixed(0)}°` : activeCardInfo.isBerg ? `${selectedEntity.draftM ?? 220} m` : activeCardInfo.isSat ? '98.2° SSO' : 'EAST ANTARCTICA'}
                    </span>
                  </div>
                </div>
              )}

              {/* Specialized Satellite Sighting Fix Card */}
              {activeCardInfo.isSatFix && (
                <div className="p-2 rounded bg-cyan-950/40 border border-cyan-500/40 space-y-1.5 text-[10px]">
                  <div className="flex items-center justify-between text-cyan-300 font-bold tracking-wider text-[9.5px]">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      SPACEBORNE SAR RADAR SIGHTING
                    </span>
                    <span className="text-[9px] text-cyan-400/90 font-mono">FIX #{selectedEntity.id?.split('_').pop() || '1'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5 text-[9.5px]">
                    <div>
                      <span className="text-gray-400 text-[8.5px] block">SPACECRAFT / SENSOR</span>
                      <span className="font-bold text-white font-mono truncate block">{selectedEntity.spacecraft} • {selectedEntity.sensor}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-[8.5px] block">DATE / PASS</span>
                      <span className="font-bold text-cyan-300 font-mono">{String(selectedEntity.timestamp).slice(0, 10)} ({selectedEntity.passType || 'Ascending'})</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-[8.5px] block">BACKSCATTER / COHERENCE</span>
                      <span className="font-bold text-emerald-400 font-mono">{selectedEntity.backscatterDb ?? -11.2} dB</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-[8.5px] block">SURFACE AREA / FREEBOARD</span>
                      <span className="font-bold text-sky-300 font-mono">{selectedEntity.surfaceAreaKm2} km² • {selectedEntity.freeboardM}m</span>
                    </div>
                  </div>
                  <div className="text-[8.5px] text-cyan-200/80 font-mono pt-1 border-t border-cyan-500/20 flex justify-between">
                    <span>SOURCE: {selectedEntity.dataSource || 'Copernicus CDSE NRT'}</span>
                    <span>ORBIT: #{selectedEntity.orbitNumber || 66220}</span>
                  </div>
                </div>
              )}

              {/* Iceberg Authentic Satellite Reconnaissance Panel (Milestone 4) */}
              {activeCardInfo.isBerg && activeCardInfo.satTrack && activeCardInfo.lastObs && (
                <div className="p-2 rounded bg-cyan-950/40 border border-cyan-500/30 text-[10px] space-y-1">
                  <div className="flex items-center justify-between text-cyan-300 font-bold tracking-wider text-[9.5px]">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      SATELLITE RECONNAISSANCE
                    </span>
                    <span className="text-[9px] text-cyan-400/80 font-mono">{activeCardInfo.satTrack.totalSightings || 13} SIGHTINGS</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5 text-[9.5px]">
                    <div>
                      <span className="text-gray-400 text-[8.5px] block">LAST OVERPASS</span>
                      <span className="font-bold text-white font-mono">{String(activeCardInfo.lastObs.timestamp).slice(0, 10)}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-[8.5px] block">DETECTING SENSOR</span>
                      <span className="font-bold text-cyan-300 font-mono truncate block">{activeCardInfo.lastObs.sensor || 'C-SAR (IW)'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-[8.5px] block">RADAR BACKSCATTER</span>
                      <span className="font-bold text-emerald-400 font-mono">{activeCardInfo.lastObs.backscatterDb ?? -11.2} dB</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-[8.5px] block">AREA TREND</span>
                      <span className="font-bold text-sky-300 font-mono">{activeCardInfo.lastObs.surfaceAreaKm2 ?? 591.5} km² (STABLE)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="text-[9.5px] text-gray-300 leading-tight border-t border-white/5 pt-1.5">
                <p className="line-clamp-2">{selectedEntity.description || 'Target contact verified via radar telemetry and autonomous sensor tracking.'}</p>
              </div>
            </div>

            {/* Bottom Bar */}
            <div
              className="px-3 py-1.5 text-[9px] bg-black/60 border-t flex items-center justify-between text-gray-400 font-mono"
              style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}
            >
              <span className="flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.accent }} />
                <span>SYS_OK</span>
              </span>
              <span className="tracking-wider">AUTOTRACK: ENGAGED</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
