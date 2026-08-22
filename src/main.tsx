import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {keycloak, keycloakEnabled, startTokenRefresh} from './auth';

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

function renderMessage(message: string) {
  document.getElementById('root')!.innerHTML =
    `<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#020617;color:#e2e8f0;font-family:sans-serif;text-align:center;padding:2rem;">
      <p style="max-width:32rem;">${message}</p>
    </div>`;
}

if (!keycloakEnabled) {
  renderMessage(
    'Sign-in is not configured yet. Set KEYCLOAK_URL, KEYCLOAK_REALM, and KEYCLOAK_CLIENT_ID in /app/data/config.env, then restart the app.'
  );
} else {
  keycloak!
    .init({
      onLoad: 'login-required',
      pkceMethod: 'S256',
      silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
    })
    .then((authenticated) => {
      if (authenticated) {
        renderApp();
        startTokenRefresh();
      } else {
        keycloak!.login();
      }
    })
    .catch((err) => {
      console.error('Keycloak init failed', err);
      renderMessage('Authentication failed to initialize. Check the Keycloak configuration in /app/data/config.env.');
    });
}
