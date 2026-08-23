/// <reference path="../pb_data/types.d.ts" />

// Adds a `team` field to `coaches` (synced from the Keycloak "team" profile
// attribute by pb_hooks/keycloak_auth.pb.js on every request) and widens
// listRule/viewRule on players/mechanics_sessions/pitch_sessions so coaches
// sharing the same team can see each other's rosters and sessions.
//
// This is read-only sharing: createRule/updateRule/deleteRule are
// deliberately left untouched (still `coach = @request.auth.id` only) - a
// coach can still only create/edit/delete their own records, never a
// team-mate's, matching 1700000200_coach_auth.js's existing per-coach
// ownership model.
//
// `@request.auth.team != ''` guards both sides of the OR so two coaches who
// each have no team set (empty string) don't get treated as being on the
// same "team".
migrate((app) => {
  const coaches = app.findCollectionByNameOrId("coaches");
  coaches.fields.add(new Field({ name: "team", type: "text", max: 200 }));
  app.save(coaches);

  const players = app.findCollectionByNameOrId("players");
  players.listRule = "coach = @request.auth.id || (@request.auth.team != '' && coach.team = @request.auth.team)";
  players.viewRule = "coach = @request.auth.id || (@request.auth.team != '' && coach.team = @request.auth.team)";
  app.save(players);

  for (const name of ["mechanics_sessions", "pitch_sessions"]) {
    const collection = app.findCollectionByNameOrId(name);
    collection.listRule = "coach = @request.auth.id || (@request.auth.team != '' && coach.team = @request.auth.team)";
    collection.viewRule = "coach = @request.auth.id || (@request.auth.team != '' && coach.team = @request.auth.team)";
    app.save(collection);
  }
}, (app) => {
  const players = app.findCollectionByNameOrId("players");
  players.listRule = "coach = @request.auth.id";
  players.viewRule = "coach = @request.auth.id";
  app.save(players);

  for (const name of ["mechanics_sessions", "pitch_sessions"]) {
    const collection = app.findCollectionByNameOrId(name);
    collection.listRule = "coach = @request.auth.id";
    collection.viewRule = "coach = @request.auth.id";
    app.save(collection);
  }

  const coaches = app.findCollectionByNameOrId("coaches");
  coaches.fields.removeByName("team");
  app.save(coaches);
});
