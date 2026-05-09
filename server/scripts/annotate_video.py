#!/usr/bin/env python3.11
"""
AdGuru AI — Enhanced Video Annotation Renderer v2
Features:
  - Original video audio mixed in (ducked under voiceover)
  - Green circles for strengths, blue for improvements, orange for warnings
  - Smooth zoom-in / zoom-out / pan camera effects (Ken Burns style)
  - Animated slide-in type banners (STRENGTH / IMPROVE / WARNING)
  - Burned-in subtitles (white text, black outline, bottom-center)
  - Voiceover audio synced per critique point (video pauses while guru speaks)
"""

import sys
import json
import os
import math
import subprocess
import tempfile
import shutil

import cv2
import numpy as np


# ─── Easing ───────────────────────────────────────────────────────────────────

def ease_in_out(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)

def lerp(a, b, t):
    return a + (b - a) * t


# ─── Video info ───────────────────────────────────────────────────────────────

def get_video_info(path):
    cap = cv2.VideoCapture(path)
    fps   = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w     = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    return fps, w, h, total


# ─── Drawing ──────────────────────────────────────────────────────────────────

def draw_annotation_circle(frame, ann, color, progress=1.0):
    """Animated growing circle with glow and label."""
    h, w = frame.shape[:2]
    cx = int(ann["x"] * w)
    cy = int(ann["y"] * h)
    rx = max(20, int(ann["w"] * w / 2))
    ry = max(20, int(ann["h"] * h / 2))
    base_r = max(rx, ry)
    r = int(base_r * ease_in_out(progress))
    if r < 5:
        return frame

    # Semi-transparent fill
    overlay = frame.copy()
    cv2.circle(overlay, (cx, cy), r, color, -1)
    frame = cv2.addWeighted(overlay, 0.15, frame, 0.85, 0)

    # Outer glow rings
    for gr, ga in [(r + 10, 0.12), (r + 5, 0.20)]:
        ov2 = frame.copy()
        cv2.circle(ov2, (cx, cy), gr, color, 2)
        frame = cv2.addWeighted(ov2, ga, frame, 1 - ga, 0)

    # Main border
    cv2.circle(frame, (cx, cy), r, color, 3)

    # Label pill above circle
    label = ann.get("label", "")
    if label and r > 20:
        font = cv2.FONT_HERSHEY_DUPLEX
        fs = 0.55
        (tw, th), _ = cv2.getTextSize(label, font, fs, 1)
        tx = cx - tw // 2
        ty = cy - r - 14
        pad = 6
        cv2.rectangle(frame, (tx - pad, ty - th - pad), (tx + tw + pad, ty + pad), color, -1)
        cv2.putText(frame, label, (tx, ty), font, fs, (255, 255, 255), 1, cv2.LINE_AA)

    return frame


def draw_type_banner(frame, point_type, title, progress=1.0):
    """Slide-in banner at the top: STRENGTH / IMPROVE / WARNING."""
    h, w = frame.shape[:2]

    if point_type == "strength":
        bg = (34, 139, 34)
        icon = "  STRENGTH"
    elif point_type == "improvement":
        bg = (180, 80, 20)
        icon = "  IMPROVE"
    else:
        bg = (30, 100, 200)
        icon = "  WARNING"

    slide = ease_in_out(min(progress * 2.5, 1.0))
    off_x = int(lerp(-w, 0, slide))

    banner_h = 50
    overlay = frame.copy()
    cv2.rectangle(overlay, (off_x, 0), (off_x + w, banner_h), bg, -1)
    frame = cv2.addWeighted(overlay, 0.85, frame, 0.15, 0)

    font = cv2.FONT_HERSHEY_DUPLEX
    cv2.putText(frame, icon, (off_x + 14, 33), font, 0.72, (255, 255, 255), 2, cv2.LINE_AA)

    title_short = title[:42]
    (tw, _), _ = cv2.getTextSize(title_short, font, 0.6, 1)
    cv2.putText(frame, title_short, (off_x + w - tw - 18, 33),
                font, 0.6, (220, 220, 220), 1, cv2.LINE_AA)
    return frame


def draw_subtitle(frame, text, progress=1.0):
    """Burn subtitle at the bottom with fade-in."""
    if not text:
        return frame
    h, w = frame.shape[:2]
    font = cv2.FONT_HERSHEY_DUPLEX
    fs = 0.70
    thick = 2

    # Word-wrap ~48 chars
    words = text.split()
    lines, cur = [], ""
    for word in words:
        if len(cur) + len(word) + 1 <= 48:
            cur = (cur + " " + word).strip()
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)

    alpha = ease_in_out(min(progress * 3.0, 1.0))
    line_h = 38
    total_h = len(lines) * line_h
    start_y = h - 55 - total_h

    for i, line in enumerate(lines):
        (tw, th), _ = cv2.getTextSize(line, font, fs, thick)
        tx = (w - tw) // 2
        ty = start_y + i * line_h + th
        for dx, dy in [(-2,-2),(2,-2),(-2,2),(2,2),(0,-2),(0,2),(-2,0),(2,0)]:
            cv2.putText(frame, line, (tx+dx, ty+dy), font, fs, (0,0,0), thick+1, cv2.LINE_AA)
        ov = frame.copy()
        cv2.putText(ov, line, (tx, ty), font, fs, (255,255,255), thick, cv2.LINE_AA)
        frame = cv2.addWeighted(ov, alpha, frame, 1.0 - alpha, 0)
    return frame


# ─── Zoom / Pan ───────────────────────────────────────────────────────────────

def apply_zoom_effect(frame, effect, progress, ann=None):
    if not effect or effect == "none":
        return frame
    h, w = frame.shape[:2]
    t = ease_in_out(progress)

    if effect == "zoom_in":
        cx_n = ann["x"] if ann else 0.5
        cy_n = ann["y"] if ann else 0.5
        scale = lerp(1.0, 1.38, t)
        cx_px, cy_px = cx_n * w, cy_n * h
        nw, nh = int(w / scale), int(h / scale)
        x1 = int(max(0, min(cx_px - nw / 2, w - nw)))
        y1 = int(max(0, min(cy_px - nh / 2, h - nh)))
        return cv2.resize(frame[y1:y1+nh, x1:x1+nw], (w, h), interpolation=cv2.INTER_LINEAR)

    elif effect == "zoom_out":
        scale = lerp(1.38, 1.0, t)
        nw, nh = int(w / scale), int(h / scale)
        x1 = (w - nw) // 2
        y1 = (h - nh) // 2
        return cv2.resize(frame[y1:y1+nh, x1:x1+nw], (w, h), interpolation=cv2.INTER_LINEAR)

    elif effect == "pan_left":
        off = int(lerp(0, w * 0.10, t))
        M = np.float32([[1, 0, -off], [0, 1, 0]])
        return cv2.warpAffine(frame, M, (w, h))

    elif effect == "pan_right":
        off = int(lerp(0, w * 0.10, t))
        M = np.float32([[1, 0, off], [0, 1, 0]])
        return cv2.warpAffine(frame, M, (w, h))

    return frame


# ─── Audio helpers ────────────────────────────────────────────────────────────

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


def extract_audio_segment(video_path, start, dur, out_wav):
    subprocess.run([
        "ffmpeg", "-y", "-ss", str(start), "-i", video_path,
        "-t", str(max(dur, 0.1)), "-vn",
        "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", out_wav
    ], capture_output=True, timeout=30)


def create_silence(dur, out_wav):
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-t", str(max(dur, 0.1)),
        "-acodec", "pcm_s16le", out_wav
    ], capture_output=True, timeout=10)


def mix_duck(orig_wav, voice_mp3, out_wav, duck=0.15):
    """Mix original audio (ducked) under voiceover."""
    r = subprocess.run([
        "ffmpeg", "-y", "-i", orig_wav, "-i", voice_mp3,
        "-filter_complex",
        f"[0:a]volume={duck}[d];[d][1:a]amix=inputs=2:duration=longest[o]",
        "-map", "[o]", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", out_wav
    ], capture_output=True, timeout=30)
    return r.returncode == 0


def concat_wavs(wav_list, out_wav):
    if not wav_list:
        create_silence(1.0, out_wav)
        return
    if len(wav_list) == 1:
        shutil.copy(wav_list[0], out_wav)
        return
    lst = out_wav + ".list.txt"
    with open(lst, "w") as f:
        for p in wav_list:
            f.write(f"file '{p}'\n")
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", lst, "-c", "copy", out_wav
    ], capture_output=True, timeout=60)
    try:
        os.remove(lst)
    except Exception:
        pass


# ─── Main renderer ────────────────────────────────────────────────────────────

def render(video_path, critique_json_path, output_path):
    with open(critique_json_path) as f:
        data = json.load(f)

    points = sorted(data.get("critiquePoints", []), key=lambda p: p.get("timestamp", 0))
    fps, W, H, total_frames = get_video_info(video_path)
    fps = max(fps, 24.0)
    video_dur = total_frames / fps

    print(f"[Render] Video: {W}x{H} @ {fps:.1f}fps, {video_dur:.1f}s", flush=True)
    print(f"[Render] {len(points)} critique points", flush=True)

    tmp = tempfile.mkdtemp(prefix="adguru_")

    try:
        cap = cv2.VideoCapture(video_path)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        raw_mp4 = os.path.join(tmp, "raw.mp4")
        writer = cv2.VideoWriter(raw_mp4, fourcc, fps, (W, H))

        # Build event timeline
        events = []
        prev = 0
        for idx, pt in enumerate(points):
            trig = int(pt.get("timestamp", 0) * fps)
            trig = max(prev, min(trig, total_frames - 1))

            if trig > prev:
                events.append({"kind": "play", "f0": prev, "f1": trig})

            ap = pt.get("audioPath", "")
            adur = ffprobe_duration(ap) if ap and os.path.exists(ap) else 3.0
            freeze_n = max(int(adur * fps), int(fps * 2))
            events.append({
                "kind": "critique",
                "f0": trig,
                "f1": trig + freeze_n,
                "pt": pt,
                "adur": adur,
                "idx": idx,
            })
            prev = trig

        if prev < total_frames:
            events.append({"kind": "play", "f0": prev, "f1": total_frames})

        # ── Render frames ──────────────────────────────────────────────────────
        frame_buf = {}

        def read_frame(fi):
            fi = max(0, min(fi, total_frames - 1))
            if fi not in frame_buf:
                cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
                ok, fr = cap.read()
                if not ok:
                    fr = np.zeros((H, W, 3), dtype=np.uint8)
                if len(frame_buf) > 80:
                    del frame_buf[min(frame_buf)]
                frame_buf[fi] = fr
            return frame_buf[fi].copy()

        written = 0
        for ev in events:
            if ev["kind"] == "play":
                for fi in range(ev["f0"], ev["f1"]):
                    writer.write(read_frame(fi))
                    written += 1
            else:
                pt = ev["pt"]
                base = read_frame(ev["f0"])
                n = ev["f1"] - ev["f0"]
                ann = pt.get("annotation")
                ptype = pt.get("type", "improvement")
                zoom = pt.get("zoomEffect", "none")
                sub = pt.get("subtitleText", pt.get("description", ""))
                title = pt.get("title", "")

                if ptype == "strength":
                    color = (50, 205, 50)
                elif ptype == "improvement":
                    color = (50, 130, 255)
                else:
                    color = (30, 140, 255)

                for i in range(n):
                    prog = i / max(n - 1, 1)
                    fr = base.copy()
                    fr = apply_zoom_effect(fr, zoom, prog, ann)
                    fr = draw_type_banner(fr, ptype, title, prog)
                    if ann:
                        fr = draw_annotation_circle(fr, ann, color, progress=prog)
                    if sub:
                        fr = draw_subtitle(fr, sub, prog)
                    writer.write(fr)
                    written += 1

        cap.release()
        writer.release()
        print(f"[Render] Wrote {written} frames ({written/fps:.1f}s)", flush=True)

        # ── Build audio track ──────────────────────────────────────────────────
        audio_segs = []
        for si, ev in enumerate(events):
            seg_wav = os.path.join(tmp, f"a{si}.wav")
            if ev["kind"] == "play":
                dur = (ev["f1"] - ev["f0"]) / fps
                extract_audio_segment(video_path, ev["f0"] / fps, dur, seg_wav)
                if not os.path.exists(seg_wav):
                    create_silence(dur, seg_wav)
                audio_segs.append(seg_wav)
            else:
                pt = ev["pt"]
                ap = pt.get("audioPath", "")
                freeze_dur = (ev["f1"] - ev["f0"]) / fps
                orig_wav = os.path.join(tmp, f"orig{si}.wav")
                extract_audio_segment(video_path, ev["f0"] / fps, freeze_dur, orig_wav)

                if ap and os.path.exists(ap):
                    mixed = os.path.join(tmp, f"mix{si}.wav")
                    if os.path.exists(orig_wav):
                        ok = mix_duck(orig_wav, ap, mixed)
                        audio_segs.append(mixed if ok and os.path.exists(mixed) else orig_wav)
                    else:
                        # Pad voiceover to freeze duration
                        padded = os.path.join(tmp, f"pad{si}.wav")
                        subprocess.run([
                            "ffmpeg", "-y", "-i", ap,
                            "-af", f"apad=whole_dur={freeze_dur}",
                            "-t", str(freeze_dur),
                            "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", padded
                        ], capture_output=True, timeout=15)
                        audio_segs.append(padded if os.path.exists(padded) else ap)
                else:
                    if os.path.exists(orig_wav):
                        audio_segs.append(orig_wav)
                    else:
                        sil = os.path.join(tmp, f"sil{si}.wav")
                        create_silence(freeze_dur, sil)
                        audio_segs.append(sil)

        final_wav = os.path.join(tmp, "final.wav")
        concat_wavs([s for s in audio_segs if os.path.exists(s)], final_wav)

        # ── Mux ───────────────────────────────────────────────────────────────
        print("[Render] Muxing...", flush=True)
        r = subprocess.run([
            "ffmpeg", "-y",
            "-i", raw_mp4,
            "-i", final_wav,
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest", output_path
        ], capture_output=True, text=True, timeout=300)

        if r.returncode != 0:
            print(f"[Render] FFmpeg mux error:\n{r.stderr[-800:]}", file=sys.stderr)
            raise RuntimeError(f"FFmpeg mux failed (code {r.returncode})")

        print(f"[Render] Done! Output: {output_path}", flush=True)

    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: annotate_video.py <video> <critique.json> <output.mp4>", file=sys.stderr)
        sys.exit(1)

    vp, cj, op = sys.argv[1], sys.argv[2], sys.argv[3]

    if not os.path.exists(vp):
        print(f"Error: video not found: {vp}", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(cj):
        print(f"Error: critique JSON not found: {cj}", file=sys.stderr)
        sys.exit(1)

    render(vp, cj, op)
