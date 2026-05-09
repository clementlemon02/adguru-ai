/**
 * AdGuru AI — GPT-4o Video Analysis Service (v3 — Flowing Narrative)
 *
 * Generates a flowing, natural voiceover critique — like a human consultant
 * doing a live screen-recording review. The video plays continuously;
 * the AI speaks naturally over it at specific timestamps.
 *
 * Key changes from v2:
 * - No zoom effects (removed entirely)
 * - subtitleChunks instead of subtitleText: word-synced short phrases
 * - spokenScript is conversational narrative, not isolated bullet points
 * - critiqueSegments (renamed from critiquePoints) sorted by timestamp
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export interface SubtitleChunk {
  text: string;       // 4–8 words matching exactly what is spoken
  offsetSec: number;  // seconds after this segment starts when this chunk appears
}

export interface CritiqueSegment {
  timestamp: number;           // seconds into the video when AI starts speaking
  type: "strength" | "improvement" | "observation";
  title: string;               // short label for the banner (max 5 words)
  spokenScript: string;        // full natural spoken sentence(s)
  subtitleChunks: SubtitleChunk[];  // word-synced subtitle phrases
  annotation?: {
    x: number; y: number; w: number; h: number;
    label: string;
  };
  audioDuration?: number;      // filled in later by voice service
  audioPath?: string;          // filled in later by voice service
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
  // Legacy alias for backward compat
  critiquePoints?: CritiqueSegment[];
}

/** Extract evenly-spaced frames from the video for GPT-4o vision */
function extractFrames(videoPath: string, tmpDir: string, maxFrames = 10): string[] {
  const framesDir = path.join(tmpDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const durationOutput = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
    { encoding: "utf8", env: { ...process.env, PYTHONHOME: undefined, PYTHONPATH: undefined } }
  ).trim();
  const duration = parseFloat(durationOutput) || 30;

  const interval = Math.max(1, duration / maxFrames);
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

async function callGPT4oVision(frames: string[], videoDuration: number): Promise<AnalysisReport> {
  const frameMessages = frames.map((fp) => {
    const tMatch = fp.match(/_t([\d.]+)\.jpg$/);
    const tSec = parseFloat(tMatch?.[1] ?? "0");
    return [
      { type: "text" as const, text: `Frame at ${tSec.toFixed(1)}s:` },
      { type: "image_url" as const, image_url: { url: imageToBase64(fp), detail: "low" as const } },
    ];
  }).flat();

  const systemPrompt = `You are Alex — a world-class marketing consultant and creative director with 20 years of experience. You are doing a LIVE screen-recording review of a client's marketing video ad, talking naturally as the video plays.

IMPORTANT: You are NOT pausing the video. You are NOT replaying clips. The video plays CONTINUOUSLY and you speak over it at specific moments. Think of it like a commentary track on a DVD — you talk while the video keeps rolling.

Your speech is natural, direct, human. You use real speech patterns:
- "Okay so right here..."
- "Watch what happens at this point..."
- "Here's what I love about this..."
- "And this is where they lose me..."
- "Now look at the bottom of the screen..."
- "See that? That's exactly what you want."
- "This is the problem — nobody's going to..."

You celebrate strengths ENTHUSIASTICALLY and address improvements CONSTRUCTIVELY.

Return ONLY valid JSON with this exact schema:
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
      "timestamp": <seconds when Alex starts speaking — must be >= 0 and < ${videoDuration}>,
      "type": "strength" | "improvement" | "observation",
      "title": "<max 5 words — shown in banner>",
      "spokenScript": "<2-4 natural spoken sentences. Alex is reacting to what's on screen RIGHT NOW. Conversational, specific, human. No bullet points, no formal language.>",
      "subtitleChunks": [
        { "text": "<4-8 words matching exactly what Alex says>", "offsetSec": 0 },
        { "text": "<next spoken phrase>", "offsetSec": <estimated seconds, ~2.5 words/sec> }
      ],
      "annotation": {
        "x": <0.0-1.0 center x of element being discussed>,
        "y": <0.0-1.0 center y>,
        "w": <0.0-1.0 width, typically 0.2-0.5>,
        "h": <0.0-1.0 height, typically 0.15-0.4>,
        "label": "<2-3 word label>"
      }
    }
  ]
}

RULES:
- Generate 5–8 segments spread naturally across the video timeline
- Segments must be in chronological order by timestamp
- Space segments at least 2 seconds apart
- Mix strengths AND improvements — don't just criticize
- subtitleChunks: break spokenScript into natural spoken phrases of 4–8 words each. Estimate offsetSec based on ~2.5 words per second speech rate
- annotation is REQUIRED for every segment — point at a specific visual element
- Video duration is ${videoDuration.toFixed(1)} seconds`;

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
      model: "gpt-4o",
      max_tokens: 4000,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Review this marketing video ad as Alex. The video is ${videoDuration.toFixed(1)} seconds long. Here are ${frames.length} frames from the video. Give me your live commentary critique as JSON.`,
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
    throw new Error(`GPT-4o API error: ${response.status} ${err}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from GPT-4o");

  const parsed = JSON.parse(content) as AnalysisReport;
  parsed.videoDuration = videoDuration;

  // Normalize segments
  if (!parsed.critiqueSegments && (parsed as unknown as { critiquePoints?: CritiqueSegment[] }).critiquePoints) {
    parsed.critiqueSegments = (parsed as unknown as { critiquePoints: CritiqueSegment[] }).critiquePoints;
  }
  if (!Array.isArray(parsed.critiqueSegments)) {
    parsed.critiqueSegments = [];
  }

  // Sort by timestamp and clamp
  parsed.critiqueSegments = parsed.critiqueSegments
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(seg => ({
      ...seg,
      timestamp: Math.max(0, Math.min(seg.timestamp, videoDuration - 1)),
      subtitleChunks: Array.isArray(seg.subtitleChunks) && seg.subtitleChunks.length > 0
        ? seg.subtitleChunks
        : [{ text: seg.spokenScript.slice(0, 40), offsetSec: 0 }],
    }));

  // Also expose as critiquePoints for backward compat with pipeline.ts
  parsed.critiquePoints = parsed.critiqueSegments;

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

    const frames = extractFrames(videoPath, tmpDir, 10);
    if (frames.length === 0) throw new Error("Could not extract frames from video");

    console.log(`[GPT-4o] Analyzing ${frames.length} frames from ${videoDuration.toFixed(1)}s video`);
    const report = await callGPT4oVision(frames, videoDuration);
    console.log(`[GPT-4o] Generated ${report.critiqueSegments.length} critique segments`);
    return report;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
