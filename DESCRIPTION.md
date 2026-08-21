## Baseball Pitching Analyzer

Real-time baseball pitching and swing mechanics analysis, powered by TensorFlow.js
pose detection running entirely in the browser.

### Features

* Live webcam pose tracking of pitching/hitting mechanics
* Upload and replay video, mark a range, and analyze just that portion
* Joint speed metrics (hip, shoulder, elbow, wrist) and a kinematic sequence chart
* Strike zone / pitch tracker overlay mode
* Telestrator-style drawing annotations on the video canvas
* Record and review webcam clips in-browser

### Notes

* All video processing happens client-side in the visitor's browser — no video
  or pose data is uploaded to or stored on the server.
* The app requires camera access; grant the browser permission when prompted.
* This app does not have its own login system. Anyone who can reach the app's
  URL can use it — use Cloudron's access control settings if you need to
  restrict access to specific users or groups.
