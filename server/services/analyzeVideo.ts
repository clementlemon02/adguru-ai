/**
 * AdGuru AI — Video Analysis Service
 * Uses GPT-4o Vision to analyze extracted video frames and produce a
 * timestamped marketing critique with annotation coordinates.
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
  description: string;      // full spoken critique text
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
function extractFrames(videoPath: string, tmpDir: string, maxFrames = 8): string[] {
  const framesDir = path.join(tmpDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  // Get video duration
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

/** Convert image file to base64 data URL */
function imageToBase64(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return `data:image/jpeg;base64,${data.toString("base64")}`;
}

/** Call GPT-4o with frames and get structured marketing critique */
async function callGPT4oVision(frames: string[], videoDuration: number): Promise<AnalysisReport> {
  const frameMessages = frames.map((fp, i) => {
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

  const systemPrompt = `You are a world-class marketing creative director and video ad expert with 20+ years of experience. 
You analyze marketing video ads with brutal honesty and expert precision.
You identify what works, what doesn't, and exactly why — with specific timestamps and visual coordinates.

Your analysis must be returned as valid JSON matching this exact schema:
{
  "overallScore": <0-100>,
  "hookScore": <0-100>,
  "ctaScore": <0-100>,
  "visualScore": <0-100>,
  "pacingScore": <0-100>,
  "emotionScore": <0-100>,
  "summary": "<2-3 sentence executive summary>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"],
  "critiquePoints": [
    {
      "timestamp": <seconds as number>,
      "timecode": "<MM:SS>",
      "type": "strength" | "improvement" | "warning",
      "title": "<short 3-5 word label>",
      "description": "<2-3 sentences of spoken critique — conversational, direct, expert>",
      "annotation": {
        "x": <0.0-1.0 normalized center x>,
        "y": <0.0-1.0 normalized center y>,
        "w": <0.0-1.0 normalized width>,
        "h": <0.0-1.0 normalized height>,
        "label": "<short annotation label>"
      }
    }
  ]
}

Rules:
- Generate 5-8 critiquePoints spread across the video duration
- Each critiquePoint MUST have an annotation pointing to a specific visual element
- Annotations should highlight: CTA buttons, headlines, product shots, faces, logos
- Descriptions should be conversational, like a real person talking — not bullet points
- Be specific: mention exact visual elements you can see in the frames
- Video duration is ${videoDuration} seconds`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min timeout

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    signal: controller.signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 3000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this marketing video ad. The video is ${videoDuration} seconds long. I'm showing you ${frames.length} key frames. Provide your expert marketing critique as JSON.`,
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

/** Main entry point: analyze a video file and return structured report */
export async function analyzeVideoFile(videoPath: string): Promise<AnalysisReport> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adguru-"));

  try {
    // Get video duration
    const durationOutput = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { encoding: "utf8" }
    ).trim();
    const videoDuration = parseFloat(durationOutput) || 30;

    // Extract frames
    const frames = extractFrames(videoPath, tmpDir, 8);
    if (frames.length === 0) throw new Error("Could not extract frames from video");

    // Analyze with GPT-4o
    const report = await callGPT4oVision(frames, videoDuration);
    return report;
  } finally {
    // Cleanup temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
