#!/usr/bin/env bash
# Record the Snipsy README demo into docs/screens/demo.mp4.
#
# Strategy: Playwright's Electron driver supports `recordVideo`,
# which captures the Obsidian window through the Chromium pipeline at
# logical pixels (1280×720). That bypasses macOS Screen Recording
# permission entirely — no avfoundation, no permission prompts, no
# captured menu bar or surrounding desktop.
#
# Flow:
#   1. Point Playwright at a fresh video dir via env var, run the
#      headed demo spec.
#   2. When the run finishes, Playwright finalises a .webm in that
#      dir.
#   3. Convert .webm -> .mp4 (H.264, 1280×720) so it embeds inline in
#      GitHub README.
#
# Prereqs:
#   - ffmpeg installed (`brew install ffmpeg`). Only used for the
#     webm->mp4 conversion, not screen capture.
#   - No special macOS permissions needed.
#
# Output: docs/screens/demo.mp4 (overrides any previous take).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Recording produces the silent raw take. scripts/build-demo.sh
# composes it with voice-over + intro/outro into the final
# docs/screens/demo.mp4.
OUTPUT="${OUTPUT:-test-results/demo/raw.mp4}"
VIDEO_DIR="${TMPDIR:-/tmp}/snipsy-demo-video"
PW_LOG="${TMPDIR:-/tmp}/snipsy-demo-playwright.log"

mkdir -p "$(dirname "${OUTPUT}")"
rm -rf "$VIDEO_DIR"
rm -f "$PW_LOG"
mkdir -p "$VIDEO_DIR"

# Leftover Obsidian temp vaults from prior test runs cause flaky
# launches — Obsidian sometimes dies during plugin-enable when /tmp
# is crowded with stale vault dirs. Sweep before each recording.
rm -rf "${TMPDIR:-/tmp}"/snipsy-e2e-* 2>/dev/null || true

echo "→ Running headed demo spec (Obsidian will open at 1280×720)…"
echo "  Don't switch focus until the run completes."
echo "  Log: $PW_LOG"

# Run the demo. SNIPSY_DEMO_VIDEO_DIR triggers the recordVideo path
# in e2e/fixtures.ts; the dir gets one .webm per spec run.
if ! SNIPSY_DEMO_VIDEO_DIR="$VIDEO_DIR" npm run demo:record:_inner > "$PW_LOG" 2>&1; then
    echo "✗ Playwright demo failed. Last 40 log lines:" >&2
    tail -n 40 "$PW_LOG" >&2 || true
    exit 1
fi

# Locate the resulting .webm. Playwright names it after the page
# handle, e.g. page@<hash>.webm.
WEBM="$(find "$VIDEO_DIR" -name "*.webm" -type f -print -quit)"
if [[ -z "${WEBM:-}" || ! -f "$WEBM" ]]; then
    echo "✗ No .webm produced under $VIDEO_DIR" >&2
    ls -la "$VIDEO_DIR" >&2 || true
    exit 1
fi
echo "→ Captured: $WEBM"

# Transcode to README-friendly MP4. H.264 main profile, yuv420p, fast
# start so GitHub's inline player can begin streaming before the
# whole file is fetched.
echo "→ Encoding to ${OUTPUT}…"
ffmpeg -y -hide_banner -loglevel error \
    -i "$WEBM" \
    -vf "scale=1280:720:flags=lanczos,fps=30" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart \
    "${OUTPUT}"

SIZE="$(du -h "${OUTPUT}" | awk '{print $1}')"
echo "✓ Recording: ${OUTPUT} ($SIZE)"
