#!/bin/bash
set -euo pipefail

echo "==> Starting nginx"
exec nginx -c /app/code/cloudron/nginx.conf -g "daemon off;"
