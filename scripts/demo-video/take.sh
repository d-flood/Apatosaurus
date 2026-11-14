#!/usr/bin/env bash
set -u
DEMO="$(cd "$(dirname "$0")" && pwd)"
APP="$DEMO/../../app"
TAKE_NAME="$1"
PORT="${2:-4392}"

cd "$APP"
pnpm exec vite preview --host 127.0.0.1 --port "$PORT" --strictPort > "$DEMO/server-$TAKE_NAME.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null' EXIT

for _ in $(seq 1 60); do
	curl -sf "http://127.0.0.1:$PORT/" > /dev/null && break
	sleep 0.5
done

cd "$DEMO"
BASE="http://127.0.0.1:$PORT" TAKE="$TAKE_NAME" node record.mjs
