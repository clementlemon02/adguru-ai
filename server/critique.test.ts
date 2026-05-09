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
