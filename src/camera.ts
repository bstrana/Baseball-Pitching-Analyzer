// Helpers for picking a specific USB/UVC camera (as opposed to the mobile
// front/rear lens, which stays on the simpler facingMode constraint) and
// discovering the high-fps slow-mo modes it supports.

export interface CameraCapabilities {
  maxWidth: number;
  maxHeight: number;
  maxFrameRate: number;
}

// Common discrete resolution/frame-rate presets to offer once a device's
// capabilities are known - browsers report a capability *range*, not the
// hardware's exact list of discrete modes, so these are best-effort ideal
// constraints rather than guaranteed exact modes.
export const RESOLUTION_PRESETS = [
  { width: 1920, height: 1080, label: '1080p' },
  { width: 1280, height: 720, label: '720p' },
  { width: 640, height: 480, label: '480p' },
  { width: 320, height: 240, label: '240p' },
] as const;

export const FRAME_RATE_PRESETS = [30, 60, 90, 120, 160, 200, 240] as const;

// Requires an existing camera permission grant - device labels are blank
// until then, which is fine here since this is only ever called from the
// Settings menu after the live feed is already running.
export async function listVideoInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === 'videoinput');
}

// Briefly opens the device to read its reported capability range, then
// closes it immediately - this does not keep the camera open.
export async function probeCameraCapabilities(deviceId: string): Promise<CameraCapabilities | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return null;

    const caps = track.getCapabilities();
    if (!caps.width?.max || !caps.height?.max || !caps.frameRate?.max) return null;

    return {
      maxWidth: caps.width.max,
      maxHeight: caps.height.max,
      maxFrameRate: Math.round(caps.frameRate.max),
    };
  } catch (err) {
    console.warn('Could not probe camera capabilities:', err);
    return null;
  } finally {
    stream?.getTracks().forEach(track => track.stop());
  }
}
