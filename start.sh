#!/usr/bin/env bash
set -euo pipefail

# Build and start the VantaHireWebsite app from the monorepo root
echo "[start.sh] Installing dependencies..."
npm install --no-audit --no-fund

# Optionally run migrations before build/start
if [ "${MIGRATE_ON_START:-}" = "true" ]; then
  echo "[start.sh] Running database migrations (db:push)..."
  npm --prefix VantaHireWebsite run db:push || {
    echo "[start.sh] Migration failed" >&2
    exit 1
  }
fi

echo "[start.sh] Building app..."
npm run build

echo "[start.sh] Starting app..."
exec npm start
