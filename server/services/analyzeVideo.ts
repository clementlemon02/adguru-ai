/**
 * AdGuru AI — Video Analysis Service (Enhanced)
 * Uses GPT-4o Vision to analyze extracted video frames and produce a
 * timestamped marketing critique with annotation coordinates, zoom effects,
 * subtitle text, and conversational voice script.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export interface CritiquePoint {
  timestamp: number;        // seconds into the video
  timecode: string;         // "MM:SS" display string
  type: "strength" | "improvement" | "warning";
  title: string;            // short label e.g. "Strong Hook"
  spokenScript: string;     // conversational, interactive spoken text for ElevenLabs
  subtitleText: string;     // shorter subtitle version (max 12 words per line)
  zoomEffect: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "none";
  annotation?: {
    x: number;              // 0-1 normalized x center
    y: number;              // 0-1 normalized y center
    w: number;              // 0-1 normalized width
    h: number;              // 0-1 normalized height
    label: string;
  };
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
  critiquePoints: CritiquePoint[];
  videoDuration: number;
}

/** Extract key frames from video at regular intervals */
function extractFrames(videoPath: string, tmpDir: string, maxFrames = 10): string[] {
  const framesDir = path.join(tmpDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const durationOutput = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
    { encoding: "utf8" }
  ).trim();
  const duration = parseFloat(durationOutput) || 30;

  const interval = Math.max(1, Math.floor(duration / maxFrames));
  const framePaths: string[] = [];

  for (let i = 0; i < maxFrames; i++) {
    const t = Math.min(i * interval, duration - 0.5);
    const framePath = path.join(framesDir, `frame_${String(i).padStart(3, "0")}_t${Math.floor(t)}.jpg`);
    try {
      execSync(
        `ffmpeg -ss ${t} -i "${videoPath}" -vframes 1 -q:v 2 -vf "scale=640:-1" "${framePath}" -y 2>/dev/null`,
        { encoding: "utf8" }
      );
      if (fs.existsSync(framePath)) framePaths.push(framePath);
    } catch { /* skip failed frame */ }
  }

  return framePaths;
}

function imageToBase64(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return `data:image/jpeg;base64,${data.toString("base64")}`;
}

async function callGPT4oVision(frames: string[], videoDuration: number): Promise<AnalysisReport> {
  const frameMessages = frames.map((fp) => {
    const tSec = parseInt(fp.match(/_t(\d+)\.jpg$/)?.[1] ?? "0");
    return [
      {
        type: "text" as const,
        text: `Frame at ${Math.floor(tSec / 60)}:${String(tSec % 60).padStart(2, "0")} (${tSec}s):`,
      },
      {
        type: "image_url" as const,
        image_url: { url: imageToBase64(fp), detail: "low" as const },
      },
    ];
  }).flat();

  const systemPrompt = `You are Alex, an elite marketing consultant and creative director with 20+ years of experience at top ad agencies. You are reviewing a client's marketing video ad in real-time, like a live creative review session. You are direct, warm, encouraging about strengths, and constructively honest about weaknesses. You speak like a real person — not a robot reading a report.

Your job is to produce a JSON analysis that will be used to:
1. Draw colored annotation circles on the video (green for strengths, red/orange for improvements)
2. Apply zoom/pan camera effects to draw attention to specific elements
3. Generate a spoken voiceover using ElevenLabs (your "spokenScript" field)
4. Burn subtitles into the video (your "subtitleText" field)

Return ONLY valid JSON matching this exact schema:
{
  "overallScore": <0-100>,
  "hookScore": <0-100>,
  "ctaScore": <0-100>,
  "visualScore": <0-100>,
  "pacingScore": <0-100>,
  "emotionScore": <0-100>,
  "summary": "<2-3 sentence executive summary in Alex's voice>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"],
  "critiquePoints": [
    {
      "timestamp": <seconds as number>,
      "timecode": "<MM:SS>",
      "type": "strength" | "improvement" | "warning",
      "title": "<short 3-5 word label>",
      "spokenScript": "<Alex speaking conversationally — 2-4 sentences. Use natural speech patterns: 'Okay so...', 'Here's the thing...', 'I love what they did here...', 'This is where it gets tricky...'. Reference what you actually SEE in the frame. Be specific and human.>",
      "subtitleText": "<12 words max, punchy subtitle version of the key insight>",
      "zoomEffect": "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "none",
      "annotation": {
        "x": <0.0-1.0 normalized center x of the element>,
        "y": <0.0-1.0 normalized center y of the element>,
        "w": <0.0-1.0 normalized width — typically 0.2-0.5>,
        "h": <0.0-1.0 normalized height — typically 0.15-0.4>,
        "label": "<2-4 word annotation label>"
      }
    }
  ]
}

Rules for critiquePoints:
- Generate 6-9 points spread across the video duration
- Mix strengths AND improvements — don't just criticize. Celebrate what works!
- For "strength" type: use zoom_in to highlight the good element, green circle
- For "improvement" type: use zoom_in on the problem area, then zoom_out to show context
- For "warning" type: use zoom_out to show the full picture
- spokenScript must sound like Alex is REACTING in real time, not reading a report
- subtitleText should be the single most important takeaway from that point (max 12 words)
- Always annotate a specific visual element (button, face, text, logo, product)
- Video duration is ${videoDuration} seconds`;

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
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Review this marketing video ad as Alex. The video is ${videoDuration} seconds long. I'm showing you ${frames.length} key frames. Give me your live creative review as JSON.`,
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

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from GPT-4o");

  const parsed = JSON.parse(content) as AnalysisReport;
  parsed.videoDuration = videoDuration;
  return parsed;
}

export async function analyzeVideoFile(videoPath: string): Promise<AnalysisReport> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adguru-"));

  try {
    const durationOutput = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { encoding: "utf8" }
    ).trim();
    const videoDuration = parseFloat(durationOutput) || 30;

    const frames = extractFrames(videoPath, tmpDir, 10);
    if (frames.length === 0) throw new Error("Could not extract frames from video");

    const report = await callGPT4oVision(frames, videoDuration);
    return report;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
