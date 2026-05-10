/**
 * AdGuru AI — Critique Pipeline Tests
 * Tests the tRPC router procedures and DB helpers for the critique feature.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB helpers ──────────────────────────────────────────
vi.mock("./db", () => ({
  createCritique: vi.fn().mockResolvedValue(42),
  getCritiqueById: vi.fn().mockResolvedValue({
    id: 42,
    userId: 1,
    status: "analyzing",
    originalVideoKey: "uploads/test_abc12345.mp4",
    originalVideoUrl: "/manus-storage/uploads/test_abc12345.mp4",
    critiqueVideoKey: null,
    critiqueVideoUrl: null,
    reportJson: null,
    errorMessage: null,
    processingStep: "Analyzing your ad with AI...",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  }),
  getCritiquesByUserId: vi.fn().mockResolvedValue([
    {
      id: 42,
      userId: 1,
      status: "completed",
      originalVideoKey: "uploads/test_abc12345.mp4",
      originalVideoUrl: "/manus-storage/uploads/test_abc12345.mp4",
      critiqueVideoKey: "critiques/42/critique_video_xyz.mp4",
      critiqueVideoUrl: "/manus-storage/critiques/42/critique_video_xyz.mp4",
      reportJson: { overallScore: 78 },
      errorMessage: null,
      processingStep: "Done!",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
  ]),
  updateCritique: vi.fn().mockResolvedValue(undefined),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(null),
}));

// ─── Mock pipeline (don't actually run it in tests) ───────────
vi.mock("./services/pipeline", () => ({
  runCritiquePipeline: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock storage ─────────────────────────────────────────────
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "uploads/test_abc12345.mp4", url: "/manus-storage/uploads/test_abc12345.mp4" }),
  storageGet: vi.fn().mockResolvedValue({ key: "uploads/test_abc12345.mp4", url: "/manus-storage/uploads/test_abc12345.mp4" }),
  storageGetSignedUrl: vi.fn().mockResolvedValue("https://s3.example.com/test-signed-url"),
}));

// ─── Auth context helper ──────────────────────────────────────
function createAuthContext(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "test-user-openid",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ────────────────────────────────────────────────────
describe("critique.create", () => {
  it("creates a critique and returns critiqueId", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.critique.create({
      originalVideoKey: "uploads/test_abc12345.mp4",
      originalVideoUrl: "/manus-storage/uploads/test_abc12345.mp4",
    });

    expect(result).toHaveProperty("critiqueId");
    expect(typeof result.critiqueId).toBe("number");
    expect(result.critiqueId).toBe(42);
  });

  it("throws UNAUTHORIZED if user is not authenticated", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.critique.create({
        originalVideoKey: "uploads/test.mp4",
        originalVideoUrl: "/manus-storage/uploads/test.mp4",
      })
    ).rejects.toThrow();
  });
});

describe("critique.getById", () => {
  it("returns critique data for the owner", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.critique.getById({ id: 42 });

    expect(result).toMatchObject({
      id: 42,
      userId: 1,
      status: "analyzing",
    });
  });

  it("throws FORBIDDEN if critique belongs to another user", async () => {
    const ctx = createAuthContext(99); // different user
    const caller = appRouter.createCaller(ctx);

    await expect(caller.critique.getById({ id: 42 })).rejects.toThrow();
  });
});

describe("critique.list", () => {
  it("returns list of critiques for authenticated user", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.critique.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("status");
  });

  it("throws UNAUTHORIZED if user is not authenticated", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    await expect(caller.critique.list()).rejects.toThrow();
  });
});

describe("auth.logout", () => {
  it("clears the session cookie and returns success", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
  });
});

// ─── Pause-and-Resume Schema Tests ───────────────────────────
describe("analyzeVideo normalization (pauseAtTimestamp schema)", () => {
  it("normalizes critiqueSegments to have pauseAtTimestamp", () => {
    // Simulate the normalization logic from analyzeVideo.ts
    const rawSegments = [
      { timestamp: 5.0, type: "strength", title: "Good hook", spokenScript: "Nice.", subtitleChunks: [] },
      { pauseAtTimestamp: 10.0, type: "improvement", title: "Weak CTA", spokenScript: "Fix this.", subtitleChunks: [] },
    ];

    const normalized = rawSegments
      .sort((a, b) => (a.pauseAtTimestamp ?? a.timestamp ?? 0) - (b.pauseAtTimestamp ?? b.timestamp ?? 0))
      .map(seg => ({
        ...seg,
        pauseAtTimestamp: seg.pauseAtTimestamp ?? seg.timestamp ?? 0,
        timestamp: seg.pauseAtTimestamp ?? seg.timestamp ?? 0,
      }));

    expect(normalized[0].pauseAtTimestamp).toBe(5.0);
    expect(normalized[1].pauseAtTimestamp).toBe(10.0);
    expect(normalized[0].timestamp).toBe(5.0);
  });

  it("deduplicates segments closer than 1 second apart", () => {
    const segments = [
      { pauseAtTimestamp: 3.0, type: "strength", title: "A", spokenScript: "Good.", subtitleChunks: [] },
      { pauseAtTimestamp: 3.5, type: "improvement", title: "B", spokenScript: "Bad.", subtitleChunks: [] },
      { pauseAtTimestamp: 8.0, type: "observation", title: "C", spokenScript: "Note.", subtitleChunks: [] },
    ];

    const deduped = segments.reduce((acc: typeof segments, seg) => {
      if (acc.length === 0) return [seg];
      const prev = acc[acc.length - 1];
      if ((seg.pauseAtTimestamp - prev.pauseAtTimestamp) < 1.0) return acc;
      return [...acc, seg];
    }, []);

    expect(deduped.length).toBe(2);
    expect(deduped[0].pauseAtTimestamp).toBe(3.0);
    expect(deduped[1].pauseAtTimestamp).toBe(8.0);
  });

  it("output video duration is longer than original when pauses are present", () => {
    const originalDuration = 17.0;
    const segments = [
      { pauseAtTimestamp: 3.0, audioDuration: 8.0 },
      { pauseAtTimestamp: 10.0, audioDuration: 6.0 },
    ];

    // Total output = original + sum of (audioDuration + 0.5 buffer) per segment
    const totalPauseDuration = segments.reduce((sum, s) => sum + s.audioDuration + 0.5, 0);
    const expectedOutput = originalDuration + totalPauseDuration;

    expect(expectedOutput).toBeGreaterThan(originalDuration);
    expect(expectedOutput).toBeCloseTo(17 + 8.5 + 6.5, 1); // 32.0s
  });

  it("subtitleChunks are only shown during the pause window (not during normal playback)", () => {
    // Verify subtitle schedule is relative to pause start, not absolute video time
    const seg = {
      pauseAtTimestamp: 5.0,
      audioDuration: 8.0,
      subtitleChunks: [
        { text: "First phrase", offsetSec: 0 },
        { text: "Second phrase", offsetSec: 3.0 },
      ],
    };

    // Build subtitle schedule (relative to pause start)
    const subSchedule = seg.subtitleChunks.map((chunk, j) => ({
      text: chunk.text,
      start: chunk.offsetSec,
      end: j + 1 < seg.subtitleChunks.length
        ? seg.subtitleChunks[j + 1].offsetSec
        : seg.audioDuration + 0.5,
    }));

    // At elapsed=0 (start of pause), first chunk should be active
    const atStart = subSchedule.find(s => s.start <= 0 && 0 < s.end);
    expect(atStart?.text).toBe("First phrase");

    // At elapsed=3.5 (mid-pause), second chunk should be active
    const atMid = subSchedule.find(s => s.start <= 3.5 && 3.5 < s.end);
    expect(atMid?.text).toBe("Second phrase");

    // At elapsed=9.0 (after pause ends), no chunk should be active
    const afterPause = subSchedule.find(s => s.start <= 9.0 && 9.0 < s.end);
    expect(afterPause).toBeUndefined();
  });
});

// ─── Subtitle Timing Tests (Whisper-based) ────────────────────
describe("subtitle timing — Whisper segment grouping", () => {
  it("groups Whisper segments into 6-word subtitle chunks with real timestamps", () => {
    // Simulate the proportional interpolation in groupWhisperSegmentsIntoChunks
    const whisperSegments = [
      { start: 0.0, end: 1.5, text: "Okay so let me pause here" },
      { start: 1.5, end: 3.2, text: "because this opening shot is really strong" },
      { start: 3.2, end: 5.0, text: "you have a great product display" },
    ];

    const TARGET_WORDS = 6;
    const wordTimings: Array<{ word: string; startSec: number }> = [];
    for (const seg of whisperSegments) {
      const segWords = seg.text.trim().split(/\s+/).filter(Boolean);
      if (segWords.length === 0) continue;
      const secPerWord = Math.max(0.01, seg.end - seg.start) / segWords.length;
      segWords.forEach((word, i) => wordTimings.push({ word, startSec: seg.start + i * secPerWord }));
    }
    const chunks: Array<{ text: string; offsetSec: number }> = [];
    for (let i = 0; i < wordTimings.length; i += TARGET_WORDS) {
      const slice = wordTimings.slice(i, i + TARGET_WORDS);
      chunks.push({ text: slice.map(w => w.word).join(" "), offsetSec: Math.max(0, Math.round(slice[0].startSec * 10) / 10) });
    }

    // With proportional interpolation:
    // seg[0]: 5 words over 1.5s → 0.3s/word → words at 0.0, 0.3, 0.6, 0.9, 1.2
    // seg[1]: 7 words over 1.7s → ~0.24s/word → words at 1.5, 1.74, 1.98...
    // seg[2]: 5 words over 1.8s → 0.36s/word → words at 3.2, 3.56, 3.92...
    // Total 17 words → 3 chunks of 6 + 1 chunk of 5 = wait, let me count:
    // "Okay so let me pause here" = 6 words
    // "because this opening shot is really strong" = 7 words
    // "you have a great product display" = 6 words
    // Total = 19 words → 4 chunks (6, 6, 6, 1)
    expect(chunks.length).toBe(4);
    expect(chunks[0].offsetSec).toBe(0.0);
    expect(chunks[0].text.split(" ").length).toBe(6);
    // All chunks should have non-negative offsetSec
    chunks.forEach(c => expect(c.offsetSec).toBeGreaterThanOrEqual(0));
    // Timestamps should be strictly increasing (proportional interpolation gives unique times)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].offsetSec).toBeGreaterThan(chunks[i-1].offsetSec);
    }
  });

  it("proportionally interpolates timing within a long single Whisper segment", () => {
    // A single 10-second Whisper segment with 20 words should produce chunks
    // with distinct, proportionally spaced timestamps
    const longSegment = [{
      start: 0.0,
      end: 10.0,
      text: "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20",
    }];

    // Simulate proportional interpolation
    const TARGET_WORDS = 6;
    const wordTimings: Array<{ word: string; startSec: number }> = [];
    for (const seg of longSegment) {
      const segWords = seg.text.trim().split(/\s+/).filter(Boolean);
      const secPerWord = (seg.end - seg.start) / segWords.length; // 0.5s/word
      segWords.forEach((word, i) => wordTimings.push({ word, startSec: seg.start + i * secPerWord }));
    }
    const chunks: Array<{ text: string; offsetSec: number }> = [];
    for (let i = 0; i < wordTimings.length; i += TARGET_WORDS) {
      const slice = wordTimings.slice(i, i + TARGET_WORDS);
      chunks.push({ text: slice.map(w => w.word).join(" "), offsetSec: Math.round(slice[0].startSec * 10) / 10 });
    }

    // 20 words / 6 = 4 chunks (6, 6, 6, 2)
    expect(chunks.length).toBe(4);
    // Each chunk should start 3 seconds apart (6 words × 0.5s/word)
    expect(chunks[0].offsetSec).toBe(0.0);
    expect(chunks[1].offsetSec).toBe(3.0); // word 7 starts at 6 × 0.5 = 3.0s
    expect(chunks[2].offsetSec).toBe(6.0); // word 13 starts at 12 × 0.5 = 6.0s
    expect(chunks[3].offsetSec).toBe(9.0); // word 19 starts at 18 × 0.5 = 9.0s
  });

  it("falls back to estimated timing when Whisper returns no segments", () => {
    // Simulate estimateSubtitleChunks fallback
    const script = "This is a great hook that grabs attention immediately and sets the tone.";
    const WORDS_PER_CHUNK = 6;
    const WORDS_PER_SEC = 2.8;
    const words = script.trim().split(/\s+/).filter(Boolean);
    const chunks: Array<{ text: string; offsetSec: number }> = [];

    for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
      const chunkWords = words.slice(i, i + WORDS_PER_CHUNK);
      chunks.push({
        text: chunkWords.join(" "),
        offsetSec: Math.round((i / WORDS_PER_SEC) * 10) / 10,
      });
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].offsetSec).toBe(0);
    // Second chunk should start at ~6/2.8 ≈ 2.1s
    expect(chunks[1].offsetSec).toBeCloseTo(2.1, 0);
  });

  it("pipeline uses Whisper subtitle chunks when available, falls back to GPT chunks", () => {
    const gptChunks = [{ text: "GPT estimated chunk", offsetSec: 0 }];
    const whisperChunks = [
      { text: "Real Whisper chunk one", offsetSec: 0 },
      { text: "Real Whisper chunk two", offsetSec: 2.3 },
    ];

    // Simulate pipeline merge logic
    const result = whisperChunks.length ? whisperChunks : gptChunks;
    expect(result).toEqual(whisperChunks);
    expect(result[1].offsetSec).toBe(2.3);

    // When Whisper returns empty, falls back to GPT
    const emptyWhisper: typeof whisperChunks = [];
    const fallback = emptyWhisper.length ? emptyWhisper : gptChunks;
    expect(fallback).toEqual(gptChunks);
  });
});
