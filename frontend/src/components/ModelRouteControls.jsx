import React, { useState } from 'react';
import { Cpu, Navigation, RefreshCw, Compass, MapPin, AlertTriangle } from 'lucide-react';

const REFERENCE_COORDINATES = [
  { name: '🇺🇸 Miami Port', lat: '25.788', lon: '-80.177' },
  { name: '🇺🇸 New York', lat: '40.712', lon: '-74.006' },
  { name: '🇿🇦 Cape Town', lat: '-33.924', lon: '18.424' },
  { name: '🇮🇳 Goa / Mormugao', lat: '15.400', lon: '73.800' },
  { name: '🇦🇶 Maitri Base', lat: '-70.770', lon: '11.730' },
  { name: '🇦🇶 Bharati Base (Dest)', lat: '-69.410', lon: '76.190' }
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

  const setSource = (lat, lon) => {
    setValues((prev) => ({ ...prev, sourceLat: lat, sourceLon: lon }));
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
    <section className="w-[min(23rem,calc(100vw-1.5rem))] rounded border border-cyan-500/30 bg-[#07111b]/95 p-3 font-mono text-xs text-slate-200 shadow-2xl backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2 text-cyan-300">
          <Cpu className="h-4 w-4" />
          <span className="font-semibold tracking-wider">MODEL ROUTE SOLVER</span>
        </div>
        <span className={`h-2 w-2 rounded-full ${modelStatus?.status === 'ready' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      </div>

      {/* Coordinate Reference Box */}
      <div className="mb-2.5 rounded bg-slate-950/80 border border-slate-800/90 p-2">
        <div className="flex items-center justify-between text-slate-400 font-semibold mb-1.5 text-[9px] uppercase tracking-wider">
          <span className="flex items-center gap-1 text-cyan-400">
            <MapPin className="w-3 h-3" />
            <span>Port Coordinates Reference:</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px]">
          {REFERENCE_COORDINATES.map((c) => (
            <div 
              key={c.name}
              onClick={() => {
                if (c.name.includes('Bharati')) {
                  setValues(v => ({ ...v, destinationLat: c.lat, destinationLon: c.lon }));
                } else {
                  setSource(c.lat, c.lon);
                }
              }}
              title="Click to insert into input field"
              className="flex items-center justify-between p-0.5 rounded hover:bg-slate-800/60 cursor-pointer transition-colors"
            >
              <span className="text-slate-400 truncate mr-1">{c.name.split(' ')[1] || c.name}:</span>
              <code className="text-cyan-300 font-mono shrink-0">{c.lat}, {c.lon}</code>
            </div>
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
            placeholder="e.g. -69.41"
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
            placeholder="e.g. 76.19"
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