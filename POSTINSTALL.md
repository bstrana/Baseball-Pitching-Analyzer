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
