import React, { useState, useEffect, useRef } from 'react';
import { 
  Anchor, 
  AlertTriangle, 
  Cpu, 
  Database, 
  Compass, 
  Radio, 
  ShieldAlert, 
  ShieldCheck, 
  Layers, 
  Globe, 
  Eye, 
  Navigation2, 
  Menu, 
  Activity,
  Maximize2,
  Search,
  MapPin,
  X,
  Crosshair,
  Zap
} from 'lucide-react';
import { calculatePolarCodeRIO } from '../utils/polarCode';

export default function MarineBridgeHeader({
  demoMode,
  onToggleDemoMode,
  isLiveLoading,
  anomalyActive,
  onTriggerAnomaly,
  cameraMode,
  onChangeCameraMode,
  isDrawerOpen,
  onToggleDrawer,
  hazardCount = 1,
  onSelectStation,
  onLocateShip,
  scenarioData,
  onOpenPolarCode,
  telemetry,
  tacticalStyle = 'normal',
  onChangeTacticalStyle,
  showIntelHud = true,
  onToggleIntelHud,
  showSatellites = true,
  onToggleSatellites,
  streamMode = 'live',
  wsStatus = 'connected',
  isWsConnected = true,
  playbackSpeed = 500,
  onJumpToLive,
  onToggleStreamMode
}) {
  // Live running UTC chronometer
  const [utcDate, setUtcDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [utcTimeOnly, setUtcTimeOnly] = useState(() => new Date().toISOString().slice(11, 19));
  
  // IMO Polar Code RIO Safety Evaluation (Synchronized live with vessel telemetry)
  const isReplan = scenarioData?.isReplan;
  const currentRisk = telemetry?.risk ?? 0.14;
  const rioInfo = calculatePolarCodeRIO(currentRisk, anomalyActive, 12.0, isReplan);

  // Tactical Target Search State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setUtcDate(now.toISOString().slice(0, 10));
      setUtcTimeOnly(now.toISOString().slice(11, 19));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Close search dropdown on click outside or on Escape key
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setIsSearchOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
        if (searchInputRef.current) searchInputRef.current.blur();
      }
    };

    // Capture phase (true) intercepts pointerdown and clicks on Cesium canvas before Cesium absorbs them
    window.addEventListener('pointerdown', handleClickOutside, true);
    window.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handleClickOutside, true);
      window.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Search catalog of stations, icebergs, and vessels
  const TARGET_CATALOG = [
    {
      id: 'maitri',
      name: 'Maitri Research Station',
      type: 'NCPOR Permanent Polar Base',
      coords: '70.77°S, 11.73°E',
      category: 'station',
      badge: 'STATION'
    },
    {
      id: 'india_bay',
      name: 'India Bay Mooring',
      type: 'NCPOR Fast-Ice Ship Berth • Princess Astrid Coast',
      coords: '69.90°S, 11.95°E',
      category: 'station',
      badge: 'DEPARTURE'
    },
    {
      id: 'bharati',
      name: 'Bharati Research Station',
      type: 'NCPOR Permanent Polar Base • Prydz Bay',
      coords: '69.41°S, 76.19°E',
      category: 'station',
      badge: 'DESTINATION'
    },
    {
      id: 'ship',
      name: 'RV Polar Explorer',
      type: 'PC4 Ice-Class Research Vessel',
      coords: 'Active Navigation Corridor',
      category: 'ship',
      badge: 'FLAGSHIP'
    },
    {
      id: 'C-19',
      name: 'Iceberg C-19',
      type: 'Tracked Giant Tabular Iceberg • 591 km²',
      coords: '67.00°S, 78.40°E',
      category: 'iceberg',
      badge: 'CRITICAL CPA'
    },
    {
      id: 'B-15K',
      name: 'Iceberg B-15K',
      type: 'Tracked Tabular Iceberg • 410 km²',
      coords: '68.20°S, 22.50°E',
      category: 'iceberg',
      badge: 'MONITORED'
    },
    {
      id: 'D-28',
      name: 'Iceberg D-28',
      type: 'Tracked Tabular Iceberg • 315 km²',
      coords: '67.50°S, 52.00°E',
      category: 'iceberg',
      badge: 'MONITORED'
    },
    {
      id: 'A-68R',
      name: 'Iceberg A-68R',
      type: 'Tracked Pinnacled Iceberg • 185 km²',
      coords: '66.80°S, 34.00°E',
      category: 'iceberg',
      badge: 'MONITORED'
    },
    {
      id: 'novolazarevskaya',
      name: 'Novolazarevskaya Station',
      type: 'Russian Antarctic Base • Schirmacher Oasis',
      coords: '70.78°S, 11.83°E',
      category: 'station'
    },
    {
      id: 'syowa',
      name: 'Syowa Station',
      type: 'Japanese Antarctic Base • East Ongul Island',
      coords: '69.00°S, 39.58°E',
      category: 'station'
    },
    {
      id: 'progress',
      name: 'Progress Station',
      type: 'Russian Antarctic Base • Larsemann Hills',
      coords: '69.37°S, 76.38°E',
      category: 'station'
    },
    {
      id: 'zhongshan',
      name: 'Zhongshan Station 🇨🇳',
      type: 'Chinese Antarctic Base • Larsemann Hills',
      coords: '69.37°S, 76.37°E',
      category: 'station'
    },
    {
      id: 'mawson',
      name: 'Mawson Station 🇦🇺',
      type: 'Australian Antarctic Base • Mac. Robertson Land',
      coords: '67.60°S, 62.87°E',
      category: 'station'
    },
    {
      id: 'davis',
      name: 'Davis Station 🇦🇺',
      type: 'Australian Antarctic Base • Vestfold Hills',
      coords: '68.58°S, 77.97°E',
      category: 'station'
    }
  ];

  const filteredTargets = TARGET_CATALOG.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.coords.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectTarget = (targetId) => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
    if (onSelectStation) {
      onSelectStation(targetId);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-12 bg-[#080c14] border-b border-slate-800 px-2.5 sm:px-3 lg:px-4 select-none font-sans flex items-center justify-between gap-1.5 sm:gap-2 lg:gap-3 text-xs text-slate-200 shadow-lg max-w-full">
      {/* Left Wing: Plotter Toggle, Identity, Target Search, and Polar Code Status */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0">
        {/* Toggle Plotter Drawer Button */}
        <button
          type="button"
          onClick={onToggleDrawer}
          aria-expanded={isDrawerOpen}
          aria-label={isDrawerOpen ? "Close Nautical Plotter" : "Open Nautical Plotter"}
          className={`h-8 px-2 sm:px-2.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors border shrink-0 ${
            isDrawerOpen
              ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/80'
          }`}
          title="Toggle Tactical Plotter & Chart Controls"
        >
          <Compass className="w-3.5 h-3.5 text-sky-400" />
          <span className="tracking-wide uppercase text-[11px]">Charts</span>
          {hazardCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-sm bg-rose-500/30 text-rose-300 text-[10px] font-bold font-mono border border-rose-500/50">
              {hazardCount}
            </span>
          )}
        </button>

        <div className="h-5 w-px bg-slate-800 shrink-0 self-center hidden sm:block" />

        {/* System & Official Institutional Identity */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="flex items-baseline space-x-1 sm:space-x-1.5">
            <span className="font-extrabold tracking-widest text-white text-xs sm:text-sm">POLARIS</span>
            <span className="text-[9px] sm:text-[10px] font-mono text-sky-400 font-bold px-1 py-0.2 rounded bg-sky-950/60 border border-sky-800/80">
              NCPOR
            </span>
          </div>
          <span className="text-[9px] font-medium px-1.5 py-0.5 bg-amber-950/60 text-amber-300 rounded-sm border border-amber-800/60 font-mono hidden 3xl:inline">
            MoES • PS 26059
          </span>
        </div>

        <div className="h-5 w-px bg-slate-800 shrink-0 self-center hidden 3xl:block" />

        {/* Vessel Tag (Shown on ultra-wide desktop screens) */}
        <div className="hidden 3xl:flex items-center gap-1.5 text-slate-300 text-[11px] shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="font-medium text-slate-200">RV Polar Explorer</span>
          <span className="text-[9px] font-mono text-slate-400 px-1 py-0.2 rounded bg-slate-800/80 border border-slate-700">
            IACS PC4
          </span>
        </div>

        <div className="h-5 w-px bg-slate-800 shrink-0 self-center hidden md:block" />

        {/* Grounded Target Search Input with WAI-ARIA Combobox */}
        <div ref={searchRef} className="relative hidden md:block w-28 sm:w-32 md:w-36 lg:w-40 shrink-0">
          <div className="bg-[#0b101b] border border-slate-700/80 hover:border-slate-600 focus-within:border-sky-500 rounded flex items-center px-2 h-8 transition-colors">
            <Search className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              id="station-target-search"
              name="station-target-search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isSearchOpen}
              aria-controls="target-search-listbox"
              aria-activedescendant={
                isSearchOpen && highlightedIndex >= 0 && filteredTargets[highlightedIndex]
                  ? `target-option-${filteredTargets[highlightedIndex].id}`
                  : undefined
              }
              aria-label="Search target stations, icebergs, or vessel"
              placeholder="Search target..."
              value={searchQuery}
              onFocus={() => {
                setIsSearchOpen(true);
                setHighlightedIndex(-1);
              }}
              onClick={() => setIsSearchOpen(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
                setHighlightedIndex(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (!isSearchOpen) {
                    setIsSearchOpen(true);
                    setHighlightedIndex(0);
                  } else {
                    setHighlightedIndex((prev) => (prev < filteredTargets.length - 1 ? prev + 1 : 0));
                  }
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (!isSearchOpen) {
                    setIsSearchOpen(true);
                    setHighlightedIndex(filteredTargets.length - 1);
                  } else {
                    setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredTargets.length - 1));
                  }
                } else if (e.key === 'Enter') {
                  if (isSearchOpen && highlightedIndex >= 0 && filteredTargets[highlightedIndex]) {
                    e.preventDefault();
                    handleSelectTarget(filteredTargets[highlightedIndex].id);
                  } else if (isSearchOpen && filteredTargets.length > 0) {
                    e.preventDefault();
                    handleSelectTarget(filteredTargets[0].id);
                  }
                } else if (e.key === 'Escape') {
                  setIsSearchOpen(false);
                  setHighlightedIndex(-1);
                  e.target.blur();
                }
              }}
              className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none font-sans"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setIsSearchOpen(false);
                  setHighlightedIndex(-1);
                }}
                className="text-slate-400 hover:text-white p-0.5 shrink-0"
                title="Clear & close search"
              >
                <X className="w-3 h-3" />
              </button>
            ) : (
              <kbd className="hidden lg:inline text-[9px] font-mono text-slate-400 bg-slate-800 px-1 py-0.5 rounded border border-slate-700 shrink-0">
                /
              </kbd>
            )}
          </div>

          {/* Autocomplete Dropdown with Dismiss Controls & ARIA Listbox */}
          {isSearchOpen && (
            <div 
              id="target-search-listbox"
              role="listbox"
              aria-label="Antarctic Fairway Targets"
              className="absolute top-9 left-0 w-72 sm:w-80 bg-[#0c121e] border border-slate-700 rounded overflow-hidden py-1 z-50 max-h-80 overflow-y-auto shadow-2xl"
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-950/80 font-mono flex items-center justify-between">
                <span>Antarctic Fairway Targets</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSearchOpen(false);
                    setHighlightedIndex(-1);
                  }}
                  className="text-slate-400 hover:text-white p-0.5 hover:bg-slate-800 rounded transition-colors flex items-center gap-1"
                  title="Close search (Esc)"
                >
                  <span className="text-[8px] font-mono text-slate-500">ESC</span>
                  <X className="w-3 h-3" />
                </button>
              </div>
              {filteredTargets.length > 0 ? (
                filteredTargets.map((item, index) => (
                  <button
                    key={item.id}
                    id={`target-option-${item.id}`}
                    role="option"
                    aria-selected={index === highlightedIndex}
                    type="button"
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => handleSelectTarget(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors border-b border-slate-800/50 cursor-pointer ${
                      index === highlightedIndex
                        ? 'bg-sky-950/80 border-l-2 border-l-sky-400 text-white'
                        : 'hover:bg-slate-800/80 text-slate-300'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs font-medium text-white truncate flex items-center gap-1.5">
                        {item.category === 'ship' && <Anchor className="w-3 h-3 text-sky-400" />}
                        {item.category === 'station' && <MapPin className="w-3 h-3 text-emerald-400" />}
                        {item.category === 'iceberg' && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                        <span>{item.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate font-mono">{item.type}</div>
                    </div>
                    {item.badge && (
                      <span className={`text-[8px] font-mono font-semibold px-1.5 py-0.5 rounded-sm shrink-0 uppercase border ${
                        item.badge.includes('CRITICAL') ? 'bg-rose-950 text-rose-300 border-rose-800' :
                        item.badge === 'DEPARTURE' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' :
                        item.badge === 'DESTINATION' ? 'bg-sky-950 text-sky-300 border-sky-800' :
                        'bg-slate-800 text-slate-300 border-slate-700'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-slate-400 text-center">
                  No matching targets found.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-5 w-px bg-slate-800 shrink-0 self-center hidden md:block" />

        {/* Live IMO Polar Code RIO Status Badge */}
        <button
          type="button"
          onClick={onOpenPolarCode}
          aria-label="Open IMO Polar Code (POLARIS / RIO) Inspector"
          className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 h-8 rounded border text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
            rioInfo.status === 'NORMAL'
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-700/80 hover:bg-emerald-950/70'
              : 'bg-rose-950/60 text-rose-300 border-rose-700 hover:bg-rose-950/80'
          }`}
          title="Click to inspect IMO Polar Code (POLARIS / RIO) Safety Certificate"
        >
          {rioInfo.status === 'NORMAL' ? (
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          )}
          <span className="font-mono text-[11px] sm:text-xs">RIO: {rioInfo.rioScore > 0 ? `+${Number(rioInfo.rioScore).toFixed(1)}` : Number(rioInfo.rioScore).toFixed(1)}</span>
          <span className="text-[10px] hidden 3xl:inline font-mono text-emerald-400/80">[{rioInfo.badgeLabel}]</span>
        </button>
      </div>

      {/* Right Wing: Tactical Recon Views, Camera Views, Anomaly Hazard Replan, Data Mode, & UTC Chronometer */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Marine ECDIS Display Palette Selector (IEC 62288) */}
        <div className="bg-[#0b101b] border border-slate-700/80 rounded p-0.5 flex items-center h-8 shrink-0" role="group" aria-label="ECDIS Display Palettes">
          {[
            { id: 'normal', label: 'DAY', title: 'ECDIS Standard Day Mode (Natural True-Color)' },
            { id: 'night', label: 'NIGHT', title: 'ECDIS Low-Glare Night Bridge Watch (IHO S-52)' },
            { id: 'radar', label: 'RADAR', title: 'Marine SAR Radar High-Contrast Ice Mode' },
            { id: 'snow', label: 'BLIZ', title: 'Antarctic Polar Blizzard Simulation' }
          ].map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => onChangeTacticalStyle && onChangeTacticalStyle(mode.id)}
              title={mode.title}
              className={`px-1 sm:px-1.5 h-6 rounded-sm text-[10px] font-mono font-bold transition-all ${
                tacticalStyle === mode.id
                  ? mode.id === 'night' 
                    ? 'bg-amber-500 text-black shadow-xs font-extrabold'
                    : mode.id === 'radar'
                    ? 'bg-emerald-500 text-black shadow-xs font-extrabold'
                    : mode.id === 'snow'
                    ? 'bg-cyan-400 text-black shadow-xs font-extrabold'
                    : 'bg-sky-500 text-white shadow-xs font-extrabold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Marine ECDIS Bridge HUD Toggle Button */}
        <button
          type="button"
          onClick={onToggleIntelHud}
          aria-label="Toggle Marine ECDIS Bridge HUD"
          className={`h-8 px-2 rounded text-[10px] font-mono font-bold flex items-center gap-1 transition-colors border shrink-0 ${
            showIntelHud
              ? 'bg-sky-950/80 text-sky-300 border-sky-600 shadow-xs'
              : 'bg-[#0b101b] text-slate-400 border-slate-700/80 hover:text-slate-200'
          }`}
          title="Toggle Marine ECDIS Bridge Navigation Watch HUD (IEC 62288 / IHO S-52)"
        >
          <Crosshair className="w-3 h-3 text-sky-400 shrink-0" />
          <span className="hidden 3xl:inline">HUD</span>
        </button>

        {/* Polar Earth Observation Satellites Toggle Button */}
        <button
          type="button"
          onClick={onToggleSatellites}
          aria-label="Toggle Polar Satellites Orbit Tracks"
          className={`h-8 px-2 rounded text-[10px] font-mono font-bold flex items-center gap-1 transition-colors border shrink-0 ${
            showSatellites
              ? 'bg-cyan-950/80 text-cyan-300 border-cyan-600 shadow-xs'
              : 'bg-[#0b101b] text-slate-400 border-slate-700/80 hover:text-slate-200'
          }`}
          title="Toggle Polar Earth Observation Satellites (CryoSat-2, ICESat-2, Aqua AMSR2)"
        >
          <Radio className="w-3 h-3 text-cyan-400 shrink-0" />
          <span className="hidden 3xl:inline">SATS</span>
        </button>

        <div className="h-5 w-px bg-slate-800 shrink-0 self-center hidden sm:block" />

        {/* Camera Segmented Control (Industrial ECDIS Style: Globe, Chase, 2D) */}
        <div className="bg-[#0b101b] border border-slate-700/80 rounded p-0.5 flex items-center h-8 shrink-0" role="group" aria-label="ECDIS Camera Views">
          {[
            { id: 'globe', label: 'Globe' },
            { id: 'chase', label: 'Chase' },
            { id: '2d', label: '2D' }
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChangeCameraMode(m.id)}
              className={`px-1.5 sm:px-2 h-6 rounded-sm text-xs font-semibold transition-colors ${
                cameraMode === m.id
                  ? 'bg-slate-700 text-white shadow-xs font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-slate-800 shrink-0 self-center hidden sm:block" />

        {/* Simulate Hazard Button */}
        <button
          type="button"
          onClick={onTriggerAnomaly}
          aria-label={anomalyActive ? "Reset Ice Hazard" : "Simulate Drifting Iceberg Hazard"}
          className={`h-8 px-2 sm:px-2.5 rounded text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-colors border shrink-0 ${
            anomalyActive
              ? 'bg-rose-950 text-rose-200 border-rose-700 hover:bg-rose-900'
              : 'bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border-amber-700/80'
          }`}
          title="Simulate sudden iceberg collision hazard to demonstrate dynamic A* route replanning"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="hidden 3xl:inline">{anomalyActive ? 'Reset Course' : 'Simulate Hazard'}</span>
          <span className="hidden sm:inline 3xl:hidden">{anomalyActive ? 'Reset' : 'Sim Hazard'}</span>
          <span className="sm:hidden">{anomalyActive ? 'Reset' : 'Hazard'}</span>
        </button>

        <div className="h-5 w-px bg-slate-800 shrink-0 self-center hidden sm:block" />

        {/* Real-Time Dual-Mode Stream Status & Jump To Live Action */}
        {streamMode === 'live' ? (
          wsStatus === 'reconnecting' || (!isWsConnected && wsStatus !== 'connected') ? (
            <button
              type="button"
              onClick={() => onToggleStreamMode && onToggleStreamMode()}
              aria-label="Real-time WebSocket stream reconnecting. Click to switch to simulation mode."
              className="h-8 px-2 sm:px-2.5 rounded text-xs font-mono font-bold flex items-center gap-1.5 bg-amber-950/70 text-amber-300 border border-amber-600/80 shrink-0 cursor-pointer hover:bg-amber-900/70 transition-colors"
              title="Real-time WebSocket stream reconnecting... Click to switch to simulation mode."
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
              </span>
              <span className="tracking-wider">RECONNECTING...</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onToggleStreamMode && onToggleStreamMode()}
              aria-label="Live Stream active at 1 Hz. Click to switch to simulation mode."
              className="h-8 px-2 sm:px-2.5 rounded text-xs font-mono font-bold flex items-center gap-1.5 bg-emerald-950/60 text-emerald-300 border border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.15)] shrink-0 cursor-pointer hover:bg-emerald-900/60 transition-colors"
              title="Live 1 Hz telemetry stream active. Click to switch to voyage simulation."
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="tracking-wide">● LIVE STREAM (1 Hz)</span>
            </button>
          )
        ) : (
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onJumpToLive}
              aria-label={`Voyage simulation running at ${playbackSpeed}x. Click to jump to live stream.`}
              className="h-8 px-2 sm:px-2.5 rounded text-xs font-mono font-semibold flex items-center gap-1.5 bg-amber-950/60 text-amber-300 border border-amber-700/80 hover:bg-amber-900/60 transition-colors cursor-pointer shrink-0"
              title={`Voyage simulation active (${playbackSpeed}x). Click to jump to live stream.`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="tracking-wide">VOYAGE SIMULATION ({playbackSpeed}x)</span>
            </button>
            <button
              type="button"
              onClick={onJumpToLive}
              aria-label="Jump to live stream"
              className="h-8 px-2.5 sm:px-3 rounded text-xs font-mono font-extrabold flex items-center gap-1 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 border border-amber-300 shadow-md transition-all cursor-pointer shrink-0 animate-pulse hover:animate-none"
              title="Seamlessly restore live real-time tracking and sync 3D vessel view"
            >
              <Zap className="w-3.5 h-3.5 fill-current shrink-0" />
              <span className="font-extrabold tracking-tight">JUMP TO LIVE ⚡</span>
            </button>
          </div>
        )}

        <div className="h-5 w-px bg-slate-800 shrink-0 self-center hidden sm:block" />

        {/* Demo Mode vs Live ML Inference */}
        <button
          type="button"
          onClick={() => onToggleDemoMode(!demoMode)}
          disabled={isLiveLoading}
          aria-label={demoMode ? "Switch to Live Inference Mode" : "Switch to Demo Mode"}
          className={`h-8 px-2 sm:px-2.5 rounded text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-colors border shrink-0 ${
            demoMode
              ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700/80'
              : 'bg-emerald-950 text-emerald-300 border-emerald-700'
          }`}
          title="Toggle between cached baseline scenario and real-time live CNN/LSTM model execution"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${demoMode ? 'bg-sky-400' : 'bg-emerald-400'}`} />
          <span className="hidden 3xl:inline">{demoMode ? 'Demo Data' : 'Live ML'}</span>
          <span className="hidden sm:inline 3xl:hidden">{demoMode ? 'Demo' : 'Live'}</span>
          <span className="sm:hidden">{demoMode ? 'Demo' : 'Live'}</span>
        </button>

        <div className="h-5 w-px bg-slate-800 shrink-0 self-center hidden lg:block" />

        {/* Live High-Precision UTC Chronometer */}
        <div className="hidden lg:flex items-center gap-1 sm:gap-1.5 text-[11px] font-mono text-slate-300 bg-slate-900/90 border border-slate-700/80 px-2 sm:px-2.5 h-8 rounded shrink-0">
          <Radio className="w-3 h-3 text-sky-400 shrink-0" />
          <span className="hidden 3xl:inline text-slate-400">{utcDate}</span>
          <span className="text-slate-200 font-medium">{utcTimeOnly}</span>
          <span className="text-sky-400/90 font-bold text-[10px]">UTC</span>
        </div>
      </div>
    </header>
  );
}
