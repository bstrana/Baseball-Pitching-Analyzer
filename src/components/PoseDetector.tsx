import React, { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { Camera, RefreshCw, Upload, Video, AlertCircle, Play, Pause, Aperture, Eye, EyeOff, Target, Sparkles, RefreshCcw, SkipForward, SkipBack, MousePointer, Slash, MoveRight, Circle, PenTool, Undo2, Trash2, Disc, History, Flag, X, MoreVertical, GripHorizontal, ZoomIn, Maximize, Minimize, MoveDiagonal2, DraftingCompass } from 'lucide-react';
import { Pitch, PitchType, StrikeZoneConfig, KinematicFrame, PitcherHandedness, AppMode, PITCH_TYPE_INFO, PITCH_TYPES, classifyPitch, classifyMiss, getTargetZoneLabel } from '../types';

// Required to initialize the WebGL backend
import '@tensorflow/tfjs-backend-webgl';

const getDistance = (x1: number, y1: number, x2: number, y2: number) => {
  return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
};

// One Euro Filter (Casiez, Roussel, Vogel 2012) - smooths a noisy 1D signal
// adaptively: heavy smoothing while the signal is nearly still (killing
// jitter), automatically backing off as it speeds up (so it doesn't lag
// behind real fast motion). Used below to stabilize raw per-frame keypoint
// positions from MoveNet, which has no temporal smoothing of its own - every
// frame is an independent estimate, so a perfectly still subject still shows
// a few pixels of random jitter per joint without this.
class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private prevX: number | null = null;
  private prevDx = 0;
  private prevT: number | null = null;

  // Defaults match the values from the original paper/reference
  // implementation (tuned for on-screen pixel-coordinate signals, which is
  // the same order of magnitude as keypoint coordinates here) - untested
  // against a real noisy camera feed in this environment, so may need
  // retuning: raise beta if fast pitching motion looks laggy/smeared, lower
  // minCutoff if there's still visible jitter at rest.
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tMs: number): number {
    if (this.prevT === null || this.prevX === null) {
      this.prevT = tMs;
      this.prevX = x;
      return x;
    }
    const dt = Math.max((tMs - this.prevT) / 1000, 1 / 240); // seconds, floor avoids div-by-~0 on duplicate timestamps
    this.prevT = tMs;

    const dx = (x - this.prevX) / dt;
    const edx = this.prevDx + this.alpha(this.dCutoff, dt) * (dx - this.prevDx);
    this.prevDx = edx;

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const result = this.prevX + this.alpha(cutoff, dt) * (x - this.prevX);
    this.prevX = result;
    return result;
  }
}

const FEET_PER_METER = 3.28084;

// Formats a distance already in feet into the display unit, including inches -
// useful for baseball-scale measurements (stride length, release point height)
// that are awkward as a fraction of a foot. isRate appends "/s" for a speed.
const formatFeetInUnit = (feet: number, unit: 'ft' | 'in' | 'm', isRate: boolean = false): string => {
  const suffix = isRate ? '/s' : '';
  if (unit === 'in') return `${(feet * 12).toFixed(1)} in${suffix}`;
  if (unit === 'm') return `${(feet / FEET_PER_METER).toFixed(isRate ? 1 : 2)} m${suffix}`;
  return `${feet.toFixed(isRate ? 1 : 2)} ft${suffix}`;
};

const getPitchTypeColor = (type: PitchType): string => PITCH_TYPE_INFO[type].hexColor;

// Traces a rounded-rect path using only moveTo/lineTo/arcTo - unlike
// CanvasRenderingContext2D.roundRect() (Chrome 99+/Safari 16+/Firefox 112+),
// arcTo has been part of Canvas2D since the original spec, so this works on
// any browser/WebView the app might run in. An uncaught exception from a
// missing roundRect here would silently abort every other draw call sharing
// the same per-frame try/catch in detectPose - not just this shape.
const pathRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
};

export interface PoseMetrics {
  rightArmAngle: number;
  leftArmAngle: number;
  rightLegAngle: number;
  leftLegAngle: number;
  hipShoulderSeparation: number;
  speeds: {
    hip: number;
    shoulder: number;
    elbow: number;
    wrist: number;
  };
}

const ZERO_METRICS: PoseMetrics = {
  rightArmAngle: 0,
  leftArmAngle: 0,
  rightLegAngle: 0,
  leftLegAngle: 0,
  hipShoulderSeparation: 0,
  speeds: { hip: 0, shoulder: 0, elbow: 0, wrist: 0 }
};

interface PoseDetectorProps {
  onMetricsUpdate: (metrics: PoseMetrics) => void;
  onKinematicsUpdate?: (data: KinematicFrame[]) => void;
  showSkeleton: boolean;
  showTrajectory: boolean;
  cameraView: 'side' | 'front' | 'back';
  strikeZoneConfig: StrikeZoneConfig;
  showStrikeZone: boolean;
  strikeZoneLocked?: boolean;
  showPitchSpeeds?: boolean;
  pitches: Pitch[];
  onAddPitch: (pitch: Pitch) => void;
  selectedPitchId: string | null;
  setSelectedPitchId: (id: string | null) => void;
  currentPitchType: PitchType;
  setCurrentPitchType?: (type: PitchType) => void;
  currentPitchSpeed: number;
  visibleMarkers?: {
    head: boolean;
    arms: boolean;
    torso: boolean;
    hips: boolean;
    legs: boolean;
  };
  
  // Optional toggles for HUD integration
  setShowSkeleton?: (show: boolean) => void;
  setShowTrajectory?: (show: boolean) => void;

  // App Mode and Config Changes
  appMode?: AppMode;
  onConfigChange?: (config: StrikeZoneConfig) => void;

  // Distance calibration & measurement, and manual angle measurement
  measureMode?: 'none' | 'calibrate' | 'measure' | 'angle' | 'height';
  onMeasureModeChange?: (mode: 'none' | 'calibrate' | 'measure' | 'angle' | 'height') => void;
  pixelsPerFoot?: number | null;
  onCalibrationPixelDistance?: (pixelDistance: number) => void;
  onMeasurementComplete?: (feet: number) => void;
  onAngleMeasured?: (angleDegrees: number) => void;
  // Calibrates pixelsPerFoot from the pitcher's known height instead of a
  // hand-drawn line - reports the estimated standing-height pixel span once
  // a confident full-body frame appears; the caller divides by the player's
  // real height to get the scale.
  onHeightCalibrationPixels?: (pixelHeight: number) => void;
  measurementUnit?: 'ft' | 'in' | 'm';

  // Digital camera zoom (1x - 3x) applied as a CSS scale on the video canvas.
  // Adjusted from the on-canvas HUD bar (not a modal) so the live feed stays
  // visible while dialing it in, rather than zooming "blind".
  cameraZoom?: number;
  onCameraZoomChange?: (zoom: number) => void;

  // Which physical camera lens to use ('user' = front/selfie, 'environment' = rear).
  // Controlled entirely from the off-canvas Settings menu - changing it here
  // restarts the webcam stream with the new lens. Ignored once uvcDeviceId is set.
  cameraFacingMode?: 'user' | 'environment';

  // USB/UVC camera override, for desktop webcams (e.g. high-fps global-shutter
  // modules) that expose a specific deviceId plus a discrete resolution/frame
  // rate mode - unrelated to the mobile front/rear lens picker above, which
  // stays on facingMode. Leave uvcDeviceId unset/null to use that mobile path
  // unchanged. Set together from the off-canvas Settings menu.
  uvcDeviceId?: string | null;
  uvcWidth?: number | null;
  uvcHeight?: number | null;
  uvcFrameRate?: number | null;
  // Reports the stream's actual negotiated width/height/frameRate once it
  // opens, since requested UVC constraints are matched best-effort by the
  // browser and may not land exactly on what was requested.
  onCameraSettingsChange?: (settings: { width: number; height: number; frameRate: number } | null) => void;

  // Reports live/paused status upward so the top bar can show it (replaces
  // the on-canvas "ANALYSIS ACTIVE"/"FEED PAUSED" indicator).
  onAnalysisStatusChange?: (isPaused: boolean) => void;

  // Name of the player this session is being recorded for, shown as a
  // top-center overlay on the video canvas.
  currentPlayerName?: string;

  // Target Mode: a draggable target circle is placed before each pitch: the
  // first tap on the canvas plants it, the next tap logs where the pitch
  // actually landed and grades the miss against it. Replaces the plain
  // click-to-log flow while active. pitcherHandedness only relabels the
  // existing zone geometry (glove side / arm side) for display.
  targetMode?: boolean;
  pitcherHandedness?: PitcherHandedness;

  // Split Test Mode: which Group/Set is currently active, shown as an
  // on-screen badge (e.g. "FOOT ON RUBBER · OUTWARD") so the coach can
  // confirm what's being tested without looking away from the camera.
  activeSplitTestLabel?: string;
}

export function PoseDetector({
  onMetricsUpdate,
  onKinematicsUpdate,
  showSkeleton,
  showTrajectory, 
  cameraView,
  strikeZoneConfig,
  showStrikeZone,
  strikeZoneLocked = false,
  showPitchSpeeds = true,
  pitches,
  onAddPitch,
  selectedPitchId,
  setSelectedPitchId,
  currentPitchType,
  setCurrentPitchType,
  currentPitchSpeed,
  visibleMarkers,
  setShowSkeleton,
  setShowTrajectory,
  appMode = 'mechanics',
  onConfigChange,
  measureMode = 'none',
  onMeasureModeChange,
  pixelsPerFoot,
  onCalibrationPixelDistance,
  onMeasurementComplete,
  onAngleMeasured,
  onHeightCalibrationPixels,
  measurementUnit = 'ft',
  cameraZoom = 1,
  onCameraZoomChange,
  cameraFacingMode = 'environment',
  uvcDeviceId = null,
  uvcWidth = null,
  uvcHeight = null,
  uvcFrameRate = null,
  onCameraSettingsChange,
  onAnalysisStatusChange,
  currentPlayerName,
  targetMode = false,
  pitcherHandedness = 'right',
  activeSplitTestLabel
}: PoseDetectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  // Pitching mode has no use for the Camera Zoom popover on the canvas HUD
  // bar - that slot instead becomes a quick pitch type picker there.
  const [showPitchTypeMenu, setShowPitchTypeMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detector, setDetector] = useState<poseDetection.PoseDetector | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const animationFrameId = useRef<number | null>(null);
  const wristTrajectory = useRef<{x: number, y: number}[]>([]);
  const singleFrameAnalyzeRequestedRef = useRef(false);
  
  // Keep track of active feed source
  const [feedSource, setFeedSource] = useState<'camera' | 'upload'>('camera');
  const feedSourceRef = useRef(feedSource);

  const lastFrameRef = useRef<{ 
    time: number; 
    keypoints: Map<string, poseDetection.Keypoint>;
    pelvisAngle?: number;
    torsoAngle?: number;
  } | null>(null);
  const speedBufferRef = useRef<{hip: number[], shoulder: number[], elbow: number[], wrist: number[]}>({
    hip: [], shoulder: [], elbow: [], wrist: []
  });
  // One filter pair (x, y) per named keypoint, created lazily and reused
  // across frames - see OneEuroFilter above for why (kills per-frame jitter
  // from MoveNet's lack of temporal smoothing without lagging real motion).
  const keypointFiltersRef = useRef<Map<string, { x: OneEuroFilter; y: OneEuroFilter }>>(new Map());

  // Dynamic references to avoid stale closures in the high-frequency animation loop
  const strikeZoneConfigRef = useRef(strikeZoneConfig);
  const showStrikeZoneRef = useRef(showStrikeZone);
  const strikeZoneLockedRef = useRef(strikeZoneLocked);
  const showPitchSpeedsRef = useRef(showPitchSpeeds);
  const pitchesRef = useRef(pitches);
  const selectedPitchIdRef = useRef(selectedPitchId);
  const currentPitchTypeRef = useRef(currentPitchType);
  const currentPitchSpeedRef = useRef(currentPitchSpeed);
  const onAddPitchRef = useRef(onAddPitch);
  const appModeRef = useRef(appMode);
  const cameraViewRef = useRef(cameraView);
  const onConfigChangeRef = useRef(onConfigChange);
  const onKinematicsUpdateRef = useRef(onKinematicsUpdate);
  const kinematicsEmitCounterRef = useRef(0);
  const metricsEmitCounterRef = useRef(0);
  const defaultVisibleMarkers = {
    head: true,
    arms: true,
    torso: true,
    hips: true,
    legs: true
  };

  const visibleMarkersRef = useRef(visibleMarkers || defaultVisibleMarkers);
  const showSkeletonRef = useRef(showSkeleton);
  const showTrajectoryRef = useRef(showTrajectory);
  const cameraZoomRef = useRef(cameraZoom);

  // Cache variables to prevent jitter when the video is paused/stopped
  const cachedPoseRef = useRef<poseDetection.Pose | null>(null);
  const cachedPoseTimeRef = useRef<number>(-1);
  const cachedPoseSourceRef = useRef<string>('');
  
  const dragStateRef = useRef<{
    type: 'move' | 'tl' | 'tr' | 'bl' | 'br';
    startX: number;
    startY: number;
    startConfig: StrikeZoneConfig;
  } | null>(null);
  
  const pressPosRef = useRef<{ x: number; y: number } | null>(null);

  // Target Mode: the pending target (planted before a pitch, cleared once
  // that pitch is logged) and whether it's currently being dragged. Kept as
  // refs only, like the zone-drag/measurement/drawing state above - the
  // render loop reads them fresh every animation frame, so no React state
  // (and its extra re-renders) is needed to keep the circle on screen.
  const targetModeRef = useRef(targetMode);
  const pitcherHandednessRef = useRef(pitcherHandedness);
  const targetPosRef = useRef<{ x: number; y: number } | null>(null);
  const targetDragRef = useRef(false);

  // Video scrubber state
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Analysis range: for uploaded/replayed video, nothing is tracked or recorded
  // until the user marks a start/end point and presses Analyze.
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const hasAnalyzedRef = useRef(false);
  const isAnalyzingRef = useRef(false);

  // Full-resolution right-wrist trail captured during an Analyze sweep (unlike
  // wristTrajectory below, never capped/decayed) so the complete pitch path can
  // stay drawn on screen once analysis finishes, plus the peak joint speeds and
  // max ankle-to-ankle (stride) pixel distance seen during that same sweep.
  // sweepPeaksRef accumulates live while runAnalysis is running; analysisSummary
  // is the frozen snapshot shown in the HUD bar once it completes.
  const analyzedTrajectoryRef = useRef<{ x: number; y: number }[]>([]);
  const sweepPeaksRef = useRef({ hip: 0, shoulder: 0, elbow: 0, wrist: 0, strideCorePixels: 0 });
  const [analysisSummary, setAnalysisSummary] = useState<{
    peakHip: number;
    peakShoulder: number;
    peakElbowPx: number;
    peakWristPx: number;
    strideCorePixels: number;
  } | null>(null);

  // Fullscreen - most useful on a phone in landscape, where it also hides
  // the browser's own address bar/toolbar, unlike our own on-canvas HUD
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordings, setRecordings] = useState<{ id: string; name: string; url: string; blob: Blob; timestamp: number }[]>([]);
  const [showRecordingsList, setShowRecordingsList] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Off-DOM canvas + its own redraw loop, used only while recording with the
  // digital zoom active (see startRecording) - never attached to the page.
  const zoomRecordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoomRecordingRafRef = useRef<number | null>(null);
  // Kept in sync with `recordings` state purely so the unmount cleanup below
  // can revoke whatever object URLs are still outstanding at that point.
  const recordingsRef = useRef(recordings);

  // Rolling kinematics data for pitch-release kinematics capturing
  const rollingKinematicsRef = useRef<{ hip: number; shoulder: number; wrist: number; timestamp: number }[]>([]);

  // Telestrator drawing states
  const [showDrawTools, setShowDrawTools] = useState(false);
  const [activeDrawTool, setActiveDrawTool] = useState<'none' | 'line' | 'arrow' | 'circle' | 'freehand'>('none');
  const [activeDrawColor, setActiveDrawColor] = useState<string>('#f43f5e'); // rose-500
  const [drawings, setDrawings] = useState<{
    id: string;
    type: 'line' | 'arrow' | 'circle' | 'freehand';
    color: string;
    points: { x: number; y: number }[];
  }[]>([]);
  const [activeDrawing, setActiveDrawing] = useState<{
    id: string;
    type: 'line' | 'arrow' | 'circle' | 'freehand';
    color: string;
    points: { x: number; y: number }[];
  } | null>(null);

  const drawingsRef = useRef(drawings);
  const activeDrawingRef = useRef(activeDrawing);
  const activeDrawToolRef = useRef(activeDrawTool);
  const activeDrawColorRef = useRef(activeDrawColor);

  // Distance calibration / measurement - click-drag two points, same interaction
  // as the telestrator 'line' tool. In 'calibrate' mode the pixel distance is
  // reported up so a known real-world reference distance can convert it into a
  // pixels-per-foot scale; in 'measure' mode that scale converts the drawn
  // distance into feet directly on the canvas.
  const [measurePoints, setMeasurePoints] = useState<{ x: number; y: number }[]>([]);
  const [measureResult, setMeasureResult] = useState<{ points: { x: number; y: number }[]; pixelDistance: number } | null>(null);
  const measureModeRef = useRef(measureMode);
  const measurePointsRef = useRef(measurePoints);
  const measureResultRef = useRef(measureResult);
  const pixelsPerFootRef = useRef(pixelsPerFoot);
  const onMeasureModeChangeRef = useRef(onMeasureModeChange);
  const onCalibrationPixelDistanceRef = useRef(onCalibrationPixelDistance);
  const onMeasurementCompleteRef = useRef(onMeasurementComplete);
  const measurementUnitRef = useRef(measurementUnit);
  const onAnalysisStatusChangeRef = useRef(onAnalysisStatusChange);

  // Manual angle measurement - three clicks (ray end, vertex, ray end), unlike
  // the click-drag distance tool above since a third point can't be captured
  // in one drag gesture. Each click commits the next point; the angle is
  // reported (and the overlay finalized) as soon as the third lands.
  const [anglePoints, setAnglePoints] = useState<{ x: number; y: number }[]>([]);
  const [angleResult, setAngleResult] = useState<{ points: { x: number; y: number }[]; angleDegrees: number } | null>(null);
  const [angleHoverPoint, setAngleHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const anglePointsRef = useRef(anglePoints);
  const angleResultRef = useRef(angleResult);
  const angleHoverPointRef = useRef(angleHoverPoint);
  const onAngleMeasuredRef = useRef(onAngleMeasured);
  const onHeightCalibrationPixelsRef = useRef(onHeightCalibrationPixels);

  useEffect(() => {
    strikeZoneConfigRef.current = strikeZoneConfig;
    showStrikeZoneRef.current = showStrikeZone;
    strikeZoneLockedRef.current = strikeZoneLocked;
    showPitchSpeedsRef.current = showPitchSpeeds;
    pitchesRef.current = pitches;
    recordingsRef.current = recordings;
    selectedPitchIdRef.current = selectedPitchId;
    currentPitchTypeRef.current = currentPitchType;
    currentPitchSpeedRef.current = currentPitchSpeed;
    onAddPitchRef.current = onAddPitch;
    appModeRef.current = appMode;
    cameraViewRef.current = cameraView;
    onConfigChangeRef.current = onConfigChange;
    onKinematicsUpdateRef.current = onKinematicsUpdate;
    feedSourceRef.current = feedSource;
    showSkeletonRef.current = showSkeleton;
    showTrajectoryRef.current = showTrajectory;
    visibleMarkersRef.current = visibleMarkers || defaultVisibleMarkers;
    cameraZoomRef.current = cameraZoom;

    drawingsRef.current = drawings;
    activeDrawingRef.current = activeDrawing;
    activeDrawToolRef.current = activeDrawTool;
    activeDrawColorRef.current = activeDrawColor;

    measureModeRef.current = measureMode;
    measurePointsRef.current = measurePoints;
    measureResultRef.current = measureResult;
    pixelsPerFootRef.current = pixelsPerFoot;
    onMeasureModeChangeRef.current = onMeasureModeChange;
    onCalibrationPixelDistanceRef.current = onCalibrationPixelDistance;
    onMeasurementCompleteRef.current = onMeasurementComplete;
    measurementUnitRef.current = measurementUnit;
    onAnalysisStatusChangeRef.current = onAnalysisStatusChange;
    anglePointsRef.current = anglePoints;
    angleResultRef.current = angleResult;
    angleHoverPointRef.current = angleHoverPoint;
    onAngleMeasuredRef.current = onAngleMeasured;
    onHeightCalibrationPixelsRef.current = onHeightCalibrationPixels;
    targetModeRef.current = targetMode;
    pitcherHandednessRef.current = pitcherHandedness;

    // If we've got visual state changes while the video is paused or stopped,
    // request a single frame redraw to render the updates immediately.
    const isVideoStopped = videoRef.current && (videoRef.current.paused || videoRef.current.ended);
    if (isPausedRef.current || isVideoStopped) {
      singleFrameAnalyzeRequestedRef.current = true;
    }
  });

  // Recording object URLs (from URL.createObjectURL) keep their Blob alive
  // in memory until explicitly revoked - release whatever's still in the
  // list if this component ever unmounts with recordings outstanding.
  useEffect(() => {
    return () => {
      recordingsRef.current.forEach(rec => URL.revokeObjectURL(rec.url));
    };
  }, []);

  // Initialize TensorFlow.js and the MoveNet model
  useEffect(() => {
    async function initTF() {
      try {
        await tf.ready();
        const model = poseDetection.SupportedModels.MoveNet;
        const detectorConfig = {
          modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        };
        const newDetector = await poseDetection.createDetector(model, detectorConfig);
        setDetector(newDetector);
        setIsLoaded(true);
      } catch (err) {
        console.error("Error initializing model:", err);
        setError("Failed to load tracking model. Ensure you have a stable connection.");
      }
    }
    initTF();
  }, []);

  // Auto-play camera when loaded
  useEffect(() => {
    if (isLoaded && videoRef.current) {
      startCamera();
    }
  }, [isLoaded]);

  // Start webcam
  // Clear any marked analysis range/results from a previous clip. Live camera
  // tracking is unaffected by these - they only gate uploaded/replayed video.
  const resetAnalysisState = () => {
    setRangeStart(null);
    setRangeEnd(null);
    setIsAnalyzing(false);
    isAnalyzingRef.current = false;
    setAnalysisProgress(0);
    setHasAnalyzed(false);
    hasAnalyzedRef.current = false;
    rollingKinematicsRef.current = [];
    lastFrameRef.current = null;
    speedBufferRef.current = { hip: [], shoulder: [], elbow: [], wrist: [] };
    wristTrajectory.current = [];
    onMetricsUpdate(ZERO_METRICS);
    onKinematicsUpdateRef.current?.([]);
  };

  // Reports the stream's actual negotiated width/height/frameRate upward -
  // UVC constraints are matched best-effort by the browser, so what's
  // requested and what's actually delivered can differ.
  const reportActualCameraSettings = (stream: MediaStream) => {
    const track = stream.getVideoTracks()[0];
    if (!track || !onCameraSettingsChange) return;
    const settings = track.getSettings();
    if (settings.width && settings.height && settings.frameRate) {
      onCameraSettingsChange({ width: settings.width, height: settings.height, frameRate: Math.round(settings.frameRate) });
    }
  };

  const startCamera = async (facing: 'user' | 'environment' = cameraFacingMode) => {
    setError(null);
    setFeedSource('camera');
    resetAnalysisState();
    if (!videoRef.current) return;

    // Stop existing camera stream first if any
    if (videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }

    // Clean up src attribute
    if (videoRef.current.src) {
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    // A specific USB/UVC device (with its own resolution/frame-rate mode)
    // takes over entirely from the mobile front/rear facingMode picker.
    const useUvcDevice = !!uvcDeviceId;

    try {
      const constraints: MediaStreamConstraints = useUvcDevice
        ? {
            video: {
              deviceId: { exact: uvcDeviceId! },
              width: { ideal: uvcWidth || 1280 },
              height: { ideal: uvcHeight || 720 },
              frameRate: { ideal: uvcFrameRate || 30 }
            },
            audio: false
          }
        : {
            // Requested as "ideal" (not "exact"), so a device that can't hit
            // it still gets the closest match instead of failing outright.
            // The canvas - and so the recording - is sized to whatever the
            // camera actually delivers (canvas.width/height mirror
            // video.videoWidth/videoHeight each frame), and pose-detection
            // cost doesn't scale with it (MoveNet resizes to a fixed 192x192
            // internally), so there's no tracking-performance reason to ask
            // for less than a modern phone's camera can comfortably give.
            video: {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              facingMode: { ideal: facing }
            },
            audio: false
          };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoRef.current.srcObject = stream;
      videoRef.current.playbackRate = playbackSpeed;
      isPausedRef.current = false;
      setIsPaused(false);
      reportActualCameraSettings(stream);
      videoRef.current.play().catch(err => {
        console.warn("Play info on stream start:", err);
      });
    } catch (err) {
      console.warn("Info accessing camera with standard constraints:", err);
      // Fallback: try with minimal constraints (crucial for some mobile browsers)
      try {
        console.log("Attempting fallback camera stream...");
        const stream = await navigator.mediaDevices.getUserMedia(
          useUvcDevice
            ? { video: { deviceId: { exact: uvcDeviceId! } }, audio: false }
            : { video: true, audio: false }
        );
        videoRef.current.srcObject = stream;
        videoRef.current.playbackRate = playbackSpeed;
        isPausedRef.current = false;
        setIsPaused(false);
        reportActualCameraSettings(stream);
        videoRef.current.play().catch(e => console.warn("Play error on stream fallback:", e));
      } catch (fallbackErr) {
        console.warn("Fallback camera access failed:", fallbackErr);
        setError("Could not access camera. Please allow camera permissions and ensure no other application is using it.");
        onCameraSettingsChange?.(null);
      }
    }
  };

  // Restart the webcam stream with the new lens whenever the off-canvas
  // Settings menu changes cameraFacingMode - skip the initial mount so this
  // doesn't fight the "Auto-play camera when loaded" effect below.
  const prevCameraFacingModeRef = useRef(cameraFacingMode);
  useEffect(() => {
    if (prevCameraFacingModeRef.current !== cameraFacingMode) {
      prevCameraFacingModeRef.current = cameraFacingMode;
      if (feedSourceRef.current === 'camera') {
        startCamera(cameraFacingMode);
      }
    }
  }, [cameraFacingMode]);

  // Same restart, for USB/UVC device or mode changes from Settings > Camera.
  const prevUvcSettingsRef = useRef({ uvcDeviceId, uvcWidth, uvcHeight, uvcFrameRate });
  useEffect(() => {
    const prev = prevUvcSettingsRef.current;
    if (prev.uvcDeviceId !== uvcDeviceId || prev.uvcWidth !== uvcWidth || prev.uvcHeight !== uvcHeight || prev.uvcFrameRate !== uvcFrameRate) {
      prevUvcSettingsRef.current = { uvcDeviceId, uvcWidth, uvcHeight, uvcFrameRate };
      if (feedSourceRef.current === 'camera') {
        startCamera();
      }
    }
  }, [uvcDeviceId, uvcWidth, uvcHeight, uvcFrameRate]);

  // Start recording the video feed. Always captures the canvas (not the raw
  // camera/video stream directly) since every overlay - skeleton, strike
  // zone, pitch markers, trajectory, HUD stats - is drawn there each frame
  // (see the ctx.drawImage(video, ...) calls in the render loop below);
  // capturing the raw camera stream instead, as this used to do for a live
  // feed, produced a recording with none of that baked in - on a phone,
  // where the live camera is by far the most common source, that meant
  // every Pitch Tracker recording came out with no strike zone or pitch
  // markers at all.
  const startRecording = () => {
    if (!videoRef.current) return;
    let stream: MediaStream | null = null;

    if (canvasRef.current) {
      try {
        // The digital zoom (1x-3x) is a CSS transform on the live canvas -
        // purely a visual effect, invisible to captureStream() since that
        // only ever reads the canvas's actual pixel buffer, never how it's
        // presented on screen. While zoomed, redraw a cropped/rescaled copy
        // of that buffer into a dedicated off-DOM canvas every frame and
        // record that instead, so the recording matches what's on screen.
        if (cameraZoomRef.current !== 1) {
          const source = canvasRef.current;
          const recCanvas = document.createElement('canvas');
          recCanvas.width = source.width;
          recCanvas.height = source.height;
          const recCtx = recCanvas.getContext('2d');
          zoomRecordingCanvasRef.current = recCanvas;

          const drawZoomedFrame = () => {
            const src = canvasRef.current;
            if (!recCtx || !src) return;
            if (recCanvas.width !== src.width || recCanvas.height !== src.height) {
              recCanvas.width = src.width;
              recCanvas.height = src.height;
            }
            const zoom = cameraZoomRef.current || 1;
            const sw = src.width / zoom;
            const sh = src.height / zoom;
            const sx = (src.width - sw) / 2;
            const sy = (src.height - sh) / 2;
            recCtx.clearRect(0, 0, recCanvas.width, recCanvas.height);
            recCtx.drawImage(src, sx, sy, sw, sh, 0, 0, recCanvas.width, recCanvas.height);
            zoomRecordingRafRef.current = requestAnimationFrame(drawZoomedFrame);
          };
          drawZoomedFrame();

          stream = (recCanvas as any).captureStream(30);
        } else {
          stream = (canvasRef.current as any).captureStream(30);
        }
      } catch (e) {
        console.error("Canvas captureStream failed:", e);
      }
    }

    // Fallback only if canvas capture itself is unsupported - better to
    // record the raw feed (no overlay) than nothing at all.
    if (!stream && feedSource === 'camera' && videoRef.current.srcObject) {
      stream = videoRef.current.srcObject as MediaStream;
    }

    if (!stream) {
      setError("No active video feed stream found to record. Switch to camera first.");
      return;
    }

    recordedChunksRef.current = [];
    try {
      const options = { mimeType: 'video/webm;codecs=vp8' };
      const recorder = new MediaRecorder(stream, options);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);

        const newRecording = {
          id: crypto.randomUUID(),
          name: `Throw Rec #${recordings.length + 1} (${new Date().toLocaleTimeString()})`,
          url,
          blob,
          timestamp: Date.now()
        };
        
        setRecordings(prev => [newRecording, ...prev]);
        setShowRecordingsList(true);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error("Failed to start MediaRecorder:", err);
      setError(`Recording error: ${err.message || err}`);
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
    if (zoomRecordingRafRef.current) {
      cancelAnimationFrame(zoomRecordingRafRef.current);
      zoomRecordingRafRef.current = null;
    }
    zoomRecordingCanvasRef.current = null;
  };

  // Play a selected recording back in the pose detector
  const playRecording = (rec: { url: string }) => {
    setError(null);
    setFeedSource('upload');
    resetAnalysisState();
    if (!videoRef.current) return;

    // Stop camera stream if active
    if (videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }

    videoRef.current.src = rec.url;
    videoRef.current.load(); // Force browser to reload source
    videoRef.current.playbackRate = playbackSpeed;
    isPausedRef.current = false;
    setIsPaused(false);

    videoRef.current.play().catch(e => {
      console.log("Auto-play prevented by browser, will trigger on interaction:", e);
    });
  };

  // Synchronize video timeline stats for scrubber slider UI
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateTime = () => {
      setCurrentTime(video.currentTime);
    };

    const updateDuration = () => {
      setVideoDuration(video.duration || 0);
    };

    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('durationchange', updateDuration);
    video.addEventListener('loadedmetadata', updateDuration);

    // Seed initial metrics
    if (video.duration) {
      setVideoDuration(video.duration);
    }
    setCurrentTime(video.currentTime);

    return () => {
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('durationchange', updateDuration);
      video.removeEventListener('loadedmetadata', updateDuration);
    };
  }, [feedSource, isLoaded]);

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
      singleFrameAnalyzeRequestedRef.current = true;
    }
  };

  const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds) || !isFinite(timeInSeconds)) return '0:00';
    const mins = Math.floor(timeInSeconds / 60);
    const secs = Math.floor(timeInSeconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isValidVideoFile = (file: File): boolean => {
    if (file.type && file.type.startsWith('video/')) return true;
    const extension = file.name.split('.').pop()?.toLowerCase();
    const commonVideoExtensions = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', '3gp', 'qt', 'mpeg', 'mpg'];
    return !!(extension && commonVideoExtensions.includes(extension));
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (isValidVideoFile(file)) {
        const url = URL.createObjectURL(file);
        startVideoFromUrl(url);
      } else {
        setError("Unsupported file format. Please upload a valid video file (MP4, WebM, MOV, etc.).");
      }
      // Reset input value so same file can be re-uploaded if desired
      event.target.value = '';
    }
  };

  const startVideoFromUrl = (url: string) => {
    setError(null);
    setFeedSource('upload');
    resetAnalysisState();
    if (!videoRef.current) return;
    
    // Stop camera stream if active
    if (videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    
    isPausedRef.current = false;
    setIsPaused(false);
    videoRef.current.src = url;
    videoRef.current.load(); // Force browser to reload source
    videoRef.current.playbackRate = playbackSpeed;
    videoRef.current.play().catch(e => {
      console.warn("Auto-play prevented or failed, loaded video in paused state:", e);
      // Fallback: simply pause the video instead of throwing a blocking error
      isPausedRef.current = true;
      setIsPaused(true);
    });
  };

  // Mark the current scrub position as the start/end of the portion to analyze
  const handleMarkRangeStart = () => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    setRangeStart(t);
    if (rangeEnd !== null && rangeEnd <= t) setRangeEnd(null);
    setHasAnalyzed(false);
    hasAnalyzedRef.current = false;
    rollingKinematicsRef.current = [];
    analyzedTrajectoryRef.current = [];
    setAnalysisSummary(null);
    onMetricsUpdate(ZERO_METRICS);
    onKinematicsUpdateRef.current?.([]);
  };

  const handleMarkRangeEnd = () => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    setRangeEnd(t);
    if (rangeStart !== null && rangeStart >= t) setRangeStart(null);
    setHasAnalyzed(false);
    hasAnalyzedRef.current = false;
    rollingKinematicsRef.current = [];
    analyzedTrajectoryRef.current = [];
    setAnalysisSummary(null);
    onMetricsUpdate(ZERO_METRICS);
    onKinematicsUpdateRef.current?.([]);
  };

  const handleClearRange = () => {
    setRangeStart(null);
    setRangeEnd(null);
    setHasAnalyzed(false);
    hasAnalyzedRef.current = false;
    setAnalysisProgress(0);
    rollingKinematicsRef.current = [];
    analyzedTrajectoryRef.current = [];
    setAnalysisSummary(null);
    onMetricsUpdate(ZERO_METRICS);
    onKinematicsUpdateRef.current?.([]);
    singleFrameAnalyzeRequestedRef.current = true;
  };

  // Wait for the video to finish seeking to the time we just set, with a safety
  // timeout in case a particular browser/codec never fires 'seeked' for a given frame.
  const waitForSeek = (video: HTMLVideoElement) => new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish);
    setTimeout(finish, 300);
  });

  // Offline analysis sweep: step through the marked [rangeStart, rangeEnd] range of an
  // uploaded/replayed video, running pose detection on each sampled frame so the joint
  // metrics and Kinematic Sequence chart reflect only that portion of the video.
  const runAnalysis = async () => {
    if (isAnalyzingRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !detector) return;
    if (rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    hasAnalyzedRef.current = false;
    setHasAnalyzed(false);

    const wasPaused = video.paused;
    video.pause();

    // Reset tracking continuity so the sweep starts from a clean state
    lastFrameRef.current = null;
    speedBufferRef.current = { hip: [], shoulder: [], elbow: [], wrist: [] };
    rollingKinematicsRef.current = [];
    wristTrajectory.current = [];
    analyzedTrajectoryRef.current = [];
    sweepPeaksRef.current = { hip: 0, shoulder: 0, elbow: 0, wrist: 0, strideCorePixels: 0 };
    setAnalysisSummary(null);
    kinematicsEmitCounterRef.current = 0;

    const start = rangeStart;
    const end = rangeEnd;
    const stepSeconds = 1 / 30;
    const totalSteps = Math.max(1, Math.round((end - start) / stepSeconds));

    for (let i = 0; i <= totalSteps; i++) {
      const t = Math.min(end, start + i * stepSeconds);
      video.currentTime = t;
      await waitForSeek(video);

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const poses = await detector.estimatePoses(video);
      if (poses.length > 0) {
        processPoseFrame(poses[0], ctx, t * 1000);
      }

      setAnalysisProgress(Math.round((i / totalSteps) * 100));
    }

    // Final, complete curve for the analyzed range (the throttled emission inside
    // processPoseFrame may have skipped the last couple of sampled frames).
    const endMs = end * 1000;
    onKinematicsUpdateRef.current?.(
      rollingKinematicsRef.current.map(p => ({
        time: parseFloat(((p.timestamp - endMs) / 1000).toFixed(2)),
        hip: p.hip,
        shoulder: p.shoulder,
        wrist: p.wrist
      }))
    );

    // Clear so the next live frame starts a fresh dt baseline instead of diffing
    // against the sweep's video-time-domain timestamp.
    lastFrameRef.current = null;

    // Freeze the peak joint speeds and max stride (ankle-to-ankle) distance seen
    // during the sweep - shown in the HUD bar alongside the persisted trajectory
    // line until a new range is marked or analysis is re-run.
    setAnalysisSummary({
      peakHip: sweepPeaksRef.current.hip,
      peakShoulder: sweepPeaksRef.current.shoulder,
      peakElbowPx: sweepPeaksRef.current.elbow,
      peakWristPx: sweepPeaksRef.current.wrist,
      strideCorePixels: sweepPeaksRef.current.strideCorePixels
    });

    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
    hasAnalyzedRef.current = true;
    setHasAnalyzed(true);
    singleFrameAnalyzeRequestedRef.current = true;

    if (!wasPaused) {
      isPausedRef.current = false;
      setIsPaused(false);
      video.play().catch(() => {});
    } else {
      isPausedRef.current = true;
      setIsPaused(true);
    }
  };

  // Formats a pixel distance (or, for a speed, a pixels/sec rate) from the
  // Analyze sweep's frozen summary into the display unit (including inches)
  // when the scene is calibrated (pixelsPerFoot set) - otherwise falls back
  // to a labeled raw pixel value so the stat is still visible before
  // calibrating.
  const formatCalibratedStat = (pixels: number, isRate: boolean) => {
    if (!pixelsPerFoot) return `${pixels.toFixed(0)} px${isRate ? '/s' : ''}`;
    return formatFeetInUnit(pixels / pixelsPerFoot, measurementUnit, isRate);
  };

  const togglePlaybackSpeed = () => {
    const nextSpeed = playbackSpeed === 1 ? 0.5 : playbackSpeed === 0.5 ? 0.25 : 1;
    setPlaybackSpeed(nextSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
    }
  };

  // Downloaded recording/snapshot filenames: <player>_<date-time>.<ext> - falls
  // back to "session" when no player is selected for the current session.
  const buildDownloadFilename = (extension: string, timestamp: number) => {
    const playerSlug = (currentPlayerName || 'session')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'session';
    const d = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    return `${playerSlug}_${dateStr}.${extension}`;
  };

  const takeSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    if (isPausedRef.current) {
      // Resume
      isPausedRef.current = false;
      videoRef.current.play();
      setIsPaused(false);
    } else {
      // Pause
      isPausedRef.current = true;
      videoRef.current.pause();
      setIsPaused(true);
      
      // Generate and download high-contrast screenshot
      const originalCanvas = canvasRef.current;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = originalCanvas.width;
      tempCanvas.height = originalCanvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      
      if (tempCtx) {
        // Draw with high contrast filter
        tempCtx.filter = 'contrast(150%) saturate(120%) brightness(90%)';
        tempCtx.drawImage(originalCanvas, 0, 0);
        
        // Add watermark
        tempCtx.fillStyle = '#38bdf8';
        tempCtx.font = 'bold 24px "Inter", sans-serif';
        tempCtx.fillText('BASEMECHANICS AI', 20, 40);
        
        const link = document.createElement('a');
        link.download = buildDownloadFilename('png', Date.now());
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
      }
    }
  };

  // Helper to calculate angle between 3 points
  const calculateAngle = (
    a: poseDetection.Keypoint,
    b: poseDetection.Keypoint,
    c: poseDetection.Keypoint
  ) => {
    if (a.score && b.score && c.score && a.score > 0.3 && b.score > 0.3 && c.score > 0.3) {
      const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
      let angle = Math.abs((radians * 180.0) / Math.PI);
      if (angle > 180.0) {
        angle = 360 - angle;
      }
      return Math.round(angle);
    }
    return null;
  };

  // Detection loop
  // Compute joint angles/speeds for one estimated pose, draw the skeleton overlay,
  // and push results to parent callbacks + rolling kinematics history.
  // `now` is the frame's timestamp in ms: wall-clock time for the live loop, or the
  // sampled video time for the offline Analyze sweep, so speed math (dist/dt) reflects
  // real elapsed time regardless of how fast the calling loop actually runs.
  const processPoseFrame = (pose: poseDetection.Pose, ctx: CanvasRenderingContext2D, now: number) => {
    // Smooth each keypoint's raw (x, y) before anything downstream reads it,
    // so drawing/angles/speeds/trajectory all see stabilized positions
    // instead of MoveNet's per-frame jitter (see OneEuroFilter above).
    const keypoints = pose.keypoints.map(kp => {
      const name = kp.name || '';
      let filters = keypointFiltersRef.current.get(name);
      if (!filters) {
        filters = { x: new OneEuroFilter(), y: new OneEuroFilter() };
        keypointFiltersRef.current.set(name, filters);
      }
      return { ...kp, x: filters.x.filter(kp.x, now), y: filters.y.filter(kp.y, now) };
    });

    // Draw keypoints and skeleton
    if (showSkeletonRef.current) {
      drawSkeleton(keypoints, ctx);
      drawKeypoints(keypoints, ctx);
    }

    // Map keypoints by name for easier access
    const keypointMap = new Map<string, poseDetection.Keypoint>(
      keypoints.map(kp => [kp.name || '', kp])
    );

    // Height-based calibration: keeps trying every frame (rather than firing
    // once and giving up) until a confident full-body view shows up, since
    // the pitcher may not be framed correctly the instant this was armed.
    // Nose-to-ankle is used as a proxy for standing height and divided by
    // 0.93 (published average adult eye/nose height as a fraction of total
    // height) to estimate it - MoveNet has no head-top or sole keypoint, so
    // this is an approximation, not a precise measurement.
    if (measureModeRef.current === 'height') {
      const nose = keypointMap.get('nose');
      const ankles = [keypointMap.get('left_ankle'), keypointMap.get('right_ankle')]
        .filter((a): a is poseDetection.Keypoint => !!a && !!a.score && a.score > 0.3);
      if (nose && nose.score && nose.score > 0.3 && ankles.length > 0) {
        const ankleY = ankles.reduce((sum, a) => sum + a.y, 0) / ankles.length;
        const estimatedHeightPixels = Math.abs(ankleY - nose.y) / 0.93;
        onHeightCalibrationPixelsRef.current?.(estimatedHeightPixels);
        onMeasureModeChangeRef.current?.('none');
      }
    }

    const rightShoulder = keypointMap.get('right_shoulder');
    const rightElbow = keypointMap.get('right_elbow');
    const rightWrist = keypointMap.get('right_wrist');

    const leftShoulder = keypointMap.get('left_shoulder');
    const leftElbow = keypointMap.get('left_elbow');
    const leftWrist = keypointMap.get('left_wrist');

    let rAngle = 0;
    let lAngle = 0;
    let rLegAngle = 0;
    let lLegAngle = 0;
    let hsSeparation = 0;

    if (rightShoulder && rightElbow && rightWrist) {
      const angle = calculateAngle(rightShoulder, rightElbow, rightWrist);
      if (angle !== null) {
        rAngle = angle;
        if (showSkeletonRef.current && visibleMarkersRef.current.arms) {
          drawAngle(ctx, rightElbow, angle);
        }
      }
    }

    if (leftShoulder && leftElbow && leftWrist) {
      const angle = calculateAngle(leftShoulder, leftElbow, leftWrist);
      if (angle !== null) {
        lAngle = angle;
        if (showSkeletonRef.current && visibleMarkersRef.current.arms) {
          drawAngle(ctx, leftElbow, angle);
        }
      }
    }

    const rightHip = keypointMap.get('right_hip');
    const rightKnee = keypointMap.get('right_knee');
    const rightAnkle = keypointMap.get('right_ankle');

    const leftHip = keypointMap.get('left_hip');
    const leftKnee = keypointMap.get('left_knee');
    const leftAnkle = keypointMap.get('left_ankle');

    if (rightHip && rightKnee && rightAnkle) {
      const angle = calculateAngle(rightHip, rightKnee, rightAnkle);
      if (angle !== null) {
        rLegAngle = angle;
        if (showSkeletonRef.current && visibleMarkersRef.current.legs) {
          drawAngle(ctx, rightKnee, angle);
        }
      }
    }

    if (leftHip && leftKnee && leftAnkle) {
      const angle = calculateAngle(leftHip, leftKnee, leftAnkle);
      if (angle !== null) {
        lLegAngle = angle;
        if (showSkeletonRef.current && visibleMarkersRef.current.legs) {
          drawAngle(ctx, leftKnee, angle);
        }
      }
    }

    let pelvisAngle = 0;
    let torsoAngle = 0;

    if (rightShoulder && leftShoulder && rightHip && leftHip) {
      if (rightShoulder.score! > 0.3 && leftShoulder.score! > 0.3 && rightHip.score! > 0.3 && leftHip.score! > 0.3) {
        if (cameraViewRef.current === 'front' || cameraViewRef.current === 'back') {
          // Front/Back view: Calculate lateral tilt
          torsoAngle = Math.atan2(leftShoulder.y - rightShoulder.y, leftShoulder.x - rightShoulder.x) * 180 / Math.PI;
          pelvisAngle = Math.atan2(leftHip.y - rightHip.y, leftHip.x - rightHip.x) * 180 / Math.PI;
        } else {
          // Side view: Calculate forward/backward lean
          const midShoulder = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 };
          const midHip = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 };
          torsoAngle = Math.atan2(midHip.y - midShoulder.y, midHip.x - midShoulder.x) * 180 / Math.PI;

          const rightKnee2 = keypointMap.get('right_knee');
          const leftKnee2 = keypointMap.get('left_knee');
          if (rightKnee2 && leftKnee2 && rightKnee2.score! > 0.3 && leftKnee2.score! > 0.3) {
              const midKnee = { x: (leftKnee2.x + rightKnee2.x) / 2, y: (leftKnee2.y + rightKnee2.y) / 2 };
              pelvisAngle = Math.atan2(midKnee.y - midHip.y, midKnee.x - midHip.x) * 180 / Math.PI;
          } else {
              pelvisAngle = torsoAngle;
          }
        }

        let sep = Math.abs(torsoAngle - pelvisAngle);
        if (sep > 180) sep = 360 - sep;
        hsSeparation = Math.round(sep);
      }
    }

    const speeds = { hip: 0, shoulder: 0, elbow: 0, wrist: 0 };

    if (lastFrameRef.current) {
      const dt = (now - lastFrameRef.current.time) / 1000;
      if (dt > 0) {
        // Rotational velocity (Degrees per second)
        if (pelvisAngle !== 0 && lastFrameRef.current.pelvisAngle !== 0) {
          let dPelvis = Math.abs(pelvisAngle - lastFrameRef.current.pelvisAngle);
          if (dPelvis > 180) dPelvis = 360 - dPelvis;
          speeds.hip = Math.round(dPelvis / dt);
        }
        if (torsoAngle !== 0 && lastFrameRef.current.torsoAngle !== 0) {
          let dTorso = Math.abs(torsoAngle - lastFrameRef.current.torsoAngle);
          if (dTorso > 180) dTorso = 360 - dTorso;
          speeds.shoulder = Math.round(dTorso / dt);
        }

        // Linear speed for arm components (smoothed in the buffer next)
        const getLinearSpeed = (name: string) => {
          const current = keypointMap.get(name);
          const prev = lastFrameRef.current!.keypoints.get(name);
          if (current && prev && current.score! > 0.3 && prev.score! > 0.3) {
            const dist = Math.sqrt(Math.pow(current.x - prev.x, 2) + Math.pow(current.y - prev.y, 2));
            return Math.round(dist / dt);
          }
          return 0;
        };

        speeds.elbow = getLinearSpeed('right_elbow');
        speeds.wrist = getLinearSpeed('right_wrist');

        // Smoothing filter (Moving average)
        speedBufferRef.current.hip.push(speeds.hip);
        speedBufferRef.current.shoulder.push(speeds.shoulder);
        speedBufferRef.current.elbow.push(speeds.elbow);
        speedBufferRef.current.wrist.push(speeds.wrist);

        // Keep last 5 frames for smoothing
        if (speedBufferRef.current.hip.length > 5) {
          speedBufferRef.current.hip.shift();
          speedBufferRef.current.shoulder.shift();
          speedBufferRef.current.elbow.shift();
          speedBufferRef.current.wrist.shift();
        }

        // Apply average
        const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) || 0;
        speeds.hip = avg(speedBufferRef.current.hip);
        speeds.shoulder = avg(speedBufferRef.current.shoulder);
        speeds.elbow = avg(speedBufferRef.current.elbow);
        speeds.wrist = avg(speedBufferRef.current.wrist);

        // Track peaks (unthrottled) and the max ankle-to-ankle spread while an
        // Analyze sweep is running, so the HUD bar can show a frozen summary
        // once it finishes - see analysisSummary/sweepPeaksRef above.
        if (isAnalyzingRef.current) {
          sweepPeaksRef.current.hip = Math.max(sweepPeaksRef.current.hip, speeds.hip);
          sweepPeaksRef.current.shoulder = Math.max(sweepPeaksRef.current.shoulder, speeds.shoulder);
          sweepPeaksRef.current.elbow = Math.max(sweepPeaksRef.current.elbow, speeds.elbow);
          sweepPeaksRef.current.wrist = Math.max(sweepPeaksRef.current.wrist, speeds.wrist);
          if (rightAnkle && leftAnkle && rightAnkle.score! > 0.3 && leftAnkle.score! > 0.3) {
            const strideDist = getDistance(rightAnkle.x, rightAnkle.y, leftAnkle.x, leftAnkle.y);
            sweepPeaksRef.current.strideCorePixels = Math.max(sweepPeaksRef.current.strideCorePixels, strideDist);
          }
        }

        // Record kinematics in rolling history
        rollingKinematicsRef.current.push({
          hip: speeds.hip,
          shoulder: speeds.shoulder,
          wrist: speeds.wrist,
          timestamp: now
        });
        if (rollingKinematicsRef.current.length > 90) {
          rollingKinematicsRef.current.shift();
        }

        // Throttle live kinematics emission (~every 6 frames) so the Kinematic
        // Sequence chart reflects real joint speeds from the current video feed.
        kinematicsEmitCounterRef.current += 1;
        if (kinematicsEmitCounterRef.current >= 6 && onKinematicsUpdateRef.current) {
          kinematicsEmitCounterRef.current = 0;
          onKinematicsUpdateRef.current(
            rollingKinematicsRef.current.map(p => ({
              time: parseFloat(((p.timestamp - now) / 1000).toFixed(2)),
              hip: p.hip,
              shoulder: p.shoulder,
              wrist: p.wrist
            }))
          );
        }
      }
    }

    lastFrameRef.current = {
      time: now,
      keypoints: keypointMap,
      pelvisAngle,
      torsoAngle
    };

    // Trajectory Tracking. While an Analyze sweep is running, every sampled
    // frame's right-wrist position is also captured unbounded into
    // analyzedTrajectoryRef (below) regardless of the branch taken here, so
    // the complete path is available once analysis finishes.
    if (isAnalyzingRef.current && rightWrist && rightWrist.score && rightWrist.score > 0.4) {
      analyzedTrajectoryRef.current.push({ x: rightWrist.x, y: rightWrist.y });
    }

    if (hasAnalyzedRef.current && !isAnalyzingRef.current) {
      // Analysis just finished (or is showing its last result) - keep the
      // full swept trajectory drawn as a solid line instead of the live
      // decaying trail, so the completed pitch's path stays on screen.
      if (showTrajectoryRef.current && analyzedTrajectoryRef.current.length > 1) {
        ctx.beginPath();
        ctx.moveTo(analyzedTrajectoryRef.current[0].x, analyzedTrajectoryRef.current[0].y);
        for (let i = 1; i < analyzedTrajectoryRef.current.length; i++) {
          ctx.lineTo(analyzedTrajectoryRef.current[i].x, analyzedTrajectoryRef.current[i].y);
        }
        ctx.strokeStyle = '#fbbf24'; // amber-400
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    } else if (showTrajectoryRef.current) {
      // Default track right wrist
      if (rightWrist && rightWrist.score && rightWrist.score > 0.4) {
        wristTrajectory.current.push({ x: rightWrist.x, y: rightWrist.y });
        if (wristTrajectory.current.length > 45) { // ~0.75s of trail at 60fps
          wristTrajectory.current.shift();
        }
      }

      if (wristTrajectory.current.length > 1) {
        ctx.beginPath();
        ctx.moveTo(wristTrajectory.current[0].x, wristTrajectory.current[0].y);
        for (let i = 1; i < wristTrajectory.current.length; i++) {
          ctx.lineTo(wristTrajectory.current[i].x, wristTrajectory.current[i].y);
        }
        ctx.strokeStyle = '#fbbf24'; // amber-400
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      // Clear trajectory if disabled or in pitching mode
      wristTrajectory.current = [];
    }

    // Update metrics back to parent - throttled to ~every 6 frames (matching
    // the kinematics chart emission below) since these are human-readable
    // numeric readouts, not something that needs to update at full frame
    // rate. Without this, setMetrics forces the entire app tree (nav bar,
    // modals, charts) to re-render on every single animation frame.
    metricsEmitCounterRef.current += 1;
    if (metricsEmitCounterRef.current >= 6) {
      metricsEmitCounterRef.current = 0;
      onMetricsUpdate({
        rightArmAngle: rAngle,
        leftArmAngle: lAngle,
        rightLegAngle: rLegAngle,
        leftLegAngle: lLegAngle,
        hipShoulderSeparation: hsSeparation,
        speeds
      });
    }
  };

  const detectPose = async () => {
    if (!detector || !videoRef.current || !canvasRef.current) return;

    // The offline Analyze sweep has exclusive control of the video/canvas/detector
    // while it runs - let it finish instead of racing it with the live loop.
    if (isAnalyzingRef.current) {
      animationFrameId.current = requestAnimationFrame(detectPose);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.readyState < 2 || video.videoWidth === 0) {
      animationFrameId.current = requestAnimationFrame(detectPose);
      return;
    }

    // Set canvas dimensions to match video
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // Determine if the video is currently static/paused/stopped
    const isVideoStatic = (video.paused || video.ended || isPausedRef.current) && feedSourceRef.current !== 'camera';
    const isCameraPaused = feedSourceRef.current === 'camera' && isPausedRef.current;
    const isStatic = isVideoStatic || isCameraPaused;

    try {
      let poses: poseDetection.Pose[] = [];
      const currentTimeVal = video.currentTime;
      const currentSource = feedSourceRef.current;

      const shouldReestimate =
        !isStatic ||
        singleFrameAnalyzeRequestedRef.current ||
        !cachedPoseRef.current ||
        cachedPoseTimeRef.current !== currentTimeVal ||
        cachedPoseSourceRef.current !== currentSource;

      // For an uploaded/replayed video, nothing is tracked until the user has
      // marked a start/end range and run Analyze. Live camera feed is unaffected.
      const canLiveTrack = feedSourceRef.current === 'camera' || hasAnalyzedRef.current;

      if (canLiveTrack) {
        if (shouldReestimate) {
          poses = await detector.estimatePoses(video);
          if (poses.length > 0) {
            cachedPoseRef.current = poses[0];
            cachedPoseTimeRef.current = currentTimeVal;
            cachedPoseSourceRef.current = currentSource;
          } else {
            cachedPoseRef.current = null;
          }
        } else if (cachedPoseRef.current) {
          poses = [cachedPoseRef.current];
        }
      }

      // Clear previous drawing
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw the video frame to the canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (poses.length > 0) {
        processPoseFrame(poses[0], ctx, performance.now());
      }

      // Render custom overlay for Strike Zone and logged pitches in Pitch Tracker mode
      if (appModeRef.current === 'pitching') {
        drawStrikeZoneOverlay(ctx, canvas.width, canvas.height);
        drawPitchesOverlay(ctx, canvas.width, canvas.height);
        drawTargetOverlay(ctx, canvas.width, canvas.height);
        // Isolated in their own try/catch - detectPose's own try/catch below
        // wraps every draw call this frame, so an exception in either of
        // these (before this existed, an unsupported ctx.roundRect() did
        // exactly this) would otherwise also silently skip the strike
        // zone/annotations/measurement calls around them.
        try {
          drawPitchStatsOverlay(ctx);
        } catch (e) {
          console.error('drawPitchStatsOverlay failed:', e);
        }
        try {
          drawWalkAlertOverlay(ctx);
        } catch (e) {
          console.error('drawWalkAlertOverlay failed:', e);
        }
      }

      // Render custom annotations (telestrator drawing lines)
      drawAnnotations(ctx, canvas.width, canvas.height);

      // Render the calibration/measurement line, if any
      drawMeasurement(ctx, canvas.width, canvas.height);

      // Render the manual angle measurement, if any
      drawAngleTool(ctx, canvas.width, canvas.height);

      // Reset single frame request flag after drawing
      singleFrameAnalyzeRequestedRef.current = false;

    } catch (e) {
      console.error(e);
    }

    animationFrameId.current = requestAnimationFrame(detectPose);
  };

  useEffect(() => {
    let active = true;
    if (videoRef.current && isLoaded) {
      const handleLoadedMetadata = () => {
        if (active) detectPose();
      };

      videoRef.current.addEventListener('loadedmetadata', handleLoadedMetadata);

      // If metadata is already loaded, kick off detection loop immediately
      if (videoRef.current.readyState >= 1) {
        detectPose();
      }

      return () => {
        active = false;
        if (videoRef.current) {
          videoRef.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        }
        if (animationFrameId.current) {
          cancelAnimationFrame(animationFrameId.current);
        }
      };
    }
  }, [detector, isLoaded]);

  const togglePlayPause = () => {
    if (!videoRef.current || feedSourceRef.current === 'camera') return;
    
    if (isPausedRef.current) {
      isPausedRef.current = false;
      videoRef.current.play().catch(e => console.log("Play error:", e));
      setIsPaused(false);
    } else {
      isPausedRef.current = true;
      videoRef.current.pause();
      setIsPaused(true);
    }
  };

  const skipFrame = (direction: 'forward' | 'backward') => {
    if (!videoRef.current || feedSourceRef.current === 'camera') return;
    
    // Ensure video is paused so we can examine the specific frame
    if (!isPausedRef.current) {
      isPausedRef.current = true;
      videoRef.current.pause();
      setIsPaused(true);
    }
    
    // Standard frame duration is roughly 1/30s (~0.033s)
    const frameTime = 0.033;
    const newTime = direction === 'forward' 
      ? Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + frameTime)
      : Math.max(0, videoRef.current.currentTime - frameTime);
      
    videoRef.current.currentTime = newTime;
    
    // Request a single frame render/pose detection
    singleFrameAnalyzeRequestedRef.current = true;
  };

  // Add seeked listener so that whenever we seek (e.g. change video frame),
  // we trigger a single-frame pose detection and canvas draw.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    const handleSeeked = () => {
      if (isPausedRef.current) {
        singleFrameAnalyzeRequestedRef.current = true;
      }
    };
    
    video.addEventListener('seeked', handleSeeked);
    return () => {
      video.removeEventListener('seeked', handleSeeked);
    };
  }, []);

  // Keep isFullscreen in sync - also catches the user exiting via Escape or
  // the browser's own UI, not just our own toggle button
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => console.warn('Failed to exit fullscreen:', err));
    } else {
      containerRef.current.requestFullscreen().catch(err => console.warn('Failed to enter fullscreen:', err));
    }
  };

  // Keyboard shortcuts listener for video playback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      
      // Support Ctrl+Z/Cmd+Z to undo drawings
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undoDrawing();
        return;
      }

      // Escape cancels an in-progress calibration/measurement/angle
      if (e.key === 'Escape' && measureModeRef.current !== 'none') {
        e.preventDefault();
        setMeasurePoints([]);
        setAnglePoints([]);
        setAngleHoverPoint(null);
        onMeasureModeChangeRef.current?.('none');
        return;
      }

      if (feedSourceRef.current === 'camera') return;
      
      switch (e.key) {
        case ' ': // Spacebar
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skipFrame('backward');
          break;
        case 'ArrowRight':
          e.preventDefault();
          skipFrame('forward');
          break;
        default:
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Trigger instant redraw when mode changes so that we don't have visual lag
  useEffect(() => {
    if (isPausedRef.current) {
      singleFrameAnalyzeRequestedRef.current = true;
    }
  }, [appMode]);

  // The Telestrator drawing tool is mechanics-only (its toggle/panel are
  // hidden in pitching mode) - close it out on mode switch so a still-active
  // tool can't keep intercepting clicks meant for plotting pitches.
  useEffect(() => {
    if (appMode !== 'mechanics') {
      setShowDrawTools(false);
      setActiveDrawTool('none');
    }
  }, [appMode]);

  // The HUD bar's rightmost popover swaps between Camera Zoom (mechanics)
  // and Pitch Type (pitching) - close whichever one is open on mode switch
  // so it doesn't linger open showing the wrong control.
  useEffect(() => {
    setShowZoomMenu(false);
    setShowPitchTypeMenu(false);
  }, [appMode]);

  // Report live/paused status upward for the top bar's status badge
  useEffect(() => {
    onAnalysisStatusChangeRef.current?.(isPaused);
  }, [isPaused]);

  // Clear any pending (not-yet-thrown) target when Target Mode is turned off
  // or the app leaves pitching mode, so it doesn't linger and get attached
  // to a pitch logged after re-enabling it.
  useEffect(() => {
    if (!targetMode || appMode !== 'pitching') {
      targetPosRef.current = null;
      targetDragRef.current = false;
      if (isPausedRef.current) {
        singleFrameAnalyzeRequestedRef.current = true;
      }
    }
  }, [targetMode, appMode]);

  // Drawing Utilities
  const drawKeypoints = (keypoints: poseDetection.Keypoint[], ctx: CanvasRenderingContext2D) => {
    keypoints.forEach((keypoint, index) => {
      if (keypoint.score && keypoint.score > 0.3) {
        let isVisible = true;
        if (index >= 0 && index <= 4) {
          isVisible = visibleMarkersRef.current.head;
        } else if (index === 5 || index === 6) {
          isVisible = visibleMarkersRef.current.torso || visibleMarkersRef.current.arms;
        } else if (index === 7 || index === 8 || index === 9 || index === 10) {
          isVisible = visibleMarkersRef.current.arms;
        } else if (index === 11 || index === 12) {
          isVisible = visibleMarkersRef.current.torso || visibleMarkersRef.current.hips || visibleMarkersRef.current.legs;
        } else if (index >= 13 && index <= 16) {
          isVisible = visibleMarkersRef.current.legs;
        }

        if (!isVisible) return;

        ctx.beginPath();
        ctx.arc(keypoint.x, keypoint.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#38bdf8'; // sky-400
        ctx.fill();
        ctx.strokeStyle = '#0284c7'; // sky-600
        ctx.stroke();
      }
    });
  };

  const drawSkeleton = (keypoints: poseDetection.Keypoint[], ctx: CanvasRenderingContext2D) => {
    const adjacentKeyPoints = poseDetection.util.getAdjacentPairs(poseDetection.SupportedModels.MoveNet);
    
    adjacentKeyPoints.forEach(([i, j]) => {
      const kp1 = keypoints[i];
      const kp2 = keypoints[j];

      if (kp1.score && kp2.score && kp1.score > 0.3 && kp2.score > 0.3) {
        let isVisible = true;
        
        const isHeadPair = i <= 4 && j <= 4;
        const isArmPair = (i === 5 && j === 7) || (i === 7 && j === 9) || (i === 6 && j === 8) || (i === 8 && j === 10);
        const isTorsoPair = (i === 5 && j === 6) || (i === 5 && j === 11) || (i === 6 && j === 12);
        const isHipPair = i === 11 && j === 12;
        const isLegPair = (i === 11 && j === 13) || (i === 13 && j === 15) || (i === 12 && j === 14) || (i === 14 && j === 16);
        
        if (isHeadPair) {
          isVisible = visibleMarkersRef.current.head;
        } else if (isArmPair) {
          isVisible = visibleMarkersRef.current.arms;
        } else if (isTorsoPair) {
          isVisible = visibleMarkersRef.current.torso;
        } else if (isHipPair) {
          isVisible = visibleMarkersRef.current.hips;
        } else if (isLegPair) {
          isVisible = visibleMarkersRef.current.legs;
        }
        
        if (!isVisible) return;

        ctx.beginPath();
        ctx.moveTo(kp1.x, kp1.y);
        ctx.lineTo(kp2.x, kp2.y);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)'; // sky-400
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  };

  const drawAngle = (ctx: CanvasRenderingContext2D, joint: poseDetection.Keypoint, angle: number) => {
    ctx.fillStyle = '#38bdf8'; // sky-400
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText(`${angle}°`, joint.x + 12, joint.y - 12);
  };

  // Drawing custom annotations on screen
  const drawAnnotations = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const allDrawings = [...drawingsRef.current];
    if (activeDrawingRef.current) {
      allDrawings.push(activeDrawingRef.current);
    }

    allDrawings.forEach((drawing) => {
      if (drawing.points.length < 2) return;

      ctx.strokeStyle = drawing.color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (drawing.type === 'freehand') {
        ctx.beginPath();
        ctx.moveTo(drawing.points[0].x * width, drawing.points[0].y * height);
        for (let i = 1; i < drawing.points.length; i++) {
          ctx.lineTo(drawing.points[i].x * width, drawing.points[i].y * height);
        }
        ctx.stroke();
      } else if (drawing.type === 'line') {
        const start = drawing.points[0];
        const end = drawing.points[drawing.points.length - 1];
        ctx.beginPath();
        ctx.moveTo(start.x * width, start.y * height);
        ctx.lineTo(end.x * width, end.y * height);
        ctx.stroke();
      } else if (drawing.type === 'arrow') {
        const start = drawing.points[0];
        const end = drawing.points[drawing.points.length - 1];
        const sx = start.x * width;
        const sy = start.y * height;
        const ex = end.x * width;
        const ey = end.y * height;

        // Draw main line
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        // Draw arrowhead
        const angle = Math.atan2(ey - sy, ex - sx);
        const arrowLength = 15;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - arrowLength * Math.cos(angle - Math.PI / 6),
          ey - arrowLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          ex - arrowLength * Math.cos(angle + Math.PI / 6),
          ey - arrowLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = drawing.color;
        ctx.fill();
      } else if (drawing.type === 'circle') {
        const start = drawing.points[0];
        const end = drawing.points[drawing.points.length - 1];
        const sx = start.x * width;
        const sy = start.y * height;
        const ex = end.x * width;
        const ey = end.y * height;
        
        const r = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 2 * Math.PI);
        ctx.stroke();
      }
    });
  };

  // Draws the in-progress calibration/measurement drag, or the last completed
  // measurement result, as a dashed line with an endpoint-to-endpoint distance
  // label (in feet once calibrated, otherwise raw pixels).
  const drawMeasurement = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const pts = measurePointsRef.current.length === 2
      ? measurePointsRef.current
      : measureResultRef.current?.points ?? null;
    if (!pts || pts.length < 2) return;

    const sx = pts[0].x * width;
    const sy = pts[0].y * height;
    const ex = pts[1].x * width;
    const ey = pts[1].y * height;
    const pixelDistance = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);

    const color = measureModeRef.current === 'calibrate' ? '#f59e0b' : '#38bdf8';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    [[sx, sy], [ex, ey]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    });

    let label: string;
    if (measureModeRef.current === 'calibrate') {
      label = `${pixelDistance.toFixed(0)} px`;
    } else if (pixelsPerFootRef.current) {
      label = formatFeetInUnit(pixelDistance / pixelsPerFootRef.current, measurementUnitRef.current);
    } else {
      label = `${pixelDistance.toFixed(0)} px (not calibrated)`;
    }

    const midX = (sx + ex) / 2;
    const midY = (sy + ey) / 2;
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.fillRect(midX - textWidth / 2 - 6, midY - 12, textWidth + 12, 22);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY - 1);
    ctx.restore();
  };

  // Draws the in-progress angle measurement (0-2 committed points, plus a
  // dashed rubber-band to the current pointer position) or the last
  // completed one (3 points, solid rays + an arc/degree label at the
  // vertex) - same click-to-place interaction as drawMeasurement above, but
  // three points instead of a single drag since a vertex angle needs both
  // rays. Vertex is always the middle point, matching calculateAngle's
  // convention (a, vertex b, c) used for the automatic joint-angle overlay.
  const drawAngleTool = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const committed = anglePointsRef.current;
    const finished = angleResultRef.current?.points ?? null;
    const pts = committed.length > 0 ? committed : finished;
    if (!pts || pts.length === 0) return;

    const toPx = (p: { x: number; y: number }) => ({ x: p.x * width, y: p.y * height });
    const screenPts = pts.map(toPx);
    const color = '#a78bfa'; // violet - distinct from calibrate (amber) / distance (sky)

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;

    if (screenPts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(screenPts[0].x, screenPts[0].y);
      for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
      ctx.stroke();
    }

    // Live rubber-band from the last committed point to the pointer, while
    // still placing the 2nd or 3rd point (no rubber-band before the 1st).
    if (committed.length > 0 && committed.length < 3 && angleHoverPointRef.current) {
      const hover = toPx(angleHoverPointRef.current);
      const last = screenPts[screenPts.length - 1];
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(hover.x, hover.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 4, 0, 2 * Math.PI);
      ctx.fill();
    }

    screenPts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 1 ? 6 : 5, 0, 2 * Math.PI);
      ctx.fill();
    });

    if (screenPts.length === 3) {
      const [a, v, b] = screenPts;
      const angle1 = Math.atan2(a.y - v.y, a.x - v.x);
      const angle2 = Math.atan2(b.y - v.y, b.x - v.x);
      let diff = angle2 - angle1;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const radius = 32;
      ctx.beginPath();
      ctx.arc(v.x, v.y, radius, angle1, angle1 + diff, diff < 0);
      ctx.stroke();

      const angleDegrees = angleResultRef.current?.angleDegrees ?? Math.abs((diff * 180) / Math.PI);
      const label = `${angleDegrees.toFixed(1)}°`;
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(label).width;
      const labelX = v.x;
      const labelY = v.y - radius - 14;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.fillRect(labelX - textWidth / 2 - 6, labelY - 12, textWidth + 12, 22);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, labelX, labelY - 1);
    }
    ctx.restore();
  };

  // A completed/in-progress angle measurement isn't part of the drawings[]
  // array (it's its own overlay, kept until explicitly cleared/reused - see
  // the angle state above), so Undo/Clear need to check it separately or
  // they'd stay disabled and no-op whenever only an angle was on screen.
  const undoDrawing = () => {
    if (anglePointsRef.current.length > 0) {
      // Still placing points - undo removes just the last click.
      setAnglePoints(prev => prev.slice(0, -1));
      singleFrameAnalyzeRequestedRef.current = true;
      return;
    }
    if (angleResultRef.current) {
      // Completed measurement - undo clears it so the tool can be reused.
      setAngleResult(null);
      singleFrameAnalyzeRequestedRef.current = true;
      return;
    }
    setDrawings(prev => prev.slice(0, -1));
    singleFrameAnalyzeRequestedRef.current = true;
  };

  const clearDrawings = () => {
    setDrawings([]);
    setAnglePoints([]);
    setAngleHoverPoint(null);
    setAngleResult(null);
    singleFrameAnalyzeRequestedRef.current = true;
  };

  // Drawing Strike Zone
  const drawStrikeZoneOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (!showStrikeZoneRef.current) return;

    const s = getOverlayScale();
    const szX = strikeZoneConfigRef.current.x * width;
    const szY = strikeZoneConfigRef.current.y * height;
    const szW = strikeZoneConfigRef.current.width * width;
    const szH = strikeZoneConfigRef.current.height * height;

    // Draw solid semi-transparent background for strike zone
    ctx.fillStyle = 'rgba(239, 68, 68, 0.05)'; // red-500 very light
    ctx.fillRect(szX, szY, szW, szH);

    // Draw main border
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'; // solid red neon border
    ctx.lineWidth = 3 * s;
    ctx.strokeRect(szX, szY, szW, szH);

    // Draw 3x3 inner grid lines
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([4 * s, 4 * s]);

    // Vertical lines
    ctx.beginPath();
    ctx.moveTo(szX + szW / 3, szY);
    ctx.lineTo(szX + szW / 3, szY + szH);
    ctx.moveTo(szX + (2 * szW) / 3, szY);
    ctx.lineTo(szX + (2 * szW) / 3, szY + szH);
    // Horizontal lines
    ctx.moveTo(szX, szY + szH / 3);
    ctx.lineTo(szX + szW, szY + szH / 3);
    ctx.moveTo(szX, szY + (2 * szH) / 3);
    ctx.lineTo(szX + szW, szY + (2 * szH) / 3);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw resize handles only while the zone can actually be dragged/resized -
    // once locked, canvas clicks always plot a pitch, so the handles would be
    // misleading clutter.
    if (appModeRef.current === 'pitching' && !strikeZoneLockedRef.current) {
      const corners = [
        { cx: szX, cy: szY },
        { cx: szX + szW, cy: szY },
        { cx: szX, cy: szY + szH },
        { cx: szX + szW, cy: szY + szH }
      ];

      ctx.fillStyle = '#f43f5e'; // rose-500
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * s;

      corners.forEach(c => {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, 6 * s, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      });
    }
  };

  // Target Mode miss-grade ring colors, drawn around a pitch marker when it
  // was thrown against a target: emerald = on target, amber = close (good
  // miss), red = well off (bad miss).
  const MISS_RESULT_COLORS: Record<string, string> = {
    'on-target': '#34d399',
    'good-miss': '#fbbf24',
    'bad-miss': '#f87171',
  };

  // Drawing Plotted Pitches
  const drawPitchesOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const s = getOverlayScale();
    pitchesRef.current.forEach((pitch) => {
      const pX = pitch.x * width;
      const pY = pitch.y * height;
      const isSelected = selectedPitchIdRef.current === pitch.id;

      // Pitch Color coding
      const color = getPitchTypeColor(pitch.type);

      // Draw highlighted pulsing circle if selected or last pitch
      const isLastPitch = pitch.number === pitchesRef.current.length;
      if (isSelected || isLastPitch) {
        ctx.beginPath();
        ctx.arc(pX, pY, (isSelected ? 14 : 10) * s, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.3)';
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#38bdf8' : '#ffffff';
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
      }

      // Target Mode: ring the marker with its miss grade
      if (pitch.missResult) {
        ctx.beginPath();
        ctx.arc(pX, pY, 11 * s, 0, 2 * Math.PI);
        ctx.strokeStyle = MISS_RESULT_COLORS[pitch.missResult];
        ctx.lineWidth = 2 * s;
        ctx.stroke();
      }

      // Draw baseball inner circle
      ctx.beginPath();
      ctx.arc(pX, pY, 7 * s, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();

      // Draw text number inside ball
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${8 * s}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pitch.number.toString(), pX, pY);

      // Draw the MPH label below the ball, if enabled
      if (showPitchSpeedsRef.current) {
        const label = `${pitch.velocity}`;
        const labelY = pY + 15 * s;
        ctx.font = `bold ${9 * s}px "JetBrains Mono", monospace`;
        const labelWidth = ctx.measureText(label).width;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(pX - labelWidth / 2 - 3 * s, labelY - 7 * s, labelWidth + 6 * s, 14 * s);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, pX, labelY);
      }

      // Reset text alignment
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });
  };

  // Draws the pending Target Mode target: a dashed crosshair circle planted
  // before a pitch is thrown, cleared once that pitch is logged.
  const drawTargetOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (!targetModeRef.current) return;
    const target = targetPosRef.current;
    if (!target) return;

    const s = getOverlayScale();
    const tX = target.x * width;
    const tY = target.y * height;
    const radius = 16 * s;
    const color = '#facc15'; // amber-400

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * s;
    ctx.setLineDash([5 * s, 4 * s]);
    ctx.beginPath();
    ctx.arc(tX, tY, radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(tX - 6 * s, tY);
    ctx.lineTo(tX + 6 * s, tY);
    ctx.moveTo(tX, tY - 6 * s);
    ctx.lineTo(tX, tY + 6 * s);
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();

    ctx.font = `bold ${9 * s}px "Inter", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText('TARGET', tX, tY - radius - 6 * s);
    ctx.textAlign = 'left';
    ctx.restore();
  };

  // Draws the Pitches/Strike%/Avg/Max totals, the same breakdown per pitch
  // type, and the Target Mode accuracy tally directly onto the canvas -
  // these used to be DOM elements floated over the canvas, which looked
  // right on screen but never showed up in a recording, since recording
  // captures only what's actually drawn to the canvas (see startRecording).
  // Reads from the pitches ref rather than the pitches prop directly since
  // this runs inside the long-lived animation-frame loop.
  const drawPitchStatsOverlay = (ctx: CanvasRenderingContext2D) => {
    const pitches = pitchesRef.current;
    if (pitches.length === 0) return;

    const strikes = pitches.filter(p => p.isStrike).length;
    const strikePct = Math.round((strikes / pitches.length) * 100);
    const avgVelo = Math.round(pitches.reduce((sum, p) => sum + p.velocity, 0) / pitches.length);
    const maxVelo = Math.max(...pitches.map(p => p.velocity));

    type TypeTotals = { count: number; strikes: number; totalVelo: number; maxVelo: number };
    const grouped: Record<string, TypeTotals> = {};
    pitches.forEach((p) => {
      if (!grouped[p.type]) grouped[p.type] = { count: 0, strikes: 0, totalVelo: 0, maxVelo: 0 };
      grouped[p.type].count += 1;
      if (p.isStrike) grouped[p.type].strikes += 1;
      grouped[p.type].totalVelo += p.velocity;
      grouped[p.type].maxVelo = Math.max(grouped[p.type].maxVelo, p.velocity);
    });
    const byType = Object.entries(grouped)
      .map(([type, s]) => ({
        type: type as PitchType,
        count: s.count,
        strikePct: Math.round((s.strikes / s.count) * 100),
        avgVelo: Math.round(s.totalVelo / s.count),
        maxVelo: s.maxVelo,
      }))
      .sort((a, b) => b.count - a.count);

    const graded = pitches.filter(p => p.missResult);
    const onTarget = graded.filter(p => p.missResult === 'on-target').length;
    const goodMiss = graded.filter(p => p.missResult === 'good-miss').length;
    const badMiss = graded.filter(p => p.missResult === 'bad-miss').length;

    const strikeColor = (pct: number) => (pct >= 60 ? '#34d399' : pct >= 45 ? '#fbbf24' : '#cbd5e1');

    const visible = getVisibleCanvasRect();
    // A live camera feed's object-fit: cover can crop the canvas down to a
    // much narrower on-screen window than its full backing-store width
    // (see getVisibleCanvasRect), so scaling this panel by the full
    // capture-resolution ratio could make it wider than what's actually
    // visible. Cap the scale so the panel (plus its margins) always fits
    // within the visible window, even if that means drawing it a bit
    // smaller than its "ideal" size in an extreme crop.
    const visibleWidth = Math.max(0, visible.right - visible.left);
    const maxScaleForWidth = visibleWidth > 0 ? visibleWidth / (220 + 2 * 12) : Infinity;
    const scale = Math.min(getOverlayScale(), maxScaleForWidth);
    const panelW = 220 * scale;
    const marginX = 12 * scale;
    const marginTop = 12 * scale;
    const lineH = 15 * scale;
    const padX = 10 * scale;
    const padY = 8 * scale;
    const sectionGap = 8 * scale;

    const totalLines = 2 + byType.length + (graded.length > 0 ? 1 : 0);
    const sectionGaps = (byType.length > 0 ? 1 : 0) + (graded.length > 0 ? 1 : 0);
    const panelH = padY * 2 + totalLines * lineH + sectionGaps * sectionGap;

    const x = visible.right - marginX - panelW;
    const y = visible.top + marginTop;
    const leftX = x + padX;
    const rightX = x + panelW - padX;

    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)';
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    pathRoundedRect(ctx, x, y, panelW, panelH, 8 * scale);
    ctx.fill();
    ctx.stroke();

    let cursorY = y + padY + 10 * scale;

    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold ${11 * scale}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${pitches.length} PITCHES`, leftX, cursorY);
    ctx.textAlign = 'right';
    ctx.fillStyle = strikeColor(strikePct);
    ctx.fillText(`${strikePct}% K`, rightX, cursorY);
    cursorY += lineH;

    ctx.font = `${10 * scale}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`AVG ${avgVelo} MPH`, leftX, cursorY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`MAX ${maxVelo} MPH`, rightX, cursorY);
    cursorY += lineH;

    if (byType.length > 0) {
      cursorY += sectionGap;
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
      ctx.beginPath();
      ctx.moveTo(leftX, cursorY - lineH + 3 * scale);
      ctx.lineTo(rightX, cursorY - lineH + 3 * scale);
      ctx.stroke();

      byType.forEach((t) => {
        ctx.font = `${9 * scale}px "Inter", sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillStyle = getPitchTypeColor(t.type);
        ctx.beginPath();
        ctx.arc(leftX + 3 * scale, cursorY - 3 * scale, 3 * scale, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(t.type, leftX + 10 * scale, cursorY);

        ctx.textAlign = 'right';
        ctx.fillStyle = strikeColor(t.strikePct);
        ctx.fillText(`${t.count} · ${t.strikePct}% · ${t.avgVelo}/${t.maxVelo}`, rightX, cursorY);
        cursorY += lineH;
      });
    }

    if (graded.length > 0) {
      cursorY += sectionGap;
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
      ctx.beginPath();
      ctx.moveTo(leftX, cursorY - lineH + 3 * scale);
      ctx.lineTo(rightX, cursorY - lineH + 3 * scale);
      ctx.stroke();

      ctx.font = `bold ${10 * scale}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#34d399';
      ctx.fillText(`ON ${onTarget}`, leftX, cursorY);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`GOOD ${goodMiss}`, x + panelW / 2, cursorY);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f87171';
      ctx.fillText(`BAD ${badMiss}`, rightX, cursorY);
    }

    ctx.textAlign = 'left';
    ctx.restore();
  };

  // Draws a pulsing "N BALLS IN A ROW" alert banner once the most recent
  // pitches - walking backward from the last one thrown - are all balls
  // and that streak reaches 4 (an automatic walk). Stays up for as long as
  // the streak continues (in case the coach keeps throwing past 4 rather
  // than resetting between at-bats) and disappears the instant a strike
  // breaks it. Drawn on the canvas, not as a DOM element, so it's baked
  // into a recording the same way the other pitch stats are.
  const drawWalkAlertOverlay = (ctx: CanvasRenderingContext2D) => {
    const pitches = pitchesRef.current;
    let streak = 0;
    for (let i = pitches.length - 1; i >= 0; i--) {
      if (pitches[i].isStrike) break;
      streak++;
    }
    if (streak < 4) return;

    const label = streak === 4 ? '4 BALLS - WALK' : `${streak} STRAIGHT BALLS`;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);

    const visible = getVisibleCanvasRect();
    const centerX = (visible.left + visible.right) / 2;
    const scale = getOverlayScale();

    ctx.save();
    ctx.font = `bold ${20 * scale}px "Inter", sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const boxW = textWidth + 56 * scale;
    const boxH = 46 * scale;
    const x = centerX - boxW / 2;
    const y = visible.top + (visible.bottom - visible.top) * 0.12;

    ctx.fillStyle = `rgba(127, 29, 29, ${0.55 + 0.25 * pulse})`; // red-900, pulsing
    ctx.strokeStyle = `rgba(248, 113, 113, ${0.6 + 0.4 * pulse})`; // red-400, pulsing
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    pathRoundedRect(ctx, x, y, boxW, boxH, 10 * scale);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, centerX, y + boxH / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  };

  // Pitch Tracker's overlays (strike zone, pitch markers, target, stats
  // panel) use pixel constants tuned against the original 640px-wide
  // capture. Bumping the default camera request up to 1920x1080 made the
  // backing store much higher-resolution without changing its on-screen
  // display size, so every fixed-pixel stroke/radius/font now renders
  // visually thinner/smaller than before. Scaling those constants by the
  // canvas's actual width relative to that 640px baseline keeps their
  // on-screen size consistent regardless of capture resolution.
  const getOverlayScale = () => Math.max(1, (canvasRef.current?.width ?? 640) / 640);

  // The live camera feed is displayed with object-fit: cover (see the
  // <canvas> element below), so on a phone whose screen is much taller/
  // narrower than the camera's native aspect ratio, the browser crops the
  // canvas's own backing-store pixels to fill the screen - it doesn't scale
  // the whole image down like "contain" does. An overlay anchored to the
  // raw canvas edge (e.g. drawPitchStatsOverlay's original top-right
  // anchor) can end up entirely inside that cropped-away region and never
  // actually appear on screen, even though it drew without error. This
  // maps the canvas's on-screen visible window back into canvas pixel
  // coordinates, reusing getCanvasLayout's cover/contain math, so overlays
  // can anchor to what's actually visible instead of the full canvas.
  const getVisibleCanvasRect = () => {
    const canvas = canvasRef.current;
    const layout = getCanvasLayout();
    if (!canvas || !layout || layout.drawnWidth === 0 || layout.drawnHeight === 0) {
      return { left: 0, top: 0, right: canvas?.width ?? 0, bottom: canvas?.height ?? 0 };
    }
    const scaleX = layout.drawnWidth / canvas.width;
    const scaleY = layout.drawnHeight / canvas.height;
    return {
      left: Math.max(0, -layout.offsetX / scaleX),
      top: Math.max(0, -layout.offsetY / scaleY),
      right: Math.min(canvas.width, (layout.rect.width - layout.offsetX) / scaleX),
      bottom: Math.min(canvas.height, (layout.rect.height - layout.offsetY) / scaleY),
    };
  };

  // Helper to map screen coordinates to the actual drawn content inside the canvas,
  // taking into account its CSS object-fit layout (cover vs contain), centering, and letterboxes.
  const getCanvasLayout = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;
    const contentWidth = canvas.width;
    const contentHeight = canvas.height;

    if (containerWidth === 0 || containerHeight === 0 || contentWidth === 0 || contentHeight === 0) {
      return {
        rect,
        offsetX: 0,
        offsetY: 0,
        drawnWidth: containerWidth || 1,
        drawnHeight: containerHeight || 1
      };
    }

    const style = window.getComputedStyle(canvas);
    const objectFit = style.objectFit || 'cover';

    const s = objectFit === 'contain'
      ? Math.min(containerWidth / contentWidth, containerHeight / contentHeight)
      : Math.max(containerWidth / contentWidth, containerHeight / contentHeight);

    const drawnWidth = contentWidth * s;
    const drawnHeight = contentHeight * s;
    const offsetX = (containerWidth - drawnWidth) / 2;
    const offsetY = (containerHeight - drawnHeight) / 2;

    return {
      rect,
      offsetX,
      offsetY,
      drawnWidth,
      drawnHeight
    };
  };

  // Handle dragging and clicking on the canvas
  const handleStart = (clientX: number, clientY: number) => {
    // Height calibration doesn't need any canvas interaction - it just
    // watches the pose stream (see processPoseFrame) - so ignore clicks
    // entirely rather than letting them fall through to drawing/strike-zone/
    // target-mode handling below.
    if (measureModeRef.current === 'height') return;

    if (measureModeRef.current === 'calibrate' || measureModeRef.current === 'measure') {
      const layout = getCanvasLayout();
      if (!layout) return;
      const clickX = clientX - layout.rect.left;
      const clickY = clientY - layout.rect.top;
      const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
      const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));
      setMeasurePoints([{ x: px, y: py }]);
      singleFrameAnalyzeRequestedRef.current = true;
      return;
    }

    if (measureModeRef.current === 'angle') {
      const layout = getCanvasLayout();
      if (!layout) return;
      const clickX = clientX - layout.rect.left;
      const clickY = clientY - layout.rect.top;
      const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
      const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));

      const next = [...anglePointsRef.current, { x: px, y: py }];
      setAnglePoints(next);
      singleFrameAnalyzeRequestedRef.current = true;

      if (next.length === 3) {
        const canvas = canvasRef.current;
        const w = canvas?.width || 0;
        const h = canvas?.height || 0;
        const [a, v, b] = next.map(p => ({ x: p.x * w, y: p.y * h }));
        const radians = Math.atan2(b.y - v.y, b.x - v.x) - Math.atan2(a.y - v.y, a.x - v.x);
        let angleDegrees = Math.abs((radians * 180) / Math.PI);
        if (angleDegrees > 180) angleDegrees = 360 - angleDegrees;

        setAngleResult({ points: next, angleDegrees });
        onAngleMeasuredRef.current?.(angleDegrees);
        onMeasureModeChangeRef.current?.('none');
        setAnglePoints([]);
        setAngleHoverPoint(null);
      }
      return;
    }

    const drawTool = activeDrawToolRef.current;
    if (drawTool !== 'none') {
      const layout = getCanvasLayout();
      if (!layout) return;
      const clickX = clientX - layout.rect.left;
      const clickY = clientY - layout.rect.top;
      const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
      const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));

      const newDrawing = {
        id: crypto.randomUUID(),
        type: drawTool,
        color: activeDrawColorRef.current,
        points: [{ x: px, y: py }]
      };
      setActiveDrawing(newDrawing);
      singleFrameAnalyzeRequestedRef.current = true;
      return;
    }

    // Target Mode takes over the canvas entirely while active - the zone
    // isn't draggable/resizable during it, so every press either arms a drag
    // on the existing target (if pressed near it) or does nothing here and
    // is resolved as a plant/log tap in handleEnd.
    if (targetModeRef.current && appModeRef.current === 'pitching') {
      const target = targetPosRef.current;
      if (target) {
        const layout = getCanvasLayout();
        if (layout) {
          const clickX = clientX - layout.rect.left;
          const clickY = clientY - layout.rect.top;
          const tX = layout.offsetX + target.x * layout.drawnWidth;
          const tY = layout.offsetY + target.y * layout.drawnHeight;
          if (getDistance(clickX, clickY, tX, tY) < 24) {
            targetDragRef.current = true;
            singleFrameAnalyzeRequestedRef.current = true;
          }
        }
      }
      return;
    }

    // Locked zones can't be dragged/resized - skip hit-testing entirely so
    // every press falls through to the pitch-logging block in handleEnd,
    // exactly like a press outside the zone already does.
    if (appModeRef.current !== 'pitching' || !showStrikeZoneRef.current || strikeZoneLockedRef.current) return;
    const layout = getCanvasLayout();
    if (!layout) return;

    // Normalized coordinates for updating config (0 to 1)
    const clickX = clientX - layout.rect.left;
    const clickY = clientY - layout.rect.top;

    const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
    const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));

    // CSS pixel coordinates for precise hit-testing
    const x = layout.offsetX + strikeZoneConfigRef.current.x * layout.drawnWidth;
    const y = layout.offsetY + strikeZoneConfigRef.current.y * layout.drawnHeight;
    const w = strikeZoneConfigRef.current.width * layout.drawnWidth;
    const h = strikeZoneConfigRef.current.height * layout.drawnHeight;

    // 24px threshold in CSS pixels is perfect for mouse & touch targets
    const threshold = 24;
    let type: 'move' | 'tl' | 'tr' | 'bl' | 'br' | null = null;

    if (getDistance(clickX, clickY, x, y) < threshold) type = 'tl';
    else if (getDistance(clickX, clickY, x + w, y) < threshold) type = 'tr';
    else if (getDistance(clickX, clickY, x, y + h) < threshold) type = 'bl';
    else if (getDistance(clickX, clickY, x + w, y + h) < threshold) type = 'br';
    else if (clickX >= x && clickX <= x + w && clickY >= y && clickY <= y + h) type = 'move';

    if (type) {
      dragStateRef.current = {
        type,
        startX: px,
        startY: py,
        startConfig: { ...strikeZoneConfigRef.current }
      };
      
      // Force immediate redraw when starting a drag
      singleFrameAnalyzeRequestedRef.current = true;
    }
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (measureModeRef.current === 'calibrate' || measureModeRef.current === 'measure') {
      if (measurePointsRef.current.length === 1) {
        const layout = getCanvasLayout();
        if (!layout) return;
        const clickX = clientX - layout.rect.left;
        const clickY = clientY - layout.rect.top;
        const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
        const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));
        setMeasurePoints([measurePointsRef.current[0], { x: px, y: py }]);
        singleFrameAnalyzeRequestedRef.current = true;
      }
      return;
    }

    if (measureModeRef.current === 'angle') {
      const committed = anglePointsRef.current;
      if (committed.length > 0 && committed.length < 3) {
        const layout = getCanvasLayout();
        if (!layout) return;
        const clickX = clientX - layout.rect.left;
        const clickY = clientY - layout.rect.top;
        const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
        const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));
        setAngleHoverPoint({ x: px, y: py });
        singleFrameAnalyzeRequestedRef.current = true;
      }
      return;
    }

    const drawTool = activeDrawToolRef.current;
    if (drawTool !== 'none') {
      const layout = getCanvasLayout();
      if (!layout) return;

      const clickX = clientX - layout.rect.left;
      const clickY = clientY - layout.rect.top;
      const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
      const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));

      if (activeDrawingRef.current) {
        if (drawTool === 'freehand') {
          setActiveDrawing(prev => {
            if (!prev) return null;
            return {
              ...prev,
              points: [...prev.points, { x: px, y: py }]
            };
          });
        } else {
          setActiveDrawing(prev => {
            if (!prev) return null;
            return {
              ...prev,
              points: [prev.points[0], { x: px, y: py }]
            };
          });
        }
        singleFrameAnalyzeRequestedRef.current = true;
      }
      return;
    }

    if (targetModeRef.current && appModeRef.current === 'pitching') {
      if (targetDragRef.current) {
        const layout = getCanvasLayout();
        if (layout) {
          const clickX = clientX - layout.rect.left;
          const clickY = clientY - layout.rect.top;
          const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
          const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));
          targetPosRef.current = { x: px, y: py };
          singleFrameAnalyzeRequestedRef.current = true;
        }
      }
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = targetDragRef.current ? 'grabbing' : 'crosshair';
      return;
    }

    if (appModeRef.current !== 'pitching' || !showStrikeZoneRef.current) return;
    const layout = getCanvasLayout();
    if (!layout) return;

    const clickX = clientX - layout.rect.left;
    const clickY = clientY - layout.rect.top;

    const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
    const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));

    // Change cursor style on hover - a locked zone can't be dragged/resized,
    // so it always shows the plain crosshair used for logging a pitch
    if (!dragStateRef.current) {
      let cursor = 'crosshair';

      if (!strikeZoneLockedRef.current) {
        const x = layout.offsetX + strikeZoneConfigRef.current.x * layout.drawnWidth;
        const y = layout.offsetY + strikeZoneConfigRef.current.y * layout.drawnHeight;
        const w = strikeZoneConfigRef.current.width * layout.drawnWidth;
        const h = strikeZoneConfigRef.current.height * layout.drawnHeight;
        const threshold = 24; // CSS pixels matching handleStart

        if (getDistance(clickX, clickY, x, y) < threshold) cursor = 'nwse-resize';
        else if (getDistance(clickX, clickY, x + w, y) < threshold) cursor = 'nesw-resize';
        else if (getDistance(clickX, clickY, x, y + h) < threshold) cursor = 'nesw-resize';
        else if (getDistance(clickX, clickY, x + w, y + h) < threshold) cursor = 'nwse-resize';
        else if (clickX >= x && clickX <= x + w && clickY >= y && clickY <= y + h) cursor = 'move';
      }

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = cursor;
      }
      return;
    }

    const drag = dragStateRef.current;
    const dx = px - drag.startX;
    const dy = py - drag.startY;

    if (drag.type === 'move') {
      const newX = Math.max(0, Math.min(1 - drag.startConfig.width, drag.startConfig.x + dx));
      const newY = Math.max(0, Math.min(1 - drag.startConfig.height, drag.startConfig.y + dy));
      onConfigChangeRef.current?.({
        ...drag.startConfig,
        x: newX,
        y: newY
      });
    } else if (drag.type === 'tl') {
      const endX = drag.startConfig.x + drag.startConfig.width;
      const endY = drag.startConfig.y + drag.startConfig.height;
      const newX = Math.max(0, Math.min(endX - 0.05, drag.startConfig.x + dx));
      const newY = Math.max(0, Math.min(endY - 0.05, drag.startConfig.y + dy));
      onConfigChangeRef.current?.({
        ...drag.startConfig,
        x: newX,
        y: newY,
        width: endX - newX,
        height: endY - newY
      });
    } else if (drag.type === 'tr') {
      const startX = drag.startConfig.x;
      const endY = drag.startConfig.y + drag.startConfig.height;
      const newY = Math.max(0, Math.min(endY - 0.05, drag.startConfig.y + dy));
      const newW = Math.max(0.05, Math.min(1 - startX, drag.startConfig.width + dx));
      onConfigChangeRef.current?.({
        ...drag.startConfig,
        y: newY,
        width: newW,
        height: endY - newY
      });
    } else if (drag.type === 'bl') {
      const endX = drag.startConfig.x + drag.startConfig.width;
      const startY = drag.startConfig.y;
      const newX = Math.max(0, Math.min(endX - 0.05, drag.startConfig.x + dx));
      const newH = Math.max(0.05, Math.min(1 - startY, drag.startConfig.height + dy));
      onConfigChangeRef.current?.({
        ...drag.startConfig,
        x: newX,
        width: endX - newX,
        height: newH
      });
    } else if (drag.type === 'br') {
      const startX = drag.startConfig.x;
      const startY = drag.startConfig.y;
      const newW = Math.max(0.05, Math.min(1 - startX, drag.startConfig.width + dx));
      const newH = Math.max(0.05, Math.min(1 - startY, drag.startConfig.height + dy));
      onConfigChangeRef.current?.({
        ...drag.startConfig,
        width: newW,
        height: newH
      });
    }

    // Force immediate redraw during drag
    singleFrameAnalyzeRequestedRef.current = true;
  };

  const handleEnd = (clientX: number, clientY: number, wasClick: boolean) => {
    // See handleStart - height calibration needs no canvas interaction, so
    // a stray tap/click while it's armed shouldn't log a pitch or anything
    // else the fallthrough logic below would otherwise do.
    if (measureModeRef.current === 'height') return;

    if (measureModeRef.current === 'calibrate' || measureModeRef.current === 'measure') {
      const pts = measurePointsRef.current;
      if (pts.length === 2) {
        const canvas = canvasRef.current;
        const w = canvas?.width || 0;
        const h = canvas?.height || 0;
        const dx = (pts[1].x - pts[0].x) * w;
        const dy = (pts[1].y - pts[0].y) * h;
        const pixelDistance = Math.sqrt(dx * dx + dy * dy);

        if (measureModeRef.current === 'calibrate') {
          onCalibrationPixelDistanceRef.current?.(pixelDistance);
        } else {
          setMeasureResult({ points: pts, pixelDistance });
          if (pixelsPerFootRef.current) {
            onMeasurementCompleteRef.current?.(pixelDistance / pixelsPerFootRef.current);
          }
        }
        onMeasureModeChangeRef.current?.('none');
      }
      setMeasurePoints([]);
      singleFrameAnalyzeRequestedRef.current = true;
      return;
    }

    // Angle points are committed on press (handleStart) since a 3rd point
    // can't be captured in the same drag as the first two - nothing to do
    // on release.
    if (measureModeRef.current === 'angle') return;

    const drawTool = activeDrawToolRef.current;
    if (drawTool !== 'none') {
      if (activeDrawingRef.current && activeDrawingRef.current.points.length >= 2) {
        setDrawings(prev => [...prev, activeDrawingRef.current!]);
      }
      setActiveDrawing(null);
      // Force immediate redraw
      singleFrameAnalyzeRequestedRef.current = true;
      return;
    }

    if (targetModeRef.current && appModeRef.current === 'pitching') {
      const wasDraggingTarget = targetDragRef.current;
      targetDragRef.current = false;
      if (wasDraggingTarget) {
        singleFrameAnalyzeRequestedRef.current = true;
        // A press that started near the target but never actually moved
        // (wasClick) falls through below and logs a bullseye pitch there,
        // same as tapping the strike zone without dragging it.
        if (!wasClick) return;
      }

      if (wasClick && isLoaded) {
        const layout = getCanvasLayout();
        if (!layout) return;

        const clickX = clientX - layout.rect.left;
        const clickY = clientY - layout.rect.top;
        const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
        const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));

        const target = targetPosRef.current;
        if (!target) {
          // First tap of the pitch: plant the target, don't log a pitch yet
          targetPosRef.current = { x: px, y: py };
          singleFrameAnalyzeRequestedRef.current = true;
          return;
        }

        // Second tap: this is where the pitch actually landed
        const config = strikeZoneConfigRef.current;
        const classification = classifyPitch(px, py, config);
        const missResult = classifyMiss(target.x, target.y, px, py, config);
        const handedness = pitcherHandednessRef.current;

        const nowMs = performance.now();
        const capturedKinematics = rollingKinematicsRef.current.map(p => ({
          time: parseFloat(((p.timestamp - nowMs) / 1000).toFixed(2)),
          hip: p.hip,
          shoulder: p.shoulder,
          wrist: p.wrist
        }));

        const newPitch: Pitch = {
          id: crypto.randomUUID(),
          number: pitchesRef.current.length + 1,
          type: currentPitchTypeRef.current,
          velocity: currentPitchSpeedRef.current,
          x: px,
          y: py,
          isStrike: classification.isStrike,
          zone: classification.zone,
          timestamp: new Date(),
          kinematicsData: capturedKinematics,
          targetX: target.x,
          targetY: target.y,
          missResult,
          targetZoneLabel: getTargetZoneLabel(target.x, target.y, config, handedness),
          pitchZoneLabel: getTargetZoneLabel(px, py, config, handedness),
        };

        onAddPitchRef.current(newPitch);
        targetPosRef.current = null;
        singleFrameAnalyzeRequestedRef.current = true;
      }
      return;
    }

    if (dragStateRef.current) {
      // A press that started inside/on the strike zone (so handleStart armed a
      // drag) but never actually moved is a tap to log a pitch, not a zone
      // move/resize - clear the drag state but keep going so it falls through
      // to the pitch-logging block below instead of being swallowed here.
      dragStateRef.current = null;
      singleFrameAnalyzeRequestedRef.current = true;
      if (!wasClick) return;
    }

    if (appModeRef.current === 'pitching' && wasClick) {
      const layout = getCanvasLayout();
      if (!layout || !isLoaded) return;

      const clickX = clientX - layout.rect.left;
      const clickY = clientY - layout.rect.top;

      const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
      const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));

      const classification = classifyPitch(px, py, strikeZoneConfigRef.current);

      const nowMs = performance.now();
      const capturedKinematics = rollingKinematicsRef.current.map(p => ({
        time: parseFloat(((p.timestamp - nowMs) / 1000).toFixed(2)),
        hip: p.hip,
        shoulder: p.shoulder,
        wrist: p.wrist
      }));

      const newPitch: Pitch = {
        id: crypto.randomUUID(),
        number: pitchesRef.current.length + 1,
        type: currentPitchTypeRef.current,
        velocity: currentPitchSpeedRef.current,
        x: px,
        y: py,
        isStrike: classification.isStrike,
        zone: classification.zone,
        timestamp: new Date(),
        kinematicsData: capturedKinematics
      };

      onAddPitchRef.current(newPitch);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    pressPosRef.current = { x: e.clientX, y: e.clientY };
    handleStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handleMove(e.clientX, e.clientY);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!pressPosRef.current) return;
    const moveDist = Math.sqrt((e.clientX - pressPosRef.current.x) ** 2 + (e.clientY - pressPosRef.current.y) ** 2);
    const wasClick = moveDist < 6;
    handleEnd(e.clientX, e.clientY, wasClick);
    pressPosRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 0) return;
    // Without this, the browser follows up a tap with synthesized
    // mousedown/mouseup/click events ~300ms later, which would fire the
    // mouse handlers below too and log every tapped pitch twice.
    e.preventDefault();
    const touch = e.touches[0];
    pressPosRef.current = { x: touch.clientX, y: touch.clientY };
    handleStart(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 0) return;
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!pressPosRef.current) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    const moveDist = Math.sqrt((touch.clientX - pressPosRef.current.x) ** 2 + (touch.clientY - pressPosRef.current.y) ** 2);
    const wasClick = moveDist < 10;
    handleEnd(touch.clientX, touch.clientY, wasClick);
    pressPosRef.current = null;
  };

  // Dragging the floating camera control bar around the canvas. hudBarPosition
  // stays null (the bar's default docked position, via CSS classes) until the
  // user grabs the handle for the first time; from then on it's positioned
  // with an explicit left/top clamped to the container bounds.
  const hudBarRef = useRef<HTMLDivElement>(null);
  const hudDragStateRef = useRef<{ startClientX: number; startClientY: number; startLeft: number; startTop: number } | null>(null);
  const [hudBarPosition, setHudBarPosition] = useState<{ x: number; y: number } | null>(null);

  // Resizing the same bar via a corner handle - sets an explicit pixel width
  // (height stays auto) rather than a uniform CSS scale, so the bar's own
  // flex layout (marked @container below) genuinely reflows: sections and
  // buttons keep their natural, legible size and wrap/stack onto new rows as
  // the bar narrows instead of shrinking below a readable size.
  const HUD_WIDTH_MIN = 260;
  const HUD_WIDTH_MAX = 900;
  const hudResizeStateRef = useRef<{ startClientX: number; startWidth: number } | null>(null);
  const [hudBarWidth, setHudBarWidth] = useState<number | null>(null);

  const moveHudBar = (clientX: number, clientY: number) => {
    const drag = hudDragStateRef.current;
    const bar = hudBarRef.current;
    const container = containerRef.current;
    if (!drag || !bar || !container) return;

    const containerRect = container.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();

    const newLeft = Math.max(0, Math.min(
      drag.startLeft + (clientX - drag.startClientX),
      containerRect.width - barRect.width
    ));
    const newTop = Math.max(0, Math.min(
      drag.startTop + (clientY - drag.startClientY),
      containerRect.height - barRect.height
    ));

    setHudBarPosition({ x: newLeft, y: newTop });
  };

  const startHudBarDrag = (clientX: number, clientY: number) => {
    const bar = hudBarRef.current;
    const container = containerRef.current;
    if (!bar || !container) return;

    const barRect = bar.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    hudDragStateRef.current = {
      startClientX: clientX,
      startClientY: clientY,
      startLeft: barRect.left - containerRect.left,
      startTop: barRect.top - containerRect.top
    };
  };

  const handleHudHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startHudBarDrag(e.clientX, e.clientY);

    const onMove = (ev: MouseEvent) => moveHudBar(ev.clientX, ev.clientY);
    const onUp = () => {
      hudDragStateRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleHudHandleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 0) return;
    const touch = e.touches[0];
    startHudBarDrag(touch.clientX, touch.clientY);

    const onMove = (ev: TouchEvent) => {
      if (ev.touches.length === 0) return;
      moveHudBar(ev.touches[0].clientX, ev.touches[0].clientY);
    };
    const onEnd = () => {
      hudDragStateRef.current = null;
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
  };

  const moveHudBarResize = (clientX: number) => {
    const resize = hudResizeStateRef.current;
    const container = containerRef.current;
    if (!resize) return;

    const maxAllowed = container
      ? Math.min(HUD_WIDTH_MAX, container.getBoundingClientRect().width - 16)
      : HUD_WIDTH_MAX;
    const newWidth = Math.max(HUD_WIDTH_MIN, Math.min(maxAllowed, resize.startWidth + (clientX - resize.startClientX)));
    setHudBarWidth(newWidth);
  };

  const startHudBarResize = (clientX: number) => {
    const bar = hudBarRef.current;
    const startWidth = hudBarWidth ?? bar?.getBoundingClientRect().width ?? HUD_WIDTH_MIN;
    hudResizeStateRef.current = { startClientX: clientX, startWidth };
  };

  const handleHudResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // don't also start a position-drag via the parent handle
    startHudBarResize(e.clientX);

    const onMove = (ev: MouseEvent) => moveHudBarResize(ev.clientX);
    const onUp = () => {
      hudResizeStateRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleHudResizeTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 0) return;
    e.stopPropagation();
    const touch = e.touches[0];
    startHudBarResize(touch.clientX);

    const onMove = (ev: TouchEvent) => {
      if (ev.touches.length === 0) return;
      moveHudBarResize(ev.touches[0].clientX);
    };
    const onEnd = () => {
      hudResizeStateRef.current = null;
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
  };

  // Drag and drop video handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (isValidVideoFile(file)) {
        const url = URL.createObjectURL(file);
        startVideoFromUrl(url);
      } else {
        setError("Unsupported file format. Please upload a valid MP4, WebM, or QuickTime video file.");
      }
    }
  };

  // Camera Zoom control - a popover instead of the Settings modal so the live
  // feed stays visible while dialing it in. Shared between the two HUD slots
  // it can occupy: next to Source in mechanics mode, or in the Speed slot's
  // place in pitching mode (which has no use for slow-mo playback speed).
  const renderZoomControl = () => (
    <div className="relative">
      <button
        onClick={() => setShowZoomMenu(v => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-[11px] font-bold uppercase tracking-wider text-white shadow-lg ${
          showZoomMenu
            ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
            : 'bg-black/50 border-slate-800 hover:bg-black/75'
        }`}
        title="Camera zoom"
      >
        <ZoomIn className="w-3.5 h-3.5" />
        <span className="font-mono">{cameraZoom.toFixed(1)}x</span>
      </button>

      {showZoomMenu && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/5"
            onClick={() => setShowZoomMenu(false)}
          />
          <div className="absolute bottom-full mb-2 right-0 w-56 max-lg:fixed max-lg:left-1/2 max-lg:-translate-x-1/2 max-lg:right-auto max-lg:bottom-24 max-lg:mb-0 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl p-3.5 z-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Camera Zoom</span>
              <span className="text-xs font-mono text-sky-400 font-bold">{cameraZoom.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1"
              max="3"
              step="0.1"
              value={cameraZoom}
              onChange={(e) => onCameraZoomChange?.(parseFloat(e.target.value))}
              className="w-full accent-sky-500 cursor-pointer"
            />
            <div className="flex items-center justify-between mt-1.5 text-[9px] text-slate-500 font-mono uppercase">
              <span>1x</span>
              <span>2x</span>
              <span>3x</span>
            </div>
            {cameraZoom !== 1 && (
              <button
                onClick={() => onCameraZoomChange?.(1)}
                className="w-full mt-2.5 px-3 py-1.5 text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider transition-colors cursor-pointer"
              >
                Reset zoom
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-slate-950 select-none"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Visual overlay */}
      {isDraggingFile && (
        <div className="absolute inset-0 bg-sky-950/90 border-2 border-dashed border-sky-400 m-4 rounded-2xl flex flex-col items-center justify-center gap-4 z-40 backdrop-blur-sm pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          <Upload className="w-16 h-16 text-sky-400 animate-bounce" />
          <h3 className="text-lg font-bold text-white uppercase tracking-wider">Drop Pitching Video</h3>
          <p className="text-xs text-sky-300">Release to import and begin biomechanics analysis</p>
        </div>
      )}

      {/* Saved Recordings Drawer Overlay */}
      {showRecordingsList && (
        <div className="absolute top-16 right-3 bottom-24 w-80 bg-slate-950/95 border border-slate-800 rounded-xl z-30 flex flex-col shadow-[0_15px_40px_rgba(0,0,0,0.8)] backdrop-blur-md overflow-hidden animate-in slide-in-from-right duration-200">
          <div className="p-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-white">
              <History className="w-4 h-4 text-sky-400" />
              <span className="font-bold text-xs uppercase tracking-wider">Recorded Throws ({recordings.length})</span>
            </div>
            <button
              onClick={() => setShowRecordingsList(false)}
              className="text-slate-400 hover:text-white text-xs font-bold uppercase tracking-wider bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded"
            >
              Hide
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {recordings.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs flex flex-col items-center justify-center gap-2">
                <Video className="w-8 h-8 text-slate-700" />
                <p>No recordings captured yet.</p>
                <p className="text-[10px] text-slate-600">Click "Record" during webcam use to log throwing motions.</p>
              </div>
            ) : (
              recordings.map((rec) => (
                <div
                  key={rec.id}
                  className="bg-slate-900/40 hover:bg-slate-900 border border-slate-800/80 p-2 rounded-lg flex flex-col gap-2 transition-all group"
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div>
                      <h4 className="text-xs font-bold text-white group-hover:text-sky-400 transition-colors line-clamp-1">{rec.name}</h4>
                      <p className="text-[9px] text-slate-500 mt-0.5">{new Date(rec.timestamp).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        URL.revokeObjectURL(rec.url);
                        setRecordings(prev => prev.filter(r => r.id !== rec.id));
                      }}
                      className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-slate-800/50 transition-colors"
                      title="Delete recording"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex gap-1.5 w-full">
                    <button
                      onClick={() => playRecording(rec)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold text-[10px] uppercase tracking-wider transition-colors"
                    >
                      <Play className="w-2.5 h-2.5" />
                      <span>Replay Feed</span>
                    </button>
                    <a
                      href={rec.url}
                      download={buildDownloadFilename('webm', rec.timestamp)}
                      className="flex items-center justify-center gap-1 py-1 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded font-bold text-[10px] uppercase tracking-wider transition-colors"
                    >
                      Export
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {/* Hidden Video Element - styled offscreen to ensure browsers keep decoding frames correctly */}
      <video
        ref={videoRef}
        className="absolute pointer-events-none opacity-0 w-1 h-1 -left-[9999px]"
        playsInline
        muted
        loop
        onError={() => {
          if (feedSourceRef.current === 'upload') {
            setError("Could not load the selected video file. Please ensure it is a valid, playable video format (MP4, WebM, or MOV).");
          }
        }}
      />

      {/* Hidden File Input - kept mounted regardless of load/error state so the
          "Upload Video" fallback button works even when the camera fails to init. */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="video/*,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv,.avi,.m4v"
        className="hidden"
      />

      {/* Interactive Canvas Overlay */}
      <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-black">
        {!isLoaded ? (
          <div className="flex flex-col items-center gap-4 text-slate-400 p-8 z-20">
            <RefreshCw className="w-10 h-10 animate-spin text-sky-400" />
            <p className="font-mono text-sm tracking-widest uppercase animate-pulse">Initializing AI tracking models...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-4 text-red-400 p-6 text-center max-w-sm z-20 bg-slate-900/90 rounded-xl border border-red-500/30 backdrop-blur-md shadow-2xl">
            <AlertCircle className="w-12 h-12 text-red-500" />
            <p className="font-semibold text-sm uppercase tracking-wider">Camera/Video Error</p>
            <p className="text-xs text-slate-400">{error}</p>
            <div className="flex gap-2 w-full mt-2">
              <button 
                onClick={startCamera}
                className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded transition-colors font-semibold text-xs uppercase tracking-wider"
              >
                Use Camera
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded transition-colors font-semibold text-xs uppercase tracking-wider"
              >
                Upload Video
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 w-full h-full z-0 flex items-center justify-center p-2 lg:p-4 bg-black/40 overflow-auto">
            {/* Resizable wrapper: drag the bottom-right corner to resize the video canvas.
                A live camera track's reported dimensions don't rotate with the
                device - on mobile, rotating to landscape while the stream is
                still portrait-shaped pillarboxes hard with object-contain, so
                the live feed fills the frame with object-cover instead
                (getCanvasLayout() already supports both modes for click/drag
                hit-testing). Uploaded/replayed video keeps object-contain -
                it has no such device-rotation mismatch, and showing the full
                frame matters more there than filling the frame. */}
            <div className="relative resize overflow-hidden w-full h-full max-w-full max-h-full min-w-[240px] min-h-[135px] rounded-xl border border-slate-800/40 shadow-2xl bg-slate-950">
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className={`w-full h-full cursor-crosshair bg-slate-950 transition-transform duration-150 ${feedSource === 'camera' ? 'object-cover' : 'object-contain'}`}
                style={{ transform: `scale(${cameraZoom})` }}
                title={appMode === 'pitching' ? "Drag the strike zone or its corners to calibrate, and tap to plot pitches" : "Pitching mechanics live stream"}
              />
            </div>
          </div>
        )}
      </div>

      {/* DYNAMIC TELEMETRY / STATUS OVERLAYS */}
      {isLoaded && !error && (
        <>
          {/* Top Left Status Overlay - the ANALYSIS ACTIVE/FEED PAUSED indicator
              itself now lives in the top nav bar (see onAnalysisStatusChange) */}
          <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
            <div className="px-2.5 py-1.5 bg-black/80 backdrop-blur-md border border-slate-700/50 rounded-lg flex items-center gap-2 shadow-lg">
              <span className="text-[9px] font-mono text-slate-400 px-1.5 py-0.5 bg-slate-800/80 rounded border border-slate-700/50 uppercase">
                {feedSource === 'camera' ? 'WEBCAM' : feedSource === 'demo' ? 'DEMO FILE' : 'UPLOAD'}
              </span>
              <span className="text-[9px] font-mono text-sky-400 px-1.5 py-0.5 bg-slate-800/80 rounded border border-slate-700/50 uppercase">
                {cameraView} View
              </span>
            </div>

            {appMode === 'pitching' && showStrikeZoneRef.current && !strikeZoneLocked && (
              <div className="px-2.5 py-1 bg-rose-500/10 border border-rose-500/30 rounded text-[9px] text-rose-400 font-mono tracking-wide uppercase shadow shadow-rose-950/25">
                ✦ Drag zone / corners to calibrate; click/tap to plot pitch
              </div>
            )}
          </div>

          {/* Current player - top center, who this session is being recorded for */}
          {currentPlayerName && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-black/80 backdrop-blur-md border border-slate-700/50 rounded-lg shadow-lg pointer-events-none">
              <span className="text-[10px] font-bold font-mono text-white uppercase tracking-wider">{currentPlayerName}</span>
            </div>
          )}

          {/* Split Test Mode - which Group/Set is currently active */}
          {appMode === 'splitTest' && activeSplitTestLabel && (
            <div className={`absolute left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-violet-950/80 backdrop-blur-md border border-violet-500/40 rounded-lg shadow-lg pointer-events-none ${currentPlayerName ? 'top-12' : 'top-3'}`}>
              <span className="text-[10px] font-bold font-mono text-violet-200 uppercase tracking-wider">{activeSplitTestLabel}</span>
            </div>
          )}

          {/* Calibration / Measurement / Angle hint banner - only shown while actively picking points */}
          {measureMode !== 'none' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3.5 py-2 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-lg shadow-lg">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                measureMode === 'calibrate' ? 'text-amber-300' : measureMode === 'angle' || measureMode === 'height' ? 'text-violet-300' : 'text-sky-300'
              }`}>
                {measureMode === 'calibrate' && 'Calibrating: click and drag across a known distance'}
                {measureMode === 'measure' && 'Measuring: click and drag across a known distance'}
                {measureMode === 'angle' && `Angle: click point ${anglePoints.length + 1} of 3 (ray end, vertex, ray end)`}
                {measureMode === 'height' && 'Height Calibration: stand with your full body in frame, head to feet'}
              </span>
              <button
                onClick={() => {
                  setMeasurePoints([]);
                  setAnglePoints([]);
                  setAngleHoverPoint(null);
                  onMeasureModeChange?.('none');
                }}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Cancel (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Telestrator - mechanics mode only; in pitching mode canvas clicks
              are reserved for plotting pitches, so the drawing tool is hidden */}
          {appMode === 'mechanics' && (
          <>
          {/* Telestrator Toggle Button - the drawing tools stay off-canvas until called on demand */}
          <button
            onClick={() => {
              setShowDrawTools(prev => {
                const next = !prev;
                if (!next) {
                  // Deselect any active tool when hiding the drawer so a hidden
                  // pen/shape tool can't keep intercepting clicks on the video.
                  setActiveDrawTool('none');
                }
                return next;
              });
              singleFrameAnalyzeRequestedRef.current = true;
            }}
            className={`absolute left-3 top-20 sm:top-24 z-30 p-2.5 rounded-xl border backdrop-blur-md shadow-lg transition-colors ${
              showDrawTools
                ? 'bg-sky-600 border-sky-500 text-white'
                : 'bg-slate-950/90 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
            title={showDrawTools ? 'Hide drawing tools' : 'Show drawing tools (Telestrator)'}
          >
            <PenTool className="w-4 h-4" />
          </button>

          {/* Telestrator / Drawing Tools Panel - off-canvas by default, slides in on demand */}
          <div
            className={`absolute left-3 top-[4.75rem] sm:top-[5.75rem] z-20 flex flex-row sm:flex-col items-center gap-2 p-1.5 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-200 origin-top-left ${
              showDrawTools
                ? 'opacity-100 translate-x-0 scale-100 pointer-events-auto'
                : 'opacity-0 -translate-x-3 scale-95 pointer-events-none'
            }`}
          >
            {/* Tool Selection Group */}
            <div className="flex flex-row sm:flex-col gap-1.5">
              <button
                onClick={() => {
                  setActiveDrawTool('none');
                  // Trigger redrawing
                  singleFrameAnalyzeRequestedRef.current = true;
                }}
                className={`p-2 rounded-lg border transition-all ${
                  activeDrawTool === 'none'
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                    : 'bg-black/40 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                title="Select Mode (Calibrate Strike Zone & Plot Pitches)"
              >
                <MousePointer className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  setActiveDrawTool('freehand');
                  singleFrameAnalyzeRequestedRef.current = true;
                }}
                className={`p-2 rounded-lg border transition-all ${
                  activeDrawTool === 'freehand'
                    ? 'border-sky-500/50 text-sky-300'
                    : 'bg-black/40 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                style={activeDrawTool === 'freehand' ? { backgroundColor: `${activeDrawColor}15`, borderColor: activeDrawColor, color: activeDrawColor } : {}}
                title="Freehand Pencil tool"
              >
                <PenTool className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  setActiveDrawTool('line');
                  singleFrameAnalyzeRequestedRef.current = true;
                }}
                className={`p-2 rounded-lg border transition-all ${
                  activeDrawTool === 'line'
                    ? 'border-sky-500/50 text-sky-300'
                    : 'bg-black/40 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                style={activeDrawTool === 'line' ? { backgroundColor: `${activeDrawColor}15`, borderColor: activeDrawColor, color: activeDrawColor } : {}}
                title="Straight Line tool"
              >
                <Slash className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  setActiveDrawTool('arrow');
                  singleFrameAnalyzeRequestedRef.current = true;
                }}
                className={`p-2 rounded-lg border transition-all ${
                  activeDrawTool === 'arrow'
                    ? 'border-sky-500/50 text-sky-300'
                    : 'bg-black/40 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                style={activeDrawTool === 'arrow' ? { backgroundColor: `${activeDrawColor}15`, borderColor: activeDrawColor, color: activeDrawColor } : {}}
                title="Directional Arrow tool"
              >
                <MoveRight className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  setActiveDrawTool('circle');
                  singleFrameAnalyzeRequestedRef.current = true;
                }}
                className={`p-2 rounded-lg border transition-all ${
                  activeDrawTool === 'circle'
                    ? 'border-sky-500/50 text-sky-300'
                    : 'bg-black/40 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                style={activeDrawTool === 'circle' ? { backgroundColor: `${activeDrawColor}15`, borderColor: activeDrawColor, color: activeDrawColor } : {}}
                title="Circular Area/Joint Marker tool"
              >
                <Circle className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  setActiveDrawTool('none');
                  onMeasureModeChange?.(measureMode === 'angle' ? 'none' : 'angle');
                  singleFrameAnalyzeRequestedRef.current = true;
                }}
                className={`p-2 rounded-lg border transition-all ${
                  measureMode === 'angle'
                    ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
                    : 'bg-black/40 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                title="Angle tool - click a ray end, the vertex, then the other ray end to measure the angle between them"
              >
                <DraftingCompass className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Small divider line */}
            <div className="w-px h-5 sm:w-5 sm:h-px bg-slate-800" />

            {/* Color Palette (Row on mobile, grid/column on desktop) */}
            <div className="flex flex-row sm:flex-col gap-1.5 px-0.5">
              {[
                { hex: '#f43f5e', name: 'Rose Red' },
                { hex: '#fbbf24', name: 'Amber Yellow' },
                { hex: '#10b981', name: 'Emerald Green' },
                { hex: '#06b6d4', name: 'Cyan Blue' },
                { hex: '#8b5cf6', name: 'Purple Violet' },
                { hex: '#ffffff', name: 'Pure White' }
              ].map((color) => (
                <button
                  key={color.hex}
                  onClick={() => {
                    setActiveDrawColor(color.hex);
                    if (activeDrawTool === 'none') {
                      setActiveDrawTool('freehand');
                    }
                    singleFrameAnalyzeRequestedRef.current = true;
                  }}
                  className={`w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 focus:outline-none relative flex items-center justify-center ${
                    activeDrawColor === color.hex ? 'scale-110 ring-2 ring-white/60 ring-offset-1 ring-offset-slate-950' : ''
                  }`}
                  style={{ backgroundColor: color.hex }}
                  title={`Select ${color.name} color`}
                />
              ))}
            </div>

            {/* Small divider line */}
            <div className="w-px h-5 sm:w-5 sm:h-px bg-slate-800" />

            {/* Actions: Undo and Clear */}
            <div className="flex flex-row sm:flex-col gap-1.5">
              <button
                onClick={undoDrawing}
                disabled={drawings.length === 0 && anglePoints.length === 0 && !angleResult}
                className={`p-2 rounded-lg border border-slate-800 bg-black/40 text-slate-400 hover:text-white hover:bg-slate-900 transition-all disabled:opacity-30 disabled:pointer-events-none`}
                title="Undo last stroke/line/angle point (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={clearDrawings}
                disabled={drawings.length === 0 && anglePoints.length === 0 && !angleResult}
                className={`p-2 rounded-lg border border-slate-800 bg-black/40 text-slate-400 hover:text-red-400 hover:bg-red-950/20 hover:border-red-500/30 transition-all disabled:opacity-30 disabled:pointer-events-none`}
                title="Clear all screen drawings and any angle measurement"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          </>
          )}

          {/* Top Right Quick Settings Toggles Overlay (Compact HUD Row) */}
          <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            {setShowSkeleton && (
              <button
                onClick={() => setShowSkeleton(!showSkeleton)}
                className={`p-2 rounded-lg border backdrop-blur-md transition-all shadow-lg flex items-center justify-center ${
                  showSkeleton
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                    : 'bg-black/70 border-slate-700/50 text-slate-400 hover:text-white'
                }`}
                title="Toggle Skeleton Tracking overlay"
              >
                {showSkeleton ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                <span className="text-[9px] font-bold uppercase tracking-wider ml-1 hidden sm:inline">Skeleton</span>
              </button>
            )}

            {setShowTrajectory && (
              <button
                onClick={() => setShowTrajectory(!showTrajectory)}
                className={`p-2 rounded-lg border backdrop-blur-md transition-all shadow-lg flex items-center justify-center ${
                  showTrajectory
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-black/70 border-slate-700/50 text-slate-400 hover:text-white'
                }`}
                title="Toggle Motion Trajectory overlay"
              >
                {showTrajectory ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                <span className="text-[9px] font-bold uppercase tracking-wider ml-1 hidden sm:inline">Trajectory</span>
              </button>
            )}
          </div>

          {/* Pitches/Strike%/Avg/Max totals, the per-pitch-type breakdown, and
              the Target Mode accuracy tally are drawn directly onto the
              canvas (see drawPitchStatsOverlay) rather than as DOM elements
              here, so they show up in recordings too. */}
          </div>

          {/* Bottom Floating Heads-Up Control Bar - draggable via the grip handle */}
          <div
            ref={hudBarRef}
            style={{
              ...(hudBarPosition ? { left: hudBarPosition.x, top: hudBarPosition.y, right: 'auto', bottom: 'auto' } : {}),
              ...(hudBarWidth !== null ? { width: hudBarWidth, right: 'auto' } : {}),
            }}
            className={`absolute z-20 @container flex flex-col @2xl:flex-row items-center justify-between gap-2.5 bg-slate-950/90 backdrop-blur-md border border-slate-800 p-2.5 md:p-3 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.8)] ${
              // bottom-20 here (left from a since-removed mobile bottom tab
              // bar) reserved 80px of clearance nothing needs anymore - on a
              // short landscape phone that's enough to push this bar's own
              // top edge above the video container's top and get clipped by
              // its overflow-hidden, since containerRef is otherwise-empty
              // dead space rather than shrinking the bar. bottom-4 everywhere
              // both reclaims that space and removes the clipping risk.
              hudBarPosition ? 'max-w-[calc(100%-1rem)]' : 'bottom-4 left-2 right-2 md:left-4 md:right-4'
            }`}
          >
            {/* Grip handle - drag anywhere on the canvas to reposition, double-click/tap to reset */}
            <div
              onMouseDown={handleHudHandleMouseDown}
              onTouchStart={handleHudHandleTouchStart}
              onDoubleClick={() => setHudBarPosition(null)}
              className="absolute -top-3 left-1/2 -translate-x-1/2 w-10 h-5 flex items-center justify-center rounded-full bg-slate-800 border border-slate-700 text-slate-500 hover:text-slate-300 hover:bg-slate-750 cursor-grab active:cursor-grabbing shadow-md transition-colors"
              title="Drag to reposition (double-click to reset)"
            >
              <GripHorizontal className="w-4 h-4" />
            </div>

            {/* Resize handle - drag horizontally to set the bar's width,
                double-click/tap to reset to its default responsive width.
                Sections and buttons keep their natural, legible size and
                wrap/stack onto new rows as the bar narrows (via the
                @container query classes below) instead of shrinking. */}
            <div
              onMouseDown={handleHudResizeMouseDown}
              onTouchStart={handleHudResizeTouchStart}
              onDoubleClick={(e) => { e.stopPropagation(); setHudBarWidth(null); }}
              className="absolute -bottom-3 -right-3 w-7 h-7 flex items-center justify-center rounded-full bg-slate-800 border border-slate-700 text-slate-500 hover:text-slate-300 hover:bg-slate-750 shadow-md transition-colors touch-none"
              style={{ cursor: 'ew-resize' }}
              title="Drag to resize width (double-click to reset)"
            >
              <MoveDiagonal2 className="w-3.5 h-3.5" />
            </div>

            {/* Center: Playback controls for Video Sources - camera view alignment and
                lens switching now live in the off-canvas Settings > Camera tab */}
            {feedSource !== 'camera' && (
              <div className="flex flex-col gap-2 w-full @2xl:max-w-md @container bg-slate-900/85 px-3 py-2 sm:py-1.5 rounded-xl border border-slate-800/80">
                <div className="flex flex-col @sm:flex-row items-center gap-3 w-full">
                  {/* Playback Buttons Group */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => skipFrame('backward')}
                      className="p-3 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors touch-manipulation"
                      title="Skip 1 frame backward (Left Arrow)"
                    >
                      <SkipBack className="w-5 h-5" />
                    </button>
                    <button
                      onClick={togglePlayPause}
                      className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center gap-1.5 ${
                        isPaused 
                          ? 'bg-sky-600 text-white hover:bg-sky-500 shadow-sm' 
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                      title="Play / Pause video (Spacebar)"
                    >
                      {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      <span>{isPaused ? 'Play' : 'Pause'}</span>
                    </button>
                    <button
                      onClick={() => skipFrame('forward')}
                      className="p-3 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors touch-manipulation"
                      title="Skip 1 frame forward (Right Arrow)"
                    >
                      <SkipForward className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Scrubber Slider Group */}
                  <div className="flex items-center gap-2.5 w-full">
                    <span className="text-[10px] font-mono text-slate-400 select-none shrink-0 min-w-[28px] text-right">
                      {formatTime(currentTime)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={videoDuration || 100}
                      step={0.01}
                      value={currentTime}
                      onChange={handleSeekChange}
                      className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-sky-400 focus:outline-none transition-all hover:bg-slate-800"
                      style={{
                        background: `linear-gradient(to right, #38bdf8 0%, #38bdf8 ${
                          (currentTime / (videoDuration || 1)) * 100
                        }%, #1e293b ${(currentTime / (videoDuration || 1)) * 100}%, #1e293b 100%)`
                      }}
                    />
                    <span className="text-[10px] font-mono text-slate-400 select-none shrink-0 min-w-[28px]">
                      {formatTime(videoDuration)}
                    </span>
                  </div>
                </div>

                  {/* Analysis Range Controls - nothing is tracked/recorded for this clip
                      until a start/end range is marked and Analyze is run */}
                  <div className="flex items-center gap-1.5 w-full">
                    <button
                      onClick={handleMarkRangeStart}
                      disabled={isAnalyzing}
                      className={`flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded border transition-colors disabled:opacity-40 ${
                        rangeStart !== null
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                      title="Mark the current frame as the start of the portion to analyze"
                    >
                      <Flag className="w-3 h-3" />
                      <span>{rangeStart !== null ? formatTime(rangeStart) : 'Start'}</span>
                    </button>

                    <button
                      onClick={handleMarkRangeEnd}
                      disabled={isAnalyzing}
                      className={`flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded border transition-colors disabled:opacity-40 ${
                        rangeEnd !== null
                          ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                      title="Mark the current frame as the end of the portion to analyze"
                    >
                      <Flag className="w-3 h-3" />
                      <span>{rangeEnd !== null ? formatTime(rangeEnd) : 'End'}</span>
                    </button>

                    <button
                      onClick={runAnalysis}
                      disabled={rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart || isAnalyzing}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider rounded border transition-colors bg-sky-600 border-sky-500 text-white hover:bg-sky-500 disabled:opacity-30 disabled:pointer-events-none"
                      title="Analyze the marked portion of the video and populate the joint metrics and Kinematic Sequence chart"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>{isAnalyzing ? `Analyzing ${analysisProgress}%` : hasAnalyzed ? 'Re-analyze' : 'Analyze'}</span>
                    </button>

                    {(rangeStart !== null || rangeEnd !== null || hasAnalyzed) && (
                      <button
                        onClick={handleClearRange}
                        disabled={isAnalyzing}
                        className="p-1 rounded border border-slate-800 bg-slate-800 text-slate-400 hover:text-white transition-colors disabled:opacity-40"
                        title="Clear the marked range and analyzed results"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Frozen results from the last completed Analyze sweep - stays
                      shown (along with the persisted trajectory line on the
                      canvas) until a new range is marked or Analyze is re-run. */}
                  {analysisSummary && !isAnalyzing && (
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 w-full pt-1.5 mt-0.5 border-t border-slate-800/70">
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Peak Hip</p>
                        <p className="text-xs font-mono text-emerald-300 font-bold leading-none mt-0.5">{analysisSummary.peakHip}°/s</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Peak Shoulder</p>
                        <p className="text-xs font-mono text-sky-300 font-bold leading-none mt-0.5">{analysisSummary.peakShoulder}°/s</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Peak Elbow</p>
                        <p className="text-xs font-mono text-amber-300 font-bold leading-none mt-0.5">{formatCalibratedStat(analysisSummary.peakElbowPx, true)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Peak Wrist</p>
                        <p className="text-xs font-mono text-rose-300 font-bold leading-none mt-0.5">{formatCalibratedStat(analysisSummary.peakWristPx, true)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Stride</p>
                        <p className="text-xs font-mono text-violet-300 font-bold leading-none mt-0.5">{formatCalibratedStat(analysisSummary.strideCorePixels, false)}</p>
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* Right: Operational Actions Row */}
            <div className="flex items-center justify-center @2xl:justify-end gap-1.5 w-full @2xl:w-auto flex-wrap">
              {/* Record Pitch Button */}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-[11px] font-bold uppercase tracking-wider text-white shadow-lg ${
                  isRecording
                    ? 'bg-red-600 border-red-500 hover:bg-red-500'
                    : 'bg-black/50 border-slate-800 hover:bg-black/75'
                }`}
                title={isRecording ? `Stop recording (${recordingSeconds}s)` : 'Start recording pitching motion'}
              >
                <Disc className={`w-3.5 h-3.5 ${isRecording ? 'text-white' : 'text-red-500 animate-pulse'}`} />
                <span>{isRecording ? `Stop (${recordingSeconds}s)` : 'Record'}</span>
              </button>

              {/* Saved Recordings History Button */}
              <button
                onClick={() => setShowRecordingsList(!showRecordingsList)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-[11px] font-bold uppercase tracking-wider text-white shadow-lg ${
                  showRecordingsList
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                    : 'bg-black/50 border-slate-800 hover:bg-slate-700'
                }`}
                title="View your recorded throw replays"
              >
                <History className="w-3.5 h-3.5" />
                <span>Replays ({recordings.length})</span>
              </button>

              {/* Video Source Menu - Webcam / Upload */}
              <div className="relative">
                <button
                  onClick={() => setShowSourceMenu(v => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-[11px] font-bold uppercase tracking-wider text-white shadow-lg ${
                    showSourceMenu
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                      : 'bg-black/50 border-slate-800 hover:bg-black/75'
                  }`}
                  title="Video source"
                >
                  {feedSource === 'camera' ? <Camera className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                  <span>Source</span>
                  <MoreVertical className="w-3 h-3" />
                </button>

                {showSourceMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40 bg-black/5"
                      onClick={() => setShowSourceMenu(false)}
                    />
                    <div className="absolute bottom-full mb-2 right-0 w-48 max-lg:fixed max-lg:left-1/2 max-lg:-translate-x-1/2 max-lg:right-auto max-lg:bottom-24 max-lg:mb-0 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl py-1 z-50">
                      <button
                        onClick={() => { startCamera(); setShowSourceMenu(false); }}
                        className={`w-full text-left px-3.5 py-2.5 text-xs transition-colors flex items-center gap-2.5 ${
                          feedSource === 'camera' ? 'text-sky-300' : 'text-slate-200 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <Camera className="w-4 h-4 shrink-0" />
                        <span className="font-semibold">Webcam</span>
                      </button>
                      <button
                        onClick={() => { fileInputRef.current?.click(); setShowSourceMenu(false); }}
                        className="w-full text-left px-3.5 py-2.5 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-2.5"
                      >
                        <Upload className="w-4 h-4 shrink-0" />
                        <span className="font-semibold">Upload Video</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {appMode === 'pitching' ? (
                /* Pitching mode has no use for a canvas-side camera zoom
                   control - this slot becomes a quick pitch type picker so
                   the type can be changed without leaving the live feed. */
                <div className="relative">
                  <button
                    onClick={() => setShowPitchTypeMenu(v => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-[11px] font-bold uppercase tracking-wider text-white shadow-lg ${
                      showPitchTypeMenu
                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                        : 'bg-black/50 border-slate-800 hover:bg-black/75'
                    }`}
                    title="Pitch type"
                  >
                    <Target className="w-3.5 h-3.5" />
                    <span className="font-mono">{PITCH_TYPE_INFO[currentPitchType].abbreviation}</span>
                  </button>

                  {showPitchTypeMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40 bg-black/5"
                        onClick={() => setShowPitchTypeMenu(false)}
                      />
                      <div className="absolute bottom-full mb-2 right-0 w-64 max-lg:fixed max-lg:left-1/2 max-lg:-translate-x-1/2 max-lg:right-auto max-lg:bottom-24 max-lg:mb-0 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl p-3.5 z-50">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-2">Pitch Type</span>
                        <div className="grid grid-cols-3 gap-1.5">
                          {PITCH_TYPES.map((type) => (
                            <button
                              key={type}
                              onClick={() => { setCurrentPitchType?.(type); setShowPitchTypeMenu(false); }}
                              title={type}
                              className={`py-1.5 px-1 rounded text-center border transition-all ${
                                currentPitchType === type
                                  ? 'bg-sky-600 border-sky-400 text-white shadow-md shadow-sky-600/20'
                                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                              }`}
                            >
                              <span className="block text-[10px] font-bold leading-tight">{PITCH_TYPE_INFO[type].abbreviation}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                renderZoomControl()
              )}

              {/* Snapshot image */}
              <button
                onClick={takeSnapshot}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg transition-all text-[11px] font-bold uppercase tracking-wider text-white shadow-md ${
                  isPaused 
                    ? 'bg-amber-500/30 hover:bg-amber-500/40 border-amber-500/50 text-amber-400' 
                    : 'bg-black/50 hover:bg-black/75 border-slate-800'
                }`}
                title={isPaused ? 'Resume live feed playback' : 'Capture instant pose snapshot'}
              >
                <Aperture className="w-3.5 h-3.5" />
                <span>{isPaused ? 'Resume' : 'Snapshot'}</span>
              </button>

              {/* Slow Motion speed slider - not useful in Pitch Tracker mode
                  (no slow-mo playback review happening there), so that slot
                  becomes a second camera zoom control instead */}
              {appMode === 'pitching' ? (
                renderZoomControl()
              ) : (
                <button
                  onClick={togglePlaybackSpeed}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/50 hover:bg-black/75 border border-slate-800 text-white rounded-lg transition-all text-[11px] font-bold uppercase tracking-wider font-mono"
                  title="Adjust slow-motion speed multiplier"
                >
                  <span className="text-[9px] text-slate-500 uppercase tracking-widest font-sans font-bold">Speed:</span>
                  <span className="text-sky-400 font-bold">{playbackSpeed}x</span>
                </button>
              )}

              {/* Fullscreen - most useful on a phone in landscape, where it
                  also hides the browser's own address bar/toolbar */}
              <button
                onClick={toggleFullscreen}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-[11px] font-bold uppercase tracking-wider text-white shadow-lg ${
                  isFullscreen
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                    : 'bg-black/50 border-slate-800 hover:bg-black/75'
                }`}
                title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
