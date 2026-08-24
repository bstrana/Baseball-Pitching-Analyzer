import React, { useState, useEffect, Suspense, lazy } from 'react';
import type { PoseMetrics } from './components/PoseDetector';
import { PitchTracker, PitchLog } from './components/PitchTracker';

// Lazy-loaded: PoseDetector pulls in @tensorflow/tfjs + pose-detection, and
// KinematicChart pulls in recharts - both are heavy and only needed once the
// user is actually in mechanics/pitch-tracking mode, not on initial page load.
const PoseDetector = lazy(() =>
  import('./components/PoseDetector').then(m => ({ default: m.PoseDetector }))
);
const KinematicChart = lazy(() =>
  import('./components/KinematicChart').then(m => ({ default: m.KinematicChart }))
);
import { Pitch, PitchType, StrikeZoneConfig, KinematicFrame, PitcherHandedness } from './types';
import { Activity, Crosshair, ToggleLeft, ToggleRight, Video, Target, Settings, X, User, Sliders, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, MoreVertical, Download, LogOut, Ruler, RefreshCw, Users, Plus, Trash2, Save, AlertCircle, Usb, Play, StopCircle, MapPin, Clock, FileText, DraftingCompass } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { keycloak, keycloakEnabled } from './auth';
import { Player, listPlayers, createPlayer, updatePlayer, deletePlayer, saveMechanicsSession, savePitchSession, getPlayerSessionCount, getPlayerSessionCounts } from './pocketbase';
import { CameraCapabilities, RESOLUTION_PRESETS, FRAME_RATE_PRESETS, listVideoInputDevices, probeCameraCapabilities } from './camera';

const FEET_PER_METER = 3.28084;

// Converts a value in one calibration unit to feet (the canonical unit
// pixelsPerFoot/lastMeasuredFeet are always stored in) and back.
const toFeet = (value: number, unit: 'ft' | 'in' | 'm'): number =>
  unit === 'in' ? value / 12 : unit === 'm' ? value * FEET_PER_METER : value;
const fromFeet = (feet: number, unit: 'ft' | 'in' | 'm'): number =>
  unit === 'in' ? feet * 12 : unit === 'm' ? feet / FEET_PER_METER : feet;
const formatFeet = (feet: number, unit: 'ft' | 'in' | 'm'): string =>
  unit === 'in' ? `${fromFeet(feet, unit).toFixed(1)} in` : `${fromFeet(feet, unit).toFixed(2)} ${unit}`;

export default function App() {
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<'profile' | 'camera' | 'overlays' | 'calibration' | 'guide'>('profile');

  // Player roster, backed by PocketBase - the active player is who saved
  // mechanics/pitch sessions get attached to.
  const [players, setPlayers] = useState<Player[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [showAddPlayerForm, setShowAddPlayerForm] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [saveSessionMessage, setSaveSessionMessage] = useState<string | null>(null);
  // Combined mechanics + pitch session count per player, shown in the roster
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});

  const selectedPlayer = players.find(p => p.id === selectedPlayerId) || null;

  // Display name of the signed-in coach - shown on the End Session summary so
  // it's clear whose session this is, especially now that team-mates can
  // view (but not edit) each other's saved sessions.
  const coachName = keycloakEnabled
    ? (keycloak?.tokenParsed?.name || keycloak?.tokenParsed?.preferred_username)
    : undefined;

  // Start/End Session lifecycle - nothing can be saved or exported until a
  // session is explicitly ended; starting one requires a player and records
  // where it happened, ending one requires a closing note and a choice of
  // where the recorded data goes.
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(0);
  const [sessionLocation, setSessionLocation] = useState('');
  const [sessionNote, setSessionNote] = useState('');
  const [showStartSessionModal, setShowStartSessionModal] = useState(false);
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  const [endingSession, setEndingSession] = useState(false);

  useEffect(() => {
    if (!sessionActive || sessionStartedAt === null) return;
    const interval = setInterval(() => {
      setSessionElapsedSeconds(Math.floor((Date.now() - sessionStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionActive, sessionStartedAt]);

  const formatDuration = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  const handleStartSession = () => {
    if (!selectedPlayerId) return;
    setSessionActive(true);
    setSessionStartedAt(Date.now());
    setSessionElapsedSeconds(0);
    setShowStartSessionModal(false);
  };

  const finalizeEndSession = () => {
    setSessionActive(false);
    setSessionStartedAt(null);
    setSessionElapsedSeconds(0);
    setSessionLocation('');
    setSessionNote('');
    setShowEndSessionModal(false);
  };

  const refreshSessionCount = (playerId: string) => {
    getPlayerSessionCount(playerId)
      .then((count) => setSessionCounts(prev => ({ ...prev, [playerId]: count })))
      .catch(() => {});
  };

  const playerIdsKey = players.map(p => p.id).join(',');
  useEffect(() => {
    let active = true;
    getPlayerSessionCounts(players.map(p => p.id))
      .then((counts) => {
        if (!active) return;
        setSessionCounts(counts);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [playerIdsKey]);

  useEffect(() => {
    let active = true;
    listPlayers()
      .then((list) => {
        if (!active) return;
        setPlayers(list);
        setPlayersError(null);
      })
      .catch(() => {
        if (active) setPlayersError('Could not reach the PocketBase backend. Is it running?');
      })
      .finally(() => {
        if (active) setPlayersLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!saveSessionMessage) return;
    const t = setTimeout(() => setSaveSessionMessage(null), 4000);
    return () => clearTimeout(t);
  }, [saveSessionMessage]);

  const handleCreatePlayer = async () => {
    const name = newPlayerName.trim();
    if (!name) return;
    try {
      const owner_sub = keycloakEnabled ? keycloak?.tokenParsed?.sub : undefined;
      const player = await createPlayer({ name, owner_sub });
      setPlayers(prev => [...prev, player].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedPlayerId(player.id);
      setNewPlayerName('');
      setShowAddPlayerForm(false);
    } catch {
      setPlayersError('Could not create the player - is the PocketBase backend reachable?');
    }
  };

  const handleUpdatePlayerField = (id: string, field: 'height_in' | 'weight_lb' | 'wingspan_in' | 'position', value: number | string) => {
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handlePersistPlayerField = async (id: string, field: 'height_in' | 'weight_lb' | 'wingspan_in' | 'position', value: number | string) => {
    try {
      await updatePlayer(id, { [field]: value });
    } catch {
      setPlayersError('Could not save that change - is the PocketBase backend reachable?');
    }
  };

  const handleDeletePlayer = async (id: string) => {
    const player = players.find(p => p.id === id);
    if (!player || !window.confirm(`Delete ${player.name} and their saved session history? This cannot be undone.`)) return;
    try {
      await deletePlayer(id);
      setPlayers(prev => prev.filter(p => p.id !== id));
      if (selectedPlayerId === id) setSelectedPlayerId(null);
    } catch {
      setPlayersError('Could not delete that player - is the PocketBase backend reachable?');
    }
  };

  // Distance calibration & measurement: click-drag two points across a known
  // real-world distance to establish a pixels-per-foot scale, then use that
  // scale to measure any other on-screen distance. pixelsPerFoot and
  // lastMeasuredFeet are always stored in feet as the canonical unit;
  // calibrationUnit only controls how values are entered/displayed.
  const [calibrationUnit, setCalibrationUnit] = useState<'ft' | 'in' | 'm'>('ft');
  const [referenceDistanceValue, setReferenceDistanceValue] = useState(60.5); // mound-to-plate default, in calibrationUnit
  const [pixelsPerFoot, setPixelsPerFoot] = useState<number | null>(null);
  const [measureMode, setMeasureMode] = useState<'none' | 'calibrate' | 'measure' | 'angle' | 'height'>('none');
  const [lastMeasuredFeet, setLastMeasuredFeet] = useState<number | null>(null);
  const [lastMeasuredAngle, setLastMeasuredAngle] = useState<number | null>(null);
  // Set right before entering 'calibrate' mode from the "draw a line from
  // head to feet" button below, so the completion handler uses the
  // selected player's known height as the reference distance instead of
  // the manually-entered one - null means "use referenceDistanceValue" as
  // normal (the manual reference-distance calibration flow).
  const [calibrationReferenceFeetOverride, setCalibrationReferenceFeetOverride] = useState<number | null>(null);

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
  
  // Live Metrics / Kinematic Sequence panel - collapsed by default, opened from the thin footer bar
  const [showMetricsPanel, setShowMetricsPanel] = useState(false);

  // Pitch Accuracy Tracker panel (Pitch Tracker mode) - collapsed behind a thin
  // bar on mobile, always expanded on lg+ where it has its own sidebar column.
  const [showPitchTracker, setShowPitchTracker] = useState(false);

  // Manually resizable widths (lg+ only) for the left Session Pitch Log and
  // right Pitch Accuracy Tracker sidebars, dragged via the handle on their
  // inner edge.
  const SIDEBAR_MIN_WIDTH = 240;
  const SIDEBAR_MAX_WIDTH = 640;
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(320);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);

  const startSidebarResize = (clientX: number, side: 'left' | 'right') => {
    const startX = clientX;
    const startWidth = side === 'left' ? leftSidebarWidth : rightSidebarWidth;
    const setWidth = side === 'left' ? setLeftSidebarWidth : setRightSidebarWidth;

    const move = (x: number) => {
      const delta = side === 'left' ? x - startX : startX - x;
      setWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta)));
    };

    const onMouseMove = (e: MouseEvent) => move(e.clientX);
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) move(e.touches[0].clientX);
    };
    const onTouchEnd = () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
  };

  // Digital camera zoom (1x - 3x), applied as a CSS scale on the video canvas
  const [cameraZoom, setCameraZoom] = useState(1);

  // Which physical camera lens to use when on the live webcam feed
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('environment');

  // USB/UVC camera override (e.g. a high-fps global-shutter module for
  // slow-mo) - a specific deviceId plus a chosen resolution/frame-rate mode,
  // separate from the mobile facingMode picker above. null = use that
  // mobile path unchanged.
  const [videoInputDevices, setVideoInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [uvcDeviceId, setUvcDeviceId] = useState<string | null>(null);
  const [uvcCapabilities, setUvcCapabilities] = useState<CameraCapabilities | null>(null);
  const [uvcResolution, setUvcResolution] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });
  const [uvcFrameRate, setUvcFrameRate] = useState(30);
  const [uvcProbing, setUvcProbing] = useState(false);
  // What the camera actually delivered, reported back from PoseDetector -
  // requested UVC constraints are matched best-effort by the browser.
  const [actualCameraSettings, setActualCameraSettings] = useState<{ width: number; height: number; frameRate: number } | null>(null);

  const handleScanCameras = async () => {
    try {
      const devices = await listVideoInputDevices();
      setVideoInputDevices(devices);
    } catch (err) {
      console.warn('Could not list camera devices:', err);
    }
  };

  const handleSelectUvcDevice = async (deviceId: string) => {
    if (!deviceId) {
      setUvcDeviceId(null);
      setUvcCapabilities(null);
      return;
    }
    setUvcDeviceId(deviceId);
    setUvcProbing(true);
    const caps = await probeCameraCapabilities(deviceId);
    setUvcProbing(false);
    setUvcCapabilities(caps);
    if (caps) {
      // Default to the highest offered resolution/frame-rate combo the
      // device actually reports supporting. If none of the presets fit
      // (a low-end device reporting less than our lowest preset), fall
      // back to the device's own reported max rather than leaving state
      // pointed at a value the device doesn't support.
      const bestResolution = RESOLUTION_PRESETS.find(p => p.width <= caps.maxWidth && p.height <= caps.maxHeight);
      const bestFrameRate = [...FRAME_RATE_PRESETS].reverse().find(fps => fps <= caps.maxFrameRate);
      setUvcResolution(bestResolution ? { width: bestResolution.width, height: bestResolution.height } : { width: caps.maxWidth, height: caps.maxHeight });
      setUvcFrameRate(bestFrameRate ?? caps.maxFrameRate);
    }
  };

  // Preset options for the pickers below, filtered down to what the
  // selected device reports supporting - always including the device's own
  // max so the dropdown never ends up empty for a low-end device.
  const uvcResolutionOptions = (() => {
    const inRange = uvcCapabilities
      ? RESOLUTION_PRESETS.filter(p => p.width <= uvcCapabilities.maxWidth && p.height <= uvcCapabilities.maxHeight)
      : [...RESOLUTION_PRESETS];
    if (!uvcCapabilities) return inRange;
    const hasMax = inRange.some(p => p.width === uvcCapabilities.maxWidth && p.height === uvcCapabilities.maxHeight);
    return hasMax ? inRange : [...inRange, { width: uvcCapabilities.maxWidth, height: uvcCapabilities.maxHeight, label: 'Max' }];
  })();

  const uvcFrameRateOptions = uvcCapabilities
    ? Array.from(new Set([...FRAME_RATE_PRESETS.filter(fps => fps <= uvcCapabilities.maxFrameRate), uvcCapabilities.maxFrameRate])).sort((a, b) => a - b)
    : [...FRAME_RATE_PRESETS];

  // Live/paused status, reported up from PoseDetector - shown in the nav bar
  // instead of the old on-canvas "ANALYSIS ACTIVE"/"FEED PAUSED" badge.
  const [analysisPaused, setAnalysisPaused] = useState(false);

  // Session menu (Session Setup / Export / Sign out) - far right of the top bar, all screen sizes
  const [showSessionMenu, setShowSessionMenu] = useState(false);

  // On a phone in landscape, the top nav bar and bottom panel bar each eat a
  // meaningful slice of the little height there is, so they collapse to a
  // small edge tab by default there (max-lg:landscape: - has no effect on
  // portrait or desktop) and only reappear while this is toggled on.
  const [mobileChromeExpanded, setMobileChromeExpanded] = useState(false);

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
  // Unlocked: canvas clicks drag/resize the zone. Locked: canvas clicks only plot pitches.
  const [strikeZoneLocked, setStrikeZoneLocked] = useState(false);
  // Shows/hides the MPH label on plotted pitches on the video canvas
  const [showPitchSpeeds, setShowPitchSpeeds] = useState(true);
  const [currentPitchType, setCurrentPitchType] = useState<PitchType>('Four-Seam Fastball');
  const [currentPitchSpeed, setCurrentPitchSpeed] = useState<number>(92);
  const [selectedPitchId, setSelectedPitchId] = useState<string | null>(null);
  // Target Mode: a draggable target circle placed before each pitch, graded
  // against where the pitch actually landed. pitcherHandedness only relabels
  // the glove side / arm side wording, it doesn't change zone geometry.
  const [targetMode, setTargetMode] = useState(false);
  const [pitcherHandedness, setPitcherHandedness] = useState<PitcherHandedness>('right');

  const handleAddPitch = (pitch: Pitch) => {
    setPitches(prev => [...prev, pitch]);
  };

  const handleRemovePitch = (id: string) => {
    setPitches(prev => prev.filter(p => p.id !== id).map((p, idx) => ({ ...p, number: idx + 1 })));
  };

  const handleClearPitches = () => {
    setPitches([]);
  };

  const handleToggleBadShape = (id: string) => {
    setPitches(prev => prev.map(p => p.id === id ? { ...p, badShape: !p.badShape } : p));
  };

  // Both only reachable from the End Session modal - nothing can be saved
  // or exported until the session is actually ended.
  const handleEndSessionExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
      player: selectedPlayer?.name ?? null,
      location: sessionLocation,
      note: sessionNote,
      mode: appMode,
      startedAt: sessionStartedAt ? new Date(sessionStartedAt) : null,
      endedAt: new Date(),
      durationSeconds: sessionElapsedSeconds,
      ...(appMode === 'mechanics'
        ? { cameraView, metrics, kinematicsData: liveKinematicsData }
        : { strikeZoneConfig, pitches }),
    }, null, 2));

    const playerSlug = (selectedPlayer?.name || 'session').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${playerSlug}-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    finalizeEndSession();
  };

  const handleEndSessionSave = async () => {
    if (!selectedPlayerId) return;
    setEndingSession(true);
    setSaveSessionMessage(null);
    try {
      if (appMode === 'mechanics') {
        await saveMechanicsSession({
          player: selectedPlayerId,
          camera_view: cameraView,
          metrics,
          kinematics_data: liveKinematicsData,
          notes: sessionNote,
          location: sessionLocation,
          duration_seconds: sessionElapsedSeconds,
        });
      } else {
        await savePitchSession({
          player: selectedPlayerId,
          strike_zone_config: strikeZoneConfig,
          pitches,
          notes: sessionNote,
          location: sessionLocation,
          duration_seconds: sessionElapsedSeconds,
        });
      }
      refreshSessionCount(selectedPlayerId);
      setSaveSessionMessage('Session saved.');
      finalizeEndSession();
    } catch {
      setSaveSessionMessage('Could not save the session - is the PocketBase backend reachable?');
    } finally {
      setEndingSession(false);
    }
  };

  const selectedPitch = pitches.find(p => p.id === selectedPitchId) || pitches[pitches.length - 1];

  const modeSelector = (
    <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 shadow-inner">
      <button
        onClick={() => setAppMode('mechanics')}
        className={`px-2 sm:px-4 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-1 sm:gap-2 ${
          appMode === 'mechanics'
            ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/20 font-extrabold'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
        }`}
      >
        <Activity className="w-4 h-4" />
        <span className="hidden sm:inline">Mechanics Tracker</span>
        <span className="sm:hidden">Mech</span>
      </button>
      <button
        onClick={() => setAppMode('pitching')}
        className={`px-2 sm:px-4 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-1 sm:gap-2 ${
          appMode === 'pitching'
            ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20 font-extrabold'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
        }`}
      >
        <Target className="w-4 h-4" />
        <span className="hidden sm:inline">Pitch Tracker</span>
        <span className="sm:hidden">Pitch</span>
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-viewport w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Edge tab - phone landscape only, toggles the top/bottom bars below
          back into view since they're collapsed there by default */}
      <button
        onClick={() => setMobileChromeExpanded(v => !v)}
        title={mobileChromeExpanded ? 'Hide bars' : 'Show bars'}
        className="hidden max-lg:landscape:flex fixed top-1/2 right-0 -translate-y-1/2 z-[60] items-center justify-center w-6 h-14 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 border-r-0 rounded-l-lg text-slate-300 shadow-lg backdrop-blur-sm"
      >
        {mobileChromeExpanded ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Top Navigation Bar */}
      {/* z-50 keeps the top bar - and its session menu dropdown - painting above every
          canvas overlay (drawing tools, hint banners, camera controls) below it, all of
          which top out at z-40. Collapses to 0 height on phone landscape unless
          mobileChromeExpanded (see the edge tab above). */}
      <nav className={`h-16 flex items-center justify-between px-4 sm:px-6 bg-slate-900 border-b border-slate-800 shrink-0 z-50 transition-all duration-200 ${
        mobileChromeExpanded ? 'max-lg:landscape:h-16' : 'max-lg:landscape:h-0 max-lg:landscape:border-b-0 max-lg:landscape:overflow-hidden'
      }`}>
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-8 h-8 bg-sky-500 rounded flex items-center justify-center">
            <Crosshair className="w-5 h-5 text-white" />
          </div>
          <div className="h-6 w-px bg-slate-700 mx-1 sm:mx-2 hidden sm:block"></div>
          <span className="items-center gap-2 text-[10px] sm:text-xs font-mono px-2 py-1 bg-slate-800 rounded border border-slate-700 hidden sm:flex">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${analysisPaused ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${analysisPaused ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
            </span>
            <span className="text-white uppercase tracking-wider">{analysisPaused ? 'Feed Paused' : 'Analysis Active'}</span>
          </span>

          {sessionActive && (
            <span className="items-center gap-1.5 text-[10px] sm:text-xs font-mono px-2 py-1 bg-emerald-950/40 rounded border border-emerald-500/40 hidden sm:flex">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-300 font-bold tabular-nums">{formatDuration(sessionElapsedSeconds)}</span>
            </span>
          )}
        </div>
        {/* Mode Selector - always in the top bar, between logo and session menu */}
        <div className="flex">{modeSelector}</div>

        <div className="flex items-center gap-3 sm:gap-4 font-sans">
          <div className="flex items-center gap-2 hidden md:flex">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs text-slate-400 uppercase tracking-widest font-sans">Live Feed • 60 FPS</span>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowSessionMenu(v => !v)}
              title="Session menu"
              className={`p-1.5 sm:p-2 rounded-md border transition-all cursor-pointer ${
                showSessionMenu
                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                  : 'bg-slate-850 hover:bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showSessionMenu && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/5"
                  onClick={() => setShowSessionMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl py-1 z-50">
                  {sessionActive ? (
                    <button
                      onClick={() => { setShowEndSessionModal(true); setShowSessionMenu(false); }}
                      className="w-full text-left px-3.5 py-2.5 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-2.5"
                    >
                      <StopCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <span className="font-semibold">End Session</span>
                      <span className="ml-auto text-[10px] font-mono text-emerald-400">{formatDuration(sessionElapsedSeconds)}</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => { setShowStartSessionModal(true); setShowSessionMenu(false); }}
                      className="w-full text-left px-3.5 py-2.5 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-2.5"
                    >
                      <Play className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="font-semibold">Start Session</span>
                    </button>
                  )}
                  <button
                    onClick={() => { setShowSetupModal(true); setShowSessionMenu(false); }}
                    className="w-full text-left px-3.5 py-2.5 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-2.5"
                  >
                    <Settings className="w-4 h-4 text-sky-400 shrink-0" />
                    <span className="font-semibold">Session Setup</span>
                  </button>
                  {keycloakEnabled && (
                    <button
                      onClick={() => { setShowSessionMenu(false); keycloak!.logout(); }}
                      className="w-full text-left px-3.5 py-2.5 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-2.5 border-t border-slate-800/60 mt-1 pt-2.5"
                    >
                      <LogOut className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="font-semibold">Sign Out</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row relative">

        {/* Left Sidebar: Session Pitch Log - desktop only; on smaller screens
            it's part of the collapsible right panel instead (no room for a
            third column) */}
        {appMode === 'pitching' && (
          <aside
            className="hidden lg:flex lg:w-[var(--left-sidebar-w)] bg-slate-900 border-r border-slate-800 flex-col shrink-0 overflow-hidden h-full relative"
            style={{ '--left-sidebar-w': `${leftSidebarWidth}px` } as React.CSSProperties}
          >
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              <PitchLog
                pitches={pitches}
                onRemovePitch={handleRemovePitch}
                onClearPitches={handleClearPitches}
                selectedPitchId={selectedPitchId}
                setSelectedPitchId={setSelectedPitchId}
                onToggleBadShape={handleToggleBadShape}
              />
            </div>
            {/* Drag to resize - right edge of this sidebar */}
            <div
              onMouseDown={(e) => { e.preventDefault(); startSidebarResize(e.clientX, 'left'); }}
              onTouchStart={(e) => { if (e.touches.length > 0) startSidebarResize(e.touches[0].clientX, 'left'); }}
              className="hidden lg:block absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-500/40 active:bg-sky-500/60 transition-colors"
              title="Drag to resize"
            />
          </aside>
        )}

        {/* Main Content: Video Feed & Metrics */}
        <main className="flex-1 flex flex-col bg-slate-950 overflow-hidden h-full">
          
          {/* Video Feed Area */}
          <div className="flex-1 relative bg-black flex items-center justify-center p-0 lg:p-4 min-h-0">
            <div className="w-full h-full relative lg:rounded-xl overflow-hidden lg:border lg:border-slate-800 lg:shadow-2xl bg-slate-950 flex items-center justify-center">
               <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40 pointer-events-none z-10"></div>
               <Suspense fallback={
                 <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                   Loading analyzer...
                 </div>
               }>
               <PoseDetector
                 onMetricsUpdate={setMetrics}
                 onKinematicsUpdate={setLiveKinematicsData}
                 showSkeleton={showSkeleton}
                 showTrajectory={showTrajectory} 
                 cameraView={cameraView} 
                 strikeZoneConfig={strikeZoneConfig}
                 onConfigChange={setStrikeZoneConfig}
                 showStrikeZone={showStrikeZone}
                 strikeZoneLocked={strikeZoneLocked}
                 showPitchSpeeds={showPitchSpeeds}
                 pitches={pitches}
                 onAddPitch={handleAddPitch}
                 selectedPitchId={selectedPitchId}
                 setSelectedPitchId={setSelectedPitchId}
                 currentPitchType={currentPitchType}
                 setCurrentPitchType={setCurrentPitchType}
                 currentPitchSpeed={currentPitchSpeed}
                 setShowSkeleton={setShowSkeleton}
                 setShowTrajectory={setShowTrajectory}
                 appMode={appMode}
                 visibleMarkers={visibleMarkers}
                 measureMode={measureMode}
                 onMeasureModeChange={setMeasureMode}
                 pixelsPerFoot={pixelsPerFoot}
                 onCalibrationPixelDistance={(pixelDistance) => {
                   const referenceDistanceFeet = calibrationReferenceFeetOverride ?? toFeet(referenceDistanceValue, calibrationUnit);
                   setPixelsPerFoot(pixelDistance / referenceDistanceFeet);
                   setCalibrationReferenceFeetOverride(null);
                 }}
                 onMeasurementComplete={setLastMeasuredFeet}
                 onAngleMeasured={setLastMeasuredAngle}
                 onHeightCalibrationPixels={(pixelHeight) => {
                   if (!selectedPlayer?.height_in) return;
                   setPixelsPerFoot(pixelHeight / (selectedPlayer.height_in / 12));
                 }}
                 measurementUnit={calibrationUnit}
                 cameraZoom={cameraZoom}
                 onCameraZoomChange={setCameraZoom}
                 cameraFacingMode={cameraFacingMode}
                 uvcDeviceId={uvcDeviceId}
                 uvcWidth={uvcResolution.width}
                 uvcHeight={uvcResolution.height}
                 uvcFrameRate={uvcFrameRate}
                 onCameraSettingsChange={setActualCameraSettings}
                 onAnalysisStatusChange={setAnalysisPaused}
                 currentPlayerName={sessionActive ? selectedPlayer?.name : undefined}
                 targetMode={targetMode}
                 pitcherHandedness={pitcherHandedness}
               />
               </Suspense>
            </div>
          </div>

          {/* Bottom Analysis and Metrics Section - collapsed by default, opened from the
              thin bar below. On phone landscape the whole section (bar included)
              collapses further to 0 height unless mobileChromeExpanded. */}
          {appMode === 'mechanics' && (
            <div className={`flex flex-col bg-slate-900 border-t border-slate-800 shrink-0 overflow-hidden transition-all duration-200 ${
              mobileChromeExpanded ? '' : 'max-lg:landscape:max-h-0 max-lg:landscape:border-t-0'
            }`}>
              <button
                onClick={() => setShowMetricsPanel(v => !v)}
                className="h-9 px-4 flex items-center justify-between text-slate-400 hover:text-slate-200 transition-colors shrink-0 cursor-pointer"
              >
                <span className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-sky-400" />
                  Live Metrics &amp; Kinematic Sequence
                </span>
                {showMetricsPanel ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>

              <AnimatePresence initial={false}>
                {showMetricsPanel && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 pt-0 overflow-y-auto max-h-[350px]">
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
                          <Suspense fallback={<div className="text-slate-500 text-xs p-4">Loading chart...</div>}>
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
                          </Suspense>
                        </div>

                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </main>

        {/* Right Sidebar: Pitch Tracking Accuracy Panel - collapsed behind a thin
            bar on mobile (matching the Live Metrics panel pattern), always expanded
            in its own column on lg+. On phone landscape that thin bar collapses
            further to 0 height unless mobileChromeExpanded. */}
        <aside
          className={`w-full lg:w-[var(--right-sidebar-w)] bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex-col shrink-0 overflow-hidden h-auto lg:h-full relative ${
            appMode === 'pitching' ? 'flex' : 'hidden'
          } ${mobileChromeExpanded ? '' : 'max-lg:landscape:border-t-0'}`}
          style={{ '--right-sidebar-w': `${rightSidebarWidth}px` } as React.CSSProperties}
        >
          {/* Drag to resize - left edge of this sidebar */}
          <div
            onMouseDown={(e) => { e.preventDefault(); startSidebarResize(e.clientX, 'right'); }}
            onTouchStart={(e) => { if (e.touches.length > 0) startSidebarResize(e.touches[0].clientX, 'right'); }}
            className="hidden lg:block absolute top-0 left-0 h-full w-1.5 cursor-col-resize hover:bg-sky-500/40 active:bg-sky-500/60 transition-colors z-10"
            title="Drag to resize"
          />
          <button
            onClick={() => setShowPitchTracker(v => !v)}
            className={`lg:hidden h-9 px-4 flex items-center justify-between text-slate-400 hover:text-slate-200 transition-colors shrink-0 cursor-pointer border-b border-slate-800 overflow-hidden ${
              mobileChromeExpanded ? 'max-lg:landscape:h-9' : 'max-lg:landscape:h-0 max-lg:landscape:px-0 max-lg:landscape:border-b-0'
            }`}
          >
            <span className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-2">
              <Target className="w-3.5 h-3.5 text-rose-400" />
              Pitch Accuracy Tracker
            </span>
            {showPitchTracker ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>

          <div className={`${showPitchTracker ? 'flex' : 'hidden'} lg:flex flex-col flex-1 min-h-0 overflow-hidden`}>
            <div className="p-4 border-b border-slate-800 shrink-0 hidden lg:block">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></span>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">PITCH ACCURACY TRACKER</p>
              </div>
              <p className="text-xs text-slate-400 mt-1">Track location, speed, and zone accuracy</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 min-h-0 max-h-[420px] lg:max-h-none">
              <PitchTracker
                pitches={pitches}
                config={strikeZoneConfig}
                onConfigChange={setStrikeZoneConfig}
                showStrikeZone={showStrikeZone}
                setShowStrikeZone={setShowStrikeZone}
                strikeZoneLocked={strikeZoneLocked}
                setStrikeZoneLocked={setStrikeZoneLocked}
                showPitchSpeeds={showPitchSpeeds}
                setShowPitchSpeeds={setShowPitchSpeeds}
                currentPitchType={currentPitchType}
                setCurrentPitchType={setCurrentPitchType}
                currentPitchSpeed={currentPitchSpeed}
                setCurrentPitchSpeed={setCurrentPitchSpeed}
                targetMode={targetMode}
                setTargetMode={setTargetMode}
                pitcherHandedness={pitcherHandedness}
                setPitcherHandedness={setPitcherHandedness}
              />

              {/* Pitch log lives in the left column on lg+; keep it reachable
                  here below lg where there's no room for a third column */}
              <div className="lg:hidden mt-5 h-[360px]">
                <PitchLog
                  pitches={pitches}
                  onRemovePitch={handleRemovePitch}
                  onClearPitches={handleClearPitches}
                  selectedPitchId={selectedPitchId}
                  setSelectedPitchId={setSelectedPitchId}
                  onToggleBadShape={handleToggleBadShape}
                />
              </div>
            </div>
          </div>
        </aside>

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
                  onClick={() => setActiveModalTab('calibration')}
                  className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
                    activeModalTab === 'calibration'
                      ? 'bg-slate-800 text-sky-400 shadow font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850/40'
                  }`}
                >
                  <Ruler className="w-3.5 h-3.5" />
                  <span>Calibration</span>
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
                    {playersError && (
                      <div className="bg-red-950/30 border border-red-500/30 rounded-xl p-3.5 flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-red-300">{playersError}</p>
                      </div>
                    )}

                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                          <Users className="w-4 h-4 text-sky-400" />
                          Player Roster
                        </h4>
                        <button
                          onClick={() => setShowAddPlayerForm(v => !v)}
                          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Player
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400 mb-3">Saved mechanics and pitch tracker sessions are recorded against the selected player.</p>

                      {showAddPlayerForm && (
                        <div className="flex items-center gap-2 mb-3">
                          <input
                            type="text"
                            autoFocus
                            value={newPlayerName}
                            onChange={(e) => setNewPlayerName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleCreatePlayer(); }}
                            placeholder="Player name"
                            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                          />
                          <button
                            onClick={handleCreatePlayer}
                            disabled={!newPlayerName.trim()}
                            className="px-3 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                          >
                            Save
                          </button>
                        </div>
                      )}

                      {playersLoading ? (
                        <p className="text-[11px] text-slate-500 py-3 text-center">Loading roster...</p>
                      ) : players.length === 0 ? (
                        <p className="text-[11px] text-slate-500 py-3 text-center">No players yet - add one to start tracking sessions.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {players.map((player) => (
                            <button
                              key={player.id}
                              onClick={() => setSelectedPlayerId(player.id)}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                                selectedPlayerId === player.id
                                  ? 'bg-sky-950/40 border-sky-500/50'
                                  : 'bg-slate-800/60 border-slate-700/60 hover:bg-slate-800'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span className={`text-sm font-semibold truncate ${selectedPlayerId === player.id ? 'text-sky-300' : 'text-slate-200'}`}>
                                  {player.name}
                                </span>
                                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider shrink-0">
                                  {sessionCounts[player.id] ?? 0} session{(sessionCounts[player.id] ?? 0) === 1 ? '' : 's'}
                                </span>
                              </span>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); handleDeletePlayer(player.id); }}
                                className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-red-500/10 transition-colors shrink-0"
                                title="Delete player"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedPlayer && (
                      <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">{selectedPlayer.name}'s Dimensions</h4>
                        <p className="text-[11px] text-slate-400 mb-4">Provide accurate biometric measurements to optimize skeletal kinematic tracking ratios.</p>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
                            <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">Height (in)</label>
                            <input
                              type="number"
                              value={selectedPlayer.height_in || 0}
                              onChange={(e) => handleUpdatePlayerField(selectedPlayer.id, 'height_in', parseInt(e.target.value) || 0)}
                              onBlur={(e) => handlePersistPlayerField(selectedPlayer.id, 'height_in', parseInt(e.target.value) || 0)}
                              className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                            />
                          </div>
                          <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
                            <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">Weight (lbs)</label>
                            <input
                              type="number"
                              value={selectedPlayer.weight_lb || 0}
                              onChange={(e) => handleUpdatePlayerField(selectedPlayer.id, 'weight_lb', parseInt(e.target.value) || 0)}
                              onBlur={(e) => handlePersistPlayerField(selectedPlayer.id, 'weight_lb', parseInt(e.target.value) || 0)}
                              className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                            />
                          </div>
                          <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
                            <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">Wingspan (in)</label>
                            <input
                              type="number"
                              value={selectedPlayer.wingspan_in || 0}
                              onChange={(e) => handleUpdatePlayerField(selectedPlayer.id, 'wingspan_in', parseInt(e.target.value) || 0)}
                              onBlur={(e) => handlePersistPlayerField(selectedPlayer.id, 'wingspan_in', parseInt(e.target.value) || 0)}
                              className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    )}

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
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">Camera Lens</h4>
                      <p className="text-[11px] text-slate-400 mb-4">Switch between the front (selfie) and rear-facing lens on the live webcam feed.</p>

                      <button
                        onClick={() => setCameraFacingMode(m => m === 'user' ? 'environment' : 'user')}
                        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border bg-slate-800 border-slate-700/60 text-slate-200 hover:bg-slate-750 transition-all cursor-pointer"
                      >
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Camera: {cameraFacingMode === 'user' ? 'Front (Selfie)' : 'Back (Rear)'}
                        </span>
                        <RefreshCw className="w-4 h-4 text-sky-400" />
                      </button>
                    </div>

                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">USB / UVC Camera (Slow-Mo)</h4>
                      <p className="text-[11px] text-slate-400 mb-4">
                        Use a USB-connected camera (e.g. a high-fps global-shutter module) instead of the lens above, and pick its resolution/frame-rate mode. Phone cameras aren't supported here - browsers cap those well below the phone's native slow-mo capability, so record slow-mo on the phone itself and upload the clip instead.
                      </p>

                      <button
                        onClick={handleScanCameras}
                        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border bg-slate-800 border-slate-700/60 text-slate-200 hover:bg-slate-750 transition-all cursor-pointer mb-3"
                      >
                        <span className="text-xs font-bold uppercase tracking-wider">Scan for Cameras</span>
                        <Usb className="w-4 h-4 text-sky-400" />
                      </button>

                      {videoInputDevices.length > 0 && (
                        <div className="mb-3">
                          <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">Device</label>
                          <select
                            value={uvcDeviceId || ''}
                            onChange={(e) => handleSelectUvcDevice(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-white font-semibold focus:outline-none focus:border-sky-500"
                          >
                            <option value="">Default (mobile lens above)</option>
                            {videoInputDevices.map((d, i) => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {uvcDeviceId && (
                        <>
                          {uvcProbing && (
                            <p className="text-[10px] text-slate-500 mb-3">Detecting supported resolutions/frame rates...</p>
                          )}
                          {!uvcProbing && uvcCapabilities && (
                            <p className="text-[10px] text-slate-500 mb-3">
                              Device reports up to {uvcCapabilities.maxWidth}x{uvcCapabilities.maxHeight} @ {uvcCapabilities.maxFrameRate}fps.
                            </p>
                          )}
                          {!uvcProbing && !uvcCapabilities && (
                            <p className="text-[10px] text-amber-400/80 mb-3">
                              Could not detect this device's capability range - presets below are shown unfiltered.
                            </p>
                          )}

                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">Resolution</label>
                              <select
                                value={`${uvcResolution.width}x${uvcResolution.height}`}
                                onChange={(e) => {
                                  const [width, height] = e.target.value.split('x').map(Number);
                                  setUvcResolution({ width, height });
                                }}
                                className="w-full bg-slate-800 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-white font-semibold focus:outline-none focus:border-sky-500"
                              >
                                {uvcResolutionOptions.map(p => (
                                  <option key={p.label} value={`${p.width}x${p.height}`}>{p.label} ({p.width}x{p.height})</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">Frame Rate</label>
                              <select
                                value={uvcFrameRate}
                                onChange={(e) => setUvcFrameRate(Number(e.target.value))}
                                className="w-full bg-slate-800 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-white font-semibold focus:outline-none focus:border-sky-500"
                              >
                                {uvcFrameRateOptions.map(fps => (
                                  <option key={fps} value={fps}>{fps} fps</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {actualCameraSettings && (
                            <p className="text-[10px] text-emerald-400 font-mono">
                              Actual stream: {actualCameraSettings.width}x{actualCameraSettings.height} @ {actualCameraSettings.frameRate}fps
                            </p>
                          )}
                        </>
                      )}
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

                {activeModalTab === 'calibration' && (
                  <div className="space-y-4">
                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Distance Calibration</h4>
                        <div className="flex items-center bg-slate-800/80 rounded-lg border border-slate-700/60 p-0.5">
                          {(['ft', 'in', 'm'] as const).map((unit) => (
                            <button
                              key={unit}
                              onClick={() => {
                                if (calibrationUnit !== unit) {
                                  setReferenceDistanceValue(v => Math.round(fromFeet(toFeet(v, calibrationUnit), unit) * 100) / 100);
                                  setCalibrationUnit(unit);
                                }
                              }}
                              className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-colors cursor-pointer ${
                                calibrationUnit === unit ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {unit === 'ft' ? 'US (ft)' : unit === 'in' ? 'Inches' : 'Metric (m)'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-400 mb-4">
                        Set a known real-world distance (e.g. the 60'6" / 18.44m mound-to-plate distance, or a
                        marked stride line), then draw over that same distance on the video to establish a
                        pixel scale for measuring anything else on screen.
                      </p>

                      <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60 mb-3">
                        <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1.5">
                          Reference Distance ({calibrationUnit === 'ft' ? 'feet' : calibrationUnit === 'in' ? 'inches' : 'meters'})
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          value={referenceDistanceValue}
                          onChange={(e) => setReferenceDistanceValue(parseFloat(e.target.value) || 0)}
                          className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                        />
                      </div>

                      <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border mb-3 ${
                        pixelsPerFoot
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-slate-800/60 border-slate-700/60 text-slate-400'
                      }`}>
                        <Ruler className="w-4 h-4 shrink-0" />
                        <span className="text-[11px] font-mono">
                          {pixelsPerFoot
                            ? `Calibrated - ${(pixelsPerFoot / fromFeet(1, calibrationUnit)).toFixed(1)} px/${calibrationUnit}`
                            : 'Not calibrated yet'}
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          setCalibrationReferenceFeetOverride(null);
                          setMeasureMode('calibrate');
                          setShowSetupModal(false);
                        }}
                        disabled={referenceDistanceValue <= 0}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg transition-all cursor-pointer"
                      >
                        <Ruler className="w-3.5 h-3.5" />
                        <span>{pixelsPerFoot ? 'Re-calibrate' : 'Start Calibration'}</span>
                      </button>
                      {pixelsPerFoot && (
                        <button
                          onClick={() => { setPixelsPerFoot(null); setLastMeasuredFeet(null); }}
                          className="w-full mt-2 px-3 py-1.5 text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider transition-colors cursor-pointer"
                        >
                          Clear calibration
                        </button>
                      )}

                      <div className="flex items-center gap-2 my-3">
                        <div className="flex-1 h-px bg-slate-800"></div>
                        <span className="text-[9px] text-slate-600 uppercase font-bold">or</span>
                        <div className="flex-1 h-px bg-slate-800"></div>
                      </div>

                      <button
                        onClick={() => {
                          if (!selectedPlayer?.height_in) return;
                          setCalibrationReferenceFeetOverride(selectedPlayer.height_in / 12);
                          setMeasureMode('calibrate');
                          setShowSetupModal(false);
                        }}
                        disabled={!selectedPlayer?.height_in}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg transition-all cursor-pointer"
                      >
                        <Ruler className="w-3.5 h-3.5" />
                        <span>Draw Line from {selectedPlayer?.name || 'Player'}'s Head to Feet</span>
                      </button>
                      <p className="text-[10px] text-slate-500 mt-2 mb-3">
                        {selectedPlayer?.height_in
                          ? "For when the automatic option below can't get a clean read - draw a line from the top of the head to the bottom of the feet yourself."
                          : 'Set a height for the selected player in the Profile tab to enable this.'}
                      </p>

                      <button
                        onClick={() => {
                          setMeasureMode('height');
                          setShowSetupModal(false);
                        }}
                        disabled={!selectedPlayer?.height_in}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg transition-all cursor-pointer"
                      >
                        <User className="w-3.5 h-3.5" />
                        <span>Auto-Detect from {selectedPlayer?.name || 'Player'}'s Height</span>
                      </button>
                      <p className="text-[10px] text-slate-500 mt-2">
                        {selectedPlayer?.height_in
                          ? "Skips drawing anything - stand the pitcher's full body in frame and hold still for a moment."
                          : 'Set a height for the selected player in the Profile tab to enable this.'}
                      </p>
                    </div>

                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">Measure a Distance</h4>
                      <p className="text-[11px] text-slate-400 mb-4">
                        Once calibrated, draw between any two points on the video to read off the real-world
                        distance - stride length, release point height, whatever you need.
                      </p>

                      <button
                        onClick={() => {
                          setMeasureMode('measure');
                          setShowSetupModal(false);
                        }}
                        disabled={!pixelsPerFoot}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg transition-all cursor-pointer"
                      >
                        <Ruler className="w-3.5 h-3.5" />
                        <span>Measure Distance</span>
                      </button>

                      {lastMeasuredFeet !== null && (
                        <p className="text-[11px] text-slate-400 mt-3 font-mono">
                          Last measurement: <span className="text-sky-400 font-bold">{formatFeet(lastMeasuredFeet, calibrationUnit)}</span>
                        </p>
                      )}
                    </div>

                    <div className="bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">Measure an Angle</h4>
                      <p className="text-[11px] text-slate-400 mb-4">
                        Click three points on the video - one ray end, the vertex, then the other ray end -
                        to read the angle between them. No calibration needed; works on any frame.
                      </p>

                      <button
                        onClick={() => {
                          setMeasureMode('angle');
                          setShowSetupModal(false);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg transition-all cursor-pointer"
                      >
                        <DraftingCompass className="w-3.5 h-3.5" />
                        <span>Measure Angle</span>
                      </button>

                      {lastMeasuredAngle !== null && (
                        <p className="text-[11px] text-slate-400 mt-3 font-mono">
                          Last angle: <span className="text-violet-400 font-bold">{lastMeasuredAngle.toFixed(1)}°</span>
                        </p>
                      )}
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

      {/* Start Session modal */}
      <AnimatePresence>
        {showStartSessionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStartSessionModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden z-10 font-sans"
            >
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                    <Play className="w-4.5 h-4.5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white uppercase tracking-wider">Start Session</h3>
                    <p className="text-[10px] text-slate-400">
                      Select a player to begin tracking
                      {coachName && <span className="text-slate-500"> · Coach: {coachName}</span>}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowStartSessionModal(false)}
                  className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                {playersError && (
                  <div className="bg-red-950/30 border border-red-500/30 rounded-xl p-3.5 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-300">{playersError}</p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-sky-400" />
                      Player
                    </label>
                    <button
                      onClick={() => setShowAddPlayerForm(v => !v)}
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Player
                    </button>
                  </div>

                  {showAddPlayerForm && (
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="text"
                        autoFocus
                        value={newPlayerName}
                        onChange={(e) => setNewPlayerName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreatePlayer(); }}
                        placeholder="Player name"
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                      />
                      <button
                        onClick={handleCreatePlayer}
                        disabled={!newPlayerName.trim()}
                        className="px-3 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {playersLoading ? (
                    <p className="text-[11px] text-slate-500 py-3 text-center">Loading roster...</p>
                  ) : players.length === 0 ? (
                    <p className="text-[11px] text-slate-500 py-3 text-center">No players yet - add one above to start a session.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                      {players.map((player) => (
                        <button
                          key={player.id}
                          onClick={() => setSelectedPlayerId(player.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                            selectedPlayerId === player.id
                              ? 'bg-emerald-950/40 border-emerald-500/50'
                              : 'bg-slate-800/60 border-slate-700/60 hover:bg-slate-800'
                          }`}
                        >
                          <span className={`text-sm font-semibold truncate ${selectedPlayerId === player.id ? 'text-emerald-300' : 'text-slate-200'}`}>
                            {player.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold flex items-center gap-1.5 mb-2">
                    <MapPin className="w-3.5 h-3.5 text-sky-400" />
                    Location
                  </label>
                  <input
                    type="text"
                    value={sessionLocation}
                    onChange={(e) => setSessionLocation(e.target.value)}
                    placeholder="e.g. Turf Field A, backyard bullpen"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>

                {!selectedPlayerId && (
                  <p className="text-[11px] text-amber-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    Select a player to start the session.
                  </p>
                )}
              </div>

              <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  onClick={() => setShowStartSessionModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartSession}
                  disabled={!selectedPlayerId}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-emerald-600/10 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  Start Session
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* End Session modal */}
      <AnimatePresence>
        {showEndSessionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEndSessionModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden z-10 font-sans"
            >
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                    <StopCircle className="w-4.5 h-4.5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white uppercase tracking-wider">End Session</h3>
                    <p className="text-[10px] text-slate-400">Add a note, then export or save</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowEndSessionModal(false)}
                  className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                <div className="bg-slate-950/30 border border-slate-800 rounded-xl p-3.5 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Player</p>
                    <p className="text-white font-semibold truncate">{selectedPlayer?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Duration</p>
                    <p className="text-emerald-400 font-mono font-bold">{formatDuration(sessionElapsedSeconds)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Coach</p>
                    <p className="text-slate-300 truncate">{coachName || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Location</p>
                    <p className="text-slate-300 truncate">{sessionLocation || '—'}</p>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold flex items-center gap-1.5 mb-2">
                    <FileText className="w-3.5 h-3.5 text-sky-400" />
                    Note
                  </label>
                  <textarea
                    value={sessionNote}
                    onChange={(e) => setSessionNote(e.target.value)}
                    placeholder="How did the session go?"
                    rows={3}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500 resize-none"
                  />
                </div>
              </div>

              <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  onClick={handleEndSessionExport}
                  disabled={endingSession}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-slate-200 text-xs font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-sky-400" />
                  Export
                </button>
                <button
                  onClick={handleEndSessionSave}
                  disabled={endingSession}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-sky-600/10 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {endingSession ? 'Saving...' : 'Save to Database'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Save Session toast */}
      <AnimatePresence>
        {saveSessionMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl text-xs font-semibold text-white flex items-center gap-2"
          >
            <Save className="w-4 h-4 text-emerald-400 shrink-0" />
            {saveSessionMessage}
          </motion.div>
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
