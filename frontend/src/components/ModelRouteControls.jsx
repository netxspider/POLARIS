import React, { useState } from 'react';
import { Cpu, Navigation, RefreshCw, Compass, Anchor, AlertTriangle } from 'lucide-react';

const PRESETS = [
  { name: '🇺🇸 Miami Port', lat: '25.788', lon: '-80.177', destLat: '-69.41', destLon: '76.19' },
  { name: '🇺🇸 New York', lat: '40.712', lon: '-74.006', destLat: '-69.41', destLon: '76.19' },
  { name: '🇿🇦 Cape Town', lat: '-33.924', lon: '18.424', destLat: '-69.41', destLon: '76.19' },
  { name: '🇦🇶 Maitri Base', lat: '-70.77', lon: '11.73', destLat: '-69.41', destLon: '76.19' },
  { name: '🇮🇳 Goa / Mormugao', lat: '15.400', lon: '73.800', destLat: '-69.41', destLon: '76.19' }
];

const DEFAULTS = {
  sourceLat: '25.788',
  sourceLon: '-80.177',
  destinationLat: '-69.41',
  destinationLon: '76.19'
};

export default function ModelRouteControls({ onRun, isLoading, modelStatus, onOpenPolarPlot }) {
  const [values, setValues] = useState(DEFAULTS);

  const update = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const applyPreset = (preset) => {
    setValues({
      sourceLat: preset.lat,
      sourceLon: preset.lon,
      destinationLat: preset.destLat,
      destinationLon: preset.destLon
    });
  };

  const sLat = parseFloat(values.sourceLat);
  const sLon = parseFloat(values.sourceLon);
  const isMiamiPositiveLon = !isNaN(sLat) && !isNaN(sLon) && sLon > 0 && Math.abs(sLon - 80.18) < 3.0 && Math.abs(sLat - 25.79) < 3.0;

  const handleRun = () => {
    let finalValues = { ...values };
    // If user entered Miami coordinates with positive longitude, auto-negate to Western hemisphere
    if (isMiamiPositiveLon) {
      finalValues.sourceLon = `-${Math.abs(sLon)}`;
      setValues(finalValues);
    }
    onRun(finalValues);
  };

  return (
    <section className="absolute right-3 top-16 z-30 w-[min(23rem,calc(100vw-1.5rem))] rounded border border-cyan-500/30 bg-[#07111b]/95 p-3 font-mono text-xs text-slate-200 shadow-2xl backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2 text-cyan-300">
          <Cpu className="h-4 w-4" />
          <span className="font-semibold tracking-wider">MODEL ROUTE SOLVER</span>
        </div>
        <span className={`h-2 w-2 rounded-full ${modelStatus?.status === 'ready' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      </div>

      {/* Quick Port Presets */}
      <div className="mb-2.5">
        <div className="text-[9px] uppercase text-slate-400 flex items-center gap-1 mb-1 font-semibold">
          <Anchor className="w-3 h-3 text-cyan-400" />
          <span>Quick Departure Presets:</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors ${
                values.sourceLat === p.lat && values.sourceLon === p.lon
                  ? 'bg-cyan-600 text-white border-cyan-400 font-bold'
                  : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:border-cyan-500/60 hover:text-white'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Warning if American port was typed with positive longitude */}
      {isMiamiPositiveLon && (
        <div className="mb-2 p-2 bg-amber-950/80 border border-amber-500/70 rounded text-[10px] text-amber-200 flex flex-col gap-1.5">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong>Notice:</strong> Miami Port is West (<strong>-80.18°W</strong>). Entering positive <strong>+80.18°E</strong> places coordinates in inland India!
            </div>
          </div>
          <button
            type="button"
            onClick={() => setValues((v) => ({ ...v, sourceLon: `-${Math.abs(parseFloat(v.sourceLon))}` }))}
            className="self-start px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold text-[9px] transition-colors"
          >
            Auto-Fix to -{Math.abs(parseFloat(values.sourceLon))}°W (USA)
          </button>
        </div>
      )}

      {/* Coordinate Input Fields (Latitude First, then Longitude) */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-[9px] uppercase text-slate-400">
          <span>SOURCE LAT (°N / -°S)</span>
          <input
            value={values.sourceLat}
            onChange={update('sourceLat')}
            type="number"
            step="any"
            placeholder="e.g. 25.788"
            className="mt-1 h-7 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
          />
        </label>
        <label className="text-[9px] uppercase text-slate-400">
          <span>SOURCE LON (°E / -°W)</span>
          <input
            value={values.sourceLon}
            onChange={update('sourceLon')}
            type="number"
            step="any"
            placeholder="USA is - (e.g. -80.177)"
            className="mt-1 h-7 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
          />
        </label>
        <label className="text-[9px] uppercase text-slate-400">
          <span>DEST LAT (°N / -°S)</span>
          <input
            value={values.destinationLat}
            onChange={update('destinationLat')}
            type="number"
            step="any"
            className="mt-1 h-7 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
          />
        </label>
        <label className="text-[9px] uppercase text-slate-400">
          <span>DEST LON (°E / -°W)</span>
          <input
            value={values.destinationLon}
            onChange={update('destinationLon')}
            type="number"
            step="any"
            className="mt-1 h-7 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={isLoading}
          onClick={handleRun}
          className="flex h-8 w-full items-center justify-center gap-2 rounded border border-cyan-500/60 bg-cyan-950/70 text-[10px] font-semibold tracking-wider text-cyan-200 hover:bg-cyan-900 disabled:cursor-wait disabled:opacity-60 transition-colors"
        >
          {isLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
          {isLoading ? 'RUNNING ENGINES 1 / 2 / 3' : 'FETCH FEEDS + OPTIMIZE ROUTE'}
        </button>
        <button
          type="button"
          onClick={onOpenPolarPlot}
          className="flex h-7 w-full items-center justify-center gap-2 rounded border border-indigo-500/50 bg-indigo-950/70 text-[10px] font-semibold tracking-wider text-indigo-200 hover:bg-indigo-900/80 transition-colors"
        >
          <Compass className="h-3.5 w-3.5 text-indigo-400" />
          <span>VIEW ENGINE 3 POLAR PLOT</span>
        </button>
      </div>
      <div className="mt-2 text-[9px] leading-4 text-slate-500">
        Engine 1 ConvLSTM • Engine 2 XGBoost • Engine 3 time-dependent A*
        {modelStatus?.sources?.usnic && (
          <div className="mt-1 text-slate-400">Icebergs: {modelStatus.sources.usnic.source || 'fallback'} ({modelStatus.sources.usnic.count || 0})</div>
        )}
      </div>
    </section>
  );
}