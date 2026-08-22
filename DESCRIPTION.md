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
* Player roster with per-player biometrics, and a "Save Session" action that
  records mechanics/pitch tracker sessions against the selected player

### Notes

* All video processing happens client-side in the visitor's browser — video
  itself is never uploaded anywhere. Explicitly saving a session (via the
  session menu) stores the resulting metrics, kinematic data, or pitch log —
  not the video — in the app's bundled PocketBase database.
* The app requires camera access; grant the browser permission when prompted.
* Sign-in is required via Keycloak. Configure the connection in
  `/app/data/config.env` after install (see the post-install message) - the
  app won't load until that's set up.
