import React from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Crosshair, 
  Waves, 
  Compass, 
  Wind, 
  Thermometer, 
  Gauge,
  Anchor,
  Activity,
  Fuel,
  ShieldCheck
} from 'lucide-react';
import { calculatePolarCodeRIO, calculateVoyageFuelEconomics } from '../utils/polarCode';

export default function MarineBridgeConsole({
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onChangeSpeed,
  onReset,
  onSeek,
  onLocateShip,
  telemetry,
  weather,
  anomalyActive = false,
  isReplan = false,
  scenarioData = null,
  onOpenPolarCode,
  onOpenEchogram
}) {
  const speeds = [50, 200, 500, 1000, 2500];
  const progressPercent = Math.round((telemetry?.progress ?? 0) * 100);

  // Marine corridor calculation
  const totalDistanceNm = scenarioData?.route?.summary?.totalDistanceNm ?? 1780;

  // Bathymetric Sounding Depth & Under-Keel Clearance (UKC)
  const depthM = telemetry?.depthM ?? Math.abs(weather?.bathymetricDepthM ?? 2450);
  const vesselDraftM = telemetry?.draftM ?? 8.5;
  const ukcM = telemetry?.ukcM ?? Math.max(0, depthM - vesselDraftM);

  const isShelf = depthM < 500;
  const isSlope = depthM >= 500 && depthM < 2500;
  const seabedClass = isShelf
    ? 'CONTINENTAL SHELF'
    : isSlope
    ? 'CONTINENTAL SLOPE'
    : 'ABYSSAL OCEAN BASIN';

  const seabedColor = isShelf
    ? 'text-emerald-400'
    : isSlope
    ? 'text-sky-400'
    : 'text-indigo-300';

  const riskPercent = Math.round((telemetry?.risk ?? 0.14) * 100);
  const riskColor = riskPercent > 60 ? 'text-rose-400' : riskPercent > 30 ? 'text-amber-400' : 'text-emerald-400';

  // IMO Polar Code RIO & MGO Fuel Consumption
  const rioData = calculatePolarCodeRIO(telemetry?.risk ?? 0.14, anomalyActive, 12.0, isReplan);
  const fuelData = calculateVoyageFuelEconomics(telemetry?.progress ?? 0, telemetry?.speedKn ?? 13.5, isReplan);

  return (
    <footer className="fixed bottom-0 left-0 right-0 h-14 bg-[#080c14] border-t border-slate-800 z-30 px-3 select-none font-sans shadow-2xl">
      <div className="grid grid-cols-12 items-center h-full divide-x divide-slate-800/90 max-w-full">
        {/* Bay 1: Interactive Echosounder & Depth Sounding (Cols 1-2) */}
        <button
          type="button"
          onClick={onOpenEchogram}
          title="Click to Open Subsea Bathymetric Echogram & Sonar Profile"
          aria-label="Open Subsea Echogram"
          className="col-span-2 pr-3 flex items-center gap-2.5 hover:bg-slate-800/40 p-1 rounded transition-colors text-left cursor-pointer group"
        >
          <div className="w-7 h-7 rounded bg-[#0b101b] group-hover:bg-sky-950/80 border border-slate-700/80 group-hover:border-sky-500/50 flex items-center justify-center text-sky-400 shrink-0 transition-colors">
            <Waves className="w-4 h-4 group-hover:animate-pulse" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 truncate">
              <span>DEPTH</span>
              <span className="text-slate-600">•</span>
              <span className={`font-bold ${seabedColor}`}>{seabedClass}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold text-white font-mono tabular-nums">
                {Math.round(depthM).toLocaleString()}m
              </span>
              <span className="text-[10px] text-slate-400 font-mono hidden xl:inline">
                UKC: <strong className="text-emerald-400 font-semibold">{Math.round(ukcM).toLocaleString()}m</strong>
              </span>
              <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-sky-950/80 text-sky-300 border border-sky-700/60 hidden 2xl:inline group-hover:border-sky-400">
                ECHOGRAM ↗
              </span>
            </div>
          </div>
        </button>

        {/* Bay 2: Antarctic Fairway Scrubber Track (Cols 3-5) */}
        <div className="col-span-3 px-3 flex flex-col justify-center gap-1 min-w-0">
          <div className="w-full flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span className="truncate">
              Maitri <span className="text-slate-500">(11.7°E)</span> ➔ Bharati <span className="text-slate-500">(76.2°E)</span>
            </span>
            <span className="text-slate-500 hidden xl:inline">{totalDistanceNm.toLocaleString()} NM</span>
          </div>
          <div className="w-full flex items-center gap-2">
            <input
              type="range"
              id="voyage-scrubber-slider"
              name="voyage-scrubber"
              min="0"
              max="1"
              step="0.001"
              aria-label="Voyage progress scrubber"
              value={telemetry?.progress ?? 0}
              onChange={(e) => onSeek && onSeek(parseFloat(e.target.value))}
              onInput={(e) => onSeek && onSeek(parseFloat(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer focus:outline-none"
              title="Scrub along Antarctic navigation fairway"
            />
            <span className="text-[10px] font-mono font-bold text-sky-300 px-1.5 py-0.2 rounded-sm bg-sky-950 border border-sky-800 shrink-0">
              {progressPercent}%
            </span>
          </div>
        </div>

        {/* Bay 3: Engine Propulsion & Simulation Speed (Cols 6-8) */}
        <div className="col-span-3 px-3 flex items-center justify-center gap-2 shrink-0">
          {/* Play/Pause Button */}
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? "Pause simulation" : "Play simulation"}
            className="w-7 h-7 rounded bg-sky-700 hover:bg-sky-600 text-white flex items-center justify-center transition-colors shadow-xs shrink-0"
            title={isPlaying ? "Pause voyage" : "Start voyage"}
          >
            {isPlaying ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
          </button>

          {/* Reset Button */}
          <button
            type="button"
            onClick={onReset}
            aria-label="Reset simulation to Maitri Station"
            className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 flex items-center justify-center transition-colors shrink-0"
            title="Reset to Maitri Departure"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          {/* Follow Vessel Button */}
          <button
            type="button"
            onClick={onLocateShip}
            aria-label="Follow Vessel"
            className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-white border border-slate-700 flex items-center justify-center transition-colors shrink-0"
            title="Center Camera on Vessel"
          >
            <Crosshair className="w-3 h-3" />
          </button>

          {/* Speed Multipliers */}
          <div 
            className="bg-[#0b101b] border border-slate-800 rounded p-0.5 flex items-center h-7 ml-0.5 shrink-0"
            role="radiogroup" 
            aria-label="Playback multiplier"
            onKeyDown={(e) => {
              const curIdx = speeds.indexOf(playbackSpeed);
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIdx = (curIdx + 1) % speeds.length;
                onChangeSpeed(speeds[nextIdx]);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIdx = (curIdx - 1 + speeds.length) % speeds.length;
                onChangeSpeed(speeds[prevIdx]);
              }
            }}
          >
            {speeds.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={playbackSpeed === s}
                tabIndex={playbackSpeed === s ? 0 : -1}
                onClick={() => onChangeSpeed(s)}
                className={`px-1.5 h-5 rounded-sm text-[9px] font-mono font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-sky-400 ${
                  playbackSpeed === s
                    ? 'bg-slate-700 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Bay 4: Navigational Telemetry (Cols 9-10) */}
        <div className="col-span-2 px-3 flex items-center justify-around text-xs font-mono">
          {/* SOG / COG */}
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-400 font-sans uppercase tracking-wider">SOG / COG</span>
            <span className="text-white font-bold tabular-nums">
              {(telemetry?.speedKn || 13.5).toFixed(1)} kn <span className="text-slate-500">/</span> {(telemetry?.heading || 86).toFixed(0)}°
            </span>
          </div>

          {/* True Wind */}
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-400 font-sans uppercase tracking-wider flex items-center gap-1">
              <Wind className="w-2.5 h-2.5 text-sky-400" />
              <span>True Wind</span>
            </span>
            <span className="text-white font-bold tabular-nums">
              {telemetry?.trueWind?.speedKn ?? weather?.windSpeedKn ?? weather?.windSpeedKnots ?? 18} kn
            </span>
          </div>
        </div>

        {/* Bay 5: Polar Code & Environmental Logistics (Cols 11-12) */}
        <div className="col-span-2 pl-3 flex items-center justify-around text-xs font-mono">
          {/* Ice Risk */}
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-400 font-sans uppercase tracking-wider">Ice Conc</span>
            <span className={`font-bold tabular-nums ${riskColor}`}>
              {riskPercent}%
            </span>
          </div>

          {/* Fuel MGO */}
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-400 font-sans uppercase tracking-wider flex items-center gap-1">
              <Fuel className="w-2.5 h-2.5 text-amber-400" />
              <span>Fuel</span>
            </span>
            <span className="text-slate-200 font-bold tabular-nums">
              {fuelData.currentBurnMT} MT
            </span>
          </div>

          {/* Polar Code RIO Button */}
          <button
            type="button"
            onClick={onOpenPolarCode}
            className="flex flex-col text-left group cursor-pointer"
            title="Inspect IMO Polar Code (POLARIS / RIO) Safety Certificate"
          >
            <span className="text-[9px] text-slate-400 font-sans uppercase tracking-wider group-hover:text-white flex items-center gap-0.5">
              <span>RIO (PC4)</span>
            </span>
            <span className={`font-bold tabular-nums group-hover:underline ${rioData.color}`}>
              {rioData.rioScore > 0 ? `+${rioData.rioScore}` : rioData.rioScore}
            </span>
          </button>
        </div>
      </div>
    </footer>
  );
}
