## 1.1.2

* Further mobile/top-bar decluttering: the session menu now sits far right
  of the top bar on every screen size, the Skeleton/Trajectory/Strike Zone
  toggles moved back to their canvas overlay, and the Mechanics/Pitch
  Tracker toggle now lives inline in the top bar on mobile too (compact
  labels below the `sm` breakpoint).
* Add a real distance calibration and measurement tool under Settings:
  draw over a known real-world distance to establish a pixel scale, then
  measure any other on-screen distance, in either US (feet) or metric
  (meters) units.

## 1.1.1

* UI decluttering: dropped the header title text, moved Session Setup /
  Export / Sign out into a canvas overlay menu, moved the Mechanics/Pitch
  Tracker toggle into the top bar, and made the Live Metrics & Kinematic
  Sequence panel collapse behind a thin bar by default - all to give the
  video canvas more visible space.

## 1.1.0

* Add required Keycloak sign-in. Configure via `/app/data/config.env`
  (KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID) and restart the app;
  the app shows a "not configured" message until that's set up.

## 1.0.0

* Initial Cloudron packaging of the Baseball Pitching Analyzer.
