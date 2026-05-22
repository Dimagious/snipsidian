#!/usr/bin/env bash
# Compose the final README demo from the raw recording + edge-tts
# voice-over clips, with per-scene audio alignment driven by scene
# marks captured during the recording.
#
# Inputs:
#   docs/screens/demo.mp4              raw silent recording (1280×720)
#   docs/screens/voice/scene[1-6].mp3  per-scene voice-over (Andrew)
#   docs/screens/voice/outro.mp3       outro tagline
#   $TMPDIR/snipsy-demo-marks.json     scene start timestamps from
#                                      the Playwright run (mark-1
#                                      = 0, others relative)
#
# Output:
#   docs/screens/demo.mp4              FINAL composed video
#   docs/screens/demo.gif              GIF fallback for embeds
#
# Pipeline:
#   1. Stash raw recording
#   2. For each scene N: pad VO N with `adelay = (mark(N) + LEAD_IN) ms`
#      of silence at the start. Mix all six padded streams via amix
#      to make a body audio track.
#   3. Mix that body audio into the raw video.
#   4. Render intro and outro cards as silent / VO-backed MP4 clips.
#   5. Concat intro + body + outro.
#   6. Derive GIF fallback.
#
# LEAD_IN is the gap between video frame 0 and the scene-1 mark
# (i.e. the fixture's Obsidian-bootstrap overhead caught by
# recordVideo). Tunable via env: LEAD_IN=3.0 (default).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Language selection: DEMO_LANG=en (default) writes docs/screens/demo.mp4
# from docs/screens/voice/; DEMO_LANG=ru writes docs/screens/demo-ru.mp4
# from docs/screens/voice-ru/. Raw recording and scene marks are shared
# across languages — both runs sync to the same video and timestamps.
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
RAW="${RAW_DIR}/raw.mp4"
OUTPUT="${ROOT}/docs/screens/${OUTPUT_NAME}"
GIF="${ROOT}/docs/screens/${GIF_NAME}"
WORK="${RAW_DIR}/build-${LANG_TAG}"
VOICE_DIR="${ROOT}/docs/screens/${VOICE_DIR_NAME}"
MARKS="${TMPDIR:-/tmp}/snipsy-demo-marks.json"

LEAD_IN="${LEAD_IN:-3.0}"

mkdir -p "$WORK" "$RAW_DIR"

# record-demo.sh writes the silent take directly to $RAW. If it's
# missing here, the user hasn't recorded yet.
if [[ ! -f "$RAW" ]]; then
    echo "✗ Raw recording not found at $RAW." >&2
    echo "  Run scripts/record-demo.sh first." >&2
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

# Pull scene start offsets (seconds since scene-1 mark) and compute
# absolute video-time delays in milliseconds.
read -r M1 M2 M3 M4 M5 M6 < <(node -e "
    const m = require('$MARKS');
    const lead = parseFloat('$LEAD_IN');
    const toMs = (s) => Math.round((s + lead) * 1000);
    console.log([toMs(m['scene-1']), toMs(m['scene-2']), toMs(m['scene-3']),
                 toMs(m['scene-4']), toMs(m['scene-5']), toMs(m['scene-6'])].join(' '));
")
echo "→ Scene audio delays (ms): $M1 $M2 $M3 $M4 $M5 $M6 (LEAD_IN=${LEAD_IN}s)"

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
ffmpeg -y -hide_banner -loglevel error \
    -i "$RAW" -i "$BODY_AUDIO" \
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
