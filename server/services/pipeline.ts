/**
 * AdGuru AI — Main Pipeline Orchestrator
 * Coordinates: Download → Analyze → Voice → Render → Upload
 */
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { updateCritique } from "../db";
import { analyzeVideoFile } from "./analyzeVideo";
import { generateAllVoiceSegments } from "./generateVoice";
import { storagePut } from "../storage";

export async function runCritiquePipeline(
  critiqueId: number,
  videoPath: string,
): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `adguru_pipeline_${critiqueId}_`));

  try {
    // ─── Step 1: Analyze video with GPT-4o ─────────────────
    await updateCritique(critiqueId, {
      status: "analyzing",
      processingStep: "Analyzing your ad with AI...",
    });

    console.log(`[Pipeline ${critiqueId}] Starting GPT-4o analysis...`);
    const report = await analyzeVideoFile(videoPath);
    console.log(`[Pipeline ${critiqueId}] Analysis complete. ${report.critiquePoints.length} critique points.`);

    // ─── Step 2: Generate voiceovers ───────────────────────
    await updateCritique(critiqueId, {
      status: "generating_voice",
      processingStep: "Generating expert voiceover...",
    });

    const voiceDir = path.join(tmpDir, "voice");
    const voiceSegments = await generateAllVoiceSegments(report.critiquePoints, voiceDir);

    // Attach audio paths to critique points for the renderer
    const critiquePointsWithAudio = report.critiquePoints.map((pt, i) => ({
      ...pt,
      audioPath: voiceSegments[i]?.audioPath ?? "",
    }));

    // ─── Step 3: Render annotated video ────────────────────
    await updateCritique(critiqueId, {
      status: "rendering",
      processingStep: "Rendering annotated critique video...",
    });

    const critiqueJsonPath = path.join(tmpDir, "critique.json");
    fs.writeFileSync(
      critiqueJsonPath,
      JSON.stringify({ ...report, critiquePoints: critiquePointsWithAudio }, null, 2)
    );

    const outputVideoPath = path.join(tmpDir, `critique_${critiqueId}.mp4`);
    const scriptPath = path.join(process.cwd(), "server/scripts/annotate_video.py");

    // Build a clean env for python3.11 — strip PYTHONHOME/PYTHONPATH injected by the
    // uv-managed Python 3.13 runtime so python3.11 uses its own stdlib and site-packages.
    const cleanPythonEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanPythonEnv.PYTHONHOME;
    delete cleanPythonEnv.PYTHONPATH;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("python3.11", [scriptPath, videoPath, critiqueJsonPath, outputVideoPath], {
        stdio: ["ignore", "pipe", "pipe"],
        env: cleanPythonEnv,
      });
      proc.stdout.on("data", (d) => console.log(`[Renderer] ${d.toString().trim()}`));
      proc.stderr.on("data", (d) => console.error(`[Renderer ERR] ${d.toString().trim()}`));
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Renderer exited with code ${code}`));
      });
    });

    // ─── Step 4: Upload critique video to storage ──────────
    await updateCritique(critiqueId, {
      processingStep: "Uploading critique video...",
    });

    const videoBuffer = fs.readFileSync(outputVideoPath);
    const { key, url } = await storagePut(
      `critiques/${critiqueId}/critique_video.mp4`,
      videoBuffer,
      "video/mp4"
    );

    // ─── Step 5: Save results ──────────────────────────────
    await updateCritique(critiqueId, {
      status: "completed",
      processingStep: "Done!",
      critiqueVideoKey: key,
      critiqueVideoUrl: url,
      reportJson: report as any,
    });

    console.log(`[Pipeline ${critiqueId}] Completed successfully!`);
  } catch (err: any) {
    console.error(`[Pipeline ${critiqueId}] Failed:`, err);
    await updateCritique(critiqueId, {
      status: "failed",
      errorMessage: err?.message ?? "Unknown error",
      processingStep: "Processing failed",
    });
    throw err;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
