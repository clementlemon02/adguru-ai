/**
 * AdGuru AI — GPT-5.5 Video Analysis Service (v5 — Pause & Resume)
 *
 * Two-pass approach:
 *   Pass 1: AI watches video frames and writes a free-form review plan
 *           (what to say, when to pause, what element to highlight)
 *   Pass 2: AI converts plan into structured critiqueSegments with
 *           pauseAtTimestamp, full natural spoken scripts, and subtitleChunks
 *
 * The output video PAUSES at each segment's timestamp while the AI speaks,
 * then RESUMES. The output video is LONGER than the original.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export interface SubtitleChunk {
  text: string;       // 5–8 words matching exactly what is spoken
  offsetSec: number;  // seconds after this segment's voiceover starts
}

export interface CritiqueSegment {
  pauseAtTimestamp: number;        // seconds into the ORIGINAL video when it pauses
  timestamp: number;               // alias for pauseAtTimestamp (backward compat)
  type: "strength" | "improvement" | "observation";
  title: string;                   // short label for the banner (max 4 words)
  spokenScript: string;            // full natural spoken paragraph (4–8 sentences)
  subtitleChunks: SubtitleChunk[]; // word-synced subtitle phrases covering full script
  annotation?: {
    x: number; y: number; w: number; h: number;
    label: string;
  };
  audioDuration?: number;          // filled in later by voice service
  audioPath?: string;              // filled in later by voice service
}

export interface AnalysisReport {
  overallScore: number;
  hookScore: number;
  ctaScore: number;
  visualScore: number;
  pacingScore: number;
  emotionScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  videoDuration: number;
  critiqueSegments: CritiqueSegment[];
  critiquePoints?: CritiqueSegment[]; // backward compat alias
}

/** Extract evenly-spaced frames from the video for GPT-4o vision */
function extractFrames(videoPath: string, tmpDir: string, maxFrames = 12): string[] {
  const framesDir = path.join(tmpDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const durationOutput = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
    { encoding: "utf8", env: { ...process.env, PYTHONHOME: undefined, PYTHONPATH: undefined } }
  ).trim();
  const duration = parseFloat(durationOutput) || 30;

  const interval = Math.max(0.5, duration / maxFrames);
  const framePaths: string[] = [];

  for (let i = 0; i < maxFrames; i++) {
    const t = Math.min(i * interval, duration - 0.1);
    const framePath = path.join(framesDir, `frame_${String(i).padStart(3, "0")}_t${t.toFixed(1)}.jpg`);
    try {
      execSync(
        `ffmpeg -ss ${t.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 3 -vf "scale=640:-1" "${framePath}" -y 2>/dev/null`,
        { encoding: "utf8", env: { ...process.env, PYTHONHOME: undefined, PYTHONPATH: undefined } }
      );
      if (fs.existsSync(framePath)) framePaths.push(framePath);
    } catch { /* skip failed frame */ }
  }

  return framePaths;
}

function imageToBase64(filePath: string): string {
  return `data:image/jpeg;base64,${fs.readFileSync(filePath).toString("base64")}`;
}

/** Pass 1: AI watches video and writes a free-form review plan */
async function pass1ReviewPlan(frames: string[], videoDuration: number): Promise<string> {
  const frameMessages = frames.map((fp) => {
    const tMatch = fp.match(/_t([\d.]+)\.jpg$/);
    const tSec = parseFloat(tMatch?.[1] ?? "0");
    return [
      { type: "text" as const, text: `Frame at ${tSec.toFixed(1)}s:` },
      { type: "image_url" as const, image_url: { url: imageToBase64(fp), detail: "low" as const } },
    ];
  }).flat();

  const systemPrompt = `You are Alex — a world-class marketing consultant and creative director with 20 years of experience reviewing ad creatives.

You are watching a ${videoDuration.toFixed(1)}-second marketing video. Your job is to write a REVIEW PLAN — a natural, thoughtful analysis of what you see.

Write your plan as if you are thinking out loud to yourself before recording your commentary. Cover:
1. Your overall first impression of the ad
2. Specific moments that stand out (good or bad) — note the approximate timestamp
3. What you want to say about each moment — write it naturally, as if speaking to the client
4. How many pause points make sense for this video (typically 3-5 pauses for a short video, more for longer ones)

Be specific about what you see in the frames. Reference actual visual elements, text, products, people, colors, pacing.

Write in plain prose — no JSON, no bullet points. Just your honest, expert thinking.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    signal: controller.signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5.5",
      max_tokens: 2000,
      temperature: 0.8,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Here are ${frames.length} frames from the video (${videoDuration.toFixed(1)}s total). Write your review plan.`,
            },
            ...frameMessages,
          ],
        },
      ],
    }),
  });

  clearTimeout(timeout);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GPT-4o Pass 1 API error: ${response.status} ${err}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Pass 2: Convert review plan into structured critiqueSegments */
async function pass2StructuredCritique(
  reviewPlan: string,
  frames: string[],
  videoDuration: number
): Promise<AnalysisReport> {
  const frameMessages = frames.map((fp) => {
    const tMatch = fp.match(/_t([\d.]+)\.jpg$/);
    const tSec = parseFloat(tMatch?.[1] ?? "0");
    return [
      { type: "text" as const, text: `Frame at ${tSec.toFixed(1)}s:` },
      { type: "image_url" as const, image_url: { url: imageToBase64(fp), detail: "low" as const } },
    ];
  }).flat();

  const systemPrompt = `You are Alex — a world-class marketing consultant. You have already reviewed a ${videoDuration.toFixed(1)}-second marketing video and written a review plan. Now convert that plan into structured JSON for the critique video renderer.

IMPORTANT — HOW THE RENDERER WORKS:
- The original video plays normally until it reaches a "pauseAtTimestamp"
- At that point, the video FREEZES on that exact frame
- While frozen, Alex's voiceover plays in FULL — no cutting off, no rushing
- Subtitles appear word-by-word during the frozen section
- An annotation circle highlights the element being discussed
- After the voiceover finishes, the video RESUMES from where it paused
- The output video will be LONGER than the original (original + all voiceover durations)

This means Alex can speak for as long as needed at each pause point. There is NO time pressure. The video waits for Alex to finish.

Return ONLY valid JSON:
{
  "overallScore": <0-100>,
  "hookScore": <0-100>,
  "ctaScore": <0-100>,
  "visualScore": <0-100>,
  "pacingScore": <0-100>,
  "emotionScore": <0-100>,
  "summary": "<2-3 sentence verdict in Alex's voice — direct, human, specific>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"],
  "videoDuration": ${videoDuration},
  "critiqueSegments": [
    {
      "pauseAtTimestamp": <seconds into the ORIGINAL video when it should pause — must be > 0 and < ${(videoDuration - 0.5).toFixed(1)}>,
      "type": "strength" | "improvement" | "observation",
      "title": "<max 4 words — shown in banner during pause>",
      "spokenScript": "<Alex's COMPLETE spoken commentary for this pause. 4-8 natural sentences. This is what plays while the video is frozen. Write it as Alex would actually say it — conversational, specific, referencing what's on screen. NO bullet points. NO lists. Just natural speech. The renderer will wait for this to finish before resuming the video.>",
      "subtitleChunks": [
        { "text": "<5-8 words matching exactly what Alex says>", "offsetSec": 0 },
        { "text": "<next phrase>", "offsetSec": <cumulative seconds at ~2.5 words/sec> }
      ],
      "annotation": {
        "x": <0.0-1.0 center x of element being discussed on the frozen frame>,
        "y": <0.0-1.0 center y>,
        "w": <0.0-1.0 width, typically 0.2-0.45>,
        "h": <0.0-1.0 height, typically 0.15-0.35>,
        "label": "<2-3 word label>"
      }
    }
  ]
}

RULES:
- pauseAtTimestamp values must be in chronological order (ascending)
- Each pauseAtTimestamp must be unique (no two pauses at the same second)
- Minimum 1 second between consecutive pauseAtTimestamp values
- subtitleChunks must cover the ENTIRE spokenScript — break it into 5-8 word phrases
- annotation is REQUIRED for every segment
- Mix strengths AND improvements — at least 1 of each type
- The number of segments should match what the review plan identified as natural pause points`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    signal: controller.signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5.5",
      max_tokens: 5000,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Here is my review plan for this ${videoDuration.toFixed(1)}-second video:\n\n${reviewPlan}\n\nHere are the video frames for reference. Convert this plan into structured JSON.`,
            },
            ...frameMessages,
          ],
        },
      ],
    }),
  });

  clearTimeout(timeout);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GPT-4o Pass 2 API error: ${response.status} ${err}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from GPT-4o Pass 2");

  const parsed = JSON.parse(content) as AnalysisReport;
  parsed.videoDuration = videoDuration;

  // Normalize: support both pauseAtTimestamp and legacy timestamp field
  if (!Array.isArray(parsed.critiqueSegments)) {
    parsed.critiqueSegments = [];
  }

  // Sort by pauseAtTimestamp, normalize fields
  parsed.critiqueSegments = parsed.critiqueSegments
    .sort((a, b) => (a.pauseAtTimestamp ?? a.timestamp ?? 0) - (b.pauseAtTimestamp ?? b.timestamp ?? 0))
    .map(seg => {
      const pauseAt = seg.pauseAtTimestamp ?? seg.timestamp ?? 0;
      return {
        ...seg,
        pauseAtTimestamp: Math.max(0.5, Math.min(pauseAt, videoDuration - 0.5)),
        timestamp: Math.max(0.5, Math.min(pauseAt, videoDuration - 0.5)), // backward compat
        subtitleChunks: Array.isArray(seg.subtitleChunks) && seg.subtitleChunks.length > 0
          ? seg.subtitleChunks
          : [{ text: seg.spokenScript.slice(0, 50), offsetSec: 0 }],
      };
    })
    // Deduplicate: ensure at least 1 second between pause points
    .reduce((acc: CritiqueSegment[], seg) => {
      if (acc.length === 0) return [seg];
      const prev = acc[acc.length - 1];
      if ((seg.pauseAtTimestamp - prev.pauseAtTimestamp) < 1.0) {
        console.log(`[GPT-4o] Deduplicating segment at ${seg.pauseAtTimestamp}s (too close to ${prev.pauseAtTimestamp}s)`);
        return acc;
      }
      return [...acc, seg];
    }, []);

  // Also expose as critiquePoints for backward compat with pipeline.ts
  parsed.critiquePoints = parsed.critiqueSegments;

  console.log(`[GPT-4o] Generated ${parsed.critiqueSegments.length} pause points for ${videoDuration.toFixed(1)}s video`);
  parsed.critiqueSegments.forEach((seg, i) => {
    console.log(`  [${i+1}] Pause at ${seg.pauseAtTimestamp.toFixed(1)}s — ${seg.type}: "${seg.title}"`);
  });

  return parsed;
}

export async function analyzeVideoFile(videoPath: string): Promise<AnalysisReport> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adguru-"));

  try {
    const durationOutput = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { encoding: "utf8", env: { ...process.env, PYTHONHOME: undefined, PYTHONPATH: undefined } }
    ).trim();
    const videoDuration = parseFloat(durationOutput) || 30;

    const frames = extractFrames(videoPath, tmpDir, 12);
    if (frames.length === 0) throw new Error("Could not extract frames from video");

    console.log(`[GPT-4o] Pass 1: Planning review for ${videoDuration.toFixed(1)}s video (${frames.length} frames)`);
    const reviewPlan = await pass1ReviewPlan(frames, videoDuration);
    console.log(`[GPT-4o] Pass 1 complete. Plan length: ${reviewPlan.length} chars`);

    console.log(`[GPT-4o] Pass 2: Converting plan to structured critique`);
    const report = await pass2StructuredCritique(reviewPlan, frames, videoDuration);
    console.log(`[GPT-4o] Pass 2 complete. ${report.critiqueSegments.length} segments generated`);

    return report;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
