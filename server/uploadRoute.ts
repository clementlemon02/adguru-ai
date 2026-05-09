/**
 * AdGuru AI — Video Upload Route
 * Handles multipart video uploads, stores to S3, returns key + url.
 */
import { Express, Response } from "express";
import type { Request } from "express";
import multer from "multer";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/avi"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

export function registerUploadRoute(app: Express) {
  app.post(
    "/api/upload-video",
    upload.single("video"),
    async (req: Request & { file?: Express.Multer.File }, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No video file provided" });
        }

        const ext = req.file.originalname.split(".").pop() ?? "mp4";
        const key = `uploads/${nanoid()}.${ext}`;

        const { key: storedKey, url } = await storagePut(key, req.file.buffer, req.file.mimetype);

        return res.json({ key: storedKey, url });
      } catch (err: any) {
        console.error("[Upload] Error:", err);
        return res.status(500).json({ error: err?.message ?? "Upload failed" });
      }
    }
  );
}
