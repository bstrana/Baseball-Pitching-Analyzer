import React, { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { Camera, RefreshCw, Upload, Video, AlertCircle, Play, Pause, Aperture, Eye, EyeOff, Target, Sparkles, RefreshCcw, SkipForward, SkipBack, MousePointer, Slash, MoveRight, Circle, PenTool, Undo2, Trash2, Disc, History } from 'lucide-react';
import { Pitch, PitchType, StrikeZoneConfig, classifyPitch } from '../types';

// Required to initialize the WebGL backend
import '@tensorflow/tfjs-backend-webgl';

const getDistance = (x1: number, y1: number, x2: number, y2: number) => {
  return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
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

interface PoseDetectorProps {
  onMetricsUpdate: (metrics: PoseMetrics) => void;
  showSkeleton: boolean;
  showTrajectory: boolean;
  cameraView: 'side' | 'front' | 'back';
  strikeZoneConfig: StrikeZoneConfig;
  showStrikeZone: boolean;
  pitches: Pitch[];
  onAddPitch: (pitch: Pitch) => void;
  selectedPitchId: string | null;
  setSelectedPitchId: (id: string | null) => void;
  currentPitchType: PitchType;
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
  setShowStrikeZone?: (show: boolean) => void;
  setCameraView?: (view: 'side' | 'front' | 'back') => void;
  
  // App Mode and Config Changes
  appMode?: 'mechanics' | 'pitching';
  onConfigChange?: (config: StrikeZoneConfig) => void;
}

export function PoseDetector({ 
  onMetricsUpdate, 
  showSkeleton, 
  showTrajectory, 
  cameraView,
  strikeZoneConfig,
  showStrikeZone,
  pitches,
  onAddPitch,
  selectedPitchId,
  setSelectedPitchId,
  currentPitchType,
  currentPitchSpeed,
  visibleMarkers,
  setShowSkeleton,
  setShowTrajectory,
  setShowStrikeZone,
  setCameraView,
  appMode = 'mechanics',
  onConfigChange
}: PoseDetectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
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

  // Dynamic references to avoid stale closures in the high-frequency animation loop
  const strikeZoneConfigRef = useRef(strikeZoneConfig);
  const showStrikeZoneRef = useRef(showStrikeZone);
  const pitchesRef = useRef(pitches);
  const selectedPitchIdRef = useRef(selectedPitchId);
  const currentPitchTypeRef = useRef(currentPitchType);
  const currentPitchSpeedRef = useRef(currentPitchSpeed);
  const onAddPitchRef = useRef(onAddPitch);
  const appModeRef = useRef(appMode);
  const onConfigChangeRef = useRef(onConfigChange);
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

  // Video scrubber and camera direction states
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('environment');
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordings, setRecordings] = useState<{ id: string; name: string; url: string; blob: Blob; timestamp: number; kinematicsData?: any[] }[]>([]);
  const [showRecordingsList, setShowRecordingsList] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Rolling kinematics data for pitch-release kinematics capturing
  const rollingKinematicsRef = useRef<{ hip: number; shoulder: number; wrist: number; timestamp: number }[]>([]);

  // Telestrator drawing states
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

  useEffect(() => {
    strikeZoneConfigRef.current = strikeZoneConfig;
    showStrikeZoneRef.current = showStrikeZone;
    pitchesRef.current = pitches;
    selectedPitchIdRef.current = selectedPitchId;
    currentPitchTypeRef.current = currentPitchType;
    currentPitchSpeedRef.current = currentPitchSpeed;
    onAddPitchRef.current = onAddPitch;
    appModeRef.current = appMode;
    onConfigChangeRef.current = onConfigChange;
    feedSourceRef.current = feedSource;
    showSkeletonRef.current = showSkeleton;
    showTrajectoryRef.current = showTrajectory;
    visibleMarkersRef.current = visibleMarkers || defaultVisibleMarkers;

    drawingsRef.current = drawings;
    activeDrawingRef.current = activeDrawing;
    activeDrawToolRef.current = activeDrawTool;
    activeDrawColorRef.current = activeDrawColor;
    
    // If we've got visual state changes while the video is paused or stopped,
    // request a single frame redraw to render the updates immediately.
    const isVideoStopped = videoRef.current && (videoRef.current.paused || videoRef.current.ended);
    if (isPausedRef.current || isVideoStopped) {
      singleFrameAnalyzeRequestedRef.current = true;
    }
  });


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
  const startCamera = async (facing: 'user' | 'environment' = cameraFacingMode) => {
    setError(null);
    setFeedSource('camera');
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

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: { ideal: facing }
        },
        audio: false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoRef.current.srcObject = stream;
      videoRef.current.playbackRate = playbackSpeed;
      isPausedRef.current = false;
      setIsPaused(false);
      videoRef.current.play().catch(err => {
        console.warn("Play info on stream start:", err);
      });
    } catch (err) {
      console.warn("Info accessing camera with standard constraints:", err);
      // Fallback: try with minimal constraints (crucial for some mobile browsers)
      try {
        console.log("Attempting fallback camera stream...");
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: false 
        });
        videoRef.current.srcObject = stream;
        videoRef.current.playbackRate = playbackSpeed;
        isPausedRef.current = false;
        setIsPaused(false);
        videoRef.current.play().catch(e => console.warn("Play error on stream fallback:", e));
      } catch (fallbackErr) {
        console.warn("Fallback camera access failed:", fallbackErr);
        setError("Could not access camera. Please allow camera permissions and ensure no other application is using it.");
      }
    }
  };

  const toggleCameraFacingMode = () => {
    const nextFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
    setCameraFacingMode(nextFacingMode);
    startCamera(nextFacingMode);
  };

  // Start recording the video feed
  const startRecording = () => {
    if (!videoRef.current) return;
    let stream: MediaStream | null = null;

    if (feedSource === 'camera' && videoRef.current.srcObject) {
      stream = videoRef.current.srcObject as MediaStream;
    } else {
      // Fallback: capture from the canvas element so they can record skeleton overlay
      if (canvasRef.current) {
        try {
          stream = (canvasRef.current as any).captureStream(30);
        } catch (e) {
          console.error("Canvas captureStream failed:", e);
        }
      }
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
        
        // Let's capture the current rolling kinematics of the recording
        const nowMs = performance.now();
        const recordedKinematics = rollingKinematicsRef.current.map(p => ({
          time: parseFloat(((p.timestamp - nowMs) / 1000).toFixed(2)),
          hip: p.hip,
          shoulder: p.shoulder,
          wrist: p.wrist
        }));

        const newRecording = {
          id: crypto.randomUUID(),
          name: `Throw Rec #${recordings.length + 1} (${new Date().toLocaleTimeString()})`,
          url,
          blob,
          timestamp: Date.now(),
          kinematicsData: recordedKinematics
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
  };

  // Play a selected recording back in the pose detector
  const playRecording = (rec: { url: string; kinematicsData?: any[] }) => {
    setError(null);
    setFeedSource('upload');
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

    // If there is recorded kinematics for this throw, populate our rolling buffer with it!
    if (rec.kinematicsData && rec.kinematicsData.length > 0) {
      const nowMs = performance.now();
      rollingKinematicsRef.current = rec.kinematicsData.map((k, i) => ({
        hip: k.hip,
        shoulder: k.shoulder,
        wrist: k.wrist,
        timestamp: nowMs - (rec.kinematicsData!.length - i) * 33 // mock original spacing
      }));
    }

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

  const togglePlaybackSpeed = () => {
    const nextSpeed = playbackSpeed === 1 ? 0.5 : playbackSpeed === 0.5 ? 0.25 : 1;
    setPlaybackSpeed(nextSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
    }
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
        link.download = `mechanics-snapshot-${Date.now()}.png`;
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
  const detectPose = async () => {
    if (!detector || !videoRef.current || !canvasRef.current) return;

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

      // Clear previous drawing
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw the video frame to the canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (poses.length > 0) {
        const pose = poses[0];
        const keypoints = pose.keypoints;

        // Draw keypoints and skeleton
        if (showSkeletonRef.current && appModeRef.current !== 'pitching') {
          drawSkeleton(keypoints, ctx);
          drawKeypoints(keypoints, ctx);
        }

        // Map keypoints by name for easier access
        const keypointMap = new Map<string, poseDetection.Keypoint>(
          keypoints.map(kp => [kp.name || '', kp])
        );

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
            if (showSkeletonRef.current && appModeRef.current !== 'pitching' && visibleMarkersRef.current.arms) {
              drawAngle(ctx, rightElbow, angle);
            }
          }
        }

        if (leftShoulder && leftElbow && leftWrist) {
          const angle = calculateAngle(leftShoulder, leftElbow, leftWrist);
          if (angle !== null) {
            lAngle = angle;
            if (showSkeletonRef.current && appModeRef.current !== 'pitching' && visibleMarkersRef.current.arms) {
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
            if (showSkeletonRef.current && appModeRef.current !== 'pitching' && visibleMarkersRef.current.legs) {
              drawAngle(ctx, rightKnee, angle);
            }
          }
        }

        if (leftHip && leftKnee && leftAnkle) {
          const angle = calculateAngle(leftHip, leftKnee, leftAnkle);
          if (angle !== null) {
            lLegAngle = angle;
            if (showSkeletonRef.current && appModeRef.current !== 'pitching' && visibleMarkersRef.current.legs) {
              drawAngle(ctx, leftKnee, angle);
            }
          }
        }

        let pelvisAngle = 0;
        let torsoAngle = 0;

        if (rightShoulder && leftShoulder && rightHip && leftHip) {
          if (rightShoulder.score! > 0.3 && leftShoulder.score! > 0.3 && rightHip.score! > 0.3 && leftHip.score! > 0.3) {
            if (cameraView === 'front' || cameraView === 'back') {
              // Front/Back view: Calculate lateral tilt
              torsoAngle = Math.atan2(leftShoulder.y - rightShoulder.y, leftShoulder.x - rightShoulder.x) * 180 / Math.PI;
              pelvisAngle = Math.atan2(leftHip.y - rightHip.y, leftHip.x - rightHip.x) * 180 / Math.PI;
            } else {
              // Side view: Calculate forward/backward lean
              const midShoulder = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 };
              const midHip = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 };
              torsoAngle = Math.atan2(midHip.y - midShoulder.y, midHip.x - midShoulder.x) * 180 / Math.PI;
              
              const rightKnee = keypointMap.get('right_knee');
              const leftKnee = keypointMap.get('left_knee');
              if (rightKnee && leftKnee && rightKnee.score! > 0.3 && leftKnee.score! > 0.3) {
                  const midKnee = { x: (leftKnee.x + rightKnee.x) / 2, y: (leftKnee.y + rightKnee.y) / 2 };
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

        const now = performance.now();
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
          }
        }

        lastFrameRef.current = {
          time: now,
          keypoints: keypointMap,
          pelvisAngle,
          torsoAngle
        };

        // Trajectory Tracking
        if (showTrajectoryRef.current && appModeRef.current !== 'pitching') {
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

        // Update metrics back to parent
        onMetricsUpdate({
          rightArmAngle: rAngle,
          leftArmAngle: lAngle,
          rightLegAngle: rLegAngle,
          leftLegAngle: lLegAngle,
          hipShoulderSeparation: hsSeparation,
          speeds
        });
      }

      // Render custom overlay for Strike Zone and logged pitches in Pitch Tracker mode
      if (appModeRef.current === 'pitching') {
        drawStrikeZoneOverlay(ctx, canvas.width, canvas.height);
        drawPitchesOverlay(ctx, canvas.width, canvas.height);
      }

      // Render custom annotations (telestrator drawing lines)
      drawAnnotations(ctx, canvas.width, canvas.height);

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

  const undoDrawing = () => {
    setDrawings(prev => prev.slice(0, -1));
    singleFrameAnalyzeRequestedRef.current = true;
  };

  const clearDrawings = () => {
    setDrawings([]);
    singleFrameAnalyzeRequestedRef.current = true;
  };

  // Drawing Strike Zone
  const drawStrikeZoneOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (!showStrikeZoneRef.current) return;
    
    const szX = strikeZoneConfigRef.current.x * width;
    const szY = strikeZoneConfigRef.current.y * height;
    const szW = strikeZoneConfigRef.current.width * width;
    const szH = strikeZoneConfigRef.current.height * height;

    // Draw solid semi-transparent background for strike zone
    ctx.fillStyle = 'rgba(239, 68, 68, 0.05)'; // red-500 very light
    ctx.fillRect(szX, szY, szW, szH);

    // Draw main border
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'; // solid red neon border
    ctx.lineWidth = 3;
    ctx.strokeRect(szX, szY, szW, szH);

    // Draw 3x3 inner grid lines
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

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

    // Add label
    ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
    ctx.font = 'bold 10px "Inter", sans-serif';
    ctx.fillText('STRIKE ZONE', szX + 6, szY - 6);

    // Draw handles if in pitching mode
    if (appModeRef.current === 'pitching') {
      const corners = [
        { cx: szX, cy: szY },
        { cx: szX + szW, cy: szY },
        { cx: szX, cy: szY + szH },
        { cx: szX + szW, cy: szY + szH }
      ];

      ctx.fillStyle = '#f43f5e'; // rose-500
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;

      corners.forEach(c => {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      });
    }
  };

  // Drawing Plotted Pitches
  const drawPitchesOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    pitchesRef.current.forEach((pitch) => {
      const pX = pitch.x * width;
      const pY = pitch.y * height;
      const isSelected = selectedPitchIdRef.current === pitch.id;

      // Pitch Color coding
      let color = '#ef4444'; // Fastball red
      if (pitch.type === 'Curveball') color = '#3b82f6';
      else if (pitch.type === 'Slider') color = '#f59e0b';
      else if (pitch.type === 'Changeup') color = '#10b981';
      else if (pitch.type === 'Cutter') color = '#a855f7';
      else if (pitch.type === 'Sinker') color = '#ec4899';

      // Draw highlighted pulsing circle if selected or last pitch
      const isLastPitch = pitch.number === pitchesRef.current.length;
      if (isSelected || isLastPitch) {
        ctx.beginPath();
        ctx.arc(pX, pY, isSelected ? 14 : 10, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.3)';
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#38bdf8' : '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw baseball inner circle
      ctx.beginPath();
      ctx.arc(pX, pY, 7, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw text number inside ball
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pitch.number.toString(), pX, pY);
      
      // Reset text alignment
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });
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

    if (appModeRef.current !== 'pitching' || !showStrikeZoneRef.current) return;
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

    if (appModeRef.current !== 'pitching' || !showStrikeZoneRef.current) return;
    const layout = getCanvasLayout();
    if (!layout) return;

    const clickX = clientX - layout.rect.left;
    const clickY = clientY - layout.rect.top;

    const px = Math.max(0, Math.min(1, (clickX - layout.offsetX) / layout.drawnWidth));
    const py = Math.max(0, Math.min(1, (clickY - layout.offsetY) / layout.drawnHeight));

    // Change cursor style on hover
    if (!dragStateRef.current) {
      const x = layout.offsetX + strikeZoneConfigRef.current.x * layout.drawnWidth;
      const y = layout.offsetY + strikeZoneConfigRef.current.y * layout.drawnHeight;
      const w = strikeZoneConfigRef.current.width * layout.drawnWidth;
      const h = strikeZoneConfigRef.current.height * layout.drawnHeight;

      let cursor = 'crosshair';
      const threshold = 24; // CSS pixels matching handleStart

      if (getDistance(clickX, clickY, x, y) < threshold) cursor = 'nwse-resize';
      else if (getDistance(clickX, clickY, x + w, y) < threshold) cursor = 'nesw-resize';
      else if (getDistance(clickX, clickY, x, y + h) < threshold) cursor = 'nesw-resize';
      else if (getDistance(clickX, clickY, x + w, y + h) < threshold) cursor = 'nwse-resize';
      else if (clickX >= x && clickX <= x + w && clickY >= y && clickY <= y + h) cursor = 'move';

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

    if (dragStateRef.current) {
      dragStateRef.current = null;
      // Force immediate redraw when drag ends
      singleFrameAnalyzeRequestedRef.current = true;
      return;
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
    const wasClick = moveDist < 6 && !dragStateRef.current;
    handleEnd(e.clientX, e.clientY, wasClick);
    pressPosRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 0) return;
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
    const touch = e.changedTouches[0];
    const moveDist = Math.sqrt((touch.clientX - pressPosRef.current.x) ** 2 + (touch.clientY - pressPosRef.current.y) ** 2);
    const wasClick = moveDist < 10 && !dragStateRef.current;
    handleEnd(touch.clientX, touch.clientY, wasClick);
    pressPosRef.current = null;
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

  return (
    <div 
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
                      download={`basemechanics-pitch-${rec.id}.webm`}
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
                object-contain on the canvas keeps the video's own aspect ratio inside it. */}
            <div className="relative resize overflow-hidden w-full h-full max-w-full max-h-full min-w-[240px] min-h-[135px] rounded-xl border border-slate-800/40 shadow-2xl bg-slate-950">
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="w-full h-full object-contain cursor-crosshair bg-slate-950"
                title={appMode === 'pitching' ? "Drag the strike zone or its corners to calibrate, and tap to plot pitches" : "Pitching mechanics live stream"}
              />
            </div>
          </div>
        )}
      </div>

      {/* DYNAMIC TELEMETRY / STATUS OVERLAYS */}
      {isLoaded && !error && (
        <>
          {/* Top Left Status Overlay */}
          <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
            <div className="px-2.5 py-1.5 bg-black/80 backdrop-blur-md border border-slate-700/50 rounded-lg flex items-center gap-2 shadow-lg">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isPaused ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
              </span>
              <span className="text-[10px] font-bold font-mono text-white uppercase tracking-wider">
                {isPaused ? 'FEED PAUSED' : 'ANALYSIS ACTIVE'}
              </span>
              <span className="text-[9px] font-mono text-slate-400 px-1.5 py-0.5 bg-slate-800/80 rounded border border-slate-700/50 uppercase">
                {feedSource === 'camera' ? 'WEBCAM' : feedSource === 'demo' ? 'DEMO FILE' : 'UPLOAD'}
              </span>
              <span className="text-[9px] font-mono text-sky-400 px-1.5 py-0.5 bg-slate-800/80 rounded border border-slate-700/50 uppercase">
                {cameraView} View
              </span>
            </div>

            {appMode === 'pitching' && showStrikeZoneRef.current && (
              <div className="px-2.5 py-1 bg-rose-500/10 border border-rose-500/30 rounded text-[9px] text-rose-400 font-mono tracking-wide uppercase shadow shadow-rose-950/25">
                ✦ Drag zone / corners to calibrate; Click/Tap to plot pitch
              </div>
            )}
          </div>

          {/* Telestrator / Drawing Tools Floating Panel */}
          <div className="absolute left-3 top-20 sm:top-24 z-20 flex flex-row sm:flex-col items-center gap-2 p-1.5 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            {/* Header Icon (Visible on desktop) */}
            <div className="hidden sm:flex items-center justify-center p-1 text-slate-500 border-b border-slate-800/80 pb-2 mb-0.5" title="Telestrator Tools">
              <PenTool className="w-4 h-4 text-sky-400" />
            </div>

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
                disabled={drawings.length === 0}
                className={`p-2 rounded-lg border border-slate-800 bg-black/40 text-slate-400 hover:text-white hover:bg-slate-900 transition-all disabled:opacity-30 disabled:pointer-events-none`}
                title="Undo last stroke/line (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={clearDrawings}
                disabled={drawings.length === 0}
                className={`p-2 rounded-lg border border-slate-800 bg-black/40 text-slate-400 hover:text-red-400 hover:bg-red-950/20 hover:border-red-500/30 transition-all disabled:opacity-30 disabled:pointer-events-none`}
                title="Clear all screen drawings"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Top Right Quick Settings Toggles Overlay (Compact HUD Row) */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
            {appMode === 'mechanics' && setShowSkeleton && (
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

            {appMode === 'mechanics' && setShowTrajectory && (
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

            {appMode === 'pitching' && setShowStrikeZone && (
              <button
                onClick={() => setShowStrikeZone(!showStrikeZone)}
                className={`p-2 rounded-lg border backdrop-blur-md transition-all shadow-lg flex items-center justify-center ${
                  showStrikeZone 
                    ? 'bg-rose-500/20 border-rose-500/50 text-rose-300' 
                    : 'bg-black/70 border-slate-700/50 text-slate-400 hover:text-white'
                }`}
                title="Toggle Strike Zone overlay"
              >
                <Target className="w-4 h-4" />
                <span className="text-[9px] font-bold uppercase tracking-wider ml-1 hidden sm:inline">Strike Zone</span>
              </button>
            )}
          </div>

          {/* Bottom Floating Heads-Up Control Bar */}
          <div className="absolute bottom-20 md:bottom-4 left-2 right-2 md:left-4 md:right-4 z-20 flex flex-col lg:flex-row items-center justify-between gap-2.5 bg-slate-950/90 backdrop-blur-md border border-slate-800 p-2.5 md:p-3 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
            {/* Left: Input view alignment selector */}
            {setCameraView ? (
              <div className="flex items-center gap-1.5 w-full lg:w-auto bg-slate-900/80 p-1 rounded-lg border border-slate-800 shrink-0">
                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider px-2 hidden sm:inline">View:</span>
                {(['side', 'back', 'front'] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => setCameraView(view)}
                    className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded transition-colors flex-1 lg:flex-none ${
                      cameraView === view 
                        ? 'bg-sky-500 text-white shadow-md' 
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {view}
                  </button>
                ))}
              </div>
            ) : (
              <div className="hidden lg:block lg:w-1" />
            )}

            {/* Center: Playback controls for Video Sources */}
            {feedSource !== 'camera' ? (
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:max-w-md bg-slate-900/85 px-3 py-2 sm:py-1.5 rounded-xl border border-slate-800/80">
                {/* Playback Buttons Group */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => skipFrame('backward')}
                    className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                    title="Skip 1 frame backward (Left Arrow)"
                  >
                    <SkipBack className="w-3.5 h-3.5" />
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
                    className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                    title="Skip 1 frame forward (Right Arrow)"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
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
            ) : (
              <div className="flex items-center justify-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800 shrink-0">
                <button
                  onClick={toggleCameraFacingMode}
                  className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-colors bg-sky-600/20 border border-sky-500/30 text-sky-300 hover:bg-sky-500/20"
                  title="Switch between front and back camera lenses"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Camera: {cameraFacingMode === 'user' ? 'Front (Selfie)' : 'Back (Rear)'}</span>
                </button>
              </div>
            )}

            {/* Right: Operational Actions Row */}
            <div className="flex items-center justify-center lg:justify-end gap-1.5 w-full lg:w-auto flex-wrap lg:flex-nowrap">
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

              {/* Start Webcam Button */}
              <button
                onClick={startCamera}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-[11px] font-bold uppercase tracking-wider text-white shadow-lg ${
                  feedSource === 'camera'
                    ? 'bg-sky-600 border-sky-500 shadow-[0_0_15px_rgba(2,132,199,0.4)]'
                    : 'bg-black/50 border-slate-800 hover:bg-black/75'
                }`}
                title="Start live webcam streaming"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Webcam</span>
              </button>

              {/* Upload video file */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/50 hover:bg-black/75 backdrop-blur-md border border-slate-800 text-white rounded-lg transition-all text-[11px] font-bold uppercase tracking-wider"
                title="Upload custom pitching video file"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload</span>
              </button>

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

              {/* Slow Motion speed slider */}
              <button
                onClick={togglePlaybackSpeed}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/50 hover:bg-black/75 border border-slate-800 text-white rounded-lg transition-all text-[11px] font-bold uppercase tracking-wider font-mono"
                title="Adjust slow-motion speed multiplier"
              >
                <span className="text-[9px] text-slate-500 uppercase tracking-widest font-sans font-bold">Speed:</span>
                <span className="text-sky-400 font-bold">{playbackSpeed}x</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
