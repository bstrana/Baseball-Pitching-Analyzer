// Local/dev default. In the packaged Cloudron image this file is generated
// at container startup by cloudron/start.sh from /app/data/config.env and
// served from there instead (see cloudron/nginx.conf) - this copy is only
// what `npm run dev` / a build without that startup step will see.
window.APP_CONFIG = {
  KEYCLOAK_URL: "",
  KEYCLOAK_REALM: "",
  KEYCLOAK_CLIENT_ID: ""
};
