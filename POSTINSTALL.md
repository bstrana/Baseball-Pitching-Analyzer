This app requires Keycloak sign-in before it will load.

1. In your Keycloak admin console, create a client for this app (e.g. client
   ID `baseball-pitching-analyzer`) in the realm you want to use, with this
   app's URL + `/*` as a valid redirect URI.
2. Edit `/app/data/config.env` (created automatically on first start) inside
   this app's storage and fill in:
   ```
   KEYCLOAK_URL=https://your-keycloak-domain
   KEYCLOAK_REALM=your-realm
   KEYCLOAK_CLIENT_ID=baseball-pitching-analyzer
   ```
3. Restart the app from the Cloudron dashboard to pick up the change.

Until this is configured, opening the app shows a "sign-in not configured"
message instead of the tool.

Once signed in, grant camera access when your browser prompts for it (pose
tracking runs entirely in-browser; nothing is uploaded to the server).

## Data backend (PocketBase)

Player rosters and saved mechanics/pitch tracker sessions are stored in a
PocketBase instance bundled with this app - no separate install needed. Its
data lives under this app's own storage, so it survives restarts and backups.

Each coach only sees their own players and sessions - PocketBase verifies
every request against the same Keycloak realm configured above, so
KEYCLOAK_URL/KEYCLOAK_REALM must be set for both sign-in and data access to
work. If you're upgrading from an older version, existing rosters are
carried forward automatically the first time this app starts after the
upgrade; any player saved without a recorded owner can't be matched to a
coach automatically and needs reassigning by hand via the admin dashboard
below.

### Sharing a roster across a team (optional)

Coaches who share the same Keycloak "team" value can view (but not edit or
delete) each other's players and sessions - useful for a coaching staff
working from one roster. To enable it:

1. In your Keycloak realm, set a `team` user attribute on each coach's
   account (Users → select a user → Attributes) to the same value for
   everyone on that team, e.g. `team` = `Varsity`.
2. On this app's client (or a client scope it uses), add a Mapper of type
   "User Attribute": User Attribute `team`, Token Claim Name `team`, and
   enable it for both the ID token and userinfo.
3. No app restart needed - each coach's team takes effect on their next
   request after you save the mapper.

Coaches with no `team` attribute set keep seeing only their own data, same
as before.

To reach the PocketBase admin dashboard (to browse/export the raw data),
add to `/app/data/config.env`:
```
PB_ADMIN_EMAIL=you@example.com
PB_ADMIN_PASSWORD=a-strong-password
```
then restart the app and open this app's URL + `/pb/_/` to log in. Leave
both blank to skip creating an admin account - the app itself doesn't need
one to save or load data.
