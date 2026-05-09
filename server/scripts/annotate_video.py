#!/usr/bin/env python3
"""
AdGuru AI — Video Annotation Renderer (v3 — Natural Consultant Feel)

Design principles:
- Video plays CONTINUOUSLY — never replays, never freezes
- Original audio is MUTED (volume=0) while AI voiceover is playing,
  with smooth 0.3s fade out/in at boundaries
- NO zoom/pan effects — clean, stable playback
- Annotation circles fade in/out naturally over the live video
- Subtitles are LARGE, BOLD, PROMINENT — white text on dark pill background,
  matching exactly what the AI is saying (word-synced chunks)
- Banner slides in at the start of each segment

Usage:
    python3 annotate_video.py <input_video> <critique_json> <output_video>
"""

import sys
import json
import os
import subprocess
import tempfile
import shutil
import math

try:
    import cv2
    import numpy as np
except ImportError as e:
    print(f"[ERROR] Missing dependency: {e}", file=sys.stderr)
    sys.exit(1)

# ── Constants ─────────────────────────────────────────────────────────────────
FONT = cv2.FONT_HERSHEY_DUPLEX
CIRCLE_FADE_SECS = 0.4
BANNER_SLIDE_SECS = 0.5
SUBTITLE_FADE_SECS = 0.25
AUDIO_FADE_SECS = 0.3

COLOR_GREEN  = (60, 200, 80)
COLOR_RED    = (60, 60, 220)
COLOR_ORANGE = (30, 140, 255)
COLOR_WHITE  = (255, 255, 255)


# ── Easing ────────────────────────────────────────────────────────────────────

def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


# ── Drawing helpers ───────────────────────────────────────────────────────────

def draw_rounded_rect_alpha(img, x1, y1, x2, y2, radius, color, alpha):
    x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
    radius = max(0, min(radius, (x2 - x1) // 2, (y2 - y1) // 2))
    overlay = img.copy()
    cv2.rectangle(overlay, (x1 + radius, y1), (x2 - radius, y2), color, -1)
    cv2.rectangle(overlay, (x1, y1 + radius), (x2, y2 - radius), color, -1)
    for cx, cy in [(x1+radius, y1+radius), (x2-radius, y1+radius),
                   (x1+radius, y2-radius), (x2-radius, y2-radius)]:
        cv2.circle(overlay, (cx, cy), radius, color, -1)
    cv2.addWeighted(overlay, alpha, img, 1.0 - alpha, 0, img)


def draw_annotation_circle(frame, ann, color, alpha):
    """Draw a single clean annotation circle with subtle glow. ONE circle only."""
    if alpha <= 0 or not ann:
        return
    h, w = frame.shape[:2]
    cx = int(ann["x"] * w)
    cy = int(ann["y"] * h)
    # Use the annotation's w/h to determine radius, capped at reasonable size
    rx = max(30, int(ann.get("w", 0.2) * w * 0.45))
    ry = max(30, int(ann.get("h", 0.2) * h * 0.45))
    r = min(max(rx, ry), 140)

    # Subtle filled glow inside the circle
    glow = frame.copy()
    cv2.circle(glow, (cx, cy), r, color, -1)
    cv2.addWeighted(glow, alpha * 0.12, frame, 1 - alpha * 0.12, 0, frame)

    # Single clean circle border (thick, solid)
    border = frame.copy()
    cv2.circle(border, (cx, cy), r, color, 4)
    # Small center dot
    cv2.circle(border, (cx, cy), 5, color, -1)
    cv2.addWeighted(border, alpha, frame, 1 - alpha, 0, frame)

    # Label above the circle
    label = ann.get("label", "")
    if label and alpha > 0.4:
        fs = 0.55
        (tw, th), _ = cv2.getTextSize(label, FONT, fs, 1)
        lx = cx - tw // 2
        ly = cy - r - 14
        draw_rounded_rect_alpha(frame, lx - 8, ly - th - 6, lx + tw + 8, ly + 6, 6, color, alpha * 0.92)
        cv2.putText(frame, label, (lx, ly), FONT, fs, COLOR_WHITE, 1, cv2.LINE_AA)


def draw_banner(frame, title, seg_type, elapsed):
    """Slide-in banner. Shows for 2.5s then slides out. elapsed = seconds since segment start."""
    h, w = frame.shape[:2]
    color = COLOR_GREEN if seg_type == "strength" else (COLOR_RED if seg_type == "improvement" else COLOR_ORANGE)
    icon = "+ STRENGTH" if seg_type == "strength" else ("! IMPROVE" if seg_type == "improvement" else "* NOTE")
    text = f"  {icon}  {title[:35].upper()}"

    show_dur = 2.5
    slide_dur = BANNER_SLIDE_SECS

    if elapsed < slide_dur:
        progress = ease(elapsed / slide_dur)
    elif elapsed < show_dur:
        progress = 1.0
    elif elapsed < show_dur + slide_dur:
        progress = ease(1.0 - (elapsed - show_dur) / slide_dur)
    else:
        return  # fully hidden

    fs = 0.78
    (tw, th), _ = cv2.getTextSize(text, FONT, fs, 2)
    banner_h = th + 28
    banner_w = min(tw + 60, w - 40)

    x_off = int((1.0 - progress) * -(banner_w + 30))
    bx = 20 + x_off
    by = 18
    alpha = progress * 0.93

    draw_rounded_rect_alpha(frame, bx, by, bx + banner_w, by + banner_h, 10, color, alpha)
    cv2.putText(frame, text, (bx + 14, by + th + 10), FONT, fs, COLOR_WHITE, 2, cv2.LINE_AA)


def draw_subtitle(frame, text, alpha):
    if not text or alpha <= 0:
        return
    h, w = frame.shape[:2]

    # Adaptive font scale: larger for vertical video (1080x1920)
    is_vertical = h > w
    fs = 1.6 if is_vertical else 1.2
    thick = 2

    # Word-wrap
    words = text.split()
    lines = []
    cur = ""
    max_w = int(w * 0.88)
    for word in words:
        test = (cur + " " + word).strip()
        (tw, _), _ = cv2.getTextSize(test, FONT, fs, thick)
        if tw > max_w:
            if cur:
                lines.append(cur)
            cur = word
        else:
            cur = test
    if cur:
        lines.append(cur)

    (_, lh), _ = cv2.getTextSize("Ag", FONT, fs, thick)
    line_spacing = int(lh * 1.6)
    # Position subtitles at 82% height to avoid original video text at the very bottom
    base_y = int(h * 0.82)

    for i, line in enumerate(lines):
        (tw, th), _ = cv2.getTextSize(line, FONT, fs, thick)
        lx = (w - tw) // 2
        ly = base_y - (len(lines) - 1 - i) * line_spacing

        # Dark pill background
        pad_x, pad_y = 24, 14
        draw_rounded_rect_alpha(frame,
                                lx - pad_x, ly - th - pad_y,
                                lx + tw + pad_x, ly + pad_y,
                                14, (8, 8, 8), alpha * 0.88)

        # Shadow
        cv2.putText(frame, line, (lx + 2, ly + 2), FONT, fs, (0, 0, 0), thick + 2, cv2.LINE_AA)
        # Main text
        cv2.putText(frame, line, (lx, ly), FONT, fs, COLOR_WHITE, thick, cv2.LINE_AA)


# ── Audio builder ─────────────────────────────────────────────────────────────

def ffprobe_duration(path):
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=10
        )
        return float(r.stdout.strip() or "0")
    except Exception:
        return 0.0


def build_audio_track(video_path, segments, total_duration, tmp_dir):
    """
    Build the final audio track using pydub for sample-level precision.
    Produces EXACTLY ONE audio track:
    - Original audio plays at full volume
    - Original audio is silenced (volume=0) during each voiceover window
    - AI voiceover is overlaid at the exact timestamp
    - 0.3s fade out/in at boundaries
    """
    from pydub import AudioSegment

    SAMPLE_RATE = 44100
    CHANNELS = 2
    FADE_MS = int(AUDIO_FADE_SECS * 1000)

    # ── Step 1: Extract original audio from video ──────────────────────────────
    orig_wav = os.path.join(tmp_dir, "orig_audio.wav")
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-vn",
         "-acodec", "pcm_s16le", "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS), orig_wav],
        capture_output=True, timeout=60
    )
    has_orig = r.returncode == 0 and os.path.exists(orig_wav) and os.path.getsize(orig_wav) > 1000

    voice_segs = [s for s in segments if s.get("audioPath") and os.path.exists(s.get("audioPath", ""))]

    if not voice_segs and not has_orig:
        return ""

    total_ms = int(total_duration * 1000)

    if not voice_segs:
        # No voiceovers — just return original audio
        return orig_wav

    # ── Step 2: Load or create the base timeline ───────────────────────────────
    if has_orig:
        try:
            base = AudioSegment.from_wav(orig_wav)
        except Exception as e:
            print(f"[Audio] Could not load orig audio: {e}", file=sys.stderr)
            base = AudioSegment.silent(duration=total_ms, frame_rate=SAMPLE_RATE)
    else:
        base = AudioSegment.silent(duration=total_ms, frame_rate=SAMPLE_RATE)

    # Ensure base is exactly total_ms long
    if len(base) < total_ms:
        base = base + AudioSegment.silent(duration=total_ms - len(base), frame_rate=SAMPLE_RATE)
    else:
        base = base[:total_ms]

    # Normalize to stereo
    if base.channels != CHANNELS:
        base = base.set_channels(CHANNELS)
    if base.frame_rate != SAMPLE_RATE:
        base = base.set_frame_rate(SAMPLE_RATE)

    # ── Step 3: For each voiceover, silence the base and overlay the voice ─────
    for seg in voice_segs:
        t_start = seg.get("t_start") if seg.get("t_start") is not None else seg.get("timestamp", 0)
        t_start_ms = int(t_start * 1000)

        # Load the voiceover clip
        try:
            voice = AudioSegment.from_file(seg["audioPath"])
        except Exception as e:
            print(f"[Audio] Could not load voice: {seg['audioPath']}: {e}", file=sys.stderr)
            continue

        # Normalize voice to same format
        if voice.channels != CHANNELS:
            voice = voice.set_channels(CHANNELS)
        if voice.frame_rate != SAMPLE_RATE:
            voice = voice.set_frame_rate(SAMPLE_RATE)

        voice_ms = len(voice)
        t_end_ms = min(t_start_ms + voice_ms, total_ms)

        # Silence window: [t_start_ms - FADE_MS, t_end_ms + FADE_MS]
        silence_start = max(0, t_start_ms - FADE_MS)
        silence_end = min(total_ms, t_end_ms + FADE_MS)

        # Extract the region to silence
        before = base[:silence_start]
        region = base[silence_start:silence_end]
        after = base[silence_end:]

        # Fade out at start, silence in middle, fade in at end
        fade_out_dur = min(FADE_MS, len(region) // 2)
        fade_in_dur = min(FADE_MS, len(region) // 2)
        region_silenced = (
            region[:fade_out_dur].fade_out(fade_out_dur) +
            AudioSegment.silent(duration=max(0, len(region) - fade_out_dur - fade_in_dur), frame_rate=SAMPLE_RATE) +
            region[-fade_in_dur:].fade_in(fade_in_dur) if fade_in_dur > 0 else
            region[:fade_out_dur].fade_out(fade_out_dur) +
            AudioSegment.silent(duration=max(0, len(region) - fade_out_dur), frame_rate=SAMPLE_RATE)
        )

        # Rebuild base with silenced region
        base = before + region_silenced + after

        # Ensure base is still exactly total_ms
        if len(base) < total_ms:
            base = base + AudioSegment.silent(duration=total_ms - len(base), frame_rate=SAMPLE_RATE)
        else:
            base = base[:total_ms]

        # Overlay the voiceover at the correct position
        voice_clip = voice[:min(voice_ms, total_ms - t_start_ms)]
        base = base.overlay(voice_clip, position=t_start_ms)

        print(f"[Audio] Overlaid voiceover at {t_start:.1f}s (dur={voice_ms/1000:.1f}s)")

    # ── Step 4: Export single mixed WAV ───────────────────────────────────────
    mixed_audio = os.path.join(tmp_dir, "mixed_audio.wav")
    base.export(mixed_audio, format="wav")
    print(f"[Audio] Mixed audio: {os.path.getsize(mixed_audio):,} bytes")
    return mixed_audio


# ── Main renderer ─────────────────────────────────────────────────────────────

def render(input_video, critique_json, output_video):
    with open(critique_json) as f:
        data = json.load(f)

    # Support both critiqueSegments (v3) and critiquePoints (legacy)
    segments = data.get("critiqueSegments") or data.get("critiquePoints") or []
    segments = sorted(segments, key=lambda s: s.get("timestamp", 0))

    cap = cv2.VideoCapture(input_video)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open: {input_video}", file=sys.stderr)
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total_duration = total_frames / fps

    print(f"[Renderer] {w}x{h} @ {fps:.1f}fps, {total_duration:.1f}s, {len(segments)} segments")

    tmp_dir = tempfile.mkdtemp(prefix="adguru_v3_")
    raw_video = os.path.join(tmp_dir, "raw.mp4")

    try:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(raw_video, fourcc, fps, (w, h))

        # Pre-compute NON-OVERLAPPING segment timing
        # Renderer-level enforcement: enforce minimum spacing between segments
        # This is a safety net in case the AI analysis didn't respect the spacing rules
        min_spacing = max(5.0, total_duration / (len(segments) + 1)) if len(segments) > 0 else 5.0
        filtered_segments = []
        last_t = -999.0
        for seg in segments:
            t = float(seg.get("timestamp", 0))
            if t - last_t >= min_spacing or len(filtered_segments) == 0:
                filtered_segments.append(seg)
                last_t = t
            else:
                print(f"[Renderer] Skipping segment at {t:.1f}s (too close to {last_t:.1f}s, min spacing {min_spacing:.1f}s)")
        segments = filtered_segments
        print(f"[Renderer] After spacing enforcement: {len(segments)} segments")

        seg_info = []
        for i, seg in enumerate(segments):
            t_start = float(seg.get("timestamp", 0))
            adur = seg.get("audioDuration") or 0
            if adur <= 0:
                ap = seg.get("audioPath", "")
                adur = ffprobe_duration(ap) if ap and os.path.exists(ap) else 0
            if adur <= 0:
                words = len(seg.get("spokenScript", "").split())
                adur = max(2.5, words / 2.5)
            t_end = t_start + adur

            # CRITICAL FIX: clamp t_end so it does NOT overlap with next segment
            if i + 1 < len(segments):
                next_t = float(segments[i + 1].get("timestamp", t_end))
                t_end = min(t_end, next_t - 0.3)
            t_end = min(t_end, total_duration)
            t_end = max(t_end, t_start + 0.5)

            # Build subtitle schedule
            chunks = seg.get("subtitleChunks") or []
            if not chunks:
                script = seg.get("spokenScript") or seg.get("subtitleText") or ""
                chunks = [{"text": script[:60], "offsetSec": 0}]

            sub_schedule = []
            for j, chunk in enumerate(chunks):
                c_start = t_start + float(chunk.get("offsetSec", 0))
                if j + 1 < len(chunks):
                    c_end = t_start + float(chunks[j+1].get("offsetSec", chunk.get("offsetSec", 0) + 3))
                else:
                    c_end = t_end + 0.3
                c_start = max(c_start, t_start)
                c_end = min(c_end, t_end + 0.3)
                if c_end > c_start:
                    sub_schedule.append({"text": chunk.get("text", ""), "start": c_start, "end": c_end})

            seg_info.append({
                "t_start": t_start,
                "t_end": t_end,
                "type": seg.get("type", "observation"),
                "title": seg.get("title", ""),
                "annotation": seg.get("annotation"),
                "sub_schedule": sub_schedule,
                "audioPath": seg.get("audioPath", ""),
                "audioDuration": adur,
            })

        print(f"[Renderer] Segment windows (non-overlapping):")
        for si in seg_info:
            print(f"  [{si['t_start']:.1f}s - {si['t_end']:.1f}s] {si['type']}: {si['title']}")

        # ── Frame loop ─────────────────────────────────────────────────────────
        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            t = frame_idx / fps

            # Find the SINGLE active segment (most recent one that has started)
            active_seg = None
            for si in seg_info:
                if si["t_start"] <= t <= si["t_end"]:
                    active_seg = si  # keep updating — last one wins

            if active_seg is not None:
                si = active_seg
                elapsed = t - si["t_start"]
                remaining = si["t_end"] - t
                seg_type = si["type"]
                ann = si["annotation"]

                # ── Annotation circle (one circle only) ───────────────────────
                if ann:
                    if elapsed < CIRCLE_FADE_SECS:
                        circle_alpha = ease(elapsed / CIRCLE_FADE_SECS)
                    elif remaining < CIRCLE_FADE_SECS:
                        circle_alpha = ease(remaining / CIRCLE_FADE_SECS)
                    else:
                        circle_alpha = 1.0
                    color = COLOR_GREEN if seg_type == "strength" else (COLOR_RED if seg_type == "improvement" else COLOR_ORANGE)
                    draw_annotation_circle(frame, ann, color, circle_alpha)

                # ── Banner ─────────────────────────────────────────────────────
                draw_banner(frame, si["title"], seg_type, elapsed)

                # ── Subtitle — only the current chunk ─────────────────────────
                current_sub = None
                for sub in si["sub_schedule"]:
                    if sub["start"] <= t <= sub["end"]:
                        current_sub = sub
                        break

                if current_sub:
                    sub_elapsed = t - current_sub["start"]
                    sub_remaining = current_sub["end"] - t
                    if sub_elapsed < SUBTITLE_FADE_SECS:
                        sub_alpha = ease(sub_elapsed / SUBTITLE_FADE_SECS)
                    elif sub_remaining < SUBTITLE_FADE_SECS:
                        sub_alpha = ease(sub_remaining / SUBTITLE_FADE_SECS)
                    else:
                        sub_alpha = 1.0
                    draw_subtitle(frame, current_sub["text"], sub_alpha)

            out.write(frame)
            frame_idx += 1

            if frame_idx % int(fps * 5) == 0:
                pct = 100 * t / max(total_duration, 1)
                print(f"[Renderer] {t:.1f}s / {total_duration:.1f}s ({pct:.0f}%)")

        cap.release()
        out.release()
        print(f"[Renderer] Frames written: {frame_idx}")

        # ── Build audio ────────────────────────────────────────────────────────
        print("[Renderer] Building audio track (mute during voiceover)...")
        mixed_audio = build_audio_track(input_video, seg_info, total_duration, tmp_dir)

        # ── Merge ──────────────────────────────────────────────────────────────
        print("[Renderer] Merging video + audio...")
        if mixed_audio and os.path.exists(mixed_audio) and os.path.getsize(mixed_audio) > 1000:
            # CRITICAL: use explicit -map to guarantee EXACTLY 1 video + 1 audio track.
            # raw_video (from OpenCV) has NO audio. mixed_audio is our single pre-built track.
            # -map 0:v:0 takes only the first video stream from raw_video.
            # -map 1:a:0 takes only the first audio stream from mixed_audio.
            # This prevents FFmpeg from auto-selecting any extra streams.
            merge_cmd = [
                "ffmpeg", "-y",
                "-i", raw_video, "-i", mixed_audio,
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "192k",
                "-shortest", output_video
            ]
        else:
            merge_cmd = [
                "ffmpeg", "-y", "-i", raw_video,
                "-map", "0:v:0",
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-an", output_video
            ]

        r = subprocess.run(merge_cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            print(f"[Renderer] Merge error: {r.stderr[-400:]}", file=sys.stderr)
            sys.exit(1)

        size = os.path.getsize(output_video)
        print(f"[Renderer] Done! {output_video} ({size:,} bytes)")

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: annotate_video.py <input_video> <critique_json> <output_video>", file=sys.stderr)
        sys.exit(1)

    input_v, critique_j, output_v = sys.argv[1], sys.argv[2], sys.argv[3]

    for p in [input_v, critique_j]:
        if not os.path.exists(p):
            print(f"[ERROR] Not found: {p}", file=sys.stderr)
            sys.exit(1)

    render(input_v, critique_j, output_v)
