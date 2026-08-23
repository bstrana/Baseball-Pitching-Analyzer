#!/bin/sh
set -eu

CONFIG_FILE="/app/data/config.env"
CONFIG_JS="/app/data/env-config.js"
PB_DATA_DIR="/app/data/pocketbase"
PB_BIN="/app/code/pocketbase/pocketbase"
PB_MIGRATIONS_DIR="/app/code/pocketbase/pb_migrations"
PB_HOOKS_DIR="/app/code/pocketbase/pb_hooks"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "==> No $CONFIG_FILE yet, creating a template"
  cat > "$CONFIG_FILE" <<'EOF'
# Keycloak connection for this app. Create a client for this app in your
# Keycloak realm (redirect URI: this app's URL + /*), fill these in, then
# restart the app from the Cloudron dashboard to pick up the change.
KEYCLOAK_URL=
KEYCLOAK_REALM=
KEYCLOAK_CLIENT_ID=

# PocketBase admin login (bundled data backend for the player roster and
# saved mechanics/pitch sessions). Set both to create or update the
# PocketBase superuser account on every startup so you can reach the admin
# dashboard at this app's URL + /pb/_/ - leave blank to skip.
PB_ADMIN_EMAIL=
PB_ADMIN_PASSWORD=
EOF
fi

KEYCLOAK_URL=""
KEYCLOAK_REALM=""
KEYCLOAK_CLIENT_ID=""
PB_ADMIN_EMAIL=""
PB_ADMIN_PASSWORD=""
# shellcheck disable=SC1090
. "$CONFIG_FILE"

# Minimal escaping so a stray " or \ in a value can't break out of the JS string.
js_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > "$CONFIG_JS" <<EOF
window.APP_CONFIG = {
  KEYCLOAK_URL: "$(js_escape "$KEYCLOAK_URL")",
  KEYCLOAK_REALM: "$(js_escape "$KEYCLOAK_REALM")",
  KEYCLOAK_CLIENT_ID: "$(js_escape "$KEYCLOAK_CLIENT_ID")"
};
EOF

mkdir -p "$PB_DATA_DIR"

if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  echo "==> Ensuring PocketBase superuser account exists"
  "$PB_BIN" superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir="$PB_DATA_DIR" --migrationsDir="$PB_MIGRATIONS_DIR" \
    || echo "==> Warning: could not create/update the PocketBase superuser account"
fi

# pb_hooks/keycloak_auth.pb.js verifies each request's Keycloak token against
# this same realm, to scope players/mechanics_sessions/pitch_sessions to the
# coach who's signed in - it needs these as real process env vars, not just
# the frontend's env-config.js above. Without them, every request to those
# collections is rejected (fails closed, not open).
export KEYCLOAK_URL
export KEYCLOAK_REALM

echo "==> Starting PocketBase"
"$PB_BIN" serve --http=127.0.0.1:8090 --dir="$PB_DATA_DIR" --migrationsDir="$PB_MIGRATIONS_DIR" --hooksDir="$PB_HOOKS_DIR" &

echo "==> Starting nginx"
exec nginx -c /app/code/cloudron/nginx.conf -g "daemon off;"
