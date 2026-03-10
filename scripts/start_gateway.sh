#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find_python() {
  local candidate
  for candidate in python3.13 python3.12 python3.11; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(find_python || true)"
fi

if [[ -z "$PYTHON_BIN" ]]; then
  cat >&2 <<'EOF'
No supported Python interpreter found.

This project requires Python 3.11 or newer.
Tried: python3.11, python3.12, python3.13

You can also run with:
  PYTHON_BIN=/path/to/python3.11 scripts/start_gateway.sh
EOF
  exit 1
fi

exec env PYTHONPATH="${ROOT_DIR}/src" "$PYTHON_BIN" -m longdoc.gateway "$@"
