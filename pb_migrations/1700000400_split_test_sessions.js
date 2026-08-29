/// <reference path="../pb_data/types.d.ts" />

// Split Test Mode: compares pitch velocity across mechanical tweaks
// (Groups of Sets, e.g. group "Foot on Rubber" -> sets "Inward"/"Neutral"/
// "Outward") instead of pitch location. Mirrors pitch_sessions' shape and
// access rules (coach ownership + same-team read sharing, see
// 1700000200_coach_auth.js and 1700000300_team_view_access.js) from the
// start, since both of those collections already exist by the time this
// migration runs.
migrate((app) => {
  const players = app.findCollectionByNameOrId("players");
  const coaches = app.findCollectionByNameOrId("coaches");

  const splitTestSessions = new Collection({
    type: "base",
    name: "split_test_sessions",
    fields: [
      { name: "player", type: "relation", required: true, collectionId: players.id, maxSelect: 1, cascadeDelete: true },
      { name: "coach", type: "relation", required: true, collectionId: coaches.id, maxSelect: 1, cascadeDelete: true },
      // SplitTestGroup[] (each with its nested Sets) as configured for this session
      { name: "groups", type: "json" },
      // SplitTestPitch[] logged during the session
      { name: "pitches", type: "json" },
      // Denormalized for cheap list-view sorting/filtering without parsing `pitches`
      { name: "total_pitches", type: "number" },
      { name: "avg_velocity", type: "number" },
      { name: "max_velocity", type: "number" },
      { name: "notes", type: "text", max: 2000 },
      { name: "recorded_at", type: "date", required: true }
    ],
    indexes: [
      "CREATE INDEX idx_split_test_sessions_player ON split_test_sessions (player)",
      "CREATE INDEX idx_split_test_sessions_coach ON split_test_sessions (coach)"
    ],
    listRule: "coach = @request.auth.id || (@request.auth.team != '' && coach.team = @request.auth.team)",
    viewRule: "coach = @request.auth.id || (@request.auth.team != '' && coach.team = @request.auth.team)",
    createRule: "@request.auth.id != '' && player.coach = @request.auth.id",
    updateRule: "coach = @request.auth.id",
    deleteRule: "coach = @request.auth.id"
  });
  app.save(splitTestSessions);
}, (app) => {
  const c = app.findCollectionByNameOrId("split_test_sessions");
  if (c) app.delete(c);
});
