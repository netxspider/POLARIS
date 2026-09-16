import React, { useState } from 'react';
import { Cpu, Navigation, RefreshCw, Compass } from 'lucide-react';

const DEFAULTS = {
  sourceLon: '11.73',
  sourceLat: '-70.77',
  destinationLon: '76.19',
  destinationLat: '-69.41'
};

export default function ModelRouteControls({ onRun, isLoading, modelStatus, onOpenPolarPlot }) {
  const [values, setValues] = useState(DEFAULTS);

  const update = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <section className="absolute right-3 top-16 z-30 w-[min(22rem,calc(100vw-1.5rem))] rounded border border-cyan-500/30 bg-[#07111b]/95 p-3 font-mono text-xs text-slate-200 shadow-2xl backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2 text-cyan-300">
          <Cpu className="h-4 w-4" />
          <span className="font-semibold tracking-wider">MODEL ROUTE SOLVER</span>
        </div>
        <span className={`h-2 w-2 rounded-full ${modelStatus?.status === 'ready' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        {[
          ['sourceLon', 'SOURCE LON'], ['sourceLat', 'SOURCE LAT'],
          ['destinationLon', 'DEST LON'], ['destinationLat', 'DEST LAT']
        ].map(([key, label]) => (
          <label key={key} className="text-[9px] uppercase text-slate-500">
            {label}
            <input
              value={values[key]}
              onChange={update(key)}
              type="number"
              step="any"
              className="mt-1 h-7 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={isLoading}
          onClick={() => onRun(values)}
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