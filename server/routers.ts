import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createCritique,
  getCritiqueById,
  getCritiquesByUserId,
} from "./db";
import { runCritiquePipeline } from "./services/pipeline";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  critique: router({
    // Start a new critique from an already-uploaded video key
    create: protectedProcedure
      .input(z.object({
        originalVideoKey: z.string(),
        originalVideoUrl: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const critiqueId = await createCritique({
          userId: ctx.user.id,
          status: "analyzing",
          originalVideoKey: input.originalVideoKey,
          originalVideoUrl: input.originalVideoUrl,
          processingStep: "Starting analysis...",
        });

        const localVideoPath = `/tmp/adguru_input_${critiqueId}.mp4`;

        // Run pipeline asynchronously in background
        (async () => {
          try {
            const { storageGetSignedUrl } = await import("./storage");
            const signedUrl = await storageGetSignedUrl(input.originalVideoKey);

            const response = await fetch(signedUrl);
            if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);

            const { createWriteStream } = await import("fs");
            const fileStream = createWriteStream(localVideoPath);
            const reader = response.body!.getReader();

            await new Promise<void>((resolve, reject) => {
              const pump = async () => {
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) { fileStream.end(); resolve(); break; }
                    fileStream.write(value);
                  }
                } catch (e) { reject(e); }
              };
              pump();
            });

            await runCritiquePipeline(critiqueId, localVideoPath);
          } catch (err) {
            console.error(`[Critique ${critiqueId}] Pipeline error:`, err);
          } finally {
            try { const { unlinkSync } = await import("fs"); unlinkSync(localVideoPath); } catch { /* ignore */ }
          }
        })();

        return { critiqueId };
      }),

    // Get status and results of a critique
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const critique = await getCritiqueById(input.id);
        if (!critique) throw new TRPCError({ code: "NOT_FOUND" });
        if (critique.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        return critique;
      }),

    // List all critiques for the current user
    list: protectedProcedure.query(async ({ ctx }) => {
      return getCritiquesByUserId(ctx.user.id);
    }),
  }),
});

export type AppRouter = typeof appRouter;
