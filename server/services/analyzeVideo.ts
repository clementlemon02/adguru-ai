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

  // Scale segment count to video duration — fewer segments = smoother, more professional feel
  const maxSegments = videoDuration < 20 ? 3 : videoDuration < 40 ? 4 : videoDuration < 60 ? 5 : 6;
  const minSpacingSec = Math.max(5, Math.floor(videoDuration / (maxSegments + 1)));

  const systemPrompt = `You are Alex — a world-class marketing consultant and creative director with 20 years of experience. You are doing a LIVE screen-recording review of a client's marketing video ad, talking naturally as the video plays.

IMPORTANT: You are NOT pausing the video. You are NOT replaying clips. The video plays CONTINUOUSLY and you speak over it at specific moments. Think of it like a commentary track on a DVD — you talk while the video keeps rolling.

Your speech is natural, direct, human. You speak in FULL PARAGRAPHS — not bullet points. Each time you speak, you say 4-6 sentences that flow naturally together. You take your time. You don't rush. You let the video breathe between your comments.

You use real speech patterns:
- "Okay so right here, I want to point out something..."
- "Watch what happens at this point — this is where it gets interesting..."
- "Here's what I love about this. The way they've framed the product..."
- "And this is where they lose me. You've got about three seconds on social media..."
- "Now look at this — see how the lighting draws your eye? That's intentional."
- "This is the problem. Nobody watching this on their phone is going to..."

You celebrate strengths ENTHUSIASTICALLY and address improvements CONSTRUCTIVELY. You are specific — you reference exactly what's on screen.

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
      "timestamp": <seconds when Alex starts speaking — must be >= 1 and < ${(videoDuration - 3).toFixed(1)}>,
      "type": "strength" | "improvement" | "observation",
      "title": "<max 4 words — shown in banner>",
      "spokenScript": "<4-6 natural spoken sentences in a single flowing paragraph. Alex is reacting to what's on screen RIGHT NOW. Conversational, specific, human. NO bullet points. NO lists. Just natural speech.>",
      "subtitleChunks": [
        { "text": "<5-8 words matching exactly what Alex says>", "offsetSec": 0 },
        { "text": "<next spoken phrase, 5-8 words>", "offsetSec": <seconds, ~2.5 words/sec> },
        { "text": "<continue until full script is covered>", "offsetSec": <cumulative seconds> }
      ],
      "annotation": {
        "x": <0.0-1.0 center x of the specific element being discussed>,
        "y": <0.0-1.0 center y>,
        "w": <0.0-1.0 width, typically 0.2-0.45>,
        "h": <0.0-1.0 height, typically 0.15-0.35>,
        "label": "<2-3 word label>"
      }
    }
  ]
}

CRITICAL RULES — FOLLOW EXACTLY:
1. Generate EXACTLY ${maxSegments} segments (no more, no less)
2. Space segments AT LEAST ${minSpacingSec} seconds apart
3. First segment must start at least 1 second in
4. Last segment must end at least 3 seconds before the video ends
5. Mix strengths AND improvements — at least 1 of each type
6. Each spokenScript must be 4-6 sentences (enough to fill ${minSpacingSec}+ seconds of speaking time)
7. subtitleChunks: break spokenScript into natural phrases of 5-8 words each, covering the ENTIRE script
8. annotation is REQUIRED for every segment — point at a specific visual element on screen
9. Video duration is ${videoDuration.toFixed(1)} seconds
10. NEVER put two segments closer than ${minSpacingSec} seconds apart — the video needs breathing room between comments`;

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

  // Enforce: sort, clamp, minimum spacing, max count
  const enforcedMaxSegments = videoDuration < 20 ? 3 : videoDuration < 40 ? 4 : videoDuration < 60 ? 5 : 6;
  const enforcedMinSpacing = Math.max(5, Math.floor(videoDuration / (enforcedMaxSegments + 1)));

  parsed.critiqueSegments = parsed.critiqueSegments
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(seg => ({
      ...seg,
      timestamp: Math.max(1, Math.min(seg.timestamp, videoDuration - 3)),
      subtitleChunks: Array.isArray(seg.subtitleChunks) && seg.subtitleChunks.length > 0
        ? seg.subtitleChunks
        : [{ text: seg.spokenScript.slice(0, 40), offsetSec: 0 }],
    }))
    // Enforce minimum spacing: drop segments that are too close to the previous one
    .reduce((acc: CritiqueSegment[], seg) => {
      if (acc.length === 0) return [seg];
      const prev = acc[acc.length - 1];
      if (seg.timestamp - prev.timestamp < enforcedMinSpacing) {
        console.log(`[GPT-4o] Dropping segment at ${seg.timestamp}s (too close to ${prev.timestamp}s, min spacing ${enforcedMinSpacing}s)`);
        return acc;
      }
      return [...acc, seg];
    }, [])
    // Cap at max segments
    .slice(0, enforcedMaxSegments);

  console.log(`[GPT-4o] After enforcement: ${parsed.critiqueSegments.length} segments (max ${enforcedMaxSegments}, min spacing ${enforcedMinSpacing}s)`);

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
