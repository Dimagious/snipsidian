#!/usr/bin/env bash
# E2E test setup. Idempotent — safe to re-run.
#
# What this does:
#   1. Verifies Obsidian is installed.
#   2. Builds the plugin (main.js + styles.css).
#   3. Symlinks the build into the pristine e2e vault so Obsidian
#      finds it under `.obsidian/plugins/snipsidian/`.
#
# Note: we do NOT extract `obsidian.asar`. The launcher targets the
# original `Obsidian.app/Contents/Resources/app.asar` and runs it
# through our project-local `electron` devDependency (which has the
# `EnableNodeCliInspectArguments` fuse on, so Playwright can attach
# to the DevTools protocol — the binary inside Obsidian.app does
# not, since the 2024 fuse change).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OBSIDIAN_APP_ASAR="/Applications/Obsidian.app/Contents/Resources/app.asar"
VAULT_PRISTINE="${ROOT}/e2e-vault.pristine"
PLUGIN_DIR="${VAULT_PRISTINE}/.obsidian/plugins/snipsidian"

if [[ ! -f "${OBSIDIAN_APP_ASAR}" ]]; then
  echo "✗ Obsidian not found at ${OBSIDIAN_APP_ASAR}"
  echo "  Install Obsidian.app into /Applications/ first."
  exit 1
fi

# 1. Build the plugin
echo "→ Building plugin..."
npm run build > /dev/null

# 2. Symlink the build artifacts into the pristine vault
mkdir -p "${PLUGIN_DIR}"
for f in main.js manifest.json styles.css; do
  ln -sf "${ROOT}/${f}" "${PLUGIN_DIR}/${f}"
done

echo "✓ E2E setup ready."
echo "  Obsidian bootstrap: ${OBSIDIAN_APP_ASAR}"
echo "  Pristine vault:     ${VAULT_PRISTINE}"
echo "  Plugin symlinks:    ${PLUGIN_DIR}/{main.js,manifest.json,styles.css}"
