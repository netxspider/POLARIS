import React, { useState, useMemo } from 'react';
import {
  X,
  Waves,
  Maximize2,
  Minimize2,
  Compass,
  Radio,
  AlertTriangle,
  ShieldCheck,
  Anchor,
  Layers,
  Activity
} from 'lucide-react';
import { getBathymetricDepth } from '../utils/geo';

export default function BathymetricEchogramMiniWindow({
  isOpen,
  onClose,
  scenarioData,
  telemetry,
  onFlyToLocation,
  isDrawerOpen = false
}) {
  if (!isOpen) return null;

  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredStation, setHoveredStation] = useState(null);

  const waypoints = scenarioData?.route?.waypoints || [];

  // Generate 80 profile samples along the corridor from waypoints
  const profileSamples = useMemo(() => {
    if (waypoints.length < 2) return [];
    const samples = [];
    const numPoints = 80;

    for (let i = 0; i <= numPoints; i++) {
      const frac = i / numPoints;
      const totalSegs = waypoints.length - 1;
      const segIndex = Math.min(totalSegs - 1, Math.floor(frac * totalSegs));
      const segFrac = (frac * totalSegs) - segIndex;

      const w1 = waypoints[segIndex];
      const w2 = waypoints[segIndex + 1];

      const lat = w1.lat + segFrac * (w2.lat - w1.lat);
      const lon = w1.lon + segFrac * (w2.lon - w1.lon);
      const depth = getBathymetricDepth(lat, lon);
      const distNm = Math.round(frac * 1780);

      samples.push({ frac, lat, lon, depth, distNm });
    }
    return samples;
  }, [waypoints]);

  // Major seabed features along the route
  const FEATURE_PINS = [
    { name: 'Maitri Shelf', lon: 11.7, lat: -70.4, depth: 138, type: 'Shelf', nm: 25 },
    { name: 'Astrid Ridge', lon: 14.5, lat: -68.8, depth: 340, type: 'Ridge Bank', nm: 130 },
    { name: 'Lazarev Basin', lon: 20.0, lat: -67.4, depth: 1250, type: 'Basin', nm: 280 },
    { name: 'Gunnerus Seamount', lon: 33.5, lat: -65.8, depth: 920, type: 'Seamount', nm: 610 },
    { name: 'Riiser-Larsen Plain', lon: 32.0, lat: -66.5, depth: 3350, type: 'Abyss', nm: 570 },
    { name: 'Cosmonauts Trench', lon: 48.0, lat: -66.2, depth: 3950, type: 'Trench', nm: 1020 },
    { name: 'Cooperation Basin', lon: 62.0, lat: -66.4, depth: 3200, type: 'Abyss', nm: 1380 },
    { name: 'Amery Trough', lon: 72.5, lat: -68.8, depth: 760, type: 'Trough', nm: 1650 },
    { name: 'Bharati Shelf', lon: 76.2, lat: -69.3, depth: 180, type: 'Shelf', nm: 1770 }
  ];

  // Current vessel live depth & UKC
  const curLat = telemetry?.lat ?? -70.77;
  const curLon = telemetry?.lon ?? 11.73;
  const currentDepth = getBathymetricDepth(curLat, curLon);
  const vesselDraft = 8.5;
  const ukc = Math.max(0, currentDepth - vesselDraft);

  const isShelf = currentDepth < 200;
  const isSlope = currentDepth >= 200 && currentDepth < 1000;
  const isDeep = currentDepth >= 1000 && currentDepth < 3000;
  const isAbyss = currentDepth >= 3000;

  const seabedClass = isShelf
    ? 'CONTINENTAL SHELF'
    : isSlope
    ? 'CONTINENTAL SLOPE'
    : isDeep
    ? 'CONTINENTAL RISE / BASIN'
    : 'ABYSSAL OCEAN BASIN';

  const seabedColor = isShelf
    ? 'text-emerald-400'
    : isSlope
    ? 'text-sky-400'
    : isDeep
    ? 'text-indigo-400'
    : 'text-purple-400';

  // Iceberg Keel Grounding Risk (< 250m is hazardous for deep keels like C-19 draft 235m)
  const isIcebergGroundingZone = currentDepth <= 250;

  // SVG Chart dimensions
  const svgW = isExpanded ? 760 : 460;
  const svgH = isExpanded ? 220 : 150;
  const padL = 45;
  const padR = 20;
  const padT = 15;
  const padB = 25;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const maxDepthM = 4500;

  // Scale functions
  const scaleX = (frac) => padL + frac * plotW;
  const scaleY = (depthM) => padT + (Math.min(maxDepthM, depthM) / maxDepthM) * plotH;

  // SVG seafloor polygon path
  const seafloorPath = useMemo(() => {
    if (profileSamples.length === 0) return '';
    let d = `M ${scaleX(0)} ${scaleY(profileSamples[0].depth)}`;
    profileSamples.forEach((pt) => {
      d += ` L ${scaleX(pt.frac)} ${scaleY(pt.depth)}`;
    });
    // Close polygon at bottom
    d += ` L ${scaleX(1)} ${padT + plotH} L ${scaleX(0)} ${padT + plotH} Z`;
    return d;
  }, [profileSamples, svgW, svgH]);

  const seafloorLine = useMemo(() => {
    if (profileSamples.length === 0) return '';
    let d = `M ${scaleX(0)} ${scaleY(profileSamples[0].depth)}`;
    profileSamples.forEach((pt) => {
      d += ` L ${scaleX(pt.frac)} ${scaleY(pt.depth)}`;
    });
    return d;
  }, [profileSamples, svgW, svgH]);

  // Current vessel X on chart
  const curFrac = telemetry?.progress ?? 0;
  const shipChartX = scaleX(Math.max(0, Math.min(1, curFrac)));
  const shipChartY = scaleY(currentDepth);
  const keelChartY = scaleY(vesselDraft);

  return (
    <div
      className={`fixed z-40 bg-[#060b13]/95 backdrop-blur-xl border border-sky-500/40 rounded-lg shadow-2xl transition-all duration-300 select-none font-sans overflow-hidden flex flex-col ${
        isExpanded
          ? isDrawerOpen
            ? 'bottom-16 left-[404px] right-6 top-20 max-w-5xl'
            : 'bottom-16 left-6 right-6 top-20 max-w-5xl mx-auto'
          : isDrawerOpen
            ? 'bottom-16 left-[404px] w-[510px] max-w-[calc(100vw-424px)]'
            : 'bottom-16 left-6 w-[510px] max-w-[calc(100vw-3rem)]'
      }`}
      style={{
        boxShadow: '0 20px 50px rgba(0,0,0,0.85), 0 0 25px rgba(56, 189, 248, 0.15)'
      }}
    >
      {/* Header Bar */}
      <div className="bg-[#0b1422] border-b border-slate-800/90 px-3.5 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-6 h-6 rounded bg-sky-950/80 border border-sky-500/50 flex items-center justify-center text-sky-400 shrink-0">
            <Waves className="w-3.5 h-3.5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-mono font-bold text-white tracking-wider flex items-center gap-1.5 truncate">
              <span>ECDIS BATHYMETRIC ECHOGRAM</span>
              <span className="text-slate-600">•</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-300 border border-sky-700/50 font-mono">
                IBCSO v2 // BEDMAP2
              </span>
            </div>
            <div className="text-[9px] font-mono text-slate-400 truncate">
              Kongsberg EM 122 Multibeam (12 kHz) • Transducer Ping Active
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title={isExpanded ? 'Collapse Echogram' : 'Expand Echogram View'}
            aria-label="Toggle Expand"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            title="Close Echogram Window"
            aria-label="Close Echogram"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-3 space-y-3 flex-1 overflow-y-auto">
        {/* Real-time Echosounder Telemetry Banner */}
        <div className="grid grid-cols-4 gap-2 bg-[#0a101d] p-2.5 rounded border border-slate-800/80 font-mono text-[10px]">
          <div>
            <div className="text-slate-400 text-[9px] uppercase tracking-wider">SEABED DEPTH</div>
            <div className="text-sm font-bold text-white flex items-baseline gap-1">
              <span>{Math.round(currentDepth).toLocaleString()}</span>
              <span className="text-[10px] text-slate-400">m</span>
            </div>
            <div className={`text-[9px] font-bold ${seabedColor} truncate`}>{seabedClass}</div>
          </div>

          <div>
            <div className="text-slate-400 text-[9px] uppercase tracking-wider">UNDER-KEEL (UKC)</div>
            <div className="text-sm font-bold text-emerald-400 flex items-baseline gap-1">
              <span>{Math.round(ukc).toLocaleString()}</span>
              <span className="text-[10px] text-slate-400">m</span>
            </div>
            <div className="text-[9px] text-slate-400 truncate">Draft: {vesselDraft}m (PC4)</div>
          </div>

          <div>
            <div className="text-slate-400 text-[9px] uppercase tracking-wider">ACOUSTIC VELOCITY</div>
            <div className="text-sm font-bold text-sky-300">1,448 m/s</div>
            <div className="text-[9px] text-slate-400 truncate">Salinity: 34.2 PSU</div>
          </div>

          <div>
            <div className="text-slate-400 text-[9px] uppercase tracking-wider">SWATH COVERAGE</div>
            <div className="text-sm font-bold text-amber-300">
              {(Math.round(currentDepth * 3.5) / 1000).toFixed(1)} km
            </div>
            <div className="text-[9px] text-slate-400 truncate">Swath: 120° Angle</div>
          </div>
        </div>

        {/* Iceberg Keel Hazard Warning Bar */}
        {isIcebergGroundingZone ? (
          <div className="flex items-center space-x-2 bg-amber-950/40 border border-amber-600/50 p-2 rounded text-[10px] text-amber-200 font-mono">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="leading-tight">
              <strong className="text-amber-300 font-bold">SHALLOW SHELF GROUNDING ZONE:</strong> Water depth ({Math.round(currentDepth)}m) is shallower than submerged iceberg keels (C-19 draft: 235m). Icebergs may ground or create moraine shoals.
            </div>
          </div>
        ) : (
          <div className="flex items-center space-x-2 bg-slate-900/50 border border-slate-800 p-1.5 rounded text-[10px] text-slate-400 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">Deep ocean abyss margin: Under-keel clearance is optimal for all polar vessel classes.</span>
          </div>
        )}

        {/* SVG Subsea Bathymetric Cross-Section Profile */}
        <div className="bg-[#050912] border border-slate-800 rounded p-2 relative">
          <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 mb-1 px-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              Maitri Base / India Bay (11.7°E)
            </span>
            <span className="text-slate-500 font-semibold">1,780 NM SUBSEA CROSS-SECTION</span>
            <span className="flex items-center gap-1.5">
              Bharati Anchorage (76.2°E)
              <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />
            </span>
          </div>

          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="w-full h-auto overflow-visible select-none"
          >
            <defs>
              <linearGradient id="bathyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
                <stop offset="25%" stopColor="#0284c7" stopOpacity="0.35" />
                <stop offset="65%" stopColor="#1e3a8a" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#0f172a" stopOpacity="0.85" />
              </linearGradient>
            </defs>

            {/* Depth Grid Lines & Labels */}
            {[0, 200, 500, 1000, 2000, 3000, 4000].map((d) => {
              const y = scaleY(d);
              return (
                <g key={d}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={padL + plotW}
                    y2={y}
                    stroke={d === 200 ? '#38bdf8' : '#1e293b'}
                    strokeWidth={d === 200 ? 1.2 : 0.8}
                    strokeDasharray={d === 200 ? '4 3' : '2 2'}
                    opacity={d === 200 ? 0.7 : 0.4}
                  />
                  <text
                    x={padL - 4}
                    y={y + 3}
                    textAnchor="end"
                    fill={d === 200 ? '#38bdf8' : '#64748b'}
                    fontSize="8"
                    fontFamily="monospace"
                  >
                    {d}m
                  </text>
                </g>
              );
            })}

            {/* Seafloor Polygon Fill */}
            <path d={seafloorPath} fill="url(#bathyGradient)" />

            {/* Seafloor Contour Line */}
            <path
              d={seafloorLine}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.8"
              strokeLinecap="round"
            />

            {/* 200m Shelf Edge Contour Guide Line */}
            <line
              x1={padL}
              y1={scaleY(200)}
              x2={padL + plotW}
              y2={scaleY(200)}
              stroke="#38bdf8"
              strokeWidth="0.75"
              strokeDasharray="4 4"
              opacity="0.6"
            />
            <text
              x={padL + plotW - 4}
              y={scaleY(200) - 3}
              textAnchor="end"
              fill="#38bdf8"
              fontSize="7.5"
              fontFamily="monospace"
              opacity="0.8"
            >
              200m SHELF BREAK
            </text>

            {/* Keel Draft Line (-8.5m) */}
            <line
              x1={padL}
              y1={scaleY(8.5)}
              x2={padL + plotW}
              y2={scaleY(8.5)}
              stroke="#f43f5e"
              strokeWidth="1.2"
              strokeDasharray="3 2"
              opacity="0.75"
            />

            {/* Feature Pins */}
            {FEATURE_PINS.map((feat) => {
              const x = padL + (feat.nm / 1780) * plotW;
              const y = scaleY(feat.depth);
              const isHovered = hoveredStation === feat.name;

              return (
                <g
                  key={feat.name}
                  className="cursor-pointer group"
                  onClick={() => onFlyToLocation && onFlyToLocation(feat.lat, feat.lon, feat.name)}
                  onMouseEnter={() => setHoveredStation(feat.name)}
                  onMouseLeave={() => setHoveredStation(null)}
                >
                  {/* Vertical drop pin */}
                  <line
                    x1={x}
                    y1={padT}
                    x2={x}
                    y2={y}
                    stroke="#94a3b8"
                    strokeWidth={isHovered ? 1.5 : 0.75}
                    strokeDasharray="2 2"
                    opacity={isHovered ? 0.9 : 0.35}
                  />
                  {/* Marker Node */}
                  <circle
                    cx={x}
                    cy={y}
                    r={isHovered ? 4.5 : 3}
                    fill={feat.type === 'Shelf' ? '#10b981' : feat.type.includes('Ridge') || feat.type.includes('Seamount') ? '#f59e0b' : '#38bdf8'}
                    stroke="#ffffff"
                    strokeWidth="1.2"
                  />
                  {/* Pin label (visible if expanded or hovered) */}
                  {(isExpanded || isHovered) && (
                    <text
                      x={x}
                      y={Math.min(padT + plotH - 6, y + 12)}
                      textAnchor="middle"
                      fill="#e2e8f0"
                      fontSize="7.5"
                      fontFamily="monospace"
                      fontWeight="bold"
                      className="pointer-events-none drop-shadow-md"
                    >
                      {feat.name} (-{feat.depth}m)
                    </text>
                  )}
                </g>
              );
            })}

            {/* Live Vessel Position Indicator */}
            <g>
              {/* Multibeam Acoustic Ping Beam */}
              <line
                x1={shipChartX}
                y1={keelChartY}
                x2={shipChartX}
                y2={shipChartY}
                stroke="#38bdf8"
                strokeWidth="2"
                strokeDasharray="3 1"
                opacity="0.9"
              />
              {/* Transducer dot on Keel */}
              <circle cx={shipChartX} cy={keelChartY} r="3" fill="#f43f5e" stroke="#fff" strokeWidth="1" />
              {/* Seafloor Reflection Ping */}
              <circle cx={shipChartX} cy={shipChartY} r="4.5" fill="#38bdf8" opacity="0.85" />
              <circle cx={shipChartX} cy={shipChartY} r="7" fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.4" />
              {/* Vessel Label */}
              <text
                x={shipChartX}
                y={padT - 3}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="8"
                fontWeight="bold"
                fontFamily="monospace"
              >
                ▼ RV POLAR EXPLORER ({Math.round(currentDepth)}m)
              </text>
            </g>
          </svg>
        </div>

        {/* Quick Geological Sounding Targets */}
        <div className="space-y-1">
          <div className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>KEY BATHYMETRIC TARGETS (CLICK TO FLY CAMERA)</span>
            <span className="text-slate-500">{FEATURE_PINS.length} SURVEY STATIONS</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 font-mono text-[9px]">
            {FEATURE_PINS.slice(0, 6).map((pin) => (
              <button
                key={pin.name}
                type="button"
                onClick={() => onFlyToLocation && onFlyToLocation(pin.lat, pin.lon, pin.name)}
                className="p-1.5 rounded bg-[#0b1220] hover:bg-slate-800 border border-slate-800 hover:border-sky-500/50 text-left transition-colors flex items-center justify-between"
              >
                <div className="min-w-0">
                  <div className="text-white font-bold truncate">{pin.name}</div>
                  <div className="text-slate-400 text-[8px]">{pin.type}</div>
                </div>
                <div className="text-sky-400 font-bold ml-1 shrink-0">-{pin.depth}m</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
