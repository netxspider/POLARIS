import React, { useState } from 'react';
import { 
  Layers, 
  AlertTriangle, 
  Anchor, 
  MapPin, 
  Compass, 
  Navigation, 
  Crosshair, 
  Radio, 
  Waves, 
  ShieldAlert, 
  ShieldCheck, 
  X, 
  Search, 
  Activity, 
  ChevronRight,
  ExternalLink,
  ChevronDown,
  Info,
  Fuel,
  Leaf,
  Coins,
  CheckCircle2
} from 'lucide-react';
import { getDistanceAndBearing } from '../utils/geo';
import { calculatePolarCodeRIO, calculateVoyageFuelEconomics } from '../utils/polarCode';

export default function MarinePlotterDrawer({
  isOpen,
  onClose,
  scenarioData,
  selectedEntity,
  onSelectEntity,
  onFlyTo,
  onFocusTrack,
  onOpenMiniTrack,
  mapStyle,
  onChangeMapStyle,
  showRiskGrid,
  onToggleRiskGrid,
  showGeeSentinel1,
  onToggleGeeSentinel1,
  showGeeSeaIce,
  onToggleGeeSeaIce,
  showIcebergs,
  onToggleIcebergs,
  showMountains,
  onToggleMountains,
  showStations,
  onToggleStations,
  showBathymetry,
  onToggleBathymetry,
  showSatelliteTracks = true,
  onToggleSatelliteTracks,
  telemetry,
  weather,
  anomalyActive,
  onOpenPolarCode,
  tacticalStyle = 'normal',
  onChangeTacticalStyle,
  showIntelHud = true,
  onToggleIntelHud,
  showSatellites = true,
  onToggleSatellites,
  onOpenEchogram
}) {
  const [activeTab, setActiveTab] = useState('layers'); // 'layers' | 'hazards' | 'waypoints' | 'dossier'
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-switch to dossier tab when an entity is selected
  React.useEffect(() => {
    if (selectedEntity) {
      setActiveTab('dossier');
    }
  }, [selectedEntity]);

  if (!isOpen) return null;

  const icebergs = scenarioData?.icebergs || [];
  const fallbackVessels = [
    { mmsi: "273138300", name: "Akademik Fedorov", type: "research", lat: -66.8, lon: 49.0, speedKn: 10.0, headingDeg: 90 },
    { mmsi: "273456110", name: "Vasily Golovnin", type: "icebreaker", lat: -67.2, lon: 38.5, speedKn: 10.4, headingDeg: 84 },
    { mmsi: "211232740", name: "RV Polarstern", type: "icebreaker", lat: -66.5, lon: 18.2, speedKn: 11.2, headingDeg: 76 },
    { mmsi: "601127000", name: "SA Agulhas II", type: "research", lat: -68.4, lon: 20.1, speedKn: 9.8, headingDeg: 102 },
    { mmsi: "413349000", name: "Xue Long 2", type: "icebreaker", lat: -68.9, lon: 75.2, speedKn: 12.0, headingDeg: 262 },
    { mmsi: "232025740", name: "RRS Sir David Attenborough", type: "icebreaker", lat: -65.9, lon: 30.5, speedKn: 11.5, headingDeg: 108 }
  ];
  const vessels = scenarioData?.isModelRoute
    ? (scenarioData.vessels || [])
    : ((scenarioData?.vessels && scenarioData.vessels.length > 0) ? scenarioData.vessels : fallbackVessels);
  const waypoints = scenarioData?.route?.waypoints || [];

  const isReplan = scenarioData?.isReplan;
  const rioData = calculatePolarCodeRIO(telemetry?.risk ?? 0.14, anomalyActive, 12.0, isReplan);
  const fuelData = calculateVoyageFuelEconomics(telemetry?.progress ?? 0, telemetry?.speedKn ?? 13.5, isReplan);

  return (
    <aside 
      className="fixed top-12 bottom-14 left-0 w-88 sm:w-96 bg-[#080d16] border-r border-slate-800 z-30 flex flex-col font-sans text-xs text-slate-200 select-none shadow-2xl transition-all overflow-hidden"
      aria-label="Nautical Tactical Plotter Console"
    >
      {/* Drawer Title Bar */}
      <div className="px-3.5 py-2.5 border-b border-slate-800 bg-[#060910] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <Compass className="w-4 h-4 text-sky-400" />
          <span className="font-bold text-white text-xs tracking-wider font-mono uppercase">ECDIS TACTICAL PLOTTER</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Plotter"
          className="w-6 h-6 rounded hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors border border-transparent hover:border-slate-700"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Industrial Tab Strip (IEC 62288) */}
      <div className="grid grid-cols-5 border-b border-slate-800 bg-[#060a12] shrink-0" role="tablist" aria-label="ECDIS Tactical Panels">
        {[
          { id: 'layers', label: 'Layers' },
          { id: 'hazards', label: 'Hazards', count: icebergs.length },
          { id: 'waypoints', label: 'Route' },
          { id: 'dossier', label: 'Dossier' },
          { id: 'compliance', label: 'RIO', dot: true }
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-2 text-[10px] font-mono font-semibold transition-colors flex items-center justify-center gap-1 border-b-2 ${
              activeTab === tab.id
                ? 'border-sky-400 bg-slate-800/60 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className="px-1 py-0.2 rounded-sm bg-rose-950 text-rose-300 border border-rose-800 text-[8px] font-bold">
                {tab.count}
              </span>
            )}
            {tab.dot && (
              <span className={`w-1.5 h-1.5 rounded-full ${rioData.rioScore >= 0 ? 'bg-emerald-400' : 'bg-rose-400 animate-ping'}`} />
            )}
          </button>
        ))}
      </div>

      {/* Tab 1: Chart Layers (S-52 Nautical Standards) */}
      {activeTab === 'layers' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
          {/* Base Cartographic Mode */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider px-1">Base Cartography</div>
            <div className="grid grid-cols-3 gap-1 p-1 rounded bg-[#0b101b] border border-slate-800">
              <button
                type="button"
                onClick={() => onChangeMapStyle('esri-satellite')}
                className={`py-1 rounded-sm text-[10px] font-mono font-semibold transition-colors ${
                  mapStyle === 'esri-satellite' ? 'bg-slate-700 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                S-52 Chart
              </button>
              <button
                type="button"
                onClick={() => onChangeMapStyle('google-satellite')}
                className={`py-1 rounded-sm text-[10px] font-mono font-semibold transition-colors ${
                  mapStyle === 'google-satellite' ? 'bg-slate-700 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Satellite
              </button>
              <button
                type="button"
                onClick={() => onChangeMapStyle('google-hybrid')}
                className={`py-1 rounded-sm text-[10px] font-mono font-semibold transition-colors ${
                  mapStyle === 'google-hybrid' ? 'bg-slate-700 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Hybrid
              </button>
            </div>
          </div>

          {/* Marine ECDIS: Display Palettes (IEC 62288) */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono font-semibold text-sky-400 uppercase tracking-wider px-1 flex items-center justify-between">
              <span>ECDIS Display Palette</span>
              <span className="text-[9px] text-slate-500 font-normal">IHO S-52 / WebGL</span>
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 rounded bg-[#0b101b] border border-slate-800">
              {[
                { id: 'normal', label: 'DAY' },
                { id: 'night', label: 'NIGHT' },
                { id: 'radar', label: 'RADAR' },
                { id: 'snow', label: 'BLIZ' }
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChangeTacticalStyle && onChangeTacticalStyle(s.id)}
                  className={`py-1 rounded-sm text-[10px] font-mono font-semibold transition-colors ${
                    tacticalStyle === s.id ? 'bg-sky-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Tactical Overlays (ECDIS HUD & Polar Satellites) */}
            <div className="grid grid-cols-2 gap-1 pt-1">
              <button
                type="button"
                onClick={onToggleIntelHud}
                className={`py-1.5 px-2 rounded text-[10px] font-mono font-semibold flex items-center justify-between border transition-colors ${
                  showIntelHud ? 'bg-sky-950/80 text-sky-300 border-sky-600' : 'bg-[#0b101b] text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span>ECDIS HUD</span>
                <span className={`w-1.5 h-1.5 rounded-full ${showIntelHud ? 'bg-sky-400' : 'bg-slate-600'}`} />
              </button>
              <button
                type="button"
                onClick={onToggleSatellites}
                className={`py-1.5 px-2 rounded text-[10px] font-mono font-semibold flex items-center justify-between border transition-colors ${
                  showSatellites ? 'bg-cyan-950/80 text-cyan-300 border-cyan-600' : 'bg-[#0b101b] text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span>Polar Sats (SGP4)</span>
                <span className={`w-1.5 h-1.5 rounded-full ${showSatellites ? 'bg-cyan-400' : 'bg-slate-600'}`} />
              </button>
            </div>
          </div>

          {/* ECDIS Environmental & Hydrographic Layers */}
          <div className="space-y-2 pt-1">
            <div className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider px-1">Ocean &amp; Ice Overlays</div>

            {/* Passive Microwave Sea-Ice Risk Layer */}
            <label className="flex items-center justify-between p-2.5 rounded bg-[#0b101b] border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
              <div className="flex items-center space-x-2.5">
                <div className="w-2 h-2 rounded-sm bg-cyan-400" />
                <div>
                  <div className="font-semibold text-white text-xs">Microwave Sea-Ice Concentration</div>
                  <div className="text-[10px] font-mono text-slate-400">AMSR2 89 GHz Microwave Grid</div>
                </div>
              </div>
              <input
                type="checkbox"
                id="layer-toggle-risk-grid"
                name="layer-toggle-risk-grid"
                checked={showRiskGrid}
                onChange={onToggleRiskGrid}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 cursor-pointer accent-sky-500"
              />
            </label>

            {/* IBCSO v2 Bathymetric Isobaths & Depth Curtains */}
            <div className="p-2.5 rounded bg-[#0b101b] border border-slate-800 hover:border-slate-700 transition-colors space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="layer-toggle-bathymetry" className="flex items-center space-x-2.5 cursor-pointer flex-1">
                  <Waves className="w-4 h-4 text-sky-400" />
                  <div>
                    <div className="font-semibold text-white text-xs">IBCSO v2 Depth Contours</div>
                    <div className="text-[10px] font-mono text-slate-400">200m, 500m, 1000m, 3000m Isobaths</div>
                  </div>
                </label>
                <input
                  type="checkbox"
                  id="layer-toggle-bathymetry"
                  name="layer-toggle-bathymetry"
                  checked={showBathymetry}
                  onChange={onToggleBathymetry}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 cursor-pointer accent-sky-500 shrink-0 ml-2"
                />
              </div>
              {onOpenEchogram && (
                <button
                  type="button"
                  onClick={onOpenEchogram}
                  className="w-full py-1 px-2 rounded bg-sky-950/60 hover:bg-sky-900/80 border border-sky-600/40 text-sky-300 font-mono text-[10px] flex items-center justify-center space-x-1.5 transition-colors"
                >
                  <Activity className="w-3 h-3 text-sky-400" />
                  <span>Launch Subsea Echogram &amp; Sonar HUD</span>
                </button>
              )}
            </div>

            {/* High-Resolution Sentinel-1 SAR Radar */}
            <label className="flex items-center justify-between p-2.5 rounded bg-[#0b101b] border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
              <div className="flex items-center space-x-2.5">
                <Radio className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="font-semibold text-white text-xs">Sentinel-1 C-Band SAR Radar</div>
                  <div className="text-[10px] font-mono text-slate-400">10m SAR Surface Penetration</div>
                </div>
              </div>
              <input
                type="checkbox"
                id="layer-toggle-sentinel1"
                name="layer-toggle-sentinel1"
                checked={showGeeSentinel1}
                onChange={onToggleGeeSentinel1}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 cursor-pointer accent-sky-500"
              />
            </label>

            {/* Authentic Satellite Trajectory Tracks (Sentinel-1 SAR / BYU) */}
            <label className="flex items-center justify-between p-2.5 rounded bg-[#0b101b] border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
              <div className="flex items-center space-x-2.5">
                <Navigation className="w-4 h-4 text-cyan-400" />
                <div>
                  <div className="font-semibold text-white text-xs">Satellite Trajectory Tracks</div>
                  <div className="text-[10px] font-mono text-slate-400">Sentinel-1 SAR / BYU Tracks &amp; Fixes</div>
                </div>
              </div>
              <input
                type="checkbox"
                id="layer-toggle-sat-tracks"
                name="layer-toggle-sat-tracks"
                checked={showSatelliteTracks}
                onChange={onToggleSatelliteTracks}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 cursor-pointer accent-sky-500"
              />
            </label>

            {/* Tracked Tabular Icebergs & Keel Footings */}
            <label className="flex items-center justify-between p-2.5 rounded bg-[#0b101b] border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
              <div className="flex items-center space-x-2.5">
                <div className="w-2 h-2 rounded-sm bg-rose-400" />
                <div>
                  <div className="font-semibold text-white text-xs">Tracked Icebergs &amp; Keels</div>
                  <div className="text-[10px] font-mono text-slate-400">235m Submerged Keels • 8 NM Zones</div>
                </div>
              </div>
              <input
                type="checkbox"
                id="layer-toggle-icebergs"
                name="layer-toggle-icebergs"
                checked={showIcebergs}
                onChange={onToggleIcebergs}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 cursor-pointer accent-sky-500"
              />
            </label>

            {/* Coastal Massifs & Research Stations */}
            <label className="flex items-center justify-between p-2.5 rounded bg-[#0b101b] border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
              <div className="flex items-center space-x-2.5">
                <MapPin className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="font-semibold text-white text-xs">Antarctic Research Stations</div>
                  <div className="text-[10px] font-mono text-slate-400">Maitri, Bharati, Novolazarevskaya</div>
                </div>
              </div>
              <input
                type="checkbox"
                id="layer-toggle-stations"
                name="layer-toggle-stations"
                checked={showStations}
                onChange={onToggleStations}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 cursor-pointer accent-sky-500"
              />
            </label>
          </div>
        </div>
      )}

      {/* Tab 2: Ice Hazards & ARPA Proximity Targets */}
      {activeTab === 'hazards' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          <div className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider px-1">
            ARPA Tracked Ice Hazards ({icebergs.length})
          </div>

          {icebergs.map((berg) => {
            const isCritical = berg.threatLevel?.includes('CRITICAL') || (berg.id === 'C-19' && anomalyActive);
            const dist = getDistanceAndBearing(telemetry.lat, telemetry.lon, berg.lat, berg.lon);

            return (
              <div 
                key={berg.id}
                className={`p-2.5 rounded border transition-colors ${
                  isCritical 
                    ? 'border-rose-700 bg-rose-950/40' 
                    : 'border-slate-800 bg-[#0b101b] hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-sm ${isCritical ? 'bg-rose-400 animate-ping' : 'bg-amber-400'}`} />
                    <span className="font-semibold text-white text-xs">Iceberg {berg.id}</span>
                  </div>
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-sm uppercase border ${
                    isCritical ? 'bg-rose-950 text-rose-300 border-rose-800' : 'bg-slate-800 text-amber-300 border-slate-700'
                  }`}>
                    {isCritical ? 'Critical CPA' : 'Monitored'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 my-2 text-[10px] text-slate-300 bg-slate-950/70 p-2 rounded-sm border border-slate-800/80 font-mono">
                  <div>Range: <span className="text-white font-semibold">{dist.distanceNm} NM</span></div>
                  <div>Bearing: <span className="text-white font-semibold">{dist.bearingDeg}° ({dist.compassDir})</span></div>
                  <div>Keel: <span className="text-sky-300 font-semibold">{Math.abs(berg.draftM || 235)}m</span></div>
                  <div>Drift: <span className="text-emerald-300 font-semibold">{berg.speedKn || 1.4} kn</span></div>
                </div>

                <div className="flex items-center justify-between px-2 py-1 mb-2 rounded bg-cyan-950/30 border border-cyan-500/20 text-[9.5px] font-mono text-cyan-300">
                  <span className="flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    <span>SATELLITE TRACK</span>
                  </span>
                  <span className="text-slate-400">SENTINEL-1 SAR / BYU</span>
                </div>

                <div className="flex items-center space-x-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      onFlyTo(berg.id);
                      onSelectEntity({
                        ...berg,
                        type: 'iceberg',
                        name: berg.name || `Iceberg ${berg.id}`,
                        subtitle: berg.subtitle || 'Tracked Antarctic Tabular Iceberg',
                        description: berg.description || `Drifting iceberg ${berg.id} tracked via Sentinel-1 SAR Radar satellite imagery and LSTM trajectory physics equations.`
                      });
                    }}
                    className="flex-1 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-semibold flex items-center justify-center space-x-1 border border-slate-700 transition-colors"
                  >
                    <Crosshair className="w-3 h-3 text-sky-400" />
                    <span>Focus</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenMiniTrack(berg)}
                    className="flex-1 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white text-[11px] font-semibold flex items-center justify-center space-x-1 transition-colors border border-sky-600"
                  >
                    <Activity className="w-3 h-3 text-sky-100" />
                    <span>Radar PiP</span>
                  </button>
                </div>
              </div>
            );
          })}

          {/* AIS Traffic / Simulated Training Fleet */}
          {vessels.length > 0 && (
            <div className="pt-2 space-y-2 border-t border-slate-800/80 mt-3">
              <div className="text-[10px] font-mono font-semibold text-amber-400 uppercase tracking-wider px-1 flex items-center justify-between">
                <span>Traffic Targets ({vessels.length})</span>
                <span className="text-[9px] text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-500/40">DEMO TARGETS</span>
              </div>

              {vessels.map((v) => {
                const dist = getDistanceAndBearing(telemetry.lat, telemetry.lon, v.lat, v.lon);
                return (
                  <div
                    key={v.mmsi}
                    className="p-2.5 rounded border border-amber-900/50 bg-amber-950/20 hover:border-amber-700/60 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="font-semibold text-white text-xs">{v.name}</span>
                      </div>
                      <span className="text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-600/50">
                        DEMO TARGET
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 my-2 text-[10px] text-slate-300 bg-slate-950/70 p-2 rounded-sm border border-slate-800/80 font-mono">
                      <div>Range: <span className="text-white font-semibold">{dist.distanceNm} NM</span></div>
                      <div>Bearing: <span className="text-white font-semibold">{dist.bearingDeg}° ({dist.compassDir})</span></div>
                      <div>Speed: <span className="text-amber-300 font-semibold">{v.speedKn || 10} kn</span></div>
                      <div>Heading: <span className="text-white font-semibold">{v.headingDeg || 90}°</span></div>
                    </div>

                    <div className="flex items-center space-x-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          onFlyTo(v.mmsi);
                          onSelectEntity({
                            type: 'vessel',
                            id: `vessel_${v.mmsi}`,
                            mmsi: String(v.mmsi),
                            name: `[DEMO] ${v.name}`,
                            subtitle: `DEMO / PRACTICE TARGET • ${(v.type || 'POLAR VESSEL').toUpperCase()} • MMSI ${v.mmsi}`,
                            lat: v.lat,
                            lon: v.lon,
                            speedKn: v.speedKn || 10.0,
                            headingDeg: v.headingDeg || 90.0,
                            destination: v.destination || 'Antarctic Station',
                            is_simulated: true,
                            is_demo: true,
                            status_label: 'DEMO / PRACTICE TARGET',
                            description: `Simulated practice vessel ${v.name} for collision avoidance testing. (In reality, this ship is currently operating in home waters / Russia outside the austral summer).`
                          });
                        }}
                        className="w-full py-1 rounded bg-amber-950/80 hover:bg-amber-900/80 text-amber-200 text-[11px] font-semibold flex items-center justify-center space-x-1 border border-amber-600/50 transition-colors"
                      >
                        <Crosshair className="w-3 h-3 text-amber-400" />
                        <span>Focus Demo Target</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Waypoint & Fairway Route Monitor */}
      {activeTab === 'waypoints' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider px-1">
            Maitri ➔ Bharati Route Plan ({waypoints.length} Waypoints)
          </div>

          <div className="space-y-1">
            {waypoints.map((wp, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === waypoints.length - 1;
              const isIndiaBay = idx === 1 && waypoints[0]?.lat <= -70.5 && wp.lat >= -70.1;
              const name = isFirst && wp.lat <= -70.5 
                ? 'Maitri Base (Overland Ice-Traverse)' 
                : isIndiaBay
                ? 'India Bay Fast-Ice Mooring (Fairway Start)'
                : isLast 
                ? 'Bharati Anchorage (Larsemann Hills)' 
                : `Fairway Waypoint ${idx}`;

              return (
                <div 
                  key={idx}
                  className="p-2 rounded bg-[#0b101b] border border-slate-800 flex items-center justify-between text-[11px]"
                >
                  <div className="flex items-center space-x-2">
                    <span className="w-5 h-5 rounded-sm bg-slate-800 text-slate-300 font-mono font-bold text-[10px] flex items-center justify-center shrink-0 border border-slate-700">
                      {idx}
                    </span>
                    <div>
                      <div className="font-semibold text-white text-[11px]">{name}</div>
                      <div className="text-[10px] font-mono text-slate-400">{Math.abs(wp.lat).toFixed(2)}°S, {Math.abs(wp.lon).toFixed(2)}°E</div>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <div className="text-sky-400 font-bold text-[11px]">{wp.speedKn || 13.5} kn</div>
                    <div className="text-[10px] text-slate-500">Leg {idx + 1}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 4: Tactical Dossier (Selected Entity) */}
      {activeTab === 'dossier' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {selectedEntity ? (
            <div className="space-y-2.5">
              {/* Entity Banner */}
              <div className="p-2.5 rounded bg-[#0b101b] border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">{selectedEntity.name || `Iceberg ${selectedEntity.id || ''}`}</span>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-sm uppercase bg-slate-800 text-sky-300 border border-slate-700">
                    {(selectedEntity.type || 'ICE HAZARD').toUpperCase()}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5">{selectedEntity.subtitle || 'Tracked Antarctic Maritime Target'}</div>
                {selectedEntity.lat !== undefined && selectedEntity.lon !== undefined && (
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">
                    Coordinates: {Math.abs(selectedEntity.lat).toFixed(3)}°S, {Math.abs(selectedEntity.lon).toFixed(3)}°E
                  </div>
                )}
              </div>

              {/* Technical Specifications */}
              {selectedEntity.type === 'iceberg' && (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Hydrodynamic &amp; Keel Specs</div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] bg-[#060a12] p-2 rounded border border-slate-800 font-mono">
                    <div>Submerged Keel: <span className="text-rose-400 font-bold">{Math.abs(selectedEntity.draftM || 235)}m</span></div>
                    <div>Freeboard Height: <span className="text-white font-bold">{selectedEntity.freeboardM || 45}m</span></div>
                    <div>Surface Area: <span className="text-white font-bold">{selectedEntity.surfaceAreaKm2 || 591} km²</span></div>
                    <div>Estimated Mass: <span className="text-white font-bold">{selectedEntity.massGt || 142} Gt</span></div>
                    <div>Drift Heading: <span className="text-emerald-400 font-bold">{selectedEntity.headingDeg || 285}° T</span></div>
                    <div>Drift Velocity: <span className="text-emerald-400 font-bold">{selectedEntity.speedKn || 1.4} kn</span></div>
                  </div>

                  <div className="p-2 rounded bg-[#0b101b] border border-slate-800 text-[10px] space-y-1">
                    <div className="font-bold text-slate-300">Radar &amp; Sensor Signature:</div>
                    <div className="text-slate-400 font-mono">{selectedEntity.radarSignature || 'Sentinel-1 C-Band SAR (-11.2 dB)'}</div>
                    <div className="font-bold text-slate-300 pt-1">Calving Origin:</div>
                    <div className="text-slate-400">{selectedEntity.calvingGlacier || 'Amery Ice Shelf'}</div>
                  </div>

                  <div className="flex items-center space-x-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onFlyTo(selectedEntity.id)}
                      className="flex-1 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-semibold flex items-center justify-center space-x-1 border border-slate-700 transition-colors"
                    >
                      <Crosshair className="w-3.5 h-3.5 text-sky-400" />
                      <span>FLY TO ICEBERG</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenMiniTrack(selectedEntity)}
                      className="flex-1 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-semibold flex items-center justify-center space-x-1 transition-colors border border-sky-600"
                    >
                      <Activity className="w-3.5 h-3.5 text-sky-100" />
                      <span>RADAR WINDOW</span>
                    </button>
                  </div>
                </div>
              )}

              {selectedEntity.type === 'station' && (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Facility &amp; Logistics Specs</div>
                  <div className="p-2 rounded bg-[#060a12] border border-slate-800 text-[10px] space-y-1 font-mono">
                    <div>Jurisdiction: <span className="text-emerald-400 font-bold">NCPOR / MoES India</span></div>
                    <div>Communications: <span className="text-white font-bold">VHF Ch 16 / HF 8291 kHz</span></div>
                    <div>Meteorological ID: <span className="text-white font-bold">WMO Antarctic #89514</span></div>
                    <div>Aviation Facility: <span className="text-white font-bold">Helipad &amp; Skiway Active</span></div>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed p-2 rounded bg-[#0b101b] border border-slate-800">
                    {selectedEntity.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => onFlyTo(selectedEntity.id)}
                    className="w-full py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-semibold flex items-center justify-center space-x-1 transition-colors border border-sky-600"
                  >
                    <Crosshair className="w-3.5 h-3.5 text-white" />
                    <span>FLY CAMERA TO BASE</span>
                  </button>
                </div>
              )}

              {selectedEntity.type === 'ship' && (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Vessel Propulsion &amp; Sonar Array</div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] bg-[#060a12] p-2 rounded border border-slate-800 font-mono">
                    <div>Ice Class: <span className="text-sky-400 font-bold">IACS PC4</span></div>
                    <div>Design Draft: <span className="text-white font-bold">8.5 m</span></div>
                    <div>Beam: <span className="text-white font-bold">22.0 m</span></div>
                    <div>Power: <span className="text-white font-bold">14,000 kW</span></div>
                    <div>Sonar: <span className="text-emerald-400 font-bold">12 kHz Multibeam</span></div>
                    <div>Radar: <span className="text-emerald-400 font-bold">X-Band &amp; S-Band</span></div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500 space-y-2">
              <Info className="w-8 h-8 mx-auto text-slate-600" />
              <div className="font-bold text-[11px] text-slate-400 font-mono">NO TARGET SELECTED</div>
              <div className="text-[10px] max-w-[220px] mx-auto text-slate-500">
                Click any vessel, iceberg, bathymetric sounding, or station on the chart to inspect technical specs.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: IMO Polar Code & Voyage Fuel Economics */}
      {activeTab === 'compliance' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider px-1">
            IMO Polar Code RIO &amp; Logistics Economics
          </div>

          {/* RIO Score Banner */}
          <div className={`p-3 rounded border ${rioData.bgClass}`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-400">Risk Index Outcome (RIO)</span>
                <div className="text-xl font-bold font-mono text-white flex items-baseline space-x-1.5">
                  <span className={rioData.color}>{rioData.rioScore > 0 ? `+${rioData.rioScore}` : rioData.rioScore}</span>
                  <span className="text-[10px] font-semibold text-slate-300">[{rioData.badgeLabel}]</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-mono text-slate-400">IACS HULL CLASS</span>
                <div className="text-xs font-bold text-white font-mono">PC4 (High Polar)</div>
              </div>
            </div>
            <div className="text-[10px] font-medium text-slate-300 mt-1">
              {rioData.statusText}
            </div>
          </div>

          {/* Economics Card */}
          <div className="p-2.5 rounded bg-[#0b101b] border border-slate-800 space-y-2">
            <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
              <Fuel className="w-3 h-3 text-amber-400" />
              <span>NCPOR Voyage Economics</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
              <div className="bg-[#060a12] p-2 rounded border border-slate-800/80">
                <span className="text-[9px] text-slate-400 block font-sans">Current MGO Burn</span>
                <span className="font-bold text-white text-sm">{fuelData.currentBurnMT} MT</span>
              </div>
              <div className="bg-[#060a12] p-2 rounded border border-slate-800/80">
                <span className="text-[9px] text-slate-400 block font-sans">Projected Total</span>
                <span className="font-bold text-sky-400 text-sm">{fuelData.projectedTotalMT} MT</span>
              </div>
              <div className="bg-[#060a12] p-2 rounded border border-slate-800/80">
                <span className="text-[9px] text-slate-400 block font-sans">Cost Saved (NCPOR)</span>
                <span className="font-bold text-emerald-400 text-sm">₹{fuelData.costSavedLakhs}L</span>
              </div>
              <div className="bg-[#060a12] p-2 rounded border border-slate-800/80">
                <span className="text-[9px] text-slate-400 block font-sans">CO₂ Abated</span>
                <span className="font-bold text-sky-300 text-sm">{fuelData.co2SavedMT} MT</span>
              </div>
            </div>
          </div>

          {/* Action to open Full Certificate Modal */}
          <button
            type="button"
            onClick={onOpenPolarCode}
            className="w-full py-2 rounded bg-sky-700 hover:bg-sky-600 text-white font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors border border-sky-600 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Open Polar Certificate Inspector</span>
          </button>
        </div>
      )}
    </aside>
  );
}
