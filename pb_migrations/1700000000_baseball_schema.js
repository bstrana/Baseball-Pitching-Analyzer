/// <reference path="../pb_data/types.d.ts" />

// Schema for the Baseball Pitching Analyzer's player roster and saved
// sessions. Collection access rules are intentionally left open ("") -
// this PocketBase instance isn't reachable except through this app's own
// nginx proxy, and the whole app is already gated behind Keycloak login
// before any of this is reachable. If you need per-user data isolation on
// top of that, tighten these rules (e.g. match `owner_sub` against a
// PocketBase auth token minted from your Keycloak identity) after wiring
// up OIDC between PocketBase and Keycloak.
migrate((app) => {
  const players = new Collection({
    type: "base",
    name: "players",
    fields: [
      { name: "name", type: "text", required: true, max: 120 },
      { name: "position", type: "text", max: 60 },
      { name: "height_in", type: "number" },
      { name: "weight_lb", type: "number" },
      { name: "wingspan_in", type: "number" },
      { name: "notes", type: "text", max: 2000 },
      // Keycloak `sub` claim of whoever created this player - not enforced
      // by an API rule yet (see note above), just recorded for later use.
      { name: "owner_sub", type: "text", max: 200 }
    ],
    indexes: ["CREATE INDEX idx_players_owner_sub ON players (owner_sub)"],
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: ""
  });
  app.save(players);

  const mechanicsSessions = new Collection({
    type: "base",
    name: "mechanics_sessions",
    fields: [
      { name: "player", type: "relation", required: true, collectionId: players.id, maxSelect: 1, cascadeDelete: true },
      { name: "camera_view", type: "select", values: ["side", "front", "back"] },
      // Final PoseMetrics snapshot at save time
      { name: "metrics", type: "json" },
      // KinematicFrame[] captured during the session
      { name: "kinematics_data", type: "json" },
      { name: "notes", type: "text", max: 2000 },
      { name: "recorded_at", type: "date", required: true }
    ],
    indexes: ["CREATE INDEX idx_mech_sessions_player ON mechanics_sessions (player)"],
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: ""
  });
  app.save(mechanicsSessions);

  const pitchSessions = new Collection({
    type: "base",
    name: "pitch_sessions",
    fields: [
      { name: "player", type: "relation", required: true, collectionId: players.id, maxSelect: 1, cascadeDelete: true },
      { name: "strike_zone_config", type: "json" },
      // Pitch[] logged during the session
      { name: "pitches", type: "json" },
      // Denormalized for cheap list-view sorting/filtering without parsing `pitches`
      { name: "total_pitches", type: "number" },
      { name: "strikes", type: "number" },
      { name: "avg_velocity", type: "number" },
      { name: "max_velocity", type: "number" },
      { name: "notes", type: "text", max: 2000 },
      { name: "recorded_at", type: "date", required: true }
    ],
    indexes: ["CREATE INDEX idx_pitch_sessions_player ON pitch_sessions (player)"],
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: ""
  });
  app.save(pitchSessions);
}, (app) => {
  const names = ["pitch_sessions", "mechanics_sessions", "players"];
  for (const name of names) {
    const c = app.findCollectionByNameOrId(name);
    if (c) app.delete(c);
  }
});
