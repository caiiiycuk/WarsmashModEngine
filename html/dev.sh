#!/usr/bin/env bash
# Web-port dev helper. See html/README.md.
# Usage: ./html/dev.sh {build|serve|dev}

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VITE="$ROOT/html/web-src"
PORT="${PORT:-8000}"

case "${1:-}" in
  build) cd "$ROOT" && ./gradlew :html:buildWeb ;;
  serve) cd "$VITE" && npm run vite ;;
  dev)   "$0" build && "$0" serve ;;
  *)     echo "usage: $0 {build|serve|dev}  (PORT=N to override port)" >&2; exit 1 ;;
esac
