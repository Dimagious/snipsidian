#!/usr/bin/env bash
# Compose the final README demo from the raw recording + edge-tts
# voice-over clips, with per-scene audio alignment driven by scene
# marks captured during the recording.
#
# Inputs:
#   test-results/demo/raw-<lang>.mp4   raw silent take from
#                                      scripts/record-demo.sh (1280×720)
#   docs/screens/voice/scene[1-6].mp3  per-scene voice-over (Andrew)
#   docs/screens/voice/outro.mp3       outro tagline
#   $TMPDIR/snipsy-demo-marks-<lang>.json
#                                      scene start timestamps from the
#                                      Playwright run (scene-1 = 0)
#
# Output:
#   docs/screens/demo.mp4              FINAL composed video
#   docs/screens/demo.gif              GIF fallback for embeds
#
# Pipeline:
#   1. Find the magenta sync flash the spec shows right before the
#      scene-1 mark; trim the raw take to start just after it (drops
#      Obsidian boot and the warm-up).
#   2. For each scene N: pad VO N with `adelay = mark(N) ms` of
#      silence. Mix all six padded streams via amix into a body track.
#   3. Mix that body audio into the trimmed video.
#   4. Render intro and outro cards as silent / VO-backed MP4 clips.
#   5. Concat intro + body + outro.
#   6. Derive GIF fallback.
#
# Record + build both languages:
#   DEMO_LANG=en npm run demo:record && DEMO_LANG=en scripts/build-demo.sh
#   DEMO_LANG=ru npm run demo:record && DEMO_LANG=ru scripts/build-demo.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Language selection: DEMO_LANG=en (default) writes docs/screens/demo.mp4
# from docs/screens/voice/; DEMO_LANG=ru writes docs/screens/demo-ru.mp4
# from docs/screens/voice-ru/. Each language has its own take (the spec
# pads every scene to that language's narration length).
LANG_TAG="${DEMO_LANG:-en}"
case "$LANG_TAG" in
    en)
        VOICE_DIR_NAME="voice"
        OUTPUT_NAME="demo.mp4"
        GIF_NAME="demo.gif"
        ;;
    ru)
        VOICE_DIR_NAME="voice-ru"
        OUTPUT_NAME="demo-ru.mp4"
        GIF_NAME="demo-ru.gif"
        ;;
    *)
        echo "✗ DEMO_LANG must be 'en' or 'ru' (got '$LANG_TAG')" >&2
        exit 1
        ;;
esac

RAW_DIR="${ROOT}/test-results/demo"
RAW="${RAW_DIR}/raw-${LANG_TAG}.mp4"
OUTPUT="${ROOT}/docs/screens/${OUTPUT_NAME}"
GIF="${ROOT}/docs/screens/${GIF_NAME}"
WORK="${RAW_DIR}/build-${LANG_TAG}"
VOICE_DIR="${ROOT}/docs/screens/${VOICE_DIR_NAME}"
MARKS="${TMPDIR:-/tmp}/snipsy-demo-marks-${LANG_TAG}.json"

mkdir -p "$WORK" "$RAW_DIR"

# record-demo.sh writes the silent take directly to $RAW. If it's
# missing here, the user hasn't recorded yet.
if [[ ! -f "$RAW" ]]; then
    echo "✗ Raw recording not found at $RAW." >&2
    echo "  Run DEMO_LANG=${LANG_TAG} scripts/record-demo.sh first." >&2
    exit 1
fi
if [[ ! -f "$MARKS" ]]; then
    echo "✗ Scene marks not found at $MARKS." >&2
    echo "  Run scripts/record-demo.sh (instrumented spec writes them)." >&2
    exit 1
fi
for n in scene1 scene2 scene3 scene4 scene5 scene6 outro; do
    if [[ ! -f "${VOICE_DIR}/${n}.mp3" ]]; then
        echo "✗ Missing voice clip: ${VOICE_DIR}/${n}.mp3" >&2
        exit 1
    fi
done

# ---------------------------------------------------------------------------
# 0. Locate the sync flash and trim the raw take to start right after it.
# ---------------------------------------------------------------------------
SYNC_T=$(python3 - "$RAW" <<'PY'
import subprocess, sys
fps = 30
proc = subprocess.run(
    ["ffmpeg", "-v", "error", "-t", "90", "-i", sys.argv[1],
     "-vf", f"fps={fps},scale=8:8", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    capture_output=True, check=True)
data, size = proc.stdout, 8 * 8 * 3
last = None
for i in range(len(data) // size):
    px = data[i * size:(i + 1) * size]
    n = len(px) // 3
    r = sum(px[0::3]) / n; g = sum(px[1::3]) / n; b = sum(px[2::3]) / n
    if r > 200 and b > 200 and g < 60:
        last = i
    elif last is not None:
        break
if last is None:
    sys.exit("no magenta sync flash found in the first 90s")
print(f"{(last + 1) / fps:.3f}")
PY
)
echo "→ Sync flash ends at ${SYNC_T}s; trimming lead-in"
TRIMMED="${WORK}/raw-trimmed.mp4"
ffmpeg -y -hide_banner -loglevel error \
    -ss "$SYNC_T" -i "$RAW" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 -an \
    "$TRIMMED"

# Scene start offsets (seconds since the scene-1 mark = trimmed t0) as
# audio delays in milliseconds.
read -r M1 M2 M3 M4 M5 M6 < <(node -e "
    const m = require('$MARKS');
    const toMs = (s) => Math.round(s * 1000);
    console.log([toMs(m['scene-1']), toMs(m['scene-2']), toMs(m['scene-3']),
                 toMs(m['scene-4']), toMs(m['scene-5']), toMs(m['scene-6'])].join(' '));
")
echo "→ Scene audio delays (ms): $M1 $M2 $M3 $M4 $M5 $M6"

# ---------------------------------------------------------------------------
# 1. Build body audio: per-scene VO with `adelay` placement, mixed.
# ---------------------------------------------------------------------------
echo "→ Building body audio track…"
BODY_AUDIO="${WORK}/body-audio.mp3"
ffmpeg -y -hide_banner -loglevel error \
    -i "${VOICE_DIR}/scene1.mp3" \
    -i "${VOICE_DIR}/scene2.mp3" \
    -i "${VOICE_DIR}/scene3.mp3" \
    -i "${VOICE_DIR}/scene4.mp3" \
    -i "${VOICE_DIR}/scene5.mp3" \
    -i "${VOICE_DIR}/scene6.mp3" \
    -filter_complex "
        [0:a]adelay=${M1}|${M1}[a1];
        [1:a]adelay=${M2}|${M2}[a2];
        [2:a]adelay=${M3}|${M3}[a3];
        [3:a]adelay=${M4}|${M4}[a4];
        [4:a]adelay=${M5}|${M5}[a5];
        [5:a]adelay=${M6}|${M6}[a6];
        [a1][a2][a3][a4][a5][a6]amix=inputs=6:normalize=0:dropout_transition=0[out]
    " -map "[out]" -ar 44100 -ac 2 -c:a libmp3lame -q:a 4 \
    "$BODY_AUDIO"

# ---------------------------------------------------------------------------
# 2. Mix body audio into the raw video.
# ---------------------------------------------------------------------------
echo "→ Mixing body audio into video…"
BODY="${WORK}/body.mp4"
# Video length drives the body (the audio track is padded with silence
# to it); `-shortest` would cut the tail hold off after the last clip.
ffmpeg -y -hide_banner -loglevel error \
    -i "$TRIMMED" -i "$BODY_AUDIO" \
    -filter_complex "[1:a]apad[a]" -map 0:v -map "[a]" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 \
    -ar 44100 -ac 2 -c:a aac -b:a 128k \
    -shortest -movflags +faststart \
    "$BODY"

# ---------------------------------------------------------------------------
# 3. Intro / outro cards via PIL (drawtext not available in brew ffmpeg).
# ---------------------------------------------------------------------------
echo "→ Rendering card PNGs via Python+PIL…"
python3 "${ROOT}/scripts/render-cards.py" "$WORK"

INTRO_PNG="${WORK}/intro.png"
OUTRO_PNG="${WORK}/outro.png"

INTRO="${WORK}/intro.mp4"
ffmpeg -y -hide_banner -loglevel error \
    -loop 1 -t 3 -i "$INTRO_PNG" \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 \
    -ar 44100 -ac 2 -c:a aac -b:a 128k -shortest \
    "$INTRO"

# Outro card holds for outro VO + ~0.8s tail. RU outro runs longer
# than EN, so compute dynamically off the actual MP3 duration.
OUTRO_VO_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "${VOICE_DIR}/outro.mp3")
OUTRO_DUR=$(node -e "console.log((parseFloat('${OUTRO_VO_DUR}') + 0.8).toFixed(2))")
OUTRO="${WORK}/outro.mp4"
ffmpeg -y -hide_banner -loglevel error \
    -loop 1 -t "$OUTRO_DUR" -i "$OUTRO_PNG" \
    -i "${VOICE_DIR}/outro.mp3" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 \
    -ar 44100 -ac 2 -c:a aac -b:a 128k -shortest \
    "$OUTRO"

# ---------------------------------------------------------------------------
# 4. Concat intro + body + outro.
# ---------------------------------------------------------------------------
echo "→ Concatenating…"
CONCAT_LIST="${WORK}/concat.txt"
{
    echo "file '$INTRO'"
    echo "file '$BODY'"
    echo "file '$OUTRO'"
} > "$CONCAT_LIST"

ffmpeg -y -hide_banner -loglevel error \
    -f concat -safe 0 -i "$CONCAT_LIST" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 \
    -ar 44100 -ac 2 -c:a aac -b:a 128k -movflags +faststart \
    "$OUTPUT"

# ---------------------------------------------------------------------------
# 5. GIF derivative (12 fps, 720 px wide).
# ---------------------------------------------------------------------------
echo "→ Rendering GIF derivative…"
PALETTE="${WORK}/palette.png"
ffmpeg -y -hide_banner -loglevel error \
    -i "$OUTPUT" \
    -vf "fps=12,scale=720:-1:flags=lanczos,palettegen=max_colors=128" \
    "$PALETTE"
ffmpeg -y -hide_banner -loglevel error \
    -i "$OUTPUT" -i "$PALETTE" \
    -filter_complex "[0:v]fps=12,scale=720:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=4" \
    "$GIF"

MP4_SIZE=$(du -h "$OUTPUT" | awk '{print $1}')
GIF_SIZE=$(du -h "$GIF" | awk '{print $1}')
MP4_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTPUT")
echo "✓ Final video: $OUTPUT ($MP4_SIZE, ${MP4_DUR}s)"
echo "✓ GIF fallback: $GIF ($GIF_SIZE)"
