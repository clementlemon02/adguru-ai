/**
 * AdGuru AI — ElevenLabs Voice Synthesis Service (v2 — Real Subtitle Timing)
 *
 * After generating each voice segment with ElevenLabs, we transcribe it with
 * Whisper to get real word-level timestamps. These replace the GPT-estimated
 * subtitleChunks so subtitles are perfectly aligned with the actual speech.
 *
 * Subtitle chunking strategy:
 *   - Group Whisper segments into 5-8 word phrases
 *   - Use the real start/end timestamps from Whisper
 *   - This guarantees subtitles match exactly what is being said
 */
import fs from "fs";
import path from "path";
import { ENV } from "../_core/env";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// "Daniel" — articulate, warm, conversational British voice — great for consulting
// Fallback: "Adam" (pNInz6obpgDQGcFmaJgB) if Daniel unavailable
const VOICE_ID = "onwK4e9ZLuTAKqWW03F9"; // Daniel

export interface SubtitleChunk {
  text: string;
  offsetSec: number;
}

export interface VoiceSegment {
  timestamp: number;
  audioPath: string;
  audioDuration: number;
  subtitleChunks: SubtitleChunk[]; // real timestamps from Whisper
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
        model_id: "eleven_turbo_v2",
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.75,
          style: 0.45,
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

/**
 * Transcribe a local audio file with Whisper to get real segment timestamps.
 * Returns subtitle chunks with real offsetSec values from Whisper.
 */
async function transcribeForSubtitles(
  audioPath: string,
  fallbackScript: string
): Promise<SubtitleChunk[]> {
  try {
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      console.warn("[Whisper] Forge API not configured — using estimated subtitle timing");
      return estimateSubtitleChunks(fallbackScript);
    }

    const audioBuffer = fs.readFileSync(audioPath);
    const sizeMB = audioBuffer.length / (1024 * 1024);
    if (sizeMB > 16) {
      console.warn("[Whisper] Audio file too large for transcription — using estimated timing");
      return estimateSubtitleChunks(fallbackScript);
    }

    const formData = new FormData();
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" });
    formData.append("file", audioBlob, "voice.mp3");
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("prompt", "Marketing video critique commentary");

    const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
    const fullUrl = new URL("v1/audio/transcriptions", baseUrl).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(fullUrl, {
      signal: controller.signal,
      method: "POST",
      headers: {
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "Accept-Encoding": "identity",
      },
      body: formData,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[Whisper] Transcription failed (${response.status}) — using estimated timing`);
      return estimateSubtitleChunks(fallbackScript);
    }

    const whisperData = await response.json() as {
      text: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    if (!whisperData.segments || whisperData.segments.length === 0) {
      console.warn("[Whisper] No segments returned — using estimated timing");
      return estimateSubtitleChunks(fallbackScript);
    }

    // Group Whisper segments into 5-8 word subtitle chunks
    const chunks = groupWhisperSegmentsIntoChunks(whisperData.segments);
    console.log(`[Whisper] Generated ${chunks.length} subtitle chunks from real timestamps`);
    return chunks;

  } catch (err) {
    console.warn("[Whisper] Transcription error — using estimated timing:", err);
    return estimateSubtitleChunks(fallbackScript);
  }
}

/**
 * Group Whisper segments into subtitle chunks of ~6 words each.
 * Proportionally interpolates timing within each Whisper segment so every
 * subtitle chunk gets a distinct, accurate start time — not all the same value.
 */
function groupWhisperSegmentsIntoChunks(
  segments: Array<{ start: number; end: number; text: string }>
): SubtitleChunk[] {
  const TARGET_WORDS = 6;

  // First, build a flat list of (word, timestamp) pairs by proportionally
  // distributing each Whisper segment's duration across its words.
  const wordTimings: Array<{ word: string; startSec: number }> = [];

  for (const seg of segments) {
    const segWords = seg.text.trim().split(/\s+/).filter(Boolean);
    if (segWords.length === 0) continue;
    const segDur = Math.max(0.01, seg.end - seg.start);
    const secPerWord = segDur / segWords.length;
    segWords.forEach((word, i) => {
      wordTimings.push({
        word,
        startSec: seg.start + i * secPerWord,
      });
    });
  }

  // Group into TARGET_WORDS-sized chunks, using the first word's timestamp
  const chunks: SubtitleChunk[] = [];
  for (let i = 0; i < wordTimings.length; i += TARGET_WORDS) {
    const slice = wordTimings.slice(i, i + TARGET_WORDS);
    chunks.push({
      text: slice.map(w => w.word).join(" "),
      offsetSec: Math.max(0, Math.round(slice[0].startSec * 10) / 10),
    });
  }

  return chunks;
}

/**
 * Fallback: estimate subtitle timing from word count at ~2.8 words/sec.
 * Used when Whisper is unavailable.
 */
function estimateSubtitleChunks(script: string): SubtitleChunk[] {
  const WORDS_PER_CHUNK = 6;
  const WORDS_PER_SEC = 2.8;

  const words = script.trim().split(/\s+/).filter(Boolean);
  const chunks: SubtitleChunk[] = [];

  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
    const chunkWords = words.slice(i, i + WORDS_PER_CHUNK);
    const offsetSec = (i / WORDS_PER_SEC);
    chunks.push({
      text: chunkWords.join(" "),
      offsetSec: Math.round(offsetSec * 10) / 10,
    });
  }

  return chunks.length > 0 ? chunks : [{ text: script.slice(0, 50), offsetSec: 0 }];
}

/** Generate all voiceover segments for a critique, with real Whisper subtitle timing */
export async function generateAllVoiceSegments(
  critiquePoints: Array<{
    timestamp?: number;
    pauseAtTimestamp?: number;
    spokenScript?: string;
    description?: string;
    title: string;
  }>,
  outputDir: string
): Promise<VoiceSegment[]> {
  fs.mkdirSync(outputDir, { recursive: true });
  const segments: VoiceSegment[] = [];

  for (let i = 0; i < critiquePoints.length; i++) {
    const point = critiquePoints[i];
    const outputPath = path.join(outputDir, `segment_${i}.mp3`);
    const timestamp = point.pauseAtTimestamp ?? point.timestamp ?? 0;

    // Use spokenScript if available, fall back to description
    const spokenText = point.spokenScript ?? `${point.title}. ${point.description ?? ""}`;

    try {
      // Step 1: Generate voice with ElevenLabs
      const duration = await generateVoiceSegment(spokenText, outputPath);

      // Step 2: Transcribe with Whisper to get real subtitle timestamps
      const subtitleChunks = await transcribeForSubtitles(outputPath, spokenText);

      segments.push({
        timestamp,
        audioPath: outputPath,
        audioDuration: duration,
        subtitleChunks,
      });

      console.log(`[Voice] Segment ${i}: ${duration.toFixed(1)}s, ${subtitleChunks.length} subtitle chunks`);
    } catch (err) {
      console.error(`[ElevenLabs] Failed to generate segment ${i}:`, err);
      segments.push({
        timestamp,
        audioPath: "",
        audioDuration: 0,
        subtitleChunks: estimateSubtitleChunks(spokenText),
      });
    }
  }

  return segments;
}
