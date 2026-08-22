# Cloudron custom app package for the Baseball Pitching Analyzer.
#
# The frontend is a client-side SPA (TensorFlow.js pose detection runs
# entirely in the visitor's browser) built with Vite. Player rosters and
# saved mechanics/pitch sessions are persisted in PocketBase, bundled here
# as a sidecar process (single static binary) alongside nginx and started
# in the background by cloudron/start.sh; its SQLite data lives under
# /app/data/pocketbase so it survives restarts via Cloudron's localstorage
# addon. Nginx reverse-proxies /pb/ to it so the frontend can talk to it
# same-origin, no separate exposed port or CORS setup needed.
#
# Build & install with the Cloudron CLI from the repo root:
#   cloudron build
#   cloudron install
#
# NOTE: this uses the public `nginx:alpine` image for the runtime stage to
# avoid pinning a Cloudron base-image tag that may go stale. If you want full
# syslog/log-aggregation integration with the Cloudron dashboard, you can
# switch the final stage to `cloudron/base:<latest>` instead (see
# https://docs.cloudron.io/packaging/base-image/ for the current tag) and
# `apt-get install nginx` there; container stdout/stderr is captured by
# Cloudron's log viewer either way.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM alpine:3.20 AS pocketbase
ARG POCKETBASE_VERSION=0.28.0
ARG TARGETARCH
RUN apk add --no-cache curl unzip && \
    case "$TARGETARCH" in \
      amd64) PB_ARCH=amd64 ;; \
      arm64) PB_ARCH=arm64 ;; \
      *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    curl -sSL -o /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_${PB_ARCH}.zip" && \
    unzip -q /tmp/pb.zip pocketbase -d /tmp && \
    chmod +x /tmp/pocketbase

FROM nginx:1.27-alpine
RUN mkdir -p /app/code
COPY --from=build /app/dist /app/code/dist
COPY --from=pocketbase /tmp/pocketbase /app/code/pocketbase/pocketbase
COPY pb_migrations /app/code/pocketbase/pb_migrations
COPY cloudron/nginx.conf /app/code/cloudron/nginx.conf
COPY cloudron/start.sh /app/code/cloudron/start.sh
RUN chmod +x /app/code/cloudron/start.sh /app/code/pocketbase/pocketbase

EXPOSE 8000

CMD ["/app/code/cloudron/start.sh"]
