import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CesiumViewer from './components/CesiumViewer';
import MarineBridgeHeader from './components/MarineBridgeHeader';
import MarinePlotterDrawer from './components/MarinePlotterDrawer';
import MarineBridgeConsole from './components/MarineBridgeConsole';
import SatelliteTrackMiniWindow from './components/SatelliteTrackMiniWindow';
import BathymetricEchogramMiniWindow from './components/BathymetricEchogramMiniWindow';
import PolarCodeInspectorModal from './components/PolarCodeInspectorModal';
import IntelHUD from './components/IntelHUD';
import TacticalEntityOverlay from './components/TacticalEntityOverlay';
import useRealtimeStream from './services/useRealtimeStream';
import { 
  fetchConfig, 
  setConfigDemoMode, 
  fetchScenario, 
  requestReplan, 
  fetchWeather,
  fetchGeeStatus
} from './services/api';
import { requestModelRoute, fetchModelStatus } from './services/api';
import ModelRouteControls from './components/ModelRouteControls';
import MapLayerLegend from './components/MapLayerLegend';
import PolarPlotModal from './components/PolarPlotModal';

export default function App() {
  const viewerRef = useRef(null);

  // Milestone 2: Real-time WebSocket Client & Dual-Mode State
  const {
    isConnected: isWsConnected,
    status: wsStatus,
    liveData,
    error: wsError,
    reconnect: reconnectWs
  } = useRealtimeStream();

  const [streamMode, setStreamMode] = useState('live'); // 'live' | 'simulation'

  const [demoMode, setDemoMode] = useState(true);
  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [anomalyActive, setAnomalyActive] = useState(false);
  const [scenarioData, setScenarioData] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(500);
  const [showPolarModal, setShowPolarModal] = useState(false);

  // 3D Camera Modes: 'globe' | 'chase' | '2d'
  const [cameraMode, setCameraMode] = useState('globe');
  const [cameraInfo, setCameraInfo] = useState({
    altitudeKm: 5200,
    headingDeg: 0,
    pitchDeg: -45,
    lat: -70.0,
    lon: 44.0
  });

  const [selectedEntity, setSelectedEntity] = useState(null);
  const [miniTrackBerg, setMiniTrackBerg] = useState(null);
  const [isEchogramOpen, setIsEchogramOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [isPolarCodeOpen, setIsPolarCodeOpen] = useState(false);

  // 3D Visual layer toggles
  const [mapStyle, setMapStyle] = useState('google-satellite'); // 'google-satellite' | 'esri-satellite' | 'google-hybrid'
  const [tacticalStyle, setTacticalStyle] = useState('normal'); // 'normal' | 'surveillance' | 'thermal' | 'retro' | 'snow'
  const [showIntelHud, setShowIntelHud] = useState(true);
  const [showSatellites, setShowSatellites] = useState(false);
  const [showRiskGrid, setShowRiskGrid] = useState(true);
  const [showGeeSeaIce, setShowGeeSeaIce] = useState(false);
  const [geeStatus, setGeeStatus] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [forecastStep, setForecastStep] = useState(0);
  const [showIcebergs, setShowIcebergs] = useState(true);
  const [showMountains, setShowMountains] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [showBathymetry, setShowBathymetry] = useState(true);
  const [showSatelliteTracks, setShowSatelliteTracks] = useState(false);
  const [activeOverpass, setActiveOverpass] = useState(null);

  // Live telemetry & marine weather
  const [telemetry, setTelemetry] = useState({
    lat: -70.77,
    lon: 11.73,
    heading: 86.0,
    speedKn: 13.5,
    risk: 0.14,
    timeIso: '2026-09-07T00:00:00Z'
  });
  const [weather, setWeather] = useState(null);

  // Load Scenario Data
  const loadScenario = useCallback(async (isLive = false, isAnomaly = false) => {
    try {
      setIsLiveLoading(true);
      const data = await fetchScenario(isLive, isAnomaly);
      setScenarioData(data);
    } catch (err) {
      console.error('Failed to load scenario:', err);
    } finally {
      setIsLiveLoading(false);
    }
  }, []);

  // Initial Load
  useEffect(() => {
    async function init() {
      try {
        const cfg = await fetchConfig();
        setDemoMode(cfg.demo_mode);
        await loadScenario(!cfg.demo_mode, false);
      } catch (e) {
        console.warn('API config unavailable, loading fallback scenario...', e);
        await loadScenario(false, false);
      }

      // Fetch GEE Engine status
      try {
        const gStatus = await fetchGeeStatus();
        setGeeStatus(gStatus);
      } catch (err) {
        console.warn('GEE status fetch fallback:', err);
      }
      try {
        setModelStatus(await fetchModelStatus());
      } catch (err) {
        console.warn('Model pipeline status unavailable:', err);
      }
    }
    init();
  }, [loadScenario]);

  const handleModelRoute = async (values) => {
    try {
      setIsModelLoading(true);
      const result = await requestModelRoute(values.sourceLat, values.sourceLon, values.destinationLat, values.destinationLon);
      setScenarioData({ ...result, isModelRoute: true, isReplan: false });
      setModelStatus((current) => ({ ...current, lastRefresh: result.generatedAt, sources: result.sources }));
      setShowRiskGrid(true);
      setShowIcebergs(true);
      setShowSatellites(false);
      setShowSatelliteTracks(false);
      setForecastStep(0);
      setStreamMode('simulation');
    } catch (err) {
      console.error('Model route generation failed:', err);
    } finally {
      setIsModelLoading(false);
    }
  };

  // Handle Demo Mode Toggle (Phase 6)
  const handleToggleDemoMode = async (newMode) => {
    try {
      setIsLiveLoading(true);
      await setConfigDemoMode(newMode);
      setDemoMode(newMode);
      await loadScenario(!newMode, anomalyActive);
    } catch (err) {
      console.error('Failed to switch demo mode:', err);
    } finally {
      setIsLiveLoading(false);
    }
  };

  // Handle Anomaly Injection & Replan (Phase 5)
  const handleTriggerAnomaly = async () => {
    if (anomalyActive) {
      setAnomalyActive(false);
      await loadScenario(!demoMode, false);
      return;
    }

    try {
      setAnomalyActive(true);
      const curLat = telemetry?.lat ?? -67.5;
      const curLon = telemetry?.lon ?? 38.0;
      const curTime = telemetry?.timeIso ?? '2026-09-07T08:00:00Z';

      const replanResult = await requestReplan(curLat, curLon, curTime, true);
      setScenarioData({
        ...replanResult,
        isReplan: true
      });
    } catch (err) {
      console.error('Failed to trigger anomaly replan:', err);
    }
  };

  // Live Stream Mode: Synchronize telemetry and Cesium clock when liveData updates
  useEffect(() => {
    if (streamMode === 'live' && liveData?.telemetry) {
      let localRisk = liveData.telemetry.risk ?? 0.14;
      if (scenarioData?.iceRiskGrid) {
        const closest = scenarioData.iceRiskGrid.find((pt) => 
          Math.abs(pt.lat - liveData.telemetry.lat) < 0.3 && Math.abs(pt.lon - liveData.telemetry.lon) < 0.6
        );
        if (closest) localRisk = closest.risk;
      }

      setTelemetry((prev) => ({
        ...prev,
        ...liveData.telemetry,
        risk: localRisk,
        timeIso: liveData.timestamp || prev.timeIso
      }));

      // In live stream mode, synchronize 3D ship position with live telemetry without jitter/snapping
      if (viewerRef.current && liveData.telemetry.progress !== undefined) {
        viewerRef.current.syncLiveProgress(liveData.telemetry.progress, 3.0);
      }
    }
  }, [liveData, streamMode, scenarioData]);

  // JUMP TO LIVE Action: Restores streamMode = 'live' and resyncs Cesium clock and camera
  const handleJumpToLive = useCallback(() => {
    setStreamMode('live');
    setIsPlaying(true);

    if (liveData?.telemetry) {
      let localRisk = liveData.telemetry.risk ?? 0.14;
      if (scenarioData?.iceRiskGrid) {
        const closest = scenarioData.iceRiskGrid.find((pt) => 
          Math.abs(pt.lat - liveData.telemetry.lat) < 0.3 && Math.abs(pt.lon - liveData.telemetry.lon) < 0.6
        );
        if (closest) localRisk = closest.risk;
      }

      setTelemetry((prev) => ({
        ...prev,
        ...liveData.telemetry,
        risk: localRisk,
        timeIso: liveData.timestamp || prev.timeIso
      }));

      if (viewerRef.current) {
        if (liveData.telemetry.progress !== undefined) {
          viewerRef.current.seekToProgress(liveData.telemetry.progress);
        }
        viewerRef.current.setPlaying(true);
        if (cameraMode === 'chase') {
          viewerRef.current.flyToShip();
        }
      }
    } else {
      reconnectWs();
      if (viewerRef.current) {
        viewerRef.current.setPlaying(true);
        if (cameraMode === 'chase') {
          viewerRef.current.flyToShip();
        }
      }
    }
  }, [liveData, scenarioData, cameraMode, reconnectWs]);

  // Toggle Stream Mode (Live <-> Simulation)
  const handleToggleStreamMode = useCallback(() => {
    if (streamMode === 'live') {
      setStreamMode('simulation');
    } else {
      handleJumpToLive();
    }
  }, [streamMode, handleJumpToLive]);

  // Merge live stream icebergs and vessels into scenarioData for downstream components
  const effectiveScenarioData = useMemo(() => {
    if (!scenarioData) {
      if (streamMode === 'live' && liveData) {
        return {
          iceRiskGrid: [],
          icebergs: Array.isArray(liveData.icebergs) ? liveData.icebergs : [],
          vessels: Array.isArray(liveData.vessels) ? liveData.vessels : [],
          route: { waypoints: [], summary: {} }
        };
      }
      return null;
    }

    // Engine 2/USNIC model routes are authoritative. Do not replace their
    // official iceberg inventory with the websocket demo fleet.
    if (scenarioData.isModelRoute) {
      return {
        ...scenarioData,
        vessels: scenarioData.vessels || []
      };
    }

    if (streamMode === 'live' && liveData) {
      return {
        ...scenarioData,
        icebergs: (Array.isArray(liveData.icebergs) && liveData.icebergs.length > 0)
          ? liveData.icebergs
          : scenarioData.icebergs,
        vessels: (Array.isArray(liveData.vessels) && liveData.vessels.length > 0)
          ? liveData.vessels
          : (scenarioData.vessels || [])
      };
    }

    return scenarioData;
  }, [scenarioData, streamMode, liveData]);

  // Reset Voyage (switches to simulation mode)
  const handleResetVoyage = () => {
    setStreamMode('simulation');
    setAnomalyActive(false);
    setCameraMode('globe');
    setIsPlaying(true);
    loadScenario(!demoMode, false);
    if (viewerRef.current) {
      viewerRef.current.seekToProgress(0);
      viewerRef.current.setPlaying(true);
      viewerRef.current.flyToStation('maitri');
    }
  };

  // Telemetry updates from Cesium clock ticks (active in simulation mode)
  const handleTelemetryUpdate = useCallback((newTelem) => {
    // In live stream mode with an active WebSocket feed, live feed is authoritative
    if (streamMode === 'live' && isWsConnected && liveData?.telemetry) {
      return;
    }

    let localRisk = 0.12;
    if (scenarioData?.iceRiskGrid) {
      const closest = scenarioData.iceRiskGrid.find((pt) => 
        Math.abs(pt.lat - newTelem.lat) < 0.3 && Math.abs(pt.lon - newTelem.lon) < 0.6
      );
      if (closest) localRisk = closest.risk;
    }

    setTelemetry((prev) => ({
      ...prev,
      ...newTelem,
      risk: localRisk
    }));
  }, [scenarioData, streamMode, isWsConnected, liveData]);

  const telemetryRef = useRef(telemetry);
  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  // Periodic weather lookup (stable 4s polling without tearing down effect on every clock tick)
  useEffect(() => {
    let active = true;
    const interval = setInterval(async () => {
      const cur = telemetryRef.current;
      if (!cur?.lat || !cur?.lon) return;
      try {
        const wData = await fetchWeather(cur.lat, cur.lon, cur.timeIso);
        if (active) setWeather(wData);
      } catch (e) {
        // silent fallback
      }
    }, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Fly to Station / Target from Navbar
  const handleSelectStationOrTarget = useCallback((st) => {
    if (st === 'ship') {
      setCameraMode('chase');
      if (viewerRef.current) viewerRef.current.flyToShip();
    } else {
      setCameraMode('globe');
      if (viewerRef.current) viewerRef.current.flyToStation(st);
    }
    const foundBerg = effectiveScenarioData?.icebergs?.find(
      (b) => b.id.toLowerCase() === String(st).toLowerCase() ||
             `iceberg ${b.id}`.toLowerCase() === String(st).toLowerCase()
    );
    if (foundBerg) {
      setSelectedEntity({
        ...foundBerg,
        type: 'iceberg',
        id: foundBerg.id,
        name: `Iceberg ${foundBerg.id}`,
        subtitle: 'Tracked Antarctic Tabular Iceberg',
        lat: foundBerg.lat,
        lon: foundBerg.lon,
        description: `Drifting iceberg ${foundBerg.id} tracked via Sentinel-1 SAR Radar satellite imagery and LSTM trajectory physics equations.`
      });
      setIsDrawerOpen(true);
      return;
    }

    if (st === 'ship') {
      setSelectedEntity({
        type: 'ship',
        name: 'RV Polar Explorer',
        subtitle: 'Ice-Class Polar Research Vessel (PC4)',
        lat: telemetry?.lat ?? -70.77,
        lon: telemetry?.lon ?? 11.73,
        description: 'Flagship polar research vessel equipped with ice-strengthened hull, multibeam bathymetric sonar, CTD rosette winches, and meteorological radar.'
      });
      setIsDrawerOpen(true);
      return;
    }

    const STATIONS = [
      { id: 'maitri', name: 'Maitri Research Station 🇮🇳', subtitle: 'Indian Antarctic Base • Princess Astrid Coast', lat: -70.77, lon: 11.73, description: 'Permanent Indian Antarctic research station in the Schirmacher Oasis.' },
      { id: 'india_bay', name: 'India Bay Mooring 🇮🇳', subtitle: 'NCPOR Fast-Ice Ship Berth • Princess Astrid Coast', lat: -69.90, lon: 11.95, description: 'Primary sea-ice anchorage and cargo offloading site at India Bay, connected to Maitri Station via 80 km overland ice-traverse.' },
      { id: 'bharati', name: 'Bharati Research Station 🇮🇳', subtitle: 'Indian Antarctic Base • Larsemann Hills, Prydz Bay', lat: -69.41, lon: 76.19, description: 'State-of-the-art Indian polar research station in Larsemann Hills.' },
      { id: 'novolazarevskaya', name: 'Novolazarevskaya Station 🇷🇺', subtitle: 'Russian Antarctic Base • Schirmacher Oasis', lat: -70.78, lon: 11.83, description: 'Russian research base near Maitri in the Schirmacher Oasis.' },
      { id: 'syowa', name: 'Syowa Station 🇯🇵', subtitle: 'Japanese Antarctic Base • East Ongul Island', lat: -69.00, lon: 39.58, description: 'Japanese Antarctic research hub in Lutzow-Holm Bay.' },
      { id: 'progress', name: 'Progress Station 🇷🇺', subtitle: 'Russian Antarctic Base • Larsemann Hills', lat: -69.37, lon: 76.38, description: 'Russian coastal base adjacent to Bharati.' },
      { id: 'zhongshan', name: 'Zhongshan Station 🇨🇳', subtitle: 'Chinese Antarctic Base • Larsemann Hills', lat: -69.37, lon: 76.37, description: 'Chinese polar research station in Larsemann Hills.' },
      { id: 'mawson', name: 'Mawson Station 🇦🇺', subtitle: 'Australian Antarctic Base • Mac. Robertson Land', lat: -67.60, lon: 62.87, description: 'Oldest continuously occupied Antarctic station.' },
      { id: 'davis', name: 'Davis Station 🇦🇺', subtitle: 'Australian Antarctic Base • Vestfold Hills', lat: -68.58, lon: 77.97, description: 'Major Australian research station in Vestfold Hills.' }
    ];

    const foundStation = STATIONS.find((s) => s.id === st || s.name.toLowerCase().includes(String(st).toLowerCase()));
    if (foundStation) {
      setSelectedEntity({
        type: 'station',
        id: foundStation.id,
        name: foundStation.name,
        subtitle: foundStation.subtitle,
        lat: foundStation.lat,
        lon: foundStation.lon,
        description: foundStation.description
      });
      setIsDrawerOpen(true);
    }
  }, [effectiveScenarioData, telemetry]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#101114] select-none font-sans">
      <ModelRouteControls
        onRun={handleModelRoute}
        isLoading={isModelLoading}
        modelStatus={modelStatus}
        forecastStep={forecastStep}
        onForecastStepChange={setForecastStep}
        onOpenPolarPlot={() => setShowPolarModal(true)}
      />
      <PolarPlotModal
        isOpen={showPolarModal}
        onClose={() => setShowPolarModal(false)}
      />
      <MapLayerLegend
        showRiskGrid={showRiskGrid}
        showBathymetry={showBathymetry}
        forecastStep={forecastStep}
        onForecastStepChange={setForecastStep}
        isModelRoute={modelStatus?.status === 'ready'}
      />
      {/* 3D Geospatial Earth Viewport (Full Screen Google Earth) */}
      <CesiumViewer
        ref={viewerRef}
        scenarioData={effectiveScenarioData}
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        cameraMode={cameraMode}
        mapStyle={mapStyle}
        tacticalStyle={tacticalStyle}
        showSatellites={showSatellites}
        showRiskGrid={showRiskGrid}
        showGeeSeaIce={showGeeSeaIce}
        showIcebergs={showIcebergs}
        showMountains={showMountains}
        showStations={showStations}
        showBathymetry={showBathymetry}
        forecastStep={forecastStep}
        useModelLayers={modelStatus?.status === 'ready'}
        showSatelliteTracks={showSatelliteTracks}
        onOverpassUpdate={setActiveOverpass}
        selectedEntity={selectedEntity}
        anomalyActive={anomalyActive}
        onTelemetryUpdate={handleTelemetryUpdate}
        onCameraUpdate={(info) => setCameraInfo(info)}
        onSelectEntity={(entity) => setSelectedEntity(entity)}
        streamMode={streamMode}
        liveData={liveData}
        liveIcebergs={liveData?.icebergs}
        liveVessels={effectiveScenarioData?.isModelRoute ? null : liveData?.vessels}
      />

      {/* Military Reconnaissance Intelligence HUD (God's Eye View HUD) */}
      <IntelHUD
        active={showIntelHud}
        tacticalStyle={tacticalStyle}
        cameraInfo={cameraInfo}
        telemetry={telemetry}
        scenarioData={effectiveScenarioData}
        anomalyActive={anomalyActive}
        isDrawerOpen={isDrawerOpen}
        streamMode={streamMode}
        liveData={liveData}
        activeOverpass={activeOverpass}
      />

      {/* God's Eye View Dynamic Tactical Object Reticles, Leader Lines & Readout Card */}
      <TacticalEntityOverlay
        viewerRef={viewerRef}
        selectedEntity={selectedEntity}
        onSelectEntity={(entity) => setSelectedEntity(entity)}
        onClose={() => setSelectedEntity(null)}
        tacticalStyle={tacticalStyle}
        telemetry={telemetry}
        scenarioData={effectiveScenarioData}
        streamMode={streamMode}
        liveData={liveData}
        liveIcebergs={liveData?.icebergs}
        liveVessels={effectiveScenarioData?.isModelRoute ? null : liveData?.vessels}
        activeOverpass={activeOverpass}
        isDrawerOpen={isDrawerOpen}
      />

      {/* 1. Fixed Top Marine Bridge Watch Bar (IEC 62288) */}
      <MarineBridgeHeader
        demoMode={demoMode}
        onToggleDemoMode={handleToggleDemoMode}
        isLiveLoading={isLiveLoading}
        anomalyActive={anomalyActive}
        onTriggerAnomaly={handleTriggerAnomaly}
        cameraMode={cameraMode}
        onChangeCameraMode={(mode) => {
          setCameraMode(mode);
          if (mode === 'chase' && viewerRef.current?.flyToShip) {
            viewerRef.current.flyToShip();
          }
          if (mode === 'globe' && viewerRef.current?.centerGlobe) {
            viewerRef.current.centerGlobe();
          }
        }}
        isDrawerOpen={isDrawerOpen}
        onToggleDrawer={() => setIsDrawerOpen(!isDrawerOpen)}
        hazardCount={effectiveScenarioData?.icebergs?.length ?? 1}
        onSelectStation={handleSelectStationOrTarget}
        onLocateShip={() => {
          setCameraMode('chase');
          if (viewerRef.current) viewerRef.current.flyToShip();
        }}
        scenarioData={effectiveScenarioData}
        onOpenPolarCode={() => setIsPolarCodeOpen(true)}
        telemetry={telemetry}
        tacticalStyle={tacticalStyle}
        onChangeTacticalStyle={(style) => setTacticalStyle(style)}
        showIntelHud={showIntelHud}
        onToggleIntelHud={() => setShowIntelHud(!showIntelHud)}
        showSatellites={showSatellites}
        onToggleSatellites={() => setShowSatellites(!showSatellites)}
        streamMode={streamMode}
        wsStatus={wsStatus}
        isWsConnected={isWsConnected}
        playbackSpeed={playbackSpeed}
        onJumpToLive={handleJumpToLive}
        onToggleStreamMode={handleToggleStreamMode}
      />

      {/* 2. Docked Left Tactical Plotter & Chart Console */}
      <MarinePlotterDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        scenarioData={effectiveScenarioData}
        selectedEntity={selectedEntity}
        onSelectEntity={(entity) => setSelectedEntity(entity)}
        onFlyTo={(id) => {
          setCameraMode('globe');
          if (viewerRef.current) viewerRef.current.flyToStation(id);
        }}
        onFocusTrack={(id) => {
          setCameraMode('globe');
          if (viewerRef.current) viewerRef.current.focusIcebergTrack(id);
        }}
        onOpenMiniTrack={(berg) => setMiniTrackBerg(berg)}
        mapStyle={mapStyle}
        onChangeMapStyle={(style) => setMapStyle(style)}
        tacticalStyle={tacticalStyle}
        onChangeTacticalStyle={(style) => setTacticalStyle(style)}
        showIntelHud={showIntelHud}
        onToggleIntelHud={() => setShowIntelHud(!showIntelHud)}
        showSatellites={showSatellites}
        onToggleSatellites={() => setShowSatellites(!showSatellites)}
        showRiskGrid={showRiskGrid}
        onToggleRiskGrid={() => setShowRiskGrid(!showRiskGrid)}
        showGeeSeaIce={showGeeSeaIce}
        onToggleGeeSeaIce={() => setShowGeeSeaIce(!showGeeSeaIce)}
        showIcebergs={showIcebergs}
        onToggleIcebergs={() => setShowIcebergs(!showIcebergs)}
        showMountains={showMountains}
        onToggleMountains={() => setShowMountains(!showMountains)}
        showStations={showStations}
        onToggleStations={() => setShowStations(!showStations)}
        showBathymetry={showBathymetry}
        onToggleBathymetry={() => setShowBathymetry(!showBathymetry)}
        telemetry={telemetry}
        weather={weather}
        anomalyActive={anomalyActive}
        onOpenPolarCode={() => setIsPolarCodeOpen(true)}
        onOpenEchogram={() => setIsEchogramOpen(true)}
        streamMode={streamMode}
        liveData={liveData}
      />

      {/* 3. Docked Bottom Echosounder, Playback & Propulsion Console */}
      <MarineBridgeConsole
        isPlaying={isPlaying}
        onTogglePlay={() => {
          setIsPlaying((prev) => {
            const next = !prev;
            if (!next) {
              // Pausing automatically switches to simulation mode
              setStreamMode('simulation');
            }
            if (viewerRef.current) {
              viewerRef.current.setPlaying(next);
            }
            return next;
          });
        }}
        playbackSpeed={playbackSpeed}
        onChangeSpeed={(s) => {
          // Selecting simulation speed multiplier switches to simulation mode
          setStreamMode('simulation');
          setPlaybackSpeed(s);
          if (viewerRef.current && viewerRef.current.setPlaying) {
            viewerRef.current.setPlaying(isPlaying);
          }
        }}
        onReset={handleResetVoyage}
        onSeek={(fraction) => {
          // Scrubbing timeline automatically switches to simulation mode
          setStreamMode('simulation');
          if (viewerRef.current) viewerRef.current.seekToProgress(fraction);
        }}
        onLocateShip={() => {
          setCameraMode('chase');
          if (viewerRef.current) viewerRef.current.flyToShip();
        }}
        telemetry={telemetry}
        weather={weather}
        anomalyActive={anomalyActive}
        isReplan={effectiveScenarioData?.isReplan}
        scenarioData={effectiveScenarioData}
        onOpenPolarCode={() => setIsPolarCodeOpen(true)}
        onOpenEchogram={() => setIsEchogramOpen(true)}
        streamMode={streamMode}
        liveData={liveData}
      />

      {/* 4. Independent Floating Satellite Track Mini-Window (PiP) */}
      <SatelliteTrackMiniWindow
        iceberg={miniTrackBerg}
        isOpen={!!miniTrackBerg}
        onClose={() => setMiniTrackBerg(null)}
        onFlyMainCamera={(lat, lon, id) => {
          if (viewerRef.current) viewerRef.current.flyToCoords(lat, lon, id);
        }}
        anomalyActive={anomalyActive}
        telemetry={telemetry}
      />

      {/* 4b. Interactive Subsea Bathymetric Echogram & Sonar Window */}
      <BathymetricEchogramMiniWindow
        isOpen={isEchogramOpen}
        onClose={() => setIsEchogramOpen(false)}
        scenarioData={effectiveScenarioData}
        telemetry={telemetry}
        onFlyToLocation={(lat, lon, label) => {
          if (viewerRef.current) viewerRef.current.flyToCoords(lat, lon, label);
        }}
        isDrawerOpen={isDrawerOpen}
      />

      {/* 5. IMO Polar Code (POLARIS / RIO) & Logistics Inspector Dialog */}
      <PolarCodeInspectorModal
        isOpen={isPolarCodeOpen}
        onClose={() => setIsPolarCodeOpen(false)}
        telemetry={telemetry}
        anomalyActive={anomalyActive}
        isReplan={effectiveScenarioData?.isReplan}
      />

      {/* 6. Marine ECDIS Loading Overlay */}
      {isLiveLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
          <div className="bg-[#090d14] text-[#cbd5e1] px-5 py-3 rounded border border-[#1e293b] shadow-2xl font-mono text-xs flex items-center space-x-3">
            <div className="w-4 h-4 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" />
            <span className="tracking-wider text-white">
              COMPUTING POLAR FAIRWAY OPTIMIZATION...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

