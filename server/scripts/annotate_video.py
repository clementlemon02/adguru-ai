#!/usr/bin/env python3
"""
AdGuru AI — Critique Video Renderer v5 (Pause & Resume)

How it works:
  1. Play original video frames normally until a pauseAtTimestamp
  2. FREEZE on that exact frame while the AI voiceover plays in full
  3. During the freeze: show annotation circle, banner, subtitles
  4. After voiceover finishes, RESUME original video from where it paused
  5. Repeat for each critique segment

The output video is LONGER than the original.
Audio: original audio plays during normal playback sections,
       original audio is MUTED during frozen/voiceover sections.
"""

import sys
import json
import os
import subprocess
import tempfile
import math
import cv2
import numpy as np
from pydub import AudioSegment

# ── Helpers ──────────────────────────────────────────────────────────────────

def ffprobe_duration(path: str) -> float:
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", path],
            stderr=subprocess.DEVNULL
        ).decode().strip()
        return float(out)
    except Exception:
        return 0.0


def load_font(size: int):
    """Load a font — try to use a system font, fall back to Hershey."""
    try:
        import PIL.ImageFont
        candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
            "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
        ]
        for c in candidates:
            if os.path.exists(c):
                return PIL.ImageFont.truetype(c, size)
        return PIL.ImageFont.load_default()
    except Exception:
        return None


def draw_text_pil(frame: np.ndarray, text: str, x: int, y: int,
                  font_size: int = 36, color=(255, 255, 255),
                  bg_color=(0, 0, 0), bg_alpha: float = 0.75,
                  padding: int = 12, center_x: bool = False) -> np.ndarray:
    """Draw text with a rounded pill background using PIL for quality rendering."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        pil_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(pil_img)

        font = load_font(font_size)
        if font is None:
            font = ImageFont.load_default()

        # Measure text
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]

        if center_x:
            x = (pil_img.width - tw) // 2

        rx0 = x - padding
        ry0 = y - padding
        rx1 = x + tw + padding
        ry1 = y + th + padding

        # Draw semi-transparent background
        overlay = Image.new("RGBA", pil_img.size, (0, 0, 0, 0))
        ov_draw = ImageDraw.Draw(overlay)
        bg_rgba = (bg_color[0], bg_color[1], bg_color[2], int(bg_alpha * 255))
        radius = min(th // 2 + padding, 20)
        ov_draw.rounded_rectangle([rx0, ry0, rx1, ry1], radius=radius, fill=bg_rgba)
        pil_img = Image.alpha_composite(pil_img.convert("RGBA"), overlay).convert("RGB")

        # Draw text
        draw2 = ImageDraw.Draw(pil_img)
        draw2.text((x, y), text, font=font, fill=color)

        return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    except Exception:
        # Fallback: OpenCV putText
        cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX,
                    font_size / 36.0, color, 2, cv2.LINE_AA)
        return frame


def draw_annotation_circle(frame: np.ndarray, ann: dict, w: int, h: int,
                             seg_type: str, alpha: float = 1.0) -> np.ndarray:
    """Draw a single clean annotation circle with label."""
    if not ann:
        return frame
    cx = int(ann.get("x", 0.5) * w)
    cy = int(ann.get("y", 0.5) * h)
    rw = int(ann.get("w", 0.3) * w)
    rh = int(ann.get("h", 0.3) * h)
    r = max(30, min(int((rw + rh) / 4), 140))

    color_map = {
        "strength": (50, 220, 80),
        "improvement": (60, 80, 230),
        "observation": (200, 160, 40),
    }
    color = color_map.get(seg_type, (200, 200, 200))

    a = max(0.0, min(1.0, alpha))

    overlay = frame.copy()
    # Filled circle (very subtle semi-transparent tint)
    cv2.circle(overlay, (cx, cy), r, color, -1)
    frame = cv2.addWeighted(overlay, 0.08 * a, frame, 1 - 0.08 * a, 0)

    # Outer ring
    overlay2 = frame.copy()
    cv2.circle(overlay2, (cx, cy), r, color, 3, cv2.LINE_AA)
    frame = cv2.addWeighted(overlay2, a, frame, 1 - a, 0)

    # Label above circle
    label = ann.get("label", "")
    if label:
        label_y = max(cy - r - 8, 30)
        label_x = cx - len(label) * 5
        frame = draw_text_pil(frame, label, label_x, label_y,
                               font_size=22, color=(255, 255, 255),
                               bg_color=(color[2], color[1], color[0]),
                               bg_alpha=0.85, padding=6)
    return frame


def draw_banner(frame: np.ndarray, seg_type: str, title: str,
                elapsed: float, total_pause_dur: float) -> np.ndarray:
    """Draw a slide-in banner at top-left during the pause."""
    type_labels = {
        "strength": "+ STRENGTH",
        "improvement": "! IMPROVE",
        "observation": "~ NOTE",
    }
    type_colors = {
        "strength": (50, 200, 70),
        "improvement": (60, 80, 220),
        "observation": (180, 140, 30),
    }
    label = type_labels.get(seg_type, "~ NOTE")
    color = type_colors.get(seg_type, (150, 150, 150))
    text = f"{label}  {title.upper()}"

    # Slide in over first 0.3s, stay, slide out over last 0.3s
    slide_dur = 0.3
    if elapsed < slide_dur:
        progress = elapsed / slide_dur
    elif elapsed > total_pause_dur - slide_dur:
        progress = max(0.0, (total_pause_dur - elapsed) / slide_dur)
    else:
        progress = 1.0

    # Estimate text width for slide offset
    text_w = len(text) * 11 + 24
    offset_x = int((1.0 - progress) * -(text_w + 20))

    frame = draw_text_pil(frame, text, 16 + offset_x, 16,
                           font_size=26,
                           color=(255, 255, 255),
                           bg_color=(color[2], color[1], color[0]),
                           bg_alpha=0.92, padding=10)
    return frame


def draw_subtitle(frame: np.ndarray, text: str, w: int, h: int) -> np.ndarray:
    """Draw large centered subtitle with dark pill background."""
    if not text:
        return frame
    font_size = max(36, min(52, w // 18))
    y = int(h * 0.82)
    return draw_text_pil(frame, text, 0, y,
                          font_size=font_size,
                          color=(255, 255, 255),
                          bg_color=(0, 0, 0),
                          bg_alpha=0.82, padding=14,
                          center_x=True)


# ── Main Renderer ─────────────────────────────────────────────────────────────

def render(video_path: str, critique_json_path: str, output_path: str):
    with open(critique_json_path) as f:
        critique = json.load(f)

    segments = critique.get("critiqueSegments") or critique.get("critiquePoints") or []

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total_duration = total_frames / fps

    print(f"[Renderer] {w}x{h} @ {fps:.1f}fps, {total_duration:.1f}s, {len(segments)} segments")

    # ── Build segment info ────────────────────────────────────────────────────
    # Sort by pauseAtTimestamp, deduplicate
    seg_info = []
    last_pause = -999.0
    for seg in sorted(segments, key=lambda s: s.get("pauseAtTimestamp", s.get("timestamp", 0))):
        pause_at = float(seg.get("pauseAtTimestamp", seg.get("timestamp", 0)))
        pause_at = max(0.5, min(pause_at, total_duration - 0.5))

        if pause_at - last_pause < 1.0:
            print(f"[Renderer] Skipping duplicate pause at {pause_at:.1f}s")
            continue
        last_pause = pause_at

        # Get voiceover duration
        adur = float(seg.get("audioDuration") or 0)
        if adur <= 0:
            ap = seg.get("audioPath", "")
            adur = ffprobe_duration(ap) if ap and os.path.exists(ap) else 0
        if adur <= 0:
            words = len(seg.get("spokenScript", "").split())
            adur = max(3.0, words / 2.5)

        # Build subtitle schedule (relative to start of pause)
        chunks = seg.get("subtitleChunks") or []
        if not chunks:
            script = seg.get("spokenScript") or ""
            chunks = [{"text": script[:60], "offsetSec": 0}]

        sub_schedule = []
        for j, chunk in enumerate(chunks):
            c_start = float(chunk.get("offsetSec", 0))
            if j + 1 < len(chunks):
                c_end = float(chunks[j+1].get("offsetSec", c_start + 3.0))
            else:
                c_end = adur + 0.5
            c_end = min(c_end, adur + 0.5)
            if c_end > c_start:
                sub_schedule.append({
                    "text": chunk.get("text", ""),
                    "start": c_start,
                    "end": c_end,
                })

        seg_info.append({
            "pause_at": pause_at,
            "pause_frame": int(pause_at * fps),
            "type": seg.get("type", "observation"),
            "title": seg.get("title", ""),
            "annotation": seg.get("annotation"),
            "sub_schedule": sub_schedule,
            "audioPath": seg.get("audioPath", ""),
            "audioDuration": adur,
        })

    print(f"[Renderer] Pause points:")
    for si in seg_info:
        print(f"  Pause at {si['pause_at']:.1f}s ({si['type']}): \"{si['title']}\" — voice {si['audioDuration']:.1f}s")

    # ── Video rendering ───────────────────────────────────────────────────────
    tmpdir = tempfile.mkdtemp(prefix="adguru_render_")
    raw_video = os.path.join(tmpdir, "raw_video.mp4")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(raw_video, fourcc, fps, (w, h))

    frame_idx = 0
    seg_cursor = 0  # which segment we're currently at or past
    total_output_frames = 0

    # We'll track which frames belong to "pause" sections for audio building
    # Each entry: (output_frame_start, output_frame_count, is_pause, seg_index)
    timeline = []  # list of sections

    # Pre-read all frames into memory for pause sections (or seek back)
    # Strategy: process frame by frame, when we hit a pause point, freeze and write pause frames

    print(f"[Renderer] Rendering frames...")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Check if this frame is a pause point
        if seg_cursor < len(seg_info) and frame_idx == seg_info[seg_cursor]["pause_frame"]:
            si = seg_info[seg_cursor]
            pause_dur = si["audioDuration"] + 0.5  # add 0.5s buffer after voiceover
            pause_frames = int(pause_dur * fps)

            # Record normal section up to this point
            timeline.append({
                "type": "normal",
                "orig_frame_start": frame_idx,
                "output_frame_start": total_output_frames,
                "frame_count": 0,  # will be updated
            })

            # Write pause frames (frozen frame with overlays)
            pause_section_start = total_output_frames
            for pf in range(pause_frames):
                elapsed = pf / fps
                annotated = frame.copy()

                # Fade in/out for annotation circle (fade in 0.3s, fade out 0.3s)
                if elapsed < 0.3:
                    circle_alpha = elapsed / 0.3
                elif elapsed > pause_dur - 0.3:
                    circle_alpha = max(0.0, (pause_dur - elapsed) / 0.3)
                else:
                    circle_alpha = 1.0

                annotated = draw_annotation_circle(annotated, si["annotation"], w, h, si["type"], circle_alpha)
                annotated = draw_banner(annotated, si["type"], si["title"], elapsed, pause_dur)

                # Find active subtitle chunk
                active_sub = ""
                for sub in si["sub_schedule"]:
                    if sub["start"] <= elapsed < sub["end"]:
                        active_sub = sub["text"]
                        break
                if active_sub:
                    annotated = draw_subtitle(annotated, active_sub, w, h)

                out.write(annotated)
                total_output_frames += 1

            timeline.append({
                "type": "pause",
                "seg_index": seg_cursor,
                "output_frame_start": pause_section_start,
                "frame_count": pause_frames,
                "pause_dur": pause_dur,
                "audio_dur": si["audioDuration"],
            })

            seg_cursor += 1

            # Progress
            pct = int(frame_idx / max(total_frames, 1) * 100)
            if pct % 25 == 0:
                print(f"[Renderer] {frame_idx/fps:.1f}s / {total_duration:.1f}s ({pct}%) [after pause]")

        # Write the current normal frame
        out.write(frame)
        total_output_frames += 1
        frame_idx += 1

        if frame_idx % int(fps * 5) == 0:
            pct = int(frame_idx / max(total_frames, 1) * 100)
            print(f"[Renderer] {frame_idx/fps:.1f}s / {total_duration:.1f}s ({pct}%)")

    cap.release()
    out.release()
    print(f"[Renderer] Frames written: {total_output_frames} ({total_output_frames/fps:.1f}s output)")

    # ── Audio building ────────────────────────────────────────────────────────
    print(f"[Renderer] Building audio track...")

    # Extract original audio
    orig_audio_path = os.path.join(tmpdir, "orig_audio.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-vn", "-acodec", "pcm_s16le",
         "-ar", "44100", "-ac", "2", orig_audio_path],
        check=True, capture_output=True
    )

    if not os.path.exists(orig_audio_path) or os.path.getsize(orig_audio_path) < 1000:
        # Video has no audio — create silence
        orig_audio = AudioSegment.silent(duration=int(total_duration * 1000), frame_rate=44100)
    else:
        orig_audio = AudioSegment.from_wav(orig_audio_path)

    # Build output audio by inserting pause sections
    # We walk through the original video timeline and insert voiceover pauses
    output_audio = AudioSegment.empty()
    orig_cursor_ms = 0  # where we are in the original audio (ms)

    for si in seg_info:
        # Add original audio up to the pause point
        pause_ms = int(si["pause_at"] * 1000)
        if pause_ms > orig_cursor_ms:
            chunk = orig_audio[orig_cursor_ms:pause_ms]
            output_audio += chunk
        orig_cursor_ms = pause_ms

        # Add the pause section audio
        pause_total_ms = int((si["audioDuration"] + 0.5) * 1000)
        pause_section = AudioSegment.silent(duration=pause_total_ms, frame_rate=44100)

        # Overlay voiceover
        ap = si.get("audioPath", "")
        if ap and os.path.exists(ap):
            try:
                voice = AudioSegment.from_file(ap)
                voice = voice + 3  # +3dB boost
                pause_section = pause_section.overlay(voice, position=0)
                print(f"[Audio] Overlaid voiceover at pause {si['pause_at']:.1f}s (dur={si['audioDuration']:.1f}s)")
            except Exception as e:
                print(f"[Audio] Warning: could not load voice {ap}: {e}")

        output_audio += pause_section

    # Add remaining original audio after last pause
    if orig_cursor_ms < len(orig_audio):
        output_audio += orig_audio[orig_cursor_ms:]

    # Export mixed audio
    mixed_audio_path = os.path.join(tmpdir, "mixed_audio.wav")
    output_audio.export(mixed_audio_path, format="wav")
    print(f"[Audio] Mixed audio: {os.path.getsize(mixed_audio_path):,} bytes ({len(output_audio)/1000:.1f}s)")

    # ── Merge video + audio ───────────────────────────────────────────────────
    print(f"[Renderer] Merging video + audio...")
    subprocess.run(
        ["ffmpeg", "-y",
         "-i", raw_video,
         "-i", mixed_audio_path,
         "-map", "0:v:0",
         "-map", "1:a:0",
         "-c:v", "libx264", "-preset", "fast", "-crf", "23",
         "-c:a", "aac", "-b:a", "192k",
         "-shortest",
         output_path],
        check=True, capture_output=True
    )

    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)

    size = os.path.getsize(output_path)
    print(f"[Renderer] Done! {output_path} ({size:,} bytes)")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: annotate_video.py <video_path> <critique_json_path> <output_path>")
        sys.exit(1)
    render(sys.argv[1], sys.argv[2], sys.argv[3])
