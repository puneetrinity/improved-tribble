#!/usr/bin/env bash
set -euo pipefail

# Build and start the VantaHireWebsite app from the monorepo root
echo "[start.sh] Installing dependencies..."
npm install --no-audit --no-fund

echo "[start.sh] Building app..."
npm run build

echo "[start.sh] Starting app..."
exec npm start

