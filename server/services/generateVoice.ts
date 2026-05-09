/**
 * AdGuru AI — ElevenLabs Voice Synthesis Service
 * Converts critique text to professional voiceover audio.
 */
import fs from "fs";
import path from "path";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Use a professional, authoritative male voice (Adam)
const VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam — deep, professional

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
  const timeout = setTimeout(() => controller.abort(), 60_000); // 60s timeout

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
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    }
  );

  clearTimeout(timeout);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} ${err}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, audioBuffer);

  // Get audio duration using ffprobe
  try {
    const { execSync } = await import("child_process");
    const durationStr = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${outputPath}"`,
      { encoding: "utf8" }
    ).trim();
    return parseFloat(durationStr) || 3;
  } catch {
    return 3; // fallback duration
  }
}

/** Generate all voiceover segments for a critique */
export async function generateAllVoiceSegments(
  critiquePoints: Array<{ timestamp: number; description: string; title: string }>,
  outputDir: string
): Promise<VoiceSegment[]> {
  fs.mkdirSync(outputDir, { recursive: true });
  const segments: VoiceSegment[] = [];

  for (let i = 0; i < critiquePoints.length; i++) {
    const point = critiquePoints[i];
    const outputPath = path.join(outputDir, `segment_${i}.mp3`);

    // Craft a natural-sounding spoken intro
    const spokenText = `${point.title}. ${point.description}`;

    try {
      const duration = await generateVoiceSegment(spokenText, outputPath);
      segments.push({
        timestamp: point.timestamp,
        audioPath: outputPath,
        audioDuration: duration,
      });
    } catch (err) {
      console.error(`[ElevenLabs] Failed to generate segment ${i}:`, err);
      // Create a silent placeholder if TTS fails
      segments.push({
        timestamp: point.timestamp,
        audioPath: "",
        audioDuration: 0,
      });
    }
  }

  return segments;
}
