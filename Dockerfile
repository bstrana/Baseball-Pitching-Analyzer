# Cloudron custom app package for the Baseball Pitching Analyzer.
#
# This is a pure client-side SPA (TensorFlow.js pose detection runs entirely
# in the visitor's browser) built with Vite, so the runtime image only needs
# to serve the static `dist/` output - no Node.js process, database, or
# Cloudron addon is required.
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

FROM nginx:1.27-alpine
RUN mkdir -p /app/code
COPY --from=build /app/dist /app/code/dist
COPY cloudron/nginx.conf /app/code/cloudron/nginx.conf
COPY cloudron/start.sh /app/code/cloudron/start.sh
RUN chmod +x /app/code/cloudron/start.sh

EXPOSE 8000

CMD ["/app/code/cloudron/start.sh"]
