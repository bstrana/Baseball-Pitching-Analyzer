/// <reference path="../pb_data/types.d.ts" />

// Real per-coach data isolation. Previously players/mechanics_sessions/
// pitch_sessions had fully open API rules (see 1700000000_baseball_schema.js)
// and player.owner_sub was just an informational text field, never checked
// by anything - any signed-in user could read/edit any coach's data.
//
// This introduces a `coaches` auth collection (one record per Keycloak
// `sub`, resolved and auto-created by pb_hooks/keycloak_auth.pb.js, which
// verifies the caller's Keycloak access token against Keycloak's own
// /userinfo endpoint on every request and sets request auth accordingly -
// see that file for the enforcement half of this). A `coach` relation is
// added to all three collections and the rules are tightened to check it
// via @request.auth.id, which the hook populates.
//
// Existing rows are backfilled from their `owner_sub` text field (already
// recorded at player-creation time, just never enforced) so existing
// rosters don't silently become invisible under the new rules. A synthetic
// email is used for these backfilled coach records since there's no
// Keycloak call available inside a migration to fetch a real one - it's
// never shown anywhere, and the runtime hook matches by keycloak_sub, not
// email, so this is harmless. Players saved with no owner_sub (Keycloak was
// disabled, or they predate that field) can't be backfilled this way -
// assign them to a coach manually via /pb/_/ if you need to preserve access.
migrate((app) => {
  const coaches = new Collection({
    type: "auth",
    name: "coaches",
    fields: [
      // Keycloak `sub` claim - the verified external identity this coach
      // record represents. Populated by the hook, never by the client.
      { name: "keycloak_sub", type: "text", required: true, max: 200 }
    ],
    indexes: ["CREATE UNIQUE INDEX idx_coaches_keycloak_sub ON coaches (keycloak_sub)"],
    // Nobody logs into this collection directly (no password flow exposed
    // to the app) and nobody but the owning coach can see their own record -
    // the hook resolves/creates records at the app level, bypassing rules.
    listRule: "id = @request.auth.id",
    viewRule: "id = @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null
  });
  app.save(coaches);

  const players = app.findCollectionByNameOrId("players");
  players.fields.add(new Field({
    name: "coach", type: "relation", required: true,
    collectionId: coaches.id, maxSelect: 1, cascadeDelete: true
  }));
  players.listRule = "coach = @request.auth.id";
  players.viewRule = "coach = @request.auth.id";
  players.createRule = "@request.auth.id != ''";
  players.updateRule = "coach = @request.auth.id";
  players.deleteRule = "coach = @request.auth.id";
  app.save(players);

  // Backfill players from owner_sub, tracking player id -> coach id so the
  // session backfill below can reuse it without re-resolving.
  const coachIdBySub = {};
  const coachIdByPlayerId = {};
  for (const player of app.findAllRecords("players")) {
    const sub = player.get("owner_sub");
    if (!sub) continue;

    let coachId = coachIdBySub[sub];
    if (!coachId) {
      let coach;
      try {
        coach = app.findFirstRecordByFilter(coaches, "keycloak_sub = {:sub}", { sub });
      } catch (err) {
        coach = new Record(coaches, { keycloak_sub: sub, email: sub + "@keycloak.local" });
        coach.setPassword($security.randomString(30));
        app.save(coach);
      }
      coachId = coach.id;
      coachIdBySub[sub] = coachId;
    }

    player.set("coach", coachId);
    app.save(player);
    coachIdByPlayerId[player.id] = coachId;
  }

  for (const name of ["mechanics_sessions", "pitch_sessions"]) {
    const collection = app.findCollectionByNameOrId(name);
    collection.fields.add(new Field({
      name: "coach", type: "relation", required: true,
      collectionId: coaches.id, maxSelect: 1, cascadeDelete: true
    }));
    collection.listRule = "coach = @request.auth.id";
    collection.viewRule = "coach = @request.auth.id";
    // Also require the referenced player to belong to this same coach, so a
    // session can't be filed against someone else's player.
    collection.createRule = "@request.auth.id != '' && player.coach = @request.auth.id";
    collection.updateRule = "coach = @request.auth.id";
    collection.deleteRule = "coach = @request.auth.id";
    app.save(collection);

    for (const session of app.findAllRecords(name)) {
      const coachId = coachIdByPlayerId[session.get("player")];
      if (!coachId) continue;
      session.set("coach", coachId);
      app.save(session);
    }
  }
}, (app) => {
  const players = app.findCollectionByNameOrId("players");
  players.fields.removeByName("coach");
  players.listRule = "";
  players.viewRule = "";
  players.createRule = "";
  players.updateRule = "";
  players.deleteRule = "";
  app.save(players);

  for (const name of ["mechanics_sessions", "pitch_sessions"]) {
    const collection = app.findCollectionByNameOrId(name);
    collection.fields.removeByName("coach");
    collection.listRule = "";
    collection.viewRule = "";
    collection.createRule = "";
    collection.updateRule = "";
    collection.deleteRule = "";
    app.save(collection);
  }

  const coaches = app.findCollectionByNameOrId("coaches");
  if (coaches) app.delete(coaches);
});
