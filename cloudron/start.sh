#!/bin/sh
set -eu

CONFIG_FILE="/app/data/config.env"
CONFIG_JS="/app/data/env-config.js"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "==> No $CONFIG_FILE yet, creating a template"
  cat > "$CONFIG_FILE" <<'EOF'
# Keycloak connection for this app. Create a client for this app in your
# Keycloak realm (redirect URI: this app's URL + /*), fill these in, then
# restart the app from the Cloudron dashboard to pick up the change.
KEYCLOAK_URL=
KEYCLOAK_REALM=
KEYCLOAK_CLIENT_ID=
EOF
fi

KEYCLOAK_URL=""
KEYCLOAK_REALM=""
KEYCLOAK_CLIENT_ID=""
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

echo "==> Starting nginx"
exec nginx -c /app/code/cloudron/nginx.conf -g "daemon off;"
