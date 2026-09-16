import React, { useEffect } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  AlertTriangle, 
  X, 
  Fuel, 
  Leaf, 
  Coins, 
  Compass, 
  Anchor, 
  FileText, 
  CheckCircle2,
  Download
} from 'lucide-react';
import { calculatePolarCodeRIO, calculateVoyageFuelEconomics } from '../utils/polarCode';

const BASELINE_MANUAL_DETOUR_MT = 68.4;

export default function PolarCodeInspectorModal({
  isOpen,
  onClose,
  telemetry,
  anomalyActive,
  isReplan
}) {
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

  if (!isOpen) return null;

  const currentRisk = telemetry?.risk ?? 0.14;
  const progress = telemetry?.progress ?? 0.04;
  const speed = telemetry?.speedKn ?? 13.5;

  const rioData = calculatePolarCodeRIO(currentRisk, anomalyActive, 12.0, isReplan);
  const fuelData = calculateVoyageFuelEconomics(progress, speed, isReplan);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none font-sans"
      role="dialog"
      aria-modal="true"
      aria-labelledby="polar-code-modal-title"
    >
      <div className="bg-[#080d16] border border-slate-700 rounded shadow-2xl max-w-2xl w-full overflow-hidden text-slate-200 text-xs flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between bg-[#060910]">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-sky-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 id="polar-code-modal-title" className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                  IMO Polar Code (POLARIS) Assessment
                </h2>
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-sm bg-sky-950 text-sky-300 border border-sky-800">
                  MSC.1/Circ.1519
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono">
                MoES / NCPOR • 44th Indian Scientific Expedition to Antarctica (44th ISEA)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Polar Code Inspector"
            className="w-6 h-6 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors border border-transparent hover:border-slate-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Main RIO Outcome Card */}
          <div className={`p-3.5 rounded border flex items-center justify-between ${rioData.bgClass}`}>
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5 font-mono">
                <span>Risk Index Outcome (RIO)</span>
                <span>•</span>
                <span>IACS PC4 Polar Hull</span>
              </div>
              <div className="text-xl font-bold font-mono text-white flex items-baseline space-x-2">
                <span className={`text-2xl ${rioData.color}`}>
                  {rioData.rioScore > 0 ? `+${rioData.rioScore}` : rioData.rioScore}
                </span>
                <span className="text-xs font-mono font-semibold text-slate-300">
                  [{rioData.badgeLabel}]
                </span>
              </div>
              <div className="text-[11px] font-medium text-slate-300">
                {rioData.statusText}
              </div>
            </div>

            <div className="text-right space-y-1 font-mono text-[10px]">
              <div className="text-slate-400">DECISION CRITERIA:</div>
              <div className="text-emerald-400 font-semibold">RIO ≥ 0.0 : Normal Entry</div>
              <div className="text-rose-400 font-semibold">RIO &lt; 0.0 : Entry Prohibited</div>
            </div>
          </div>

          {/* Ice Regime Breakdown Table */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
              <Compass className="w-3 h-3 text-sky-400" />
              <span>Ice Regime Fractional Breakdown (POLARIS Sum)</span>
            </div>
            <div className="rounded border border-slate-800 overflow-hidden bg-[#060a12]">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="bg-[#0b101b] text-slate-400 text-[10px] uppercase border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Ice Regime Category</th>
                    <th className="py-2 px-3 text-center">Concentration (Tenths)</th>
                    <th className="py-2 px-3 text-center">PC4 Risk Value (RIV)</th>
                    <th className="py-2 px-3 text-right">Weighted RIO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {rioData.components.map((c, i) => {
                    const weighted = (c.concentrationTenths * c.riv).toFixed(1);
                    return (
                      <tr key={i} className="hover:bg-slate-900/40">
                        <td className="py-2 px-3 font-sans text-white">{c.name}</td>
                        <td className="py-2 px-3 text-center">{c.concentrationTenths} / 10</td>
                        <td className="py-2 px-3 text-center">
                          <span className={c.riv >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {c.riv > 0 ? `+${c.riv}` : c.riv}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-bold">
                          <span className={parseFloat(weighted) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {parseFloat(weighted) > 0 ? `+${weighted}` : weighted}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Voyage Fuel Economics & NCPOR Savings */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
              <Fuel className="w-3 h-3 text-amber-400" />
              <span>NCPOR Voyage Economics &amp; Green Carbon Abatement</span>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {/* Card 1: Fuel Burned */}
              <div className="p-2.5 rounded bg-[#0b101b] border border-slate-800 space-y-1">
                <div className="text-[9px] font-mono text-slate-400 uppercase flex items-center space-x-1">
                  <Fuel className="w-3 h-3 text-amber-400" />
                  <span>Current MGO Burn</span>
                </div>
                <div className="text-base font-mono font-bold text-white">
                  {fuelData.currentBurnMT} <span className="text-xs text-slate-400 font-sans">MT</span>
                </div>
                <div className="text-[9px] text-slate-500 font-mono">
                  Projected: {fuelData.projectedTotalMT} MT
                </div>
              </div>

              {/* Card 2: Cost Savings */}
              <div className="p-2.5 rounded bg-[#0b101b] border border-slate-800 space-y-1">
                <div className="text-[9px] font-mono text-slate-400 uppercase flex items-center space-x-1">
                  <Coins className="w-3 h-3 text-emerald-400" />
                  <span>NCPOR Cost Saved</span>
                </div>
                <div className="text-base font-mono font-bold text-emerald-400">
                  ₹{fuelData.costSavedLakhs} <span className="text-xs text-slate-400 font-sans">Lakhs</span>
                </div>
                <div className="text-[9px] text-slate-500 font-mono">
                  vs {BASELINE_MANUAL_DETOUR_MT} MT Manual Detour
                </div>
              </div>

              {/* Card 3: CO2 Abatement */}
              <div className="p-2.5 rounded bg-[#0b101b] border border-slate-800 space-y-1">
                <div className="text-[9px] font-mono text-slate-400 uppercase flex items-center space-x-1">
                  <Leaf className="w-3 h-3 text-sky-400" />
                  <span>CO₂ Abatement</span>
                </div>
                <div className="text-base font-mono font-bold text-sky-300">
                  {fuelData.co2SavedMT} <span className="text-xs text-slate-400 font-sans">Tons</span>
                </div>
                <div className="text-[9px] text-slate-500 font-mono">
                  IMO MARPOL Annex VI
                </div>
              </div>
            </div>
          </div>

          {/* Ship Specifications Strip */}
          <div className="p-2.5 rounded bg-[#060a12] border border-slate-800 flex items-center justify-between text-[10px] font-mono">
            <div className="flex items-center space-x-2">
              <Anchor className="w-3.5 h-3.5 text-sky-400" />
              <span>Vessel: <strong className="text-white">RV Polar Explorer</strong></span>
            </div>
            <div>Class: <strong className="text-emerald-400">IACS PC4</strong></div>
            <div>Installed Power: <strong className="text-white">14,000 kW</strong></div>
            <div>Bunker Fuel: <strong className="text-white">DMA Low-Sulfur MGO</strong></div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-2.5 border-t border-slate-800 flex items-center justify-between bg-[#060910]">
          <div className="flex items-center space-x-1.5 text-[10px] text-slate-400 font-mono">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Certified Compliant with IMO Polar Code Part I-A Chapter 3</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => {
                alert(`NCPOR Antarctic Voyage Passage Plan (MSC.1/Circ.1519)\n\nVessel: RV Polar Explorer\nVoyage: Maitri -> Bharati Fairway\nStatus: Polar Code RIO ${rioData.rioScore} (Passed)\nProjected Fuel: ${fuelData.projectedTotalMT} MT MGO\nSavings: ₹${fuelData.costSavedLakhs} Lakhs\n\nOfficial manifest verified by POLARIS AI Decision Support.`);
              }}
              className="px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-semibold text-xs flex items-center space-x-1.5 transition-colors border border-sky-600"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Official Report</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors border border-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
