#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  echo "Dependencies missing. Run 'npm install' first."
  exit 1
fi

declare -a pids=()

cleanup() {
  local exit_code=$?

  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  wait "${pids[@]:-}" 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup INT TERM EXIT

echo "Starting Jarvis API on http://localhost:4000"
npm run dev:api &
pids+=("$!")

echo "Starting Jarvis extension dev server on http://localhost:4174"
npm run dev:extension &
pids+=("$!")

echo "Jarvis dev stack is starting. Press Ctrl+C to stop everything."

wait -n "${pids[@]}"
