#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${DIST_DIR}/sidebarclaw-extension"
ZIP_PATH="${DIST_DIR}/sidebarclaw-extension.zip"

rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}"
mkdir -p "${DIST_DIR}"

cp -R "${ROOT_DIR}/extension/." "${STAGE_DIR}/"

rm -f "${ZIP_PATH}"

(
  cd "${STAGE_DIR}"
  zip -qr "${ZIP_PATH}" .
)

echo "Packaged extension:"
echo "  ${ZIP_PATH}"
