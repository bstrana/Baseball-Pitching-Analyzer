import React, { useState } from 'react';
import { PoseDetector, PoseMetrics } from './components/PoseDetector';
import { PitchTracker } from './components/PitchTracker';
import { KinematicChart } from './components/KinematicChart';
import { Pitch, PitchType, StrikeZoneConfig, KinematicFrame } from './types';
import { Activity, Crosshair, Download, ToggleLeft, ToggleRight, Video, Target, Settings, X, User, Sliders, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { keycloak, keycloakEnabled } from './auth';

export default function App() {
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<'profile' | 'camera' | 'overlays' | 'guide'>('profile');
  const [pitcherProfile, setPitcherProfile] = useState({
    height: 74,
    weight: 210,
    wingspan: 75
  });

  const [metrics, setMetrics] = useState<PoseMetrics>({ 
    rightArmAngle: 0, 
    leftArmAngle: 0, 
    rightLegAngle: 0,
    leftLegAngle: 0,
    hipShoulderSeparation: 0,
    speeds: { hip: 0, shoulder: 0, elbow: 0, wrist: 0 }
  });
  const [liveKinematicsData, setLiveKinematicsData] = useState<KinematicFrame[]>([]);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showTrajectory, setShowTrajectory] = useState(true);
  const [speedGunConnected, setSpeedGunConnected] = useState(false);
  const [cameraView, setCameraView] = useState<'side' | 'front' | 'back'>('side');
  const [visibleMarkers, setVisibleMarkers] = useState({
    head: true,
    arms: true,
    torso: true,
    hips: true,
    legs: true
  });
  
  // Mobile active tab state
  const [activeMobileTab, setActiveMobileTab] = useState<'feed' | 'pitchcast' | 'settings'>('feed');

  // Active Mode: 'mechanics' or 'pitching'
  const [appMode, setAppMode] = useState<'mechanics' | 'pitching'>('mechanics');

  // Pitch Tracker states
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [strikeZoneConfig, setStrikeZoneConfig] = useState<StrikeZoneConfig>({
    x: 0.38,
    y: 0.30,
    width: 0.24,
    height: 0.38
  });
  const [showStrikeZone, setShowStrikeZone] = useState(true);
  const [currentPitchType, setCurrentPitchType] = useState<PitchType>('Fastball');
  const [currentPitchSpeed, setCurrentPitchSpeed] = useState<number>(92);
  const [selectedPitchId, setSelectedPitchId] = useState<string | null>(null);
  const [showExportDropdown, setShowExportDropdown] = useState(false);

  const handleAddPitch = (pitch: Pitch) => {
    setPitches(prev => [...prev, pitch]);
  };

  const handleRemovePitch = (id: string) => {
    setPitches(prev => prev.filter(p => p.id !== id).map((p, idx) => ({ ...p, number: idx + 1 })));
  };

  const handleClearPitches = () => {
    setPitches([]);
  };

  const handleExportSession = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
      metrics,
      cameraView,
      pitches,
      strikeZoneConfig,
      exportedAt: new Date()
    }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `pitch-session-analysis-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleExportCSV = () => {
    if (pitches.length === 0) {
      alert("No pitches to export. Log some pitches first!");
      return;
    }
    
    // Headers
    const headers = ["Pitch Number", "Pitch Type", "Velocity (MPH)", "X (0-1)", "Y (0-1)", "Call", "Zone Location", "Timestamp"];
    
    // Rows
    const rows = pitches.map(pitch => [
      pitch.number,
      `"${pitch.type}"`,
      pitch.velocity,
      pitch.x.toFixed(4),
      pitch.y.toFixed(4),
      pitch.isStrike ? "Strike" : "Ball",
      `"${pitch.zone.replace(/"/g, '""')}"`,
      `"${new Date(pitch.timestamp).toISOString()}"`
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    
    const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `pitch-session-pitches-${Date.now()}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const selectedPitch = pitches.find(p => p.id === selectedPitchId) || pitches[pitches.length - 1];

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Navigation Bar */}
      <nav className="h-16 flex items-center justify-between px-4 sm:px-6 bg-slate-900 border-b border-slate-800 shrink-0 z-20">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-8 h-8 bg-sky-500 rounded flex items-center justify-center">
            <Crosshair className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">BASE<span className="text-sky-400">MECHANICS</span> AI</h1>
          <div className="h-6 w-px bg-slate-700 mx-1 sm:mx-2 hidden sm:block"></div>
          <span className="text-[10px] sm:text-xs font-mono px-2 py-1 bg-slate-800 rounded border border-slate-700 text-sky-400 hidden sm:inline-block">TENSORFLOW READY</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 font-sans">
          <div className="flex items-center gap-2 hidden md:flex">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs text-slate-400 uppercase tracking-widest font-sans">Live Feed • 60 FPS</span>
          </div>
          
          <button
            onClick={() => setShowSetupModal(true)}
            className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs sm:text-sm font-semibold rounded-md shadow transition-all flex items-center gap-1.5 sm:gap-2 font-sans cursor-pointer"
          >
            <Settings className="w-4 h-4 text-sky-400" />
            <span>SESSION SETUP</span>
          </button>

          {keycloakEnabled && (
            <button
              onClick={() => keycloak!.logout()}
              title={keycloak?.tokenParsed?.preferred_username ? `Sign out (${keycloak.tokenParsed.preferred_username})` : 'Sign out'}
              className="p-1.5 sm:p-2 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md shadow transition-all cursor-pointer"
            >
              <LogOut className="w-4 h-4 text-sky-400" />
            </button>
          )}

          <div className="relative">
            <button 
              onClick={() => setShowExportDropdown(!showExportDropdown)}
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs sm:text-sm font-semibold rounded-md shadow-lg transition-all flex items-center gap-1.5 sm:gap-2 font-sans"
            >
              <Download className="w-4 h-4 text-white" /> <span>EXPORT <span className="hidden sm:inline">ANALYSIS</span></span>
            </button>

            {showExportDropdown && (
              <>
                {/* Backdrop to dismiss on click outside */}
                <div 
                  className="fixed inset-0 z-40 bg-black/5" 
                  onClick={() => setShowExportDropdown(false)} 
                />
                
                {/* Dropdown Menu */}
                <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-3.5 py-1.5 border-b border-slate-800/80">
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Select Format</p>
                  </div>
                  
                  <button
                    onClick={() => {
                      handleExportSession();
                      setShowExportDropdown(false);
                    }}
                    className="w-full text-left px-4 py-3 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-3 border-b border-slate-800/30"
                  >
                    <Download className="w-4 h-4 text-sky-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-200">Export Session (JSON)</span>
                      <span className="text-[10px] text-slate-400 mt-0.5">Includes full kinematics & config</span>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      handleExportCSV();
                      setShowExportDropdown(false);
                    }}
                    className="w-full text-left px-4 py-3 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-3"
                  >
                    <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-200">Export Pitch Log (CSV)</span>
                      <span className="text-[10px] text-slate-400 mt-0.5">Pitches spreadsheet for Excel/Sheets</span>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Mode Selector Sub-Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex justify-center shrink-0 z-20">
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 shadow-inner">
          <button
            onClick={() => {
              setAppMode('mechanics');
              setActiveMobileTab('feed');
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-2 ${
              appMode === 'mechanics'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/20 font-extrabold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Mechanics Tracker</span>
          </button>
          <button
            onClick={() => {
              setAppMode('pitching');
              setActiveMobileTab('feed');
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-2 ${
              appMode === 'pitching'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20 font-extrabold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Target className="w-4 h-4" />
            <span>Pitch Tracker</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row relative">
        
        {/* Main Content: Video Feed & Metrics */}
        <main className={`flex-1 flex flex-col bg-slate-950 overflow-hidden ${appMode === 'mechanics' || activeMobileTab === 'feed' ? 'flex h-full' : 'hidden lg:flex'}`}>
          
          {/* Video Feed Area */}
          <div className="flex-1 relative bg-black flex items-center justify-center p-0 lg:p-4 min-h-0">
            <div className="w-full h-full relative lg:rounded-xl overflow-hidden lg:border lg:border-slate-800 lg:shadow-2xl bg-slate-950 flex items-center justify-center">
               <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40 pointer-events-none z-10"></div>
               <PoseDetector
                 onMetricsUpdate={setMetrics}
                 onKinematicsUpdate={setLiveKinematicsData}
                 showSkeleton={showSkeleton}
                 showTrajectory={showTrajectory} 
                 cameraView={cameraView} 
                 strikeZoneConfig={strikeZoneConfig}
                 onConfigChange={setStrikeZoneConfig}
                 showStrikeZone={showStrikeZone}
                 pitches={pitches}
                 onAddPitch={handleAddPitch}
                 selectedPitchId={selectedPitchId}
                 setSelectedPitchId={setSelectedPitchId}
                 currentPitchType={currentPitchType}
                 currentPitchSpeed={currentPitchSpeed}
                 setShowSkeleton={setShowSkeleton}
                 setShowTrajectory={setShowTrajectory}
                 setShowStrikeZone={setShowStrikeZone}
                 setCameraView={setCameraView}
                 appMode={appMode}
                 visibleMarkers={visibleMarkers}
               />
            </div>
          </div>

          {/* Bottom Analysis and Metrics Section */}
          {appMode === 'mechanics' && (
            <div className="hidden lg:block bg-slate-900 border-t border-slate-800 p-4 shrink-0 overflow-y-auto max-h-[350px]">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                
                {/* Joint Angles / Metrics Cards */}
                <div className="xl:col-span-1 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Live Joint Metrics</span>
                    <span className="text-[9px] text-sky-400 font-mono">Real-time Angles</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 flex-1">
                    <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 flex flex-col justify-between">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Throwing Arm</p>
                      <p className="text-2xl font-mono text-white my-1">{metrics.rightArmAngle ? `${metrics.rightArmAngle}°` : '--'}</p>
                      <span className="text-[9px] text-slate-500">Elbow Flexion</span>
                    </div>
                    <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 flex flex-col justify-between">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Lead Leg</p>
                      <p className="text-2xl font-mono text-white my-1">{metrics.leftLegAngle ? `${metrics.leftLegAngle}°` : '--'}</p>
                      <span className="text-[9px] text-slate-500">Knee Flexion</span>
                    </div>
                    <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 flex flex-col justify-between col-span-2">
                      <div className="flex justify-between items-center">
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Hip/Shoulder Separation</p>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${metrics.hipShoulderSeparation > 40 ? 'text-sky-400 border-sky-400/30 bg-sky-950/30' : 'text-slate-400 border-slate-700/50 bg-slate-800/30'}`}>
                          {metrics.hipShoulderSeparation > 40 ? 'High Torque' : 'Building'}
                        </span>
                      </div>
                      <p className="text-3xl font-mono text-white my-1.5">{metrics.hipShoulderSeparation ? `${metrics.hipShoulderSeparation}°` : '--'}</p>
                      <span className="text-[9px] text-slate-500">Separation Angle Delta</span>
                    </div>
                  </div>
                </div>

                {/* Kinematic Sequencing Chart */}
                <div className="xl:col-span-2">
                  <KinematicChart
                    pitchNumber={selectedPitch?.number || null}
                    pitchType={selectedPitch?.type || null}
                    velocity={selectedPitch?.velocity || null}
                    kinematicsData={
                      selectedPitch?.kinematicsData && selectedPitch.kinematicsData.length > 0
                        ? selectedPitch.kinematicsData
                        : liveKinematicsData
                    }
                  />
                </div>

              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar: Pitch Tracking Accuracy Panel */}
        <aside className={`w-full lg:w-80 bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col shrink-0 overflow-hidden h-full pb-20 lg:pb-0 ${
          appMode === 'pitching' 
            ? (activeMobileTab === 'pitchcast' ? 'flex flex-1' : 'hidden lg:flex') 
            : 'hidden'
        }`}>
          <div className="p-4 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></span>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">PITCH ACCURACY TRACKER</p>
            </div>
            <p className="text-xs text-slate-400 mt-1">Track location, speed, and zone accuracy</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            <PitchTracker
              pitches={pitches}
              onAddPitch={handleAddPitch}
              onRemovePitch={handleRemovePitch}
              onClearPitches={handleClearPitches}
              config={strikeZoneConfig}
              onConfigChange={setStrikeZoneConfig}
              showStrikeZone={showStrikeZone}
              setShowStrikeZone={setShowStrikeZone}
              currentPitchType={currentPitchType}
              setCurrentPitchType={setCurrentPitchType}
              currentPitchSpeed={currentPitchSpeed}
              setCurrentPitchSpeed={setCurrentPitchSpeed}
              selectedPitchId={selectedPitchId}
              setSelectedPitchId={setSelectedPitchId}
            />
          </div>
        </aside>

      </div>

      {/* Mobile Bottom Tab Navigation */}
      <div className="lg:hidden h-16 bg-slate-900 border-t border-slate-800/80 flex items-center justify-around shrink-0 z-30 px-2 absolute bottom-0 left-0 right-0 font-sans">
        <button
          onClick={() => setActiveMobileTab('feed')}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 transition-all ${
            activeMobileTab === 'feed' ? 'text-sky-400 scale-105 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Video className="w-5 h-5" />
          <span className="text-[9px] uppercase tracking-wider font-semibold">Live Feed</span>
        </button>

        {appMode === 'pitching' && (
          <button
            onClick={() => setActiveMobileTab('pitchcast')}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 transition-all ${
              activeMobileTab === 'pitchcast' ? 'text-sky-400 scale-105 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Target className="w-5 h-5" />
            <span className="text-[9px] uppercase tracking-wider font-semibold">Pitchcast</span>
          </button>
        )}

        <button
          onClick={() => setShowSetupModal(true)}
          className="flex flex-col items-center justify-center gap-1 flex-1 py-1 transition-all text-slate-400 hover:text-slate-200"
        >
          <Settings className="w-5 h-5" />
          <span className="text-[9px] uppercase tracking-wider font-semibold">Settings</span>
        </button>
      </div>

      {/* Setup & Configuration Modal */}
      <AnimatePresence>
        {showSetupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSetupModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden z-10 font-sans"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center">
                    <Settings className="w-4.5 h-4.5 text-sky-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white uppercase tracking-wider">Session Setup</h3>
                    <p className="text-[10px] text-slate-400">Calibrate profile, hardware, and screen overlays</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowSetupModal(false)}
                  className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tabs Navigation */}
              <div className="flex border-b border-slate-800/60 bg-slate-950/20 p-1 shrink-0">
                <button
                  onClick={() => setActiveModalTab('profile')}
                  className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
                    activeModalTab === 'profile'
                      ? 'bg-slate-800 text-sky-400 shadow font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850/40'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Profile</span>
                </button>
                <button
                  onClick={() => setActiveModalTab('camera')}
                  className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
                    activeModalTab === 'camera'
                      ? 'bg-slate-800 text-sky-400 shadow font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850/40'
                  }`}
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>Camera</span>
                </button>
                <button
                  onClick={() => setActiveModalTab('overlays')}
                  className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
                    activeModalTab === 'overlays'
                      ? 'bg-slate-800 text-sky-400 shadow font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850/40'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Overlays</span>
                </button>
                <button
                  onClick={() => setActiveModalTab('guide')}
                  className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
                    activeModalTab === 'guide'
                      ? 'bg-slate-800 text-sky-400 shadow font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850/40'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Guide</span>
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {activeModalTab === 'profile' && (
                  <div className="space-y-4">
                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">Pitcher Dimensions</h4>
                      <p className="text-[11px] text-slate-400 mb-4">Provide accurate biometric measurements to optimize skeletal kinematic tracking ratios.</p>
                      
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
                          <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">Height (in)</label>
                          <input 
                            type="number" 
                            value={pitcherProfile.height} 
                            onChange={(e) => setPitcherProfile(prev => ({ ...prev, height: parseInt(e.target.value) || 0 }))}
                            className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none" 
                          />
                        </div>
                        <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
                          <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">Weight (lbs)</label>
                          <input 
                            type="number" 
                            value={pitcherProfile.weight} 
                            onChange={(e) => setPitcherProfile(prev => ({ ...prev, weight: parseInt(e.target.value) || 0 }))}
                            className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none" 
                          />
                        </div>
                        <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
                          <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">Wingspan (in)</label>
                          <input 
                            type="number" 
                            value={pitcherProfile.wingspan} 
                            onChange={(e) => setPitcherProfile(prev => ({ ...prev, wingspan: parseInt(e.target.value) || 0 }))}
                            className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none" 
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-950/20 p-4 rounded-xl border border-slate-800/60 flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                        <Activity className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Calibration Active</h4>
                        <p className="text-[10px] text-slate-400 leading-normal mt-0.5">Biometric calibration maps real-world coordinates into our deep neural net pipeline. Stand 60 feet 6 inches from the camera for high precision pitching mechanics assessment.</p>
                      </div>
                    </div>
                  </div>
                )}

                {activeModalTab === 'camera' && (
                  <div className="space-y-4">
                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">Capture Perspective</h4>
                      <p className="text-[11px] text-slate-400 mb-4">Set the physical placement of your recording device relative to the pitcher.</p>
                      
                      <div className="grid grid-cols-3 gap-2">
                        {(['side', 'back', 'front'] as const).map((view) => (
                          <button
                            key={view}
                            onClick={() => setCameraView(view)}
                            className={`px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all border ${
                              cameraView === view 
                                ? 'bg-sky-600 border-sky-500 text-white shadow-lg shadow-sky-600/15' 
                                : 'bg-slate-800 border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-750 cursor-pointer'
                            }`}
                          >
                            {view}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">External Hardware Integration</h4>
                      <p className="text-[11px] text-slate-400 mb-4">Enable telemetry synchronization for automated speed-gun overlays.</p>
                      
                      <button 
                        onClick={() => setSpeedGunConnected(!speedGunConnected)}
                        className={`w-full flex justify-between items-center p-3.5 rounded-lg border transition-all cursor-pointer ${
                          speedGunConnected 
                            ? 'bg-sky-950/20 border-sky-500/50 shadow-sm' 
                            : 'bg-slate-800 border-slate-700 hover:bg-slate-750'
                        }`}
                      >
                        <div className="flex flex-col items-start text-left">
                          <span className="text-xs font-bold text-white uppercase tracking-wider">Stalker Pro Radar Gun</span>
                          <span className={`text-[9px] mt-0.5 ${speedGunConnected ? 'text-sky-400 font-mono' : 'text-slate-500'}`}>
                            {speedGunConnected ? 'CONNECTED • BLE CHANNEL A' : 'OFFLINE • TAP TO SCAN'}
                          </span>
                        </div>
                        {speedGunConnected ? <ToggleRight className="w-5 h-5 text-sky-400" /> : <ToggleLeft className="w-5 h-5 text-slate-500" />}
                      </button>
                    </div>
                  </div>
                )}

                {activeModalTab === 'overlays' && (
                  <div className="space-y-4">
                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Skeletal Tracker</h4>
                        <button 
                          onClick={() => setShowSkeleton(!showSkeleton)}
                          className="focus:outline-none cursor-pointer"
                        >
                          {showSkeleton ? <ToggleRight className="w-6 h-6 text-sky-400" /> : <ToggleLeft className="w-6 h-6 text-slate-500" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400 mb-4">Overlay high-frequency joint markers and wireframe skeletal links on top of the live video feed.</p>
                      
                      {showSkeleton && (
                        <div className="bg-slate-900/40 border border-slate-800/80 rounded-lg p-3 space-y-3 shadow-inner">
                          <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1">Visible Segments</p>
                          <div className="grid grid-cols-2 gap-2">
                            {([
                              { key: 'head', label: 'Head & Neck' },
                              { key: 'arms', label: 'Throwing Arm' },
                              { key: 'torso', label: 'Spine & Shoulders' },
                              { key: 'hips', label: 'Hips & Core' }
                            ] as const).map(({ key, label }) => (
                              <button
                                key={key}
                                onClick={() => setVisibleMarkers(prev => ({ ...prev, [key]: !prev[key] }))}
                                className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[10px] font-bold uppercase transition-colors cursor-pointer ${
                                  visibleMarkers[key] 
                                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/30 shadow-sm' 
                                    : 'bg-slate-850 text-slate-500 border-slate-800/60 hover:bg-slate-800/40'
                                }`}
                              >
                                <span>{label}</span>
                                <span className={`w-1.5 h-1.5 rounded-full ${visibleMarkers[key] ? 'bg-sky-400' : 'bg-slate-600'}`}></span>
                              </button>
                            ))}
                            <button
                              onClick={() => setVisibleMarkers(prev => ({ ...prev, legs: !prev.legs }))}
                              className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[10px] font-bold uppercase col-span-2 transition-colors cursor-pointer ${
                                visibleMarkers.legs 
                                  ? 'bg-sky-500/10 text-sky-300 border-sky-500/30 shadow-sm' 
                                  : 'bg-slate-850 text-slate-500 border-slate-800/60 hover:bg-slate-800/40'
                              }`}
                            >
                              <span>Lower Extremities</span>
                              <span className={`w-1.5 h-1.5 rounded-full ${visibleMarkers.legs ? 'bg-sky-400' : 'bg-slate-600'}`}></span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Motion Trajectory Path</h4>
                        <button 
                          onClick={() => setShowTrajectory(!showTrajectory)}
                          className="focus:outline-none cursor-pointer"
                        >
                          {showTrajectory ? <ToggleRight className="w-6 h-6 text-sky-400" /> : <ToggleLeft className="w-6 h-6 text-slate-500" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400">Generate a high-frequency velocity tail displaying hand acceleration vectors throughout the throw cycle.</p>
                    </div>
                  </div>
                )}

                {activeModalTab === 'guide' && (
                  <div className="space-y-3.5">
                    <p className="text-[11px] text-slate-400 mb-1">Use these primary mechanical thresholds to optimize dynamic torque generation and prevent injuries:</p>
                    
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-white uppercase tracking-wider">Arm Cocking Phase</span>
                        <div className="w-2 h-2 bg-sky-500 rounded-full shadow-lg shadow-sky-500/40"></div>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Aim to maintain an "L" shape (85° to 95°) in your dominant throwing arm right before foot-strike. This maximizes mechanical load and minimizes direct stress on the ulnar collateral ligament (UCL).
                      </p>
                    </div>

                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-white uppercase tracking-wider">Glove Arm Rotation</span>
                        <div className="w-2 h-2 bg-slate-500 rounded-full"></div>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Tuck your glove arm tightly against your torso as your shoulders squared to home plate. This pulls in mass, lowering the moment of inertia and accelerating trunk rotational velocity for increased velocity.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between shrink-0 font-sans">
                <span className="text-[10px] text-slate-500 font-mono">
                  AUTO-SAVED REALTIME
                </span>
                <button
                  onClick={() => setShowSetupModal(false)}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-sky-600/10 transition-all cursor-pointer font-sans"
                >
                  Apply & Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({ title, value, subtitle, trend, status }: { title: string, value: string | number, subtitle: string, trend: string, status: 'good' | 'neutral' | 'bad' }) {
  const statusColors = {
    good: 'text-sky-400 border-sky-400/30 bg-sky-950/30',
    neutral: 'text-slate-400 border-slate-700/50 bg-slate-800/30',
    bad: 'text-red-400 border-red-400/30 bg-red-950/30'
  };

  return (
    <div className={`bg-slate-950/50 rounded-lg p-3 border border-slate-800 flex flex-col justify-between relative overflow-hidden`}>
      <p className="text-[10px] text-slate-500 uppercase font-bold z-10">{title}</p>
      <div className="flex items-end gap-2 my-2 z-10 flex-1 justify-center flex-col items-start">
        <p className="text-3xl sm:text-4xl font-mono text-white tracking-tighter">{value}</p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between z-10 gap-2">
        <p className="text-[10px] text-slate-500 truncate">{subtitle}</p>
        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${statusColors[status]} whitespace-nowrap self-start sm:self-auto`}>
          {trend}
        </span>
      </div>
    </div>
  );
}
