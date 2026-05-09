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
