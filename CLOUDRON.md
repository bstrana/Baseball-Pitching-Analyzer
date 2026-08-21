# Packaging for Cloudron

This app is packaged as a Cloudron custom app. It's a static Vite/React SPA
(TensorFlow.js pose detection runs entirely in the visitor's browser), so the
runtime image is just nginx serving the built `dist/` output on port 8000 -
no database, addon, or Node.js process is needed at runtime.

Files involved:

* `CloudronManifest.json` - app metadata (id, version, port, icon, etc.)
* `Dockerfile` - multi-stage build: `node:20-alpine` builds `dist/`, then
  `nginx:1.27-alpine` serves it
* `cloudron/nginx.conf` - SPA fallback routing (`try_files ... /index.html`),
  a `Permissions-Policy: camera=(self)` header so the pose-tracking camera
  prompt isn't blocked, and cache headers for hashed static assets
* `cloudron/start.sh` - container entrypoint (`nginx -g "daemon off;"`)
* `appicon.png` - 512x512 app icon (placeholder - swap for your own branding)
* `DESCRIPTION.md`, `CHANGELOG.md`, `POSTINSTALL.md` - Cloudron App Store copy

## Prerequisites

* [Cloudron CLI](https://docs.cloudron.io/custom-apps/tutorial/#getting-started) (`npm install -g cloudron`)
* Logged into your Cloudron: `cloudron login <my.domain.com>`
* Docker, if you want to build/test the image locally first

## Build & install

From the repo root:

```bash
# Optional: sanity-check the image builds
docker build -t baseball-pitching-analyzer .

# Build on/for your Cloudron and install it
cloudron build
cloudron install
```

To push an update after making changes, bump `version` in
`CloudronManifest.json`, then:

```bash
cloudron build
cloudron update --app <app-id-or-domain>
```

## Notes

* No Cloudron addons are configured - the app has no server-side state to
  persist. If you later add a backend, wire up the relevant addon
  (`localstorage`, `postgresql`, etc.) in `CloudronManifest.json`.
* Camera access requires a secure context; Cloudron terminates HTTPS at its
  reverse proxy in front of the app, so this works out of the box.
* The app has no built-in login. Use Cloudron's per-app user/group access
  control if you need to restrict who can reach it.
