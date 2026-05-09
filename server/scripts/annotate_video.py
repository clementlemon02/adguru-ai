#!/usr/bin/env python3
"""
AdGuru AI — Video Annotation & Rendering Script
Takes the original video + critique JSON + voice segments and produces
an annotated critique video with:
  - Glowing amber annotation circles on specific elements
  - ElevenLabs voiceover audio
  - Video pauses while guru speaks
  - Original audio ducked under voiceover
"""

import json
import sys
import os
import subprocess
import tempfile
import shutil
import math

import cv2
import numpy as np

def parse_args():
    if len(sys.argv) < 4:
        print("Usage: annotate_video.py <input_video> <critique_json> <output_video>", file=sys.stderr)
        sys.exit(1)
    return sys.argv[1], sys.argv[2], sys.argv[3]

def get_video_info(video_path):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps
    cap.release()
    return fps, width, height, total_frames, duration

def draw_annotation_circle(frame, x_norm, y_norm, w_norm, h_norm, label, alpha=1.0, pulse=0.0):
    """Draw a glowing amber annotation circle on the frame."""
    h, w = frame.shape[:2]
    cx = int(x_norm * w)
    cy = int(y_norm * h)
    rx = max(20, int(w_norm * w / 2))
    ry = max(20, int(h_norm * h / 2))
    r = max(rx, ry)

    # Pulse effect
    pulse_scale = 1.0 + 0.08 * math.sin(pulse * math.pi * 2)
    r = int(r * pulse_scale)

    # Amber color: BGR = (0, 165, 255)
    amber = (0, 165, 255)
    amber_glow = (0, 100, 180)

    overlay = frame.copy()

    # Outer glow (multiple circles with decreasing opacity)
    for glow_r in [r + 12, r + 7, r + 3]:
        cv2.circle(overlay, (cx, cy), glow_r, amber_glow, 2)
    cv2.addWeighted(overlay, 0.3 * alpha, frame, 1 - 0.3 * alpha, 0, frame)

    # Main circle
    cv2.circle(frame, (cx, cy), r, amber, 3)

    # Label background
    if label:
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.55
        thickness = 1
        (tw, th), _ = cv2.getTextSize(label, font, font_scale, thickness)
        lx = cx - tw // 2
        ly = cy - r - 12
        # Background pill
        cv2.rectangle(frame, (lx - 6, ly - th - 4), (lx + tw + 6, ly + 4),
                      (0, 120, 200), -1)
        cv2.rectangle(frame, (lx - 6, ly - th - 4), (lx + tw + 6, ly + 4),
                      amber, 1)
        cv2.putText(frame, label, (lx, ly), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

    return frame

def get_audio_duration(audio_path):
    """Get duration of an audio file using ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", audio_path],
            capture_output=True, text=True
        )
        return float(result.stdout.strip())
    except:
        return 3.0

def render_video(input_video, critique_data, output_video):
    fps, width, height, total_frames, duration = get_video_info(input_video)
    fps = max(fps, 24)

    critique_points = critique_data.get("critiquePoints", [])
    # Sort by timestamp
    critique_points = sorted(critique_points, key=lambda p: p.get("timestamp", 0))

    # Build a timeline: list of (start_sec, end_sec, point)
    # Each point causes the video to pause for audio_duration seconds
    timeline = []
    for pt in critique_points:
        ts = pt.get("timestamp", 0)
        audio_path = pt.get("audioPath", "")
        audio_dur = get_audio_duration(audio_path) if audio_path and os.path.exists(audio_path) else 3.0
        timeline.append({
            "timestamp": ts,
            "audio_dur": audio_dur,
            "audio_path": audio_path,
            "annotation": pt.get("annotation"),
            "label": pt.get("annotation", {}).get("label", "") if pt.get("annotation") else "",
            "type": pt.get("type", "improvement"),
        })

    tmp_dir = tempfile.mkdtemp(prefix="adguru_render_")
    frames_dir = os.path.join(tmp_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    print(f"[Render] Video: {width}x{height} @ {fps:.1f}fps, {duration:.1f}s", flush=True)
    print(f"[Render] {len(timeline)} critique points", flush=True)

    cap = cv2.VideoCapture(input_video)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    tmp_video = os.path.join(tmp_dir, "annotated_silent.mp4")
    out = cv2.VideoWriter(tmp_video, fourcc, fps, (width, height))

    # Build frame-by-frame output
    # We'll track which critique point is "active" at each frame
    frame_idx = 0
    output_frame_count = 0

    # Pre-compute which original frames map to critique points
    point_frame_map = {}
    for pt in timeline:
        target_frame = int(pt["timestamp"] * fps)
        point_frame_map[target_frame] = pt

    # Audio segments to merge: list of (output_start_sec, audio_path)
    audio_segments = []

    # Track current output time
    output_time = 0.0
    active_annotation = None
    annotation_frames_remaining = 0
    annotation_total_frames = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        current_video_time = frame_idx / fps

        # Check if this frame triggers a critique point
        if frame_idx in point_frame_map:
            pt = point_frame_map[frame_idx]
            audio_dur = pt["audio_dur"]
            audio_path = pt["audio_path"]

            if audio_path and os.path.exists(audio_path):
                # Record audio segment at current output time
                audio_segments.append({
                    "start": output_time,
                    "path": audio_path,
                    "duration": audio_dur,
                })

                # Write pause frames (freeze current frame while audio plays)
                pause_frame_count = int(audio_dur * fps)
                ann = pt.get("annotation")

                for pf in range(pause_frame_count):
                    pause_frame = frame.copy()
                    if ann:
                        pulse = pf / max(pause_frame_count, 1)
                        # Fade in for first 10 frames
                        alpha = min(1.0, pf / 10.0)
                        pause_frame = draw_annotation_circle(
                            pause_frame,
                            ann.get("x", 0.5), ann.get("y", 0.5),
                            ann.get("w", 0.2), ann.get("h", 0.2),
                            pt.get("label", ""),
                            alpha=alpha,
                            pulse=pulse,
                        )
                    out.write(pause_frame)
                    output_frame_count += 1
                    output_time += 1.0 / fps

        # Write the actual video frame (with annotation if still active)
        out.write(frame)
        output_frame_count += 1
        output_time += 1.0 / fps
        frame_idx += 1

    cap.release()
    out.release()

    print(f"[Render] Wrote {output_frame_count} frames ({output_time:.1f}s)", flush=True)

    # ─── Audio mixing ─────────────────────────────────────────
    # Extract original audio
    orig_audio = os.path.join(tmp_dir, "original_audio.aac")
    subprocess.run(
        ["ffmpeg", "-i", input_video, "-vn", "-acodec", "aac", "-b:a", "128k", orig_audio, "-y"],
        capture_output=True
    )

    if audio_segments and os.path.exists(orig_audio):
        # Build a complex ffmpeg filter to mix voiceover + ducked original audio
        # For simplicity: concatenate all voiceover segments into one track
        # then mix with the original audio (ducked)

        # Create silence file for padding
        silence_path = os.path.join(tmp_dir, "silence.mp3")
        subprocess.run(
            ["ffmpeg", "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono",
             "-t", str(output_time), silence_path, "-y"],
            capture_output=True
        )

        # Build filter_complex for audio mixing
        # Input 0: original video audio (stretched to match output duration)
        # Inputs 1..N: voiceover segments at specific timestamps

        inputs = ["-i", orig_audio]
        filter_parts = []
        n_inputs = 1

        for i, seg in enumerate(audio_segments):
            inputs += ["-i", seg["path"]]
            # Delay the voiceover to the correct timestamp
            delay_ms = int(seg["start"] * 1000)
            filter_parts.append(
                f"[{n_inputs}]adelay={delay_ms}|{delay_ms}[v{i}]"
            )
            n_inputs += 1

        # Mix all voiceover segments
        if filter_parts:
            vo_inputs = "".join(f"[v{i}]" for i in range(len(audio_segments)))
            filter_parts.append(
                f"{vo_inputs}amix=inputs={len(audio_segments)}:normalize=0[voiceover]"
            )
            # Duck original audio: reduce to 20% volume, mix with voiceover
            filter_parts.append(
                "[0]volume=0.2[orig_ducked]"
            )
            filter_parts.append(
                "[orig_ducked][voiceover]amix=inputs=2:normalize=0[final_audio]"
            )
            filter_str = ";".join(filter_parts)

            mixed_audio = os.path.join(tmp_dir, "mixed_audio.aac")
            cmd = (
                ["ffmpeg"] + inputs +
                ["-filter_complex", filter_str,
                 "-map", "[final_audio]",
                 "-acodec", "aac", "-b:a", "128k",
                 mixed_audio, "-y"]
            )
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"[Render] Audio mix warning: {result.stderr[-500:]}", flush=True)
                mixed_audio = orig_audio  # fallback to original audio
        else:
            mixed_audio = orig_audio

        # Merge annotated video + mixed audio
        cmd = [
            "ffmpeg",
            "-i", tmp_video,
            "-i", mixed_audio,
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            output_video, "-y"
        ]
    else:
        # No audio: just re-encode video
        cmd = [
            "ffmpeg",
            "-i", tmp_video,
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            output_video, "-y"
        ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[Render] FFmpeg error: {result.stderr[-1000:]}", file=sys.stderr, flush=True)
        raise RuntimeError(f"FFmpeg failed: {result.returncode}")

    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(f"[Render] Done! Output: {output_video}", flush=True)

if __name__ == "__main__":
    input_video, critique_json_path, output_video = parse_args()

    with open(critique_json_path, "r") as f:
        critique_data = json.load(f)

    render_video(input_video, critique_data, output_video)
