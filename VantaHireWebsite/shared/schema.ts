import { pgTable, text, serial, integer, boolean, timestamp, date, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").notNull().default("candidate"), // admin, recruiter, candidate
});

export const contactSubmissions = pgTable("contact_submissions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  location: text("location"),
  message: text("message").notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
});

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  location: text("location").notNull(),
  type: text("type").notNull(), // full-time, part-time, contract, remote
  description: text("description").notNull(),
  skills: text("skills").array(),
  deadline: date("deadline"),
  postedBy: integer("posted_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  status: text("status").notNull().default('pending'), // pending, approved, declined
  reviewComments: text("review_comments"),
  expiresAt: timestamp("expires_at"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at")
});

export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  bio: text("bio"),
  skills: text("skills").array(),
  linkedin: text("linkedin"),
  location: text("location"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  resumeUrl: text("resume_url").notNull(),
  coverLetter: text("cover_letter"),
  status: text("status").default("submitted").notNull(),
  notes: text("notes"),
  lastViewedAt: timestamp("last_viewed_at"),
  downloadedAt: timestamp("downloaded_at"),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const jobAnalytics = pgTable("job_analytics", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  views: integer("views").notNull().default(0),
  applyClicks: integer("apply_clicks").notNull().default(0),
  conversionRate: numeric("conversion_rate", { precision: 5, scale: 2 }).default("0.00"),
  aiScoreCache: integer("ai_score_cache"),
  aiModelVersion: text("ai_model_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  jobs: many(jobs),
  reviewedJobs: many(jobs, { relationName: "reviewedJobs" }),
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  postedBy: one(users, {
    fields: [jobs.postedBy],
    references: [users.id],
  }),
  reviewedBy: one(users, {
    fields: [jobs.reviewedBy],
    references: [users.id],
    relationName: "reviewedJobs",
  }),
  applications: many(applications),
  analytics: one(jobAnalytics, {
    fields: [jobs.id],
    references: [jobAnalytics.jobId],
  }),
}));

export const applicationsRelations = relations(applications, ({ one }) => ({
  job: one(jobs, {
    fields: [applications.jobId],
    references: [jobs.id],
  }),
}));

export const jobAnalyticsRelations = relations(jobAnalytics, ({ one }) => ({
  job: one(jobs, {
    fields: [jobAnalytics.jobId],
    references: [jobs.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  firstName: true,
  lastName: true,
  role: true,
});

export const insertContactSchema = createInsertSchema(contactSubmissions).pick({
  name: true,
  email: true,
  phone: true,
  company: true,
  location: true,
  message: true,
});

export const insertJobSchema = createInsertSchema(jobs).pick({
  title: true,
  location: true,
  type: true,
  description: true,
  skills: true,
  deadline: true,
}).extend({
  title: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  type: z.enum(["full-time", "part-time", "contract", "remote"]),
  description: z.string().min(10).max(5000),
  skills: z.array(z.string().min(1).max(50)).max(20).optional(),
  deadline: z.string().transform(str => new Date(str)).optional(),
});

export const insertApplicationSchema = createInsertSchema(applications).pick({
  name: true,
  email: true,
  phone: true,
  coverLetter: true,
  status: true,
  notes: true,
}).extend({
  name: z.string().min(1).max(50),
  email: z.string().email(),
  phone: z.string().min(10).max(15),
  coverLetter: z.string().max(2000).optional(),
  status: z.enum(["submitted", "reviewed", "shortlisted", "rejected", "downloaded"]).optional(),
  notes: z.string().max(1000).optional(),
});

export const insertUserProfileSchema = createInsertSchema(userProfiles).pick({
  bio: true,
  skills: true,
  linkedin: true,
  location: true,
}).extend({
  bio: z.string().max(500).optional(),
  skills: z.array(z.string().min(1).max(50)).max(20).optional(),
  linkedin: z.string().url().optional(),
  location: z.string().min(1).max(100).optional(),
});

export const insertJobAnalyticsSchema = createInsertSchema(jobAnalytics).pick({
  jobId: true,
  views: true,
  applyClicks: true,
  conversionRate: true,
}).extend({
  jobId: z.number().int().positive(),
  views: z.number().int().min(0).optional(),
  applyClicks: z.number().int().min(0).optional(),
  conversionRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertContact = z.infer<typeof insertContactSchema>;
export type ContactSubmission = typeof contactSubmissions.$inferSelect;

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type Application = typeof applications.$inferSelect;

export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfiles.$inferSelect;

export type InsertJobAnalytics = z.infer<typeof insertJobAnalyticsSchema>;
export type JobAnalytics = typeof jobAnalytics.$inferSelect;
