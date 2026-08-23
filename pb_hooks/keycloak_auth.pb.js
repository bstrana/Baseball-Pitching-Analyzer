/// <reference path="../pb_data/types.d.ts" />

// Real per-coach data isolation for players/mechanics_sessions/pitch_sessions.
// See pb_migrations/1700000200_coach_auth.js for the collection rules this
// supports (they all check `@request.auth.id` / `coach = @request.auth.id`).
//
// Requires KEYCLOAK_URL and KEYCLOAK_REALM to be set as environment
// variables for the PocketBase process itself (not just the frontend's
// env-config.js) - see cloudron/start.sh. Without them, every request to
// these collections is rejected (fail closed, not fail open).
//
// ARCHITECTURE NOTES (all verified empirically against a real PocketBase
// v0.28.0 instance - these are not documented behaviors, they were found by
// testing):
//
// 1. A collection's createRule/updateRule is evaluated using PocketBase's
//    own native @request.auth resolution BEFORE onRecordCreateRequest /
//    onRecordUpdateRequest hooks run - setting e.auth from inside one of
//    those hooks is too late to satisfy that same request's rule check (the
//    request never reaches the hook at all; it's rejected earlier with a
//    generic "create rule failure: sql: no rows in result set"). listRule/
//    viewRule/deleteRule don't have this problem (they're applied as a
//    filter during/after data fetch, which happens after hooks run) - but
//    for consistency this file resolves auth in one place for every verb.
//    The fix is a router-level middleware (routerUse + Middleware, with a
//    negative priority to run early) instead of a collection-scoped hook.
//
// 2. e.request is undefined on RecordsListRequestEvent/RecordRequestEvent
//    in this binding (despite the .d.ts typing it as always present) - use
//    e.requestInfo().headers instead. On the router Middleware's own event
//    e.request IS populated.
//
// 3. PocketBase's JS hook binding does not preserve closures over sibling
//    top-level functions/variables defined in the same file - a callback
//    passed to routerUse/onRecordXRequest must be fully self-contained, or
//    it fails at runtime with "ReferenceError: ... is not defined".
//
// 4. `coaches` is a real PocketBase auth collection, so creating a new
//    coach record requires a non-blank `email` (a required system field) -
//    Keycloak's userinfo response usually includes one; fall back to a
//    synthetic address derived from `sub` if it doesn't.
//
// 5. This middleware is registered globally via routerUse (there is no
//    path-scoped variant), so it runs for every single request the server
//    handles - including /api/health, the admin dashboard, static assets,
//    everything. The path prefix check below MUST stay first and MUST pass
//    through untouched (e.next()) for anything that isn't one of the three
//    protected collections, or it breaks the entire server, not just these
//    collections. (Confirmed the hard way: a ReferenceError thrown here
//    once broke /api/health along with everything else.)
//
// 6. `team` is synced from Keycloak's userinfo "team" claim on every
//    request (not just first sight), so a team reassignment in Keycloak
//    takes effect on the coach's next request. This requires a Keycloak
//    "User Attribute" protocol mapper on the client (or a client scope
//    it uses) mapping the "team" user attribute to a "team" token/userinfo
//    claim - a custom attribute isn't included by default. See
//    pb_migrations/1700000300_team_view_access.js for how this widens
//    read access to players/sessions shared by team (view/list only -
//    create/update/delete stay restricted to the owning coach).

routerUse(new Middleware((e) => {
  const path = e.request.url.path;
  const isProtected = path.indexOf("/api/collections/players/") === 0 ||
    path.indexOf("/api/collections/mechanics_sessions/") === 0 ||
    path.indexOf("/api/collections/pitch_sessions/") === 0;
  if (!isProtected) {
    e.next();
    return;
  }

  // PocketBase's own native auth-token resolution (superuser tokens, e.g.
  // from the /pb/_/ admin dashboard) already runs before this middleware,
  // regardless of its priority - e.auth/e.hasSuperuserAuth() are already
  // populated at this point if the caller sent a valid PocketBase-issued
  // token. Superusers bypass every collection API rule by default, so let
  // them straight through instead of trying to verify their token against
  // Keycloak (it isn't one, and would always fail) - otherwise the admin
  // dashboard can never browse/fix this data directly.
  if (e.hasSuperuserAuth()) {
    e.next();
    return;
  }

  const authHeader = (e.requestInfo().headers.authorization) || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new UnauthorizedError("Missing bearer token");

  const keycloakUrl = $os.getenv("KEYCLOAK_URL");
  const keycloakRealm = $os.getenv("KEYCLOAK_REALM");
  if (!keycloakUrl || !keycloakRealm) throw new UnauthorizedError("Coach auth is not configured (KEYCLOAK_URL/KEYCLOAK_REALM missing)");

  let res;
  try {
    res = $http.send({
      method: "GET",
      url: keycloakUrl.replace(/\/+$/, "") + "/realms/" + keycloakRealm + "/protocol/openid-connect/userinfo",
      headers: { Authorization: "Bearer " + token },
      timeout: 10,
    });
  } catch (err) {
    throw new UnauthorizedError("Could not reach Keycloak to verify the token");
  }
  if (res.statusCode !== 200 || !res.json || !res.json.sub) throw new UnauthorizedError("Invalid or expired token");

  const sub = res.json.sub;
  const team = res.json.team || "";
  const coaches = e.app.findCollectionByNameOrId("coaches");
  try {
    const record = e.app.findFirstRecordByFilter(coaches, "keycloak_sub = {:sub}", { sub });
    if (record.get("team") !== team) {
      record.set("team", team);
      e.app.save(record);
    }
    e.auth = record;
  } catch (err) {
    const record = new Record(coaches, {
      keycloak_sub: sub,
      email: res.json.email || (sub + "@keycloak.local"),
      team: team,
    });
    record.setPassword($security.randomString(30));
    e.app.save(record);
    e.auth = record;
  }
  e.next();
}, -1000));

// Create/update stamp the `coach` field server-side from the identity the
// middleware above already resolved, overwriting whatever (if anything) the
// client sent for it - the client can never claim ownership on behalf of
// another coach. No Keycloak call needed here; e.auth is already set.
onRecordCreateRequest((e) => {
  e.record.set("coach", e.auth.id);
  e.next();
}, "players", "mechanics_sessions", "pitch_sessions");

onRecordUpdateRequest((e) => {
  e.record.set("coach", e.auth.id);
  e.next();
}, "players", "mechanics_sessions", "pitch_sessions");
