## 1.2.2

* Add Target Mode to the Pitch Tracker: tap the video canvas to plant a
  draggable target before a pitch, then tap again where it actually
  landed. The pitch is graded against the target (on target / good miss /
  bad miss) using the strike zone's existing grid, with colored rings on
  the canvas marker and an accuracy tally alongside the other pitch
  stats. A "Pitcher Throws" toggle relabels the target's location as
  glove side / arm side for the selected handedness.
* A pitch can also be flagged as a "bad shape" (flat curve, hanging
  slider, high changeup, etc.) directly in the Session Pitch Log,
  independent of where it was located.
* Replaced the pitch type list with the standard grip taxonomy (four-seam
  and two-seam fastball, cutter, changeup, curveball, slider, slurve,
  sweeper, splitter, forkball, knuckleball), grouped by category
  (Fastball / Breaking Ball / Off-Speed) with scouting abbreviations (FF,
  FT, FC, CH, CB, SL, SV, SW, SF, FO, KN) throughout the pitch type
  selector, legend, and session log.

## 1.2.1

* Pitch Tracker polish: the Telestrator drawing tool is now mechanics-mode
  only, the Session Pitch Log lists newest pitch first with abbreviated
  pitch types (FB, CH, ...), a Speed on/off toggle and per-pitch-type
  count/strike%/max-velo breakdown join the existing totals, 4 more pitch
  types (Splitter, Knuckleball, Forkball, Screwball), the strike zone's
  corner handles hide once it's locked, and the left/right sidebars are
  now manually resizable.
* Player Roster entries show a combined mechanics + pitch session count,
  and the video canvas gets a top-center overlay naming the selected
  player.
* Removed the redundant on-canvas "Strike Zone" toggle (duplicated the
  sidebar's "Zone Visible" toggle), and moved the "ANALYSIS ACTIVE"/"FEED
  PAUSED" indicator from an on-canvas overlay into the top nav bar,
  replacing the static "TENSORFLOW READY" badge.

## 1.2.0

* Add a PocketBase data backend, bundled as a sidecar process (single
  static binary alongside nginx, proxied same-origin at /pb/) - no
  separate service to install.
* Settings > Profile is now a player roster: add, select, and delete
  players, with biometrics (height/weight/wingspan) recorded per player
  instead of one shared, throwaway profile.
* The session menu gets a "Save Mechanics/Pitch Session" action that
  records the current session's metrics, kinematic data, or pitch log
  against the selected player. Nothing is saved automatically - only on
  this explicit action.
* A session history viewer (browsing past saved sessions per player) is
  planned as a follow-up, not included in this release.

## 1.1.5

* Fix a bug where tapping the strike zone on a touchscreen logged two
  pitches instead of one - the browser's synthesized mouse click
  following a touch tap was firing the pitch-logging logic a second
  time.
* Hide the red "drag zone / corners to calibrate" hint banner once the
  strike zone is locked, since there's nothing left to calibrate.
* Move Camera Zoom from the Settings modal onto the on-canvas camera
  control bar as a popover, so the live feed stays visible while
  adjusting it instead of zooming blind.

## 1.1.4

* The on-canvas camera control bar (Record/Replays/Source/Snapshot/Speed)
  is now draggable via a grip handle - reposition it anywhere on the
  video canvas; double-click/tap the handle to reset it.
* Fix a bug where tapping inside the strike zone on the video canvas
  never logged a pitch - only clicks outside the zone (balls) did.
* Add a lock toggle for the strike zone: unlocked (default) drags/resizes
  it as before; locked disables dragging entirely so every canvas click
  reliably plots a pitch instead of risking an accidental recalibration.
* Move the Pitches / Strike % / Max Velo stats from the Pitch Tracker
  sidebar onto the video canvas as an on-screen overlay.
* Rework the Pitch Tracker panel: Interactive PitchCast now sits directly
  under Select Pitch Type, and the Session Pitch Log moves to its own
  left-side column on larger screens.

## 1.1.3

* Drop the fixed mobile bottom tab bar - Settings already lives in the top
  bar's session menu, and the Pitch Accuracy Tracker panel now collapses
  behind a thin toggle bar on mobile instead (same pattern as Live
  Metrics).
* Raise the top bar's stacking order so its session menu always renders
  above the video canvas's overlays instead of risking being hidden
  behind them.
* Add a Camera Zoom slider (1x-3x) to Settings > Camera - the skeleton and
  every overlay zoom together with the video since they're all part of
  the same canvas.
* Move the on-canvas camera view selector (Side/Back/Front) and the
  front/rear camera lens toggle off the video canvas into Settings >
  Camera, alongside a new "Camera Lens" control for switching lenses.

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
