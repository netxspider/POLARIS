import React, { useState } from 'react';
import { X, RefreshCw, Download, Compass, Maximize2 } from 'lucide-react';

export default function PolarPlotModal({ isOpen, onClose }) {
  const [loadKey, setLoadKey] = useState(Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  if (!isOpen) return null;

  const imageUrl = `/api/model/pipeline-plot.png?t=${loadKey}`;

  const handleRefresh = () => {
    setIsLoading(true);
    setHasError(false);
    setLoadKey(Date.now());
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `POLARIS_Engine3_Polar_Plot_${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col max-h-[92vh] w-full max-w-5xl rounded-xl border border-cyan-500/40 bg-[#07111b]/98 text-slate-100 shadow-2xl font-mono overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#091726] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
              <Compass className="h-4 w-4 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-wider text-cyan-200">
                  POLARIS POLAR STEREOGRAPHIC ROUTE PIPELINE
                </h3>
                <span className="rounded bg-cyan-950 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-400 border border-cyan-800">
                  ENGINE 3
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                South Polar Stereographic (45°E) • ConvLSTM SIC • Engine 2 XGBoost Drift • Dynamic A*
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[10px] text-slate-300 hover:bg-slate-800 hover:text-cyan-300 transition-colors"
              title="Refresh Plot"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[10px] text-slate-300 hover:bg-slate-800 hover:text-cyan-300 transition-colors"
              title="Download Plot PNG"
            >
              <Download className="h-3 w-3" />
              <span>Download</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/80 text-slate-400 hover:bg-red-950/80 hover:border-red-600 hover:text-red-200 transition-colors"
              title="Close modal (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Body / Image View */}
        <div className="relative flex-1 min-h-[420px] max-h-[72vh] flex items-center justify-center bg-[#030910] p-3 overflow-auto">
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#030910]/80 z-10">
              <RefreshCw className="h-6 w-6 animate-spin text-cyan-400" />
              <span className="text-xs text-cyan-300 font-semibold">Generating Polar Stereographic Plot...</span>
              <span className="text-[10px] text-slate-500">Executing Cartopy South Polar projection & rendering layers</span>
            </div>
          )}

          {hasError ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
              <div className="text-amber-400 text-sm font-bold">Failed to load Polar Plot</div>
              <p className="text-xs text-slate-400 max-w-md">
                Could not retrieve /api/model/pipeline-plot.png. Ensure the backend model pipeline has completed its route execution.
              </p>
              <button
                type="button"
                onClick={handleRefresh}
                className="mt-2 rounded bg-cyan-900 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-800"
              >
                Retry Generation
              </button>
            </div>
          ) : (
            <img
              src={imageUrl}
              alt="POLARIS Full Pipeline Polar Route Plot"
              className={`max-h-full max-w-full rounded-md object-contain transition-opacity duration-300 ${
                isLoading ? 'opacity-0' : 'opacity-100'
              }`}
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setHasError(true);
              }}
            />
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-[#07111b] px-4 py-2.5 text-[9px] text-slate-400">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-400 inline-block" />
              <span>Engine 1: 72h ConvLSTM SIC Forecast (Blues_r Colormap)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-magenta-400 inline-block" style={{ backgroundColor: '#ff00ff' }} />
              <span>Engine 2: XGBoost 13-Feature Drift Vectors</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
              <span>Engine 3: Dynamic Polar A* Least-Risk Fairway</span>
            </span>
          </div>
          <span className="text-slate-500">Maitri Station (-70.77°S, 11.73°E) ➔ Bharati Station (-69.41°S, 76.19°E)</span>
        </div>
      </div>
    </div>
  );
}
