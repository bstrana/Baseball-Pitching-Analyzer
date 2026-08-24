## 1.2.13

* Fixed the drawing panel's Undo (Ctrl+Z) and Clear buttons doing
  nothing when an angle measurement was the only thing on screen -
  they only ever checked for regular strokes/lines, so they stayed
  disabled instead of removing the angle.
* Added inches as a measurement unit alongside feet and meters, for
  baseball-scale distances (stride length, release point height) that
  are awkward as a fraction of a foot.
* Added a manual "draw a line from head to feet" calibration option
  using the selected player's recorded height as the reference
  distance - useful when the existing automatic pose-detected version
  can't get a clean read.
* The per-pitch-type breakdown on the video canvas now also shows
  average velocity for each type, next to its max.
* The Pitch Tracker sidebar's chart now depends on the Speed On/Off
  toggle: velocity-per-pitch line with an average reference line when
  speed is on, or a strikes-vs-balls breakdown by pitch type when it's
  off (velocity isn't tracked in that mode).
* The Session Pitch Log, Pitch Calibration, and Velocity Chart panels
  can now be dragged (via a new grip handle) between the left sidebar,
  right sidebar, or a new bottom dock - drop the velocity chart at the
  bottom, for example, to view it full-width once a lot of pitches
  have been logged. The bottom dock is empty by default.

## 1.2.12

* The floating video control bar's resize handle now sets an explicit
  width instead of a uniform zoom, so its sections and buttons stack
  onto new rows as it's narrowed instead of shrinking below a legible
  size.
* Finishing an Analyze sweep on an uploaded/replayed video now keeps
  that pitch's trajectory line drawn on screen instead of letting it
  decay, and the control bar shows a summary of peak hip, shoulder,
  elbow, and wrist speeds plus a stride (foot-to-foot) distance -
  in real-world units once distance is calibrated.
* Added an Angle tool to the on-canvas drawing tools panel, alongside
  the pencil/line/arrow/circle tools - click three points to read the
  angle between them without opening Session Setup.

## 1.2.11

* Added a manual angle tool (Session Setup > Calibration > Measure Angle):
  click three points on the video - a ray end, the vertex, then the
  other ray end - to read the angle between them, no calibration
  needed.
* Added an alternative way to calibrate distance measurement: instead
  of drawing a reference line, use "Calibrate from &lt;Player&gt;'s
  Height" with the pitcher's height already on their profile.
* Fixed visible jitter in the pose tracking overlay - the skeleton
  dots would drift slightly even when the subject was standing
  completely still, since each frame was an independent estimate with
  no smoothing. Frame-to-frame noise is now filtered out without
  adding lag during actual fast motion like a pitch.
* The floating video control bar can now be resized (drag the new
  handle at its bottom-right corner, double-click to reset), in
  addition to being repositionable as before.

## 1.2.10

* Coaches sharing the same team (set via a Keycloak profile attribute)
  can now view each other's players and saved sessions - editing and
  deleting still stay restricted to the coach who created each record.
  Requires a Keycloak protocol mapper exposing a "team" attribute; see
  POSTINSTALL for setup.
* The Start/End Session modals now show the signed-in coach's name, so
  it's clear whose session it is when teammates can see each other's
  data.

## 1.2.9

* Player rosters and saved sessions are now scoped to the signed-in coach.
  Previously any signed-in user could see and edit every coach's data;
  now PocketBase verifies each request against Keycloak and only shows a
  coach their own players and sessions. Existing rosters carry forward
  automatically on upgrade; a player saved without a recorded owner needs
  reassigning by hand via the PocketBase admin dashboard.

## 1.2.8

* Fixed the session menu (the three-dot icon in the top-right of the nav
  bar) opening but rendering invisible - the nav bar's overflow-hidden
  style, added for the mobile-landscape collapsible chrome, was clipping
  the dropdown everywhere instead of only in that collapsed state.

## 1.2.7

* Added a Start/End Session flow: starting a session requires picking a
  player from the roster (or adding a new one) and entering a location,
  with a live duration clock in the nav bar while it runs. Ending a
  session requires a closing note, then a choice of Export (JSON) or
  Save to Database - saving/exporting is no longer available outside
  this flow. The player's name now displays as a top-center HUD on the
  video canvas while a session is active.
* Added an Avg Velo stat next to Max Velo on the Pitch Tracker's
  on-canvas overlay.
* Performance: the live metrics readout was updating on every single
  animation frame (up to 60 times a second), forcing the whole app to
  re-render that often - now throttled to match the kinematics chart.
  TensorFlow.js and the chart library are now loaded on demand instead
  of upfront, cutting the initial page load from ~3.4MB to ~855KB of
  JavaScript. Also fixed camera view changes not being picked up live
  by the pose detection loop, and replaced a per-player roster fetch
  with a single bulk query.

## 1.2.6

* Replaced the Interactive PitchCast mini-map in the Pitch Tracker side
  panel with a Velocity Trend chart (velocity per pitch, colored by
  type, with an average line and a per-pitch tooltip) - pitch location
  is already plotted live on the video canvas, so the map was a
  redundant second copy of the same thing.
* On a phone in landscape, the top nav bar and bottom panel bar (Live
  Metrics / Pitch Accuracy Tracker) now collapse to a small chevron tab
  on the right edge by default, since there's very little height to
  spare there. Tap the tab to slide both back in, tap again to hide
  them. Portrait and desktop are unaffected.
* Added a Fullscreen toggle to the video canvas's HUD bar - most useful
  in that same phone-landscape case, since it also hides the browser's
  own address bar/toolbar.

## 1.2.5

* Fixed the live camera feed rendering as a narrow pillarboxed strip with
  large dead black bars in mobile landscape orientation - the raw camera
  stream's dimensions don't rotate with the device, so the feed now fills
  the frame instead of preserving a stale portrait aspect ratio.
  Uploaded/replayed video is unaffected.
* Fixed the floating canvas HUD control bar (Record/Zoom/Source/Snapshot)
  getting clipped out of view in a short mobile landscape video area - it
  reserved 80px of bottom clearance left over from a bottom tab bar
  removed back in 1.1.3, which was enough to push it above the video
  container's own top edge and get clipped there.
* Pitch Tracker mode's HUD bar now has a camera zoom control in the slot
  the slow-mo playback speed control used, since speed isn't useful while
  tracking live pitches.
* Recorded throws and snapshots now download named after the selected
  player and the date/time they were captured (e.g.
  `jake-martinez_2026-08-22_16-45-03.webm`) instead of a bare UUID or raw
  timestamp.
* Deleting a recorded throw now releases its memory immediately instead
  of leaking it for the rest of the session.

## 1.2.4

* Pitch Tracker mode's canvas HUD bar now shows a pitch type quick-picker
  (abbreviation + a tap-to-select grid of all 11 types) in the slot the
  camera zoom control used, since zoom isn't useful there. Mechanics mode
  keeps camera zoom in that spot, unchanged.
* Fixed the Source / Camera Zoom / Pitch Type popovers on the canvas HUD
  rendering off-screen on mobile - they were anchored to their own
  button rather than the viewport, so once the button row wrapped a
  button could land near the screen edge and clip the popover off it
  entirely. They now center in the viewport on mobile.
* Fixed the video canvas getting clipped by the mobile browser's own UI
  (address bar / toolbar) in landscape orientation, where it eats a much
  larger share of the already-short viewport height than in portrait.
  The app shell now uses the dynamic viewport height unit, which tracks
  what's actually visible instead of the full layout viewport.

## 1.2.3

* Removed the "STRIKE ZONE" text label drawn above the strike zone box on
  the video canvas - the border and grid already identify it.
* Settings > Camera gets a "USB / UVC Camera (Slow-Mo)" section: scan for
  connected video input devices, pick one, and choose from its reported
  resolution/frame-rate presets (e.g. 720p @ 120fps) - useful for a
  high-fps global-shutter module like an AR0234. The actual negotiated
  stream settings are shown next to the pickers, since a browser's
  constraint negotiation is best-effort. This is separate from - and
  doesn't change - the existing mobile front/rear lens picker; phone
  cameras still aren't supported here since browsers cap `getUserMedia`
  well below a phone's native slow-mo capability.

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
