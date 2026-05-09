import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const critiques = mysqlTable("critiques", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", [
    "uploading",
    "analyzing",
    "generating_voice",
    "rendering",
    "completed",
    "failed",
  ]).default("uploading").notNull(),
  originalVideoKey: varchar("originalVideoKey", { length: 512 }),
  originalVideoUrl: text("originalVideoUrl"),
  critiqueVideoKey: varchar("critiqueVideoKey", { length: 512 }),
  critiqueVideoUrl: text("critiqueVideoUrl"),
  reportJson: json("reportJson"),
  errorMessage: text("errorMessage"),
  processingStep: varchar("processingStep", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Critique = typeof critiques.$inferSelect;
export type InsertCritique = typeof critiques.$inferInsert;