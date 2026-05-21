#!/usr/bin/env bash
# Record the two article clips (hero + packages) for the Dev.to post.
#
# Output: docs/screens/articles/{hero-todo,packages-gtd}.mp4
#
# Each clip is recorded in its own Playwright run so we get a clean
# webm per scene. After each run, the script trims the recording to
# the scene window written by the spec into
# $TMPDIR/snipsy-article-marks-<scene>.json, then transcodes to
# H.264 / no-audio MP4 sized 1100×618 (downscale from 1280×720).
#
# Per the article's UX requirements:
#   - H.264, yuv420p, faststart so Dev.to inlines the MP4 in <video>.
#   - No audio track (autoplay-loop video with sound is a UX disaster).
#   - 30 fps. 60 fps overkill for screen recording.
#   - ≤ 5 MB per clip target.
#   - Last frame ≡ first frame (the spec ends each scene with
#     `clearEditor` so the loop seam is invisible).
#
# Prereqs:
#   - ffmpeg installed (`brew install ffmpeg`)
#   - Obsidian.app installed at /Applications
#   - Repo built (`npm run build`) so the linked plugin in
#     `e2e-vault.pristine/.obsidian/plugins/snipsidian/main.js` is fresh
#
# Tunables:
#   - VIDEO_LEAD (seconds) — small constant subtracted from sceneStart
#     to absorb any lag between the page's `performance.now()` clock
#     and the actual video frame timeline. Default 0.2.
#   - VIDEO_TAIL (seconds) — small constant added past sceneEnd to
#     avoid clipping the trailing clearEditor. Default 0.2.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${ROOT}/docs/screens/articles"
WORK_ROOT="${ROOT}/test-results/article-clips"
VIDEO_LEAD="${VIDEO_LEAD:-0.2}"
VIDEO_TAIL="${VIDEO_TAIL:-0.2}"

mkdir -p "$OUT_DIR" "$WORK_ROOT"

# Sweep leftover Obsidian temp vaults from prior runs. Stale vault
# dirs in /tmp sometimes wedge Obsidian's plugin-enable path.
rm -rf "${TMPDIR:-/tmp}"/snipsy-e2e-* 2>/dev/null || true

# Run e2e-setup once up front to symlink the current build into the
# pristine vault. Idempotent; skipping per-scene saves a few seconds.
echo "→ Running e2e-setup (links current build into pristine vault)…"
./scripts/e2e-setup.sh

record_one() {
    local scene="$1"        # "hero" or "packages"
    local grep_pattern="$2" # playwright --grep substring
    local out_basename="$3" # "hero-todo" or "packages-gtd"

    local video_dir="${WORK_ROOT}/${scene}-video"
    local marks="${TMPDIR:-/tmp}/snipsy-article-marks-${scene}.json"
    local log="${WORK_ROOT}/${scene}-playwright.log"
    local final_mp4="${OUT_DIR}/${out_basename}.mp4"

    rm -rf "$video_dir"
    rm -f "$marks" "$log"
    mkdir -p "$video_dir"

    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo " Recording: ${scene}"
    echo " Output:    ${final_mp4}"
    echo " Don't switch focus until the run completes."
    echo "════════════════════════════════════════════════════════════"

    # Run playwright against the article-clips spec, filtering to the
    # single test for this scene. Each invocation spawns its own
    # Electron instance so the webm is isolated.
    if ! SNIPSY_DEMO_VIDEO_DIR="$video_dir" \
        env -u ELECTRON_RUN_AS_NODE playwright test \
            e2e/demo/article-clips.spec.ts \
            --grep "$grep_pattern" \
            --headed --reporter=list --workers=1 \
            > "$log" 2>&1; then
        echo "✗ Playwright run failed for scene '${scene}'. Last 40 lines:" >&2
        tail -n 40 "$log" >&2 || true
        exit 1
    fi

    # Locate the webm Playwright wrote. It names it after the page
    # handle: `page@<hash>.webm`.
    local webm
    webm="$(find "$video_dir" -name "*.webm" -type f -print -quit)"
    if [[ -z "${webm:-}" || ! -f "$webm" ]]; then
        echo "✗ No .webm produced under $video_dir for scene '${scene}'" >&2
        exit 1
    fi
    echo "→ Raw take: $webm ($(du -h "$webm" | awk '{print $1}'))"

    if [[ ! -f "$marks" ]]; then
        echo "✗ Marks file missing at $marks. Did the spec finish?" >&2
        exit 1
    fi

    # Compute the trim window. The page's performance.now() clock
    # starts when the renderer attaches, which is also when Playwright
    # begins capturing video — so sceneStart/sceneEnd map directly to
    # video time, modulo a small constant lag (VIDEO_LEAD).
    local trim
    trim=$(node -e "
        const m = require('$marks');
        const lead = parseFloat('${VIDEO_LEAD}');
        const tail = parseFloat('${VIDEO_TAIL}');
        const start = Math.max(0, m.start - lead).toFixed(3);
        const end   = (m.end + tail).toFixed(3);
        const dur   = (parseFloat(end) - parseFloat(start)).toFixed(3);
        console.log(start + ' ' + dur);
    ")
    local trim_start trim_dur
    read -r trim_start trim_dur <<< "$trim"
    echo "→ Trim window: start=${trim_start}s duration=${trim_dur}s"

    # Transcode to article-grade MP4. Steps:
    #   1. -ss before -i seeks fast (keyframe-accurate enough for webm
    #      VP8); -t bounds the duration.
    #   2. -an drops audio.
    #   3. scale to 1100×-2 (preserve aspect, ensure even height).
    #   4. -r 30 normalises framerate.
    #   5. fade=in / fade=out 0.2s at each edge — softens the loop
    #      seam so the autoplay-loop on Dev.to doesn't visibly jump
    #      between the end and the start of the clip.
    #   6. H.264 main profile, yuv420p, faststart so the <video> tag
    #      can begin streaming before the whole file lands.
    local fade_out_start
    fade_out_start=$(node -e "console.log((parseFloat('${trim_dur}') - 0.2).toFixed(3))")
    echo "→ Transcoding to MP4 (1100×618, H.264, no audio, 30 fps, fade=200ms)…"
    ffmpeg -y -hide_banner -loglevel error \
        -ss "$trim_start" -t "$trim_dur" \
        -i "$webm" \
        -an \
        -vf "scale=1100:-2:flags=lanczos,fps=30,fade=t=in:st=0:d=0.2,fade=t=out:st=${fade_out_start}:d=0.2" \
        -c:v libx264 -preset slow -crf 22 \
        -pix_fmt yuv420p -movflags +faststart \
        -profile:v main -level 4.0 \
        "$final_mp4"

    local size
    size="$(du -h "$final_mp4" | awk '{print $1}')"
    local actual_dur
    actual_dur="$(ffprobe -v error -show_entries format=duration \
        -of csv=p=0 "$final_mp4")"
    echo "✓ ${out_basename}.mp4 — ${size}, ${actual_dur}s"
}

# Order matters only for visual continuity in the terminal output;
# tests are independent.
record_one hero      "hero — todo expansion"                  "hero-todo"
record_one packages  "packages — install Markdown Essentials" "packages-table"

echo ""
echo "════════════════════════════════════════════════════════════"
echo " Done. Both clips at: ${OUT_DIR}/"
echo "════════════════════════════════════════════════════════════"
ls -lh "$OUT_DIR"/*.mp4 2>/dev/null || true
