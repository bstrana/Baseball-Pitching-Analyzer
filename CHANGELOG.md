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
