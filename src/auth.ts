import Keycloak from 'keycloak-js';

declare global {
  interface Window {
    APP_CONFIG?: {
      KEYCLOAK_URL?: string;
      KEYCLOAK_REALM?: string;
      KEYCLOAK_CLIENT_ID?: string;
    };
  }
}

const config = window.APP_CONFIG || {};

export const keycloakEnabled = Boolean(
  config.KEYCLOAK_URL && config.KEYCLOAK_REALM && config.KEYCLOAK_CLIENT_ID
);

export const keycloak = keycloakEnabled
  ? new Keycloak({
      url: config.KEYCLOAK_URL!,
      realm: config.KEYCLOAK_REALM!,
      clientId: config.KEYCLOAK_CLIENT_ID!,
    })
  : null;

// Keeps the session alive; if the refresh fails (token unrecoverable), send
// the user back through the login flow rather than leaving a dead session.
export function startTokenRefresh() {
  if (!keycloak) return;
  setInterval(() => {
    keycloak.updateToken(60).catch(() => keycloak.login());
  }, 30000);
}
