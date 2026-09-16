import React, { useState, useEffect } from 'react';
import { 
  X, 
  Satellite, 
  Play, 
  Pause, 
  RotateCcw, 
  Maximize2, 
  Minimize2, 
  Activity, 
  ChevronRight, 
  ChevronLeft,
  Navigation,
  Anchor,
  Compass,
  Radio,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import { getDistanceAndBearing } from '../utils/geo';

export default function SatelliteTrackMiniWindow({
  iceberg,
  isOpen,
  onClose,
  onFlyMainCamera,
  anomalyActive,
  telemetry
}) {
  if (!isOpen || !iceberg) return null;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0); // 0 = observed, 1..12 = +6h..+72h
  const [isExpanded, setIsExpanded] = useState(false);

  const track = iceberg.predictedTrack || [];
  const allPoints = [
    {
      lat: iceberg.lat,
      lon: iceberg.lon,
      hours: 0,
      time: iceberg.time || '2026-09-07T00:00:00Z',
      speedKn: iceberg.speedKn ?? 0.36,
      headingDeg: iceberg.headingDeg ?? 285.5,
      distanceNm: 0.0
    },
    ...track.map((pt, i) => ({
      lat: pt.lat,
      lon: pt.lon,
      hours: pt.hours ?? (i + 1) * 6,
      time: pt.time || '',
      speedKn: pt.speedKn ?? (0.2 + (i % 3) * 0.08),
      headingDeg: pt.headingDeg ?? (280 + (i % 4) * 2),
      distanceNm: pt.distanceNm ?? (i + 1) * 2.1
    }))
  ];

  // Auto-play animation in the mini-window
  useEffect(() => {
    let interval = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= allPoints.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 800);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, allPoints.length]);

  const activePoint = allPoints[currentStep] || allPoints[0];
  const isCritical = iceberg.threatLevel?.includes('CRITICAL') || (iceberg.id === 'C-19' && anomalyActive);

  // Compute live distance from Ship
  const shipLat = telemetry?.lat ?? -70.77;
  const shipLon = telemetry?.lon ?? 11.73;
  const shipProximity = getDistanceAndBearing(shipLat, shipLon, activePoint.lat, activePoint.lon);

  // Compute bounding box and normalization for SVG Radar view
  const lats = allPoints.map((p) => p.lat);
  const lons = allPoints.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const latSpan = Math.max(0.06, maxLat - minLat);
  const lonSpan = Math.max(0.14, maxLon - minLon);

  const svgWidth = isExpanded ? 480 : 360;
  const svgHeight = isExpanded ? 200 : 150;
  const padding = 24;

  // Transform lat/lon to SVG coordinates
  const getSvgCoords = (lat, lon) => {
    const x = padding + ((lon - minLon) / lonSpan) * (svgWidth - 2 * padding);
    const y = padding + ((maxLat - lat) / latSpan) * (svgHeight - 2 * padding);
    return { x, y };
  };

  const pathCoords = allPoints.map((p) => getSvgCoords(p.lat, p.lon));
  const activeSvgPos = getSvgCoords(activePoint.lat, activePoint.lon);

  // Build SVG path string
  const svgPathD = pathCoords.reduce((acc, curr, idx) => {
    return idx === 0 ? `M ${curr.x} ${curr.y}` : `${acc} L ${curr.x} ${curr.y}`;
  }, '');

  // Escape key listener to close mini window
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Clean display name for title header (e.g. "Iceberg C-19" instead of overflowing "Iceberg C-19 (Tabular Giant)")
  const icebergDisplayName = iceberg.name ? iceberg.name.replace(/\s*\([^)]*\)/, '') : `Iceberg ${iceberg.id}`;

  return (
    <div 
      className={`fixed top-36 right-3 z-40 bg-[#080d16] rounded border border-slate-800 overflow-hidden pointer-events-auto transition-all font-sans shadow-2xl max-h-[calc(100vh-10rem)] flex flex-col ${
        isExpanded ? 'w-[540px] max-w-[calc(100vw-2rem)]' : 'w-[410px] max-w-[calc(100vw-2rem)]'
      }`}
      role="region"
      aria-label="Satellite Track Mini Window"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800 bg-[#060910] gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
            isCritical ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-slate-800 text-sky-300 border border-slate-700'
          }`}>
            <Satellite className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-xs text-white truncate font-mono" title={iceberg.name || `Iceberg ${iceberg.id}`}>
            ARPA Track • {icebergDisplayName}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-sm bg-emerald-950/90 text-emerald-300 border border-emerald-800/90 shrink-0">
            72h SAR
          </span>
          <div className="h-4 w-px bg-slate-800 shrink-0" />
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label={isExpanded ? "Collapse mini window" : "Expand mini window"}
              className="w-6 h-6 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors border border-slate-800 hover:border-slate-700"
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Satellite Track Mini Window"
              className="w-6 h-6 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors border border-slate-800 hover:border-slate-700"
              title="Close"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Sub-header Notice */}
      <div className="px-4 py-1.5 bg-slate-950/20 border-b border-white/5 flex items-center justify-between text-[10px] text-slate-400">
        <div className="flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-emerald-300 font-medium">Independent PiP Radar</span>
          <span>• Main map locked</span>
        </div>
        <div className="font-mono text-sky-400">
          Δt = 6h ({allPoints.length} Waypoints)
        </div>
      </div>

      {/* 2D Satellite Trajectory Canvas / Radar Scope (Zero floating text clutter) */}
      <div className="relative bg-[#101114] p-1 flex items-center justify-center overflow-hidden border-b border-[#3c4043]">
        {/* Radar Range Grid */}
        <div 
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(#8ab4f8 1px, transparent 1px), linear-gradient(to right, #3c4043 1px, transparent 1px), linear-gradient(to bottom, #3c4043 1px, transparent 1px)`,
            backgroundSize: `20px 20px, 40px 40px, 40px 40px`
          }}
        />

        {/* Concentric Range Rings */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
          <div className="w-40 h-40 rounded-full border border-dashed border-[#8ab4f8]" />
          <div className="w-24 h-24 rounded-full border border-[#8ab4f8] absolute" />
        </div>

        {/* Scale & North Marker */}
        <div className="absolute top-1.5 left-2.5 text-[9px] font-mono text-[#9aa0a6] select-none">
          N ↑
        </div>
        <div className="absolute bottom-1.5 right-2.5 text-[9px] font-mono text-[#9aa0a6] select-none">
          Scale: ~{Math.round(lonSpan * 20)} NM
        </div>

        <svg 
          width={svgWidth} 
          height={svgHeight} 
          className="relative z-10 overflow-visible"
        >
          <defs>
            {/* Trajectory Gradient */}
            <linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1a73e8" />
              <stop offset="50%" stopColor="#8ab4f8" />
              <stop offset="100%" stopColor="#fdd663" />
            </linearGradient>
          </defs>

          {/* Forecast Uncertainty Envelope (Expanding Cone) */}
          {pathCoords.length > 2 && (
            <path
              d={`M ${pathCoords[0].x} ${pathCoords[0].y} 
                  ${pathCoords.map((c, i) => `L ${c.x + (i * 1.5)} ${c.y - (i * 0.7)}`).join(' ')}
                  ${pathCoords.slice().reverse().map((c, i) => `L ${c.x - ((pathCoords.length - 1 - i) * 1.5)} ${c.y + ((pathCoords.length - 1 - i) * 0.7)}`).join(' ')}
                  Z`}
              fill="rgba(26, 115, 232, 0.08)"
              stroke="rgba(138, 180, 248, 0.25)"
              strokeDasharray="3 3"
            />
          )}

          {/* Predicted Satellite Drift Polyline */}
          <path
            d={svgPathD}
            fill="none"
            stroke="url(#trackGrad)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Waypoint Markers */}
          {allPoints.map((pt, idx) => {
            const coords = pathCoords[idx];
            const isSelected = idx === currentStep;

            return (
              <g 
                key={idx}
                className="cursor-pointer"
                onClick={() => setCurrentStep(idx)}
              >
                <circle
                  cx={coords.x}
                  cy={coords.y}
                  r={isSelected ? 5.5 : 3.5}
                  fill={idx === 0 ? '#81c995' : isSelected ? '#fdd663' : '#8ab4f8'}
                  stroke="#202124"
                  strokeWidth="1.5"
                />

                {/* Waypoint step label (+0h, +24h, +48h, +72h) */}
                {(idx === 0 || idx % 4 === 0 || idx === allPoints.length - 1) && (
                  <text
                    x={coords.x}
                    y={coords.y - 7}
                    textAnchor="middle"
                    fill={isSelected ? '#fdd663' : '#9aa0a6'}
                    fontSize="9px"
                    fontFamily="monospace"
                    fontWeight={isSelected ? 'bold' : 'normal'}
                  >
                    +{pt.hours}h
                  </text>
                )}
              </g>
            );
          })}

          {/* Active Sim Position Marker with Clean Reticle */}
          <circle
            cx={activeSvgPos.x}
            cy={activeSvgPos.y}
            r="8"
            fill="none"
            stroke="#fdd663"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
          <circle
            cx={activeSvgPos.x}
            cy={activeSvgPos.y}
            r="4.5"
            fill="#fdd663"
            stroke="#202124"
            strokeWidth="1.5"
          />
        </svg>
      </div>

      {/* DEDICATED PROXIMITY & TELEMETRY HUD STRIP */}
      <div className="p-3 bg-[#17181a] space-y-2 border-b border-[#3c4043] font-mono text-xs">
        {/* Proximity to RV Polar Explorer */}
        <div className="bg-[#202124] p-2.5 rounded-xl border border-[#3c4043] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Anchor className="w-4 h-4 text-[#8ab4f8] shrink-0" />
            <div>
              <span className="text-[10px] font-sans font-medium text-[#9aa0a6] block">DISTANCE FROM SHIP</span>
              <span className="font-bold text-sm text-[#e8eaed]">
                {shipProximity.distanceNm} NM <span className="text-[11px] font-normal text-[#9aa0a6]">({shipProximity.distanceKm} km)</span>
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-sans font-medium text-[#9aa0a6] block">BEARING</span>
            <span className="font-semibold text-xs text-[#81c995]">
              {shipProximity.bearingDeg}° ({shipProximity.compassDir})
            </span>
          </div>
        </div>

        {/* Selected Step Coordinate & Velocity Matrix */}
        <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
          <div className="bg-[#202124] p-1.5 rounded-lg border border-[#3c4043]">
            <span className="text-[9px] text-[#9aa0a6] block font-sans">COORDINATES</span>
            <span className="font-semibold text-[#8ab4f8]">{Math.abs(activePoint.lat).toFixed(2)}°S {Math.abs(activePoint.lon).toFixed(2)}°E</span>
          </div>
          <div className="bg-[#202124] p-1.5 rounded-lg border border-[#3c4043]">
            <span className="text-[9px] text-[#9aa0a6] block font-sans">DRIFT SPEED</span>
            <span className="font-semibold text-[#fdd663]">{activePoint.speedKn} kn</span>
          </div>
          <div className="bg-[#202124] p-1.5 rounded-lg border border-[#3c4043]">
            <span className="text-[9px] text-[#9aa0a6] block font-sans">DRIFT DISTANCE</span>
            <span className="font-semibold text-[#81c995]">{activePoint.distanceNm} NM</span>
          </div>
        </div>
      </div>

      {/* Mini-Window Timeline Playback Controls */}
      <div className="p-3 bg-[#202124] space-y-2.5">
        {/* Timeline Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-[#e8eaed] flex items-center space-x-1.5">
              <Activity className="w-3.5 h-3.5 text-[#8ab4f8]" />
              <span>Forecast Step: <strong>+{activePoint.hours}h / 72h</strong></span>
            </span>
            <span className="text-[#9aa0a6] font-mono text-[10px]">
              {activePoint.time ? activePoint.time.replace('T', ' ').substring(0, 16) + ' UTC' : ''}
            </span>
          </div>

          <input
            id="mini-track-scrubber"
            name="miniTrackScrubber"
            type="range"
            min="0"
            max={allPoints.length - 1}
            step="1"
            value={currentStep}
            onChange={(e) => {
              setCurrentStep(Number(e.target.value));
              setIsPlaying(false);
            }}
            aria-label="Satellite Drift Timeline Scrubber"
            className="w-full h-1.5 bg-[#303134] rounded-lg appearance-none cursor-pointer accent-[#8ab4f8]"
          />
        </div>

        {/* Step Buttons & Actions */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => {
                setCurrentStep(0);
                setIsPlaying(false);
              }}
              aria-label="Reset drift timeline to 0h"
              title="Reset to 0h"
              className="p-1.5 rounded-lg bg-[#303134] hover:bg-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
              disabled={currentStep === 0}
              aria-label="Previous 6-hour waypoint"
              className="p-1.5 rounded-lg bg-[#303134] hover:bg-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              aria-label={isPlaying ? "Pause simulation" : "Play 72-hour drift simulation"}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isPlaying 
                  ? 'bg-[#ea4335] text-white' 
                  : 'bg-[#1a73e8] hover:bg-[#1b66c9] text-white shadow-sm'
              }`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isPlaying ? 'Pause' : 'Simulate'}</span>
            </button>

            <button
              type="button"
              onClick={() => setCurrentStep((prev) => Math.min(allPoints.length - 1, prev + 1))}
              disabled={currentStep === allPoints.length - 1}
              aria-label="Next 6-hour waypoint"
              className="p-1.5 rounded-lg bg-[#303134] hover:bg-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Center 3D Camera to Active Waypoint */}
          {onFlyMainCamera && (
            <button
              type="button"
              onClick={() => onFlyMainCamera(activePoint.lat, activePoint.lon, iceberg.id)}
              aria-label="Align main 3D camera to this iceberg position"
              title="Center 3D globe camera on this iceberg"
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[#303134] hover:bg-[#3c4043] text-[#8ab4f8] border border-[#5f6368] transition-colors"
            >
              <Navigation className="w-3 h-3" />
              <span>Center 3D</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
