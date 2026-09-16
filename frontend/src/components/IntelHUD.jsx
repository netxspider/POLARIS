import React, { useState, useEffect, useMemo } from 'react';
import { forward as toMGRS } from 'mgrs';

const THEME_COLORS = {
  night: {
    text: '#fbbf24',
    glow: 'rgba(251, 191, 36, 0.5)',
    border: 'rgba(251, 191, 36, 0.4)',
    bg: 'rgba(24, 16, 4, 0.65)',
    modeLabel: 'ECDIS NIGHT WATCH (IHO S-52)'
  },
  radar: {
    text: '#34d399',
    glow: 'rgba(52, 211, 153, 0.5)',
    border: 'rgba(52, 211, 153, 0.4)',
    bg: 'rgba(4, 24, 16, 0.65)',
    modeLabel: 'RADAR SAR ICE DISCRIMINATION'
  },
  snow: {
    text: '#7dd3fc',
    glow: 'rgba(125, 211, 252, 0.5)',
    border: 'rgba(125, 211, 252, 0.4)',
    bg: 'rgba(4, 18, 30, 0.65)',
    modeLabel: 'POLAR BLIZZARD CONDITIONS'
  },
  normal: {
    text: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.45)',
    border: 'rgba(56, 189, 248, 0.3)',
    bg: 'rgba(8, 15, 26, 0.65)',
    modeLabel: 'ECDIS DAY STANDARD (IEC 62288)'
  }
};

/**
 * Marine ECDIS Bridge Navigation HUD Overlay (IEC 62288 / IHO S-52 Standards)
 * Rendered non-intrusively on top of the Cesium chart canvas.
 *
 * Displays official MoES / NCPOR expedition parameters, vessel telemetry,
 * polar grid datums (WGS-84 / EPSG:3031), radar / SAR status, and UTC chronometer.
 */
export default function IntelHUD({
  active = true,
  tacticalStyle = 'normal',
  cameraInfo = {},
  telemetry = {},
  scenarioData = null,
  anomalyActive = false,
  satelliteCount = 5,
  isDrawerOpen = true,
  streamMode = 'live',
  liveData = null,
  activeOverpass = null
}) {
  const [recBlink, setRecBlink] = useState(true);
  const [utcTime, setUtcTime] = useState(() => new Date().toISOString().slice(11, 19) + 'Z');
  const [utcDate, setUtcDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setUtcTime(now.toISOString().slice(11, 19) + 'Z');
      setUtcDate(now.toISOString().slice(0, 10));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const blinkTimer = setInterval(() => {
      setRecBlink((b) => !b);
    }, 1000);
    return () => clearInterval(blinkTimer);
  }, []);

  const theme = THEME_COLORS[tacticalStyle] || THEME_COLORS.normal;

  const lat = cameraInfo?.lat ?? telemetry?.lat ?? -70.77;
  const lon = cameraInfo?.lon ?? telemetry?.lon ?? 11.73;

  const mgrsCoord = useMemo(() => {
    try {
      const clampedLat = Math.max(-79.9, Math.min(83.9, lat));
      const raw = toMGRS([lon, clampedLat]);
      if (!raw) return '33VWX 12345 67890';
      return raw.replace(/([A-Z]+)(\d{5})(\d{5})/, '$1 $2 $3');
    } catch {
      return '33DUL 82415 69321';
    }
  }, [lat, lon]);

  const altKm = cameraInfo?.altitudeKm ?? 5200;
  const gsdM = (altKm * 0.00035).toFixed(2);
  const onaDeg = Math.abs(cameraInfo?.pitchDeg ? 90 + cameraInfo.pitchDeg : 45).toFixed(1);

  const formatDMS = (val, isLat) => {
    const abs = Math.abs(val);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = Math.floor(((abs - d) * 60 - m) * 60);
    const hemi = isLat ? (val >= 0 ? 'N' : 'S') : val >= 0 ? 'E' : 'W';
    return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"${hemi}`;
  };

  if (!active) return null;

  return (
    <div 
      className="pointer-events-none absolute inset-0 z-20 select-none font-mono transition-colors duration-500"
      style={{
        color: theme.text,
        textShadow: `0 0 4px ${theme.glow}`
      }}
      aria-label="Marine Bridge Navigation ECDIS HUD Overlay"
    >
      {/* Top Official Institutional Banner (MoES / NCPOR) */}
      <div 
        className="absolute top-14 flex items-center justify-between px-4 py-1 text-[9px] tracking-[0.18em] border backdrop-blur-md rounded-sm transition-all duration-300"
        style={{
          borderColor: theme.border,
          backgroundColor: theme.bg,
          left: isDrawerOpen ? 'calc(24rem + (100vw - 24rem) / 2)' : '50%',
          transform: 'translateX(-50%)',
          width: 'min(760px, calc(100vw - 420px))'
        }}
      >
        <span className="font-semibold opacity-90 hidden md:inline">MoES / NCPOR • 44TH INDIAN SCIENTIFIC EXPEDITION</span>
        <span className="font-bold">POLARIS-ECDIS // BRIDGE WATCH // PC4</span>
        <span className="opacity-90 hidden sm:inline">GOVT OF INDIA</span>
      </div>

      {/* Top-Left Watch Context Bracket */}
      <div 
        className={`absolute top-20 flex items-start space-x-2 text-xs transition-all duration-300 ${
          isDrawerOpen ? 'left-[404px]' : 'left-6'
        }`}
      >
        <span className="text-2xl leading-none opacity-80 select-none">┌</span>
        <div className="space-y-1">
          <div className="text-[10px] tracking-[0.16em] font-bold opacity-90">
            SYSTEM: ECDIS S-52 / IEC 62288 BRIDGE WATCH
          </div>
          <div className="text-[11px] tracking-wider opacity-85">
            DISPLAY: {theme.modeLabel}
          </div>
          <div className="text-sm font-bold tracking-[0.2em] mt-0.5">
            CORRIDOR: MAITRI ➔ BHARATI
          </div>
          <div className="text-[10px] tracking-wider opacity-80 mt-0.5 max-w-xs leading-relaxed">
            {anomalyActive 
              ? 'ALERT: HAZARD AVOIDANCE • 4D SPATIOTEMPORAL RE-PLAN ACTIVE • RIO SAFE'
              : 'STATUS: OPTIMAL MARITIME FAIRWAY • DUAL RADAR & SATELLITE PASS ACTIVE'}
          </div>
          <div className="text-[9px] tracking-widest opacity-90 mt-1 flex items-center gap-1.5 font-bold">
            <span className={`inline-block w-2 h-2 rounded-full ${streamMode === 'live' ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]' : 'bg-amber-400'}`} />
            <span>{streamMode === 'live' ? 'LIVE STREAM (1 Hz)' : 'VOYAGE SIMULATION'}</span>
          </div>
        </div>
      </div>

      {/* Top-Right Chronometer & Satellite Tracking */}
      <div className="absolute top-20 right-6 flex items-start space-x-2 text-xs text-right">
        <div className="space-y-1">
          <div className="flex items-center justify-end space-x-2 text-[11px] font-bold tracking-wider">
            <span 
              className="inline-block w-2.5 h-2.5 rounded-full mr-1 transition-opacity duration-200"
              style={{
                backgroundColor: theme.text,
                boxShadow: `0 0 6px ${theme.glow}`,
                opacity: recBlink ? 1 : 0.4
              }}
            />
            <span>NAV CHRONO</span>
            <span className="opacity-95 font-mono">{utcDate} {utcTime}</span>
          </div>
          <div className="text-[10px] tracking-wider opacity-80">
            SATELLITES: {satelliteCount} POLAR ORBITERS TRACKED (SGP4)
          </div>
          <div className="text-[10px] tracking-wider opacity-80">
            POLAR ALTIMETRY: CRYO-SURFACE TELEMETRY ACTIVE
          </div>
        </div>
        <span className="text-2xl leading-none opacity-80 select-none">┐</span>
      </div>

      {/* Bottom-Left Position & Geodetic Datum */}
      <div 
        className={`absolute bottom-28 flex items-end space-x-2 text-xs transition-all duration-300 ${
          isDrawerOpen ? 'left-[404px]' : 'left-6'
        }`}
      >
        <span className="text-2xl leading-none opacity-80 select-none">└</span>
        <div className="space-y-1">
          <div className="text-sm font-bold tracking-[0.16em]">
            GRID: {mgrsCoord}
          </div>
          <div className="text-xs tracking-widest opacity-90 font-mono">
            {formatDMS(lat, true)} {formatDMS(lon, false)}
          </div>
          <div className="text-[10px] tracking-wider opacity-75">
            DATUM: WGS-84 • ANTARCTIC POLAR STEREOGRAPHIC (EPSG:3031)
          </div>
        </div>
      </div>

      {/* Bottom-Right Vessel Optics & Telemetry */}
      <div className="absolute bottom-28 right-6 flex items-end space-x-2 text-xs text-right">
        <div className="space-y-1">
          <div className="text-[11px] tracking-wider opacity-90">
            VIEW ALTITUDE: {Math.round(altKm).toLocaleString()} KM • TILT: {onaDeg}°
          </div>
          <div className="text-xs font-bold tracking-[0.15em]">
            VESSEL: RV POLAR EXPLORER (IACS PC4)
          </div>
          <div className="text-[10px] tracking-wider opacity-80">
            SOG: {(telemetry?.speedKn || 13.5).toFixed(1)} KTS • HEADING: {(telemetry?.heading || 86).toFixed(0)}° T
          </div>
        </div>
        <span className="text-2xl leading-none opacity-80 select-none">┘</span>
      </div>
    </div>
  );
}
