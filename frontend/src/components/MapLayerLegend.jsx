import React from 'react';

const ICE_STOPS = [
  ['#08306b', '0% open'],
  ['#2171b5', '25%'],
  ['#6baed6', '50%'],
  ['#c6dbef', '75%'],
  ['#f7fbff', '100% pack']
];

export default function MapLayerLegend({ showRiskGrid, showBathymetry, forecastStep, onForecastStepChange, isModelRoute }) {
  if (!showRiskGrid && !showBathymetry) return null;

  return (
    <aside className="pointer-events-auto absolute right-3 top-[23rem] z-30 w-60 rounded-lg border border-slate-700/80 bg-[#07111b]/95 p-3 font-mono text-[10px] text-slate-200 shadow-2xl backdrop-blur-md">
      {showRiskGrid && (
        <div className="mb-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold tracking-wider text-cyan-200">
            <span>SEA-ICE CONCENTRATION</span>
            {isModelRoute && <span className="rounded bg-cyan-950 px-1 py-0.2 text-[8px] font-semibold text-emerald-400 border border-emerald-800">ENGINE 1</span>}
          </div>
          <div className="h-2 rounded-sm border border-slate-800" style={{ background: 'linear-gradient(90deg, #08306b, #2171b5, #6baed6, #c6dbef, #f7fbff)' }} />
          <div className="mt-1 grid grid-cols-5 gap-1 text-[8px] text-slate-400">
            {ICE_STOPS.map(([, label]) => <span key={label} className="text-center first:text-left last:text-right">{label}</span>)}
          </div>
          <div className="mt-1 text-[8px] text-slate-500">Blues_r Antarctic colormap (open ocean transparent)</div>
          {isModelRoute && (
            <label className="mt-2.5 block text-slate-400 border-t border-slate-800/80 pt-2">
              <div className="flex justify-between">
                <span>Forecast horizon:</span>
                <span className="text-cyan-300 font-bold">+{forecastStep * 24}h ({forecastStep === 0 ? 'Day 1' : forecastStep === 1 ? 'Day 2' : 'Day 3'})</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="1"
                value={forecastStep}
                onChange={(event) => onForecastStepChange(Number(event.target.value))}
                className="mt-1.5 w-full accent-cyan-400 cursor-pointer"
                aria-label="Sea-ice forecast horizon"
              />
              <div className="flex justify-between text-[8px] text-slate-500"><span>NOW</span><span>24H</span><span>48H</span></div>
            </label>
          )}
        </div>
      )}
      {showBathymetry && (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold tracking-wider text-sky-200">
            <span>BATHYMETRY DEPTH</span>
            <span className="text-[8px] text-slate-400">IBCSO</span>
          </div>
          <div className="h-2 rounded-sm border border-slate-800" style={{ background: 'linear-gradient(90deg, #440154, #3b528b, #21918c, #5ec962, #fde725)' }} />
          <div className="mt-1 grid grid-cols-3 gap-1 text-[8px] text-slate-400">
            <span>DEEP (-5500m)</span><span className="text-center">SHELF</span><span className="text-right">COAST (0m)</span>
          </div>
          <div className="mt-1 text-[8px] text-slate-500">Land & ice-sheet masked (100% transparent)</div>
        </div>
      )}
    </aside>
  );
}