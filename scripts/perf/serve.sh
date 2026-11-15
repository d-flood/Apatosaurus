#!/usr/bin/env bash
set -u
PERF="$(cd "$(dirname "$0")" && pwd)"
PORT="$1"
shift

cd "$PERF/../../app"
pnpm exec vite preview --host 127.0.0.1 --port "$PORT" --strictPort > /dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null' EXIT

for _ in $(seq 1 60); do
	curl -sf "http://127.0.0.1:$PORT/" > /dev/null && break
	sleep 0.5
done

cd "$PERF"
BASE="http://127.0.0.1:$PORT" "$@"
