/**
 * AdGuru AI — ElevenLabs Voice Synthesis Service (Enhanced)
 * Converts critique spoken scripts to expressive, conversational voiceover audio.
 * Uses "Alex" persona — warm, direct, expert marketing consultant.
 */
import fs from "fs";
import path from "path";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// "Daniel" — articulate, warm, conversational British voice — great for consulting
// Fallback: "Adam" (pNInz6obpgDQGcFmaJgB) if Daniel unavailable
const VOICE_ID = "onwK4e9ZLuTAKqWW03F9"; // Daniel

export interface VoiceSegment {
  timestamp: number;
  audioPath: string;
  audioDuration: number;
}

/** Generate a single voiceover audio file from text */
export async function generateVoiceSegment(
  text: string,
  outputPath: string
): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY!,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2", // faster + more expressive than monolingual_v1
        voice_settings: {
          stability: 0.35,          // lower = more expressive, natural variation
          similarity_boost: 0.75,
          style: 0.45,              // adds personality and energy
          use_speaker_boost: true,
        },
      }),
    }
  );

  clearTimeout(timeout);

  if (!response.ok) {
    // Fallback to Adam voice if Daniel fails
    const fallbackResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY!,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
            style: 0.35,
            use_speaker_boost: true,
          },
        }),
      }
    );
    if (!fallbackResp.ok) {
      const err = await fallbackResp.text();
      throw new Error(`ElevenLabs API error: ${fallbackResp.status} ${err}`);
    }
    const audioBuffer = Buffer.from(await fallbackResp.arrayBuffer());
    fs.writeFileSync(outputPath, audioBuffer);
    return await getAudioDuration(outputPath);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, audioBuffer);
  return await getAudioDuration(outputPath);
}

async function getAudioDuration(outputPath: string): Promise<number> {
  try {
    const { execSync } = await import("child_process");
    const durationStr = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${outputPath}"`,
      { encoding: "utf8" }
    ).trim();
    return parseFloat(durationStr) || 3;
  } catch {
    return 3;
  }
}

/** Generate all voiceover segments for a critique */
export async function generateAllVoiceSegments(
  critiquePoints: Array<{ timestamp: number; spokenScript?: string; description?: string; title: string }>,
  outputDir: string
): Promise<VoiceSegment[]> {
  fs.mkdirSync(outputDir, { recursive: true });
  const segments: VoiceSegment[] = [];

  for (let i = 0; i < critiquePoints.length; i++) {
    const point = critiquePoints[i];
    const outputPath = path.join(outputDir, `segment_${i}.mp3`);

    // Use spokenScript if available (new format), fall back to description (old format)
    const spokenText = point.spokenScript ?? `${point.title}. ${point.description ?? ""}`;

    try {
      const duration = await generateVoiceSegment(spokenText, outputPath);
      segments.push({
        timestamp: point.timestamp,
        audioPath: outputPath,
        audioDuration: duration,
      });
    } catch (err) {
      console.error(`[ElevenLabs] Failed to generate segment ${i}:`, err);
      segments.push({
        timestamp: point.timestamp,
        audioPath: "",
        audioDuration: 0,
      });
    }
  }

  return segments;
}
