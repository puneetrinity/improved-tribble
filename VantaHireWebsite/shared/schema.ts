import { pgTable, text, serial, integer, boolean, timestamp, date, numeric, index, jsonb, uniqueIndex, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").notNull().default("candidate"), // super_admin, recruiter, candidate, hiring_manager
  // Email verification
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpires: timestamp("email_verification_expires"),
  // Password reset
  passwordResetToken: text("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  // AI features
  aiContentFreeUsed: boolean("ai_content_free_used").default(false),
  aiOnboardedAt: timestamp("ai_onboarded_at"),
  // Profile completion
  profilePromptSnoozeUntil: timestamp("profile_prompt_snooze_until"),
  profileCompletedAt: timestamp("profile_completed_at"),
  // Onboarding tracking
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  profileSkippedAt: timestamp("profile_skipped_at"),
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

// Clients (for consulting/agency use-cases)
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  name: text("name").notNull(),
  domain: text("domain"),
  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: integer("created_by").notNull().references(() => users.id),
}, (table) => ({
  nameIdx: index("clients_name_idx").on(table.name),
  orgIdx: index("clients_org_idx").on(table.organizationId),
}));

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  title: text("title").notNull(),
  location: text("location").notNull(),
  type: text("type").notNull(), // full-time, part-time, contract, remote
  description: text("description").notNull(),
  originalJD: text("original_jd"),
  skills: text("skills").array(),
  deadline: date("deadline"),
  postedBy: integer("posted_by").notNull().references(() => users.id),
  hiringManagerId: integer("hiring_manager_id").references(() => users.id), // Optional hiring manager assigned to this job
  clientId: integer("client_id").references(() => clients.id), // Optional client for agency use-cases
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isActive: boolean("is_active").notNull().default(false), // Only active after admin approval
  status: text("status").notNull().default('pending'), // pending, approved, declined
  reviewComments: text("review_comments"),
  expiresAt: timestamp("expires_at"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  slug: text("slug"), // URL-friendly slug for SEO (e.g., "senior-developer-bangalore")
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Job lifecycle tracking (deactivation/reactivation)
  deactivatedAt: timestamp("deactivated_at"), // When job was deactivated
  reactivatedAt: timestamp("reactivated_at"), // When job was last reactivated
  reactivationCount: integer("reactivation_count").notNull().default(0), // Number of times job has been reactivated
  deactivationReason: text("deactivation_reason"), // Reason for deactivation: 'manual', 'auto_expired', 'filled', 'cancelled'
  warningEmailSent: boolean("warning_email_sent").notNull().default(false), // Warning email sent before auto-deactivation
  // AI features
  jdDigest: jsonb("jd_digest"), // Cached job description digest for AI matching
  jdDigestVersion: integer("jd_digest_version").default(1),
  // Structured job requirements
  salaryMin: integer("salary_min"), // Minimum salary
  salaryMax: integer("salary_max"), // Maximum salary
  salaryPeriod: text("salary_period"), // 'per_month' | 'per_year'
  goodToHaveSkills: text("good_to_have_skills").array(), // Nice-to-have skills (existing 'skills' field is for required skills)
  educationRequirement: text("education_requirement"), // Education requirement
  experienceYears: integer("experience_years"), // Minimum / preferred years of experience
  experienceYearsMax: integer("experience_years_max"), // Maximum years of experience (upper bound)
}, (table) => ({
  // Indexes for performance hotspots
  orgIdx: index("jobs_org_idx").on(table.organizationId),
  statusIdx: index("jobs_status_idx").on(table.status),
  postedByIdx: index("jobs_posted_by_idx").on(table.postedBy),
  hiringManagerIdx: index("jobs_hiring_manager_idx").on(table.hiringManagerId),
  clientIdIdx: index("jobs_client_id_idx").on(table.clientId),
  isActiveIdx: index("jobs_is_active_idx").on(table.isActive),
  slugIdx: index("jobs_slug_idx").on(table.slug),
  deactivatedAtIdx: index("jobs_deactivated_at_idx").on(table.deactivatedAt),
}));

export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  publicId: text("public_id"), // URL-safe public identifier (generated when profile is made public)
  displayName: text("display_name"),
  company: text("company"),
  phone: text("phone"), // User's phone number
  photoUrl: text("photo_url"),
  bio: text("bio"),
  skills: text("skills").array(),
  linkedin: text("linkedin"),
  location: text("location"),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  publicIdIdx: uniqueIndex("user_profiles_public_id_idx").on(table.publicId),
  userIdIdx: uniqueIndex("user_profiles_user_id_idx").on(table.userId),
}));

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  jobId: integer("job_id").notNull().references(() => jobs.id),
  userId: integer("user_id").references(() => users.id), // Optional: bind application to user account
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  resumeUrl: text("resume_url").notNull(),
  resumeFilename: text("resume_filename"), // Original filename for proper downloads
  extractedResumeText: text("extracted_resume_text"), // Extracted resume text for AI summary
  coverLetter: text("cover_letter"),
  status: text("status").default("submitted").notNull(),
  rejectionReason: text("rejection_reason"), // 'skills_mismatch', 'experience_gap', 'salary_expectations', 'culture_fit', 'withdrew', 'no_show', 'position_filled', 'other'
  notes: text("notes"),
  lastViewedAt: timestamp("last_viewed_at"),
  downloadedAt: timestamp("downloaded_at"),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // ATS enhancements
  currentStage: integer("current_stage").references(() => pipelineStages.id),
  interviewDate: timestamp("interview_date"),
  interviewTime: text("interview_time"),
  interviewLocation: text("interview_location"),
  interviewNotes: text("interview_notes"),
  recruiterNotes: text("recruiter_notes").array(),
  hmReviewRequestedAt: timestamp("hm_review_requested_at"),
  hmReviewRequestedBy: integer("hm_review_requested_by").references(() => users.id),
  hmReviewNote: text("hm_review_note"),
  rating: integer("rating"),
  tags: text("tags").array(),
  stageChangedAt: timestamp("stage_changed_at"),
  stageChangedBy: integer("stage_changed_by").references(() => users.id),
  // Recruiter-add metadata
  submittedByRecruiter: boolean("submitted_by_recruiter").default(false),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  source: text("source").default("public_apply"), // 'public_apply', 'recruiter_add', 'referral', 'linkedin', 'indeed', 'other'
  sourceMetadata: jsonb("source_metadata"), // { referrer, platform, notes }
  // AI fit scoring
  aiFitScore: integer("ai_fit_score"), // 0-100
  aiFitLabel: text("ai_fit_label"), // 'Exceptional', 'Strong', 'Good', 'Partial', 'Low'
  aiFitReasons: jsonb("ai_fit_reasons"), // Array of reason strings
  aiModelVersion: text("ai_model_version"), // e.g., 'llama-3.3-70b-versatile'
  aiComputedAt: timestamp("ai_computed_at"),
  aiStaleReason: text("ai_stale_reason"), // 'resume_updated', 'job_updated', 'expired_ttl'
  aiDigestVersionUsed: integer("ai_digest_version_used"), // JD digest version used for this fit computation
  // AI candidate summary
  aiSummary: text("ai_summary"), // AI-generated summary of candidate strengths and fit
  aiSummaryVersion: integer("ai_summary_version").default(1), // Model version for summary generation
  aiSuggestedAction: text("ai_suggested_action"), // 'advance', 'hold', 'reject'
  aiSuggestedActionReason: text("ai_suggested_action_reason"), // Reasoning for the suggested action
  aiSummaryComputedAt: timestamp("ai_summary_computed_at"), // When the summary was generated
  aiSummaryModelVersion: text("ai_summary_model_version"), // AI model used for summary (e.g., 'llama-3.3-70b-versatile')
  aiStrengths: text("ai_strengths").array(), // Candidate strengths identified by AI
  aiConcerns: text("ai_concerns").array(), // Concerns/gaps identified by AI
  aiKeyHighlights: text("ai_key_highlights").array(), // Notable achievements/qualifications
  // AI skill analysis
  aiRequiredSkillsMatched: text("ai_required_skills_matched").array(), // Required skills found in candidate resume
  aiRequiredSkillsMissing: text("ai_required_skills_missing").array(), // Required skills NOT found
  aiRequiredSkillsMatchPercentage: integer("ai_required_skills_match_percentage"), // % of required skills matched (0-100)
  aiRequiredSkillsDepthNotes: text("ai_required_skills_depth_notes"), // Notes on depth/quality of matched skills
  aiGoodToHaveSkillsMatched: text("ai_good_to_have_skills_matched").array(), // Good-to-have skills found
  aiGoodToHaveSkillsMissing: text("ai_good_to_have_skills_missing").array(), // Good-to-have skills NOT found
  resumeId: integer("resume_id").references(() => candidateResumes.id),
  whatsappConsent: boolean("whatsapp_consent").notNull().default(true), // WhatsApp notification consent (opt-out model)
  syncSkippedReason: text("sync_skipped_reason"), // Why ActiveKG sync was skipped (e.g. 'resume_text_missing', 'resume_text_below_threshold')
  // Platform discovery consent (opt-in: default false)
  platformDiscoveryConsent: boolean("platform_discovery_consent").default(false), // Whether applicant consents to cross-tenant discovery
  consentCapturedAt: timestamp("consent_captured_at"), // When consent was explicitly captured
}, (table) => ({
  // Indexes for ATS performance
  orgIdx: index("applications_org_idx").on(table.organizationId),
  currentStageIdx: index("applications_current_stage_idx").on(table.currentStage),
  jobIdIdx: index("applications_job_id_idx").on(table.jobId),
  emailIdx: index("applications_email_idx").on(table.email),
  jobLowerEmailUniqueIdx: uniqueIndex("applications_job_lower_email_unique")
    .on(table.jobId, sql`lower(${table.email})`),
  userIdIdx: index("applications_user_id_idx").on(table.userId),
  statusIdx: index("applications_status_idx").on(table.status),
  hmReviewRequestedAtIdx: index("applications_hm_review_requested_at_idx").on(table.hmReviewRequestedAt),
  rejectionReasonIdx: index("applications_rejection_reason_idx").on(table.rejectionReason),
}));

export const jobAnalytics = pgTable("job_analytics", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  views: integer("views").notNull().default(0),
  applyClicks: integer("apply_clicks").notNull().default(0),
  conversionRate: numeric("conversion_rate", { precision: 5, scale: 2 }).default("0.00"),
  aiScoreCache: integer("ai_score_cache"),
  aiModelVersion: text("ai_model_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Job audit log for compliance and debugging
export const jobAuditLog = pgTable("job_audit_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  action: text("action").notNull(), // 'deactivated', 'reactivated', 'created', 'approved', 'declined'
  performedBy: integer("performed_by").notNull().references(() => users.id),
  reason: text("reason"), // Reason for action (e.g., 'auto_expired', 'manual', 'filled')
  metadata: jsonb("metadata"), // Additional context (e.g., { previousStatus: 'active', newStatus: 'inactive' })
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => ({
  jobIdIdx: index("job_audit_log_job_id_idx").on(table.jobId),
  timestampIdx: index("job_audit_log_timestamp_idx").on(table.timestamp),
  actionIdx: index("job_audit_log_action_idx").on(table.action),
}));

// ATS: Pipeline stages
export const pipelineStages = pgTable("pipeline_stages", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  name: text("name").notNull(),
  order: integer("order").notNull(),
  color: text("color").default("#3b82f6"),
  isDefault: boolean("is_default").default(false),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ATS: Application stage history
export const applicationStageHistory = pgTable("application_stage_history", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: 'cascade' }),
  fromStage: integer("from_stage").references(() => pipelineStages.id),
  toStage: integer("to_stage").notNull().references(() => pipelineStages.id),
  changedBy: integer("changed_by").notNull().references(() => users.id),
  notes: text("notes"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
});

// ATS: Application feedback (for hiring managers)
export const applicationFeedback = pgTable("application_feedback", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: 'cascade' }),
  authorId: integer("author_id").notNull().references(() => users.id), // User who provided feedback (hiring manager or recruiter)
  overallScore: integer("overall_score").notNull(), // 1-5 rating
  recommendation: text("recommendation").notNull(), // 'advance', 'hold', 'reject'
  notes: text("notes"), // Detailed feedback notes
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  applicationIdIdx: index("application_feedback_application_id_idx").on(table.applicationId),
  authorIdIdx: index("application_feedback_author_id_idx").on(table.authorId),
}));

// ATS: Email templates
export const emailTemplates = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  templateType: text("template_type").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ATS: Email audit log
export const emailAuditLog = pgTable("email_audit_log", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").references(() => applications.id, { onDelete: 'cascade' }),
  templateId: integer("template_id").references(() => emailTemplates.id),
  templateType: text("template_type"),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  sentBy: integer("sent_by").references(() => users.id),
  status: text("status").notNull().default("success"), // success, failed
  errorMessage: text("error_message"),
  previewUrl: text("preview_url"),
});

// ATS: Automation settings
export const automationSettings = pgTable("automation_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  settingKey: text("setting_key").notNull(),
  settingValue: boolean("setting_value").notNull().default(true),
  description: text("description"),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ATS: Automation events log (tracks when automations fire)
export const automationEvents = pgTable("automation_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  automationKey: text("automation_key").notNull(), // e.g., 'auto_acknowledge', 'auto_stage_move', 'reminder_email'
  targetType: text("target_type").notNull(), // 'application', 'job', 'user'
  targetId: integer("target_id").notNull(), // ID of the target entity
  outcome: text("outcome").notNull().default("success"), // 'success', 'failed', 'skipped'
  errorMessage: text("error_message"), // Error details if failed
  metadata: jsonb("metadata"), // { emailId, recipientEmail, templateId, etc. }
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  triggeredBy: integer("triggered_by").references(() => users.id), // null for system-triggered
}, (table) => ({
  automationKeyIdx: index("automation_events_key_idx").on(table.automationKey),
  targetTypeIdx: index("automation_events_target_type_idx").on(table.targetType),
  triggeredAtIdx: index("automation_events_triggered_at_idx").on(table.triggeredAt),
  outcomeIdx: index("automation_events_outcome_idx").on(table.outcome),
}));

// WhatsApp: Message templates (registered with Meta for production)
export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  metaTemplateName: text("meta_template_name").notNull().unique(),
  metaTemplateId: text("meta_template_id"), // Meta's template ID after approval
  language: text("language").notNull().default("en"),
  templateType: text("template_type").notNull(), // matches email template types: 'application_received', 'interview_invite', 'status_update', 'offer_extended', 'rejection'
  category: text("category").notNull().default("UTILITY"), // META template category
  bodyTemplate: text("body_template").notNull(), // Message body with {{1}}, {{2}} placeholders
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'rejected'
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  templateTypeIdx: index("whatsapp_templates_type_idx").on(table.templateType),
  statusIdx: index("whatsapp_templates_status_idx").on(table.status),
}));

// WhatsApp: Audit log (parallel to emailAuditLog)
export const whatsappAuditLog = pgTable("whatsapp_audit_log", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").references(() => applications.id, { onDelete: 'cascade' }),
  templateId: integer("template_id").references(() => whatsappTemplates.id),
  templateType: text("template_type"),
  recipientPhone: text("recipient_phone").notNull(),
  messageId: text("message_id"), // Meta's message ID or test ID
  status: text("status").notNull().default("pending"), // 'pending', 'sent', 'delivered', 'read', 'failed'
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  templateVariables: jsonb("template_variables"), // Variables sent to template
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  sentBy: integer("sent_by").references(() => users.id),
}, (table) => ({
  applicationIdIdx: index("whatsapp_audit_log_application_id_idx").on(table.applicationId),
  statusIdx: index("whatsapp_audit_log_status_idx").on(table.status),
  messageIdIdx: index("whatsapp_audit_log_message_id_idx").on(table.messageId),
  sentAtIdx: index("whatsapp_audit_log_sent_at_idx").on(table.sentAt),
}));

// Consultant Profiles
export const consultants = pgTable("consultants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  experience: text("experience").notNull(),
  linkedinUrl: text("linkedin_url"),
  domains: text("domains").notNull(),
  description: text("description"),
  photoUrl: text("photo_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Client Shortlists: Agency feature to share candidate lists with clients
export const clientShortlists = pgTable("client_shortlists", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  token: text("token").notNull().unique(), // Public access token
  title: text("title"), // Optional custom title (defaults to job title)
  message: text("message"), // Optional message to client
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"), // Optional expiration
  status: text("status").notNull().default('active'), // 'active', 'expired', 'closed'
}, (table) => ({
  clientIdIdx: index("client_shortlists_client_id_idx").on(table.clientId),
  jobIdIdx: index("client_shortlists_job_id_idx").on(table.jobId),
  tokenIdx: index("client_shortlists_token_idx").on(table.token),
}));

export const clientShortlistItems = pgTable("client_shortlist_items", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  shortlistId: integer("shortlist_id").notNull().references(() => clientShortlists.id, { onDelete: 'cascade' }),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: 'cascade' }),
  position: integer("position").notNull(), // Order in the list
  notes: text("notes"), // Optional recruiter notes about this candidate
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  shortlistIdIdx: index("client_shortlist_items_shortlist_id_idx").on(table.shortlistId),
  applicationIdIdx: index("client_shortlist_items_application_id_idx").on(table.applicationId),
  shortlistIdPositionIdx: index("client_shortlist_items_shortlist_position_idx").on(table.shortlistId, table.position),
}));

export const clientFeedback = pgTable("client_feedback", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: 'cascade' }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  shortlistId: integer("shortlist_id").references(() => clientShortlists.id, { onDelete: 'set null' }), // Track which shortlist generated this feedback
  recommendation: text("recommendation").notNull(), // 'advance', 'reject', 'hold'
  notes: text("notes"), // Client's feedback notes
  rating: integer("rating"), // Optional 1-5 rating
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  applicationIdIdx: index("client_feedback_application_id_idx").on(table.applicationId),
  clientIdIdx: index("client_feedback_client_id_idx").on(table.clientId),
  shortlistIdIdx: index("client_feedback_shortlist_id_idx").on(table.shortlistId),
}));

// Forms Feature: Recruiter-sent candidate forms
export const forms = pgTable("forms", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  name: text("name").notNull(),
  description: text("description"),
  isPublished: boolean("is_published").notNull().default(true),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  createdByIdx: index("forms_created_by_idx").on(table.createdBy),
  isPublishedIdx: index("forms_is_published_idx").on(table.isPublished),
}));

export const formFields = pgTable("form_fields", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").notNull().references(() => forms.id, { onDelete: 'cascade' }),
  type: text("type").notNull(), // 'short_text', 'long_text', 'yes_no', 'select', 'date', 'file', 'email'
  label: text("label").notNull(),
  required: boolean("required").notNull().default(false),
  options: text("options"), // JSON string for select options
  order: integer("order").notNull(),
}, (table) => ({
  formIdOrderIdx: index("form_fields_form_id_order_idx").on(table.formId, table.order),
}));

export const formInvitations = pgTable("form_invitations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  applicationId: integer("application_id").references(() => applications.id, { onDelete: 'cascade' }), // Nullable for external invites
  formId: integer("form_id").notNull().references(() => forms.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  status: text("status").notNull().default('pending'), // 'pending', 'sent', 'viewed', 'answered', 'expired', 'failed'
  sentBy: integer("sent_by").notNull().references(() => users.id),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  answeredAt: timestamp("answered_at"),
  fieldSnapshot: text("field_snapshot").notNull(), // JSONB stored as text: snapshot of form fields at creation
  customMessage: text("custom_message"),
  reminderSentAt: timestamp("reminder_sent_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // External invite fields (when applicationId is null)
  email: text("email"), // Candidate email for external invites
  candidateName: text("candidate_name"), // Candidate name for external invites
  jobId: integer("job_id").references(() => jobs.id), // Optional job association for auto-creating application
}, (table) => ({
  tokenIdx: index("form_invitations_token_idx").on(table.token),
  applicationIdStatusIdx: index("form_invitations_app_status_idx").on(table.applicationId, table.status),
  createdAtIdx: index("form_invitations_created_at_idx").on(table.createdAt),
  formIdIdx: index("form_invitations_form_id_idx").on(table.formId),
  emailFormIdx: index("form_invitations_email_form_idx").on(table.email, table.formId),
}));

export const formResponses = pgTable("form_responses", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  invitationId: integer("invitation_id").notNull().references(() => formInvitations.id, { onDelete: 'cascade' }).unique(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: 'cascade' }),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
}, (table) => ({
  applicationIdIdx: index("form_responses_application_id_idx").on(table.applicationId),
}));

export const formResponseAnswers = pgTable("form_response_answers", {
  id: serial("id").primaryKey(),
  responseId: integer("response_id").notNull().references(() => formResponses.id, { onDelete: 'cascade' }),
  fieldId: integer("field_id").notNull().references(() => formFields.id),
  value: text("value"), // Text or JSON string for structured answers
  fileUrl: text("file_url"), // For file upload fields
}, (table) => ({
  responseIdIdx: index("form_response_answers_response_id_idx").on(table.responseId),
}));

// AI Matching: Candidate Resumes
export const candidateResumes = pgTable("candidate_resumes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: text("label").notNull(), // e.g., "Software Engineer Resume", "Data Science Resume"
  gcsPath: text("gcs_path").notNull(), // GCS bucket path
  extractedText: text("extracted_text"), // Extracted text from PDF/DOCX
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("candidate_resumes_user_id_idx").on(table.userId),
  // Partial unique index: only one default resume per user
  uniqueDefaultPerUser: uniqueIndex("candidate_resumes_unique_default_per_user")
    .on(table.userId)
    .where(sql`${table.isDefault} = true`),
}));

// AI Matching: Usage tracking for billing and limits
export const userAiUsage = pgTable("user_ai_usage", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text("kind").notNull(), // 'fit', 'content', 'role', 'feedback', 'summary'
  tokensIn: integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
  costUsd: decimal("cost_usd", { precision: 10, scale: 8 }).notNull(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
  metadata: jsonb("metadata"), // { applicationId, durationMs, cached, etc. }
}, (table) => ({
  userIdIdx: index("user_ai_usage_user_id_idx").on(table.userId),
  kindIdx: index("user_ai_usage_kind_idx").on(table.kind),
  computedAtIdx: index("user_ai_usage_computed_at_idx").on(table.computedAt),
}));

// Talent Pool: Candidates added via external form invites (no job application yet)
export const talentPool = pgTable("talent_pool", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  email: text("email").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  recruiterId: integer("recruiter_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  source: text("source").notNull().default('external_form'), // 'external_form', 'manual', 'import'
  formResponseId: integer("form_response_id").references(() => formResponses.id),
  notes: text("notes"),
  resumeUrl: text("resume_url"), // Optional resume URL from form response
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  recruiterEmailIdx: uniqueIndex("talent_pool_recruiter_email_idx").on(table.recruiterId, table.email),
  recruiterIdIdx: index("talent_pool_recruiter_id_idx").on(table.recruiterId),
  createdAtIdx: index("talent_pool_created_at_idx").on(table.createdAt),
}));

// Hiring Manager Invitations: Invite hiring managers via email
export const hiringManagerInvitations = pgTable("hiring_manager_invitations", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"), // Optional invitee name
  token: text("token").notNull(), // SHA256 hashed token
  invitedBy: integer("invited_by").notNull().references(() => users.id),
  inviterName: text("inviter_name"), // Denormalized for email template
  expiresAt: timestamp("expires_at").notNull(), // 7 days default
  status: text("status").notNull().default('pending'), // 'pending', 'accepted', 'expired'
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  emailIdx: index("hm_invitations_email_idx").on(table.email),
  tokenIdx: uniqueIndex("hm_invitations_token_idx").on(table.token),
  invitedByIdx: index("hm_invitations_invited_by_idx").on(table.invitedBy),
  statusIdx: index("hm_invitations_status_idx").on(table.status),
}));

// Job Recruiters: Many-to-many relationship for co-recruiters on jobs
export const jobRecruiters = pgTable("job_recruiters", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  recruiterId: integer("recruiter_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedBy: integer("added_by").references(() => users.id),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (table) => ({
  jobRecruiterUnique: uniqueIndex("job_recruiter_unique_idx").on(table.jobId, table.recruiterId),
  jobIdx: index("job_recruiters_job_idx").on(table.jobId),
  recruiterIdx: index("job_recruiters_recruiter_idx").on(table.recruiterId),
}));

// Co-Recruiter Invitations: Invite recruiters to collaborate on jobs
export const coRecruiterInvitations = pgTable("co_recruiter_invitations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'cascade' }), // Nullable for migration
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  email: text("email").notNull(),
  token: text("token").notNull(), // SHA256 hashed
  invitedBy: integer("invited_by").notNull().references(() => users.id),
  inviterName: text("inviter_name"), // Denormalized for email template
  jobTitle: text("job_title"), // Denormalized for email template
  expiresAt: timestamp("expires_at").notNull(), // 7 days default
  status: text("status").notNull().default('pending'), // 'pending', 'accepted', 'expired'
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tokenIdx: uniqueIndex("co_recruiter_invite_token_idx").on(table.token),
  jobEmailIdx: index("co_recruiter_invite_job_email_idx").on(table.jobId, table.email), // Composite for getByEmail
  statusIdx: index("co_recruiter_invite_status_idx").on(table.status),
}));

// AI Fit Jobs: Async job processing for AI fit scoring
export const aiFitJobs = pgTable("ai_fit_jobs", {
  id: serial("id").primaryKey(),

  // Queue reference (internal - not exposed to clients)
  bullJobId: text("bull_job_id").notNull(),
  queueName: text("queue_name").notNull(), // 'ai:interactive' | 'ai:batch'

  // Request context
  userId: integer("user_id").notNull().references(() => users.id),
  applicationId: integer("application_id").references(() => applications.id), // For single jobs
  applicationIds: integer("application_ids").array(), // For batch jobs

  // Status tracking
  status: text("status").notNull().default('pending'), // 'pending' | 'active' | 'completed' | 'failed' | 'cancelled'

  // Progress (for batch jobs)
  progress: integer("progress").default(0), // 0-100
  processedCount: integer("processed_count").default(0),
  totalCount: integer("total_count"),

  // Results
  result: jsonb("result"), // FitResult or BatchFitResult
  error: text("error"),
  errorCode: text("error_code"), // 'QUOTA_EXHAUSTED' | 'CIRCUIT_OPEN' | 'VALIDATION' | 'TRANSIENT' | 'ENQUEUE_FAILED'

  // Timing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  bullJobIdIdx: uniqueIndex("ai_fit_jobs_bull_job_id_idx").on(table.bullJobId),
  userIdStatusIdx: index("ai_fit_jobs_user_status_idx").on(table.userId, table.status),
  applicationIdIdx: index("ai_fit_jobs_application_id_idx").on(table.applicationId),
  createdAtIdx: index("ai_fit_jobs_created_at_idx").on(table.createdAt),
}));

// =====================================================
// ORGANIZATION & SUBSCRIPTION TABLES
// =====================================================

// Organizations
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),

  // Branding
  logo: text("logo"),

  // Domain (admin-approved)
  domain: text("domain").unique(),
  domainVerified: boolean("domain_verified").default(false),
  domainApprovedBy: integer("domain_approved_by").references(() => users.id),
  domainApprovedAt: timestamp("domain_approved_at"),

  // Billing info
  gstin: text("gstin"),
  billingName: text("billing_name"),
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingPincode: text("billing_pincode"),
  billingContactEmail: text("billing_contact_email"),
  billingContactName: text("billing_contact_name"),

  settings: jsonb("settings"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  // Signal integration
  signalTenantId: text("signal_tenant_id").unique(),
}, (table) => ({
  slugIdx: uniqueIndex("organizations_slug_idx").on(table.slug),
  domainIdx: index("organizations_domain_idx").on(table.domain),
  signalTenantIdx: uniqueIndex("organizations_signal_tenant_idx").on(table.signalTenantId),
}));

// Organization members
export const organizationMembers = pgTable("organization_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text("role").notNull().default('member'), // 'owner', 'admin', 'member'

  // Seat assignment (for downgrade/reduction scenarios)
  seatAssigned: boolean("seat_assigned").default(true).notNull(),
  lastActivityAt: timestamp("last_activity_at"),

  // Credits (follow the seat)
  creditsAllocated: integer("credits_allocated").notNull().default(0),
  creditsUsed: integer("credits_used").notNull().default(0),
  creditsRollover: integer("credits_rollover").notNull().default(0),
  creditsPeriodStart: timestamp("credits_period_start"),
  creditsPeriodEnd: timestamp("credits_period_end"),

  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  invitedBy: integer("invited_by").references(() => users.id),
}, (table) => ({
  orgUserIdx: uniqueIndex("org_members_org_user_idx").on(table.organizationId, table.userId),
  userUniqueIdx: uniqueIndex("org_members_user_unique_idx").on(table.userId), // Enforce single-org-per-user
  roleIdx: index("org_members_role_idx").on(table.role),
  seatAssignedIdx: index("org_members_seat_assigned_idx").on(table.seatAssigned),
}));

export const mauticContactLinks = pgTable("mautic_contact_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: 'cascade' }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: 'set null' }),
  email: text("email").notNull(),
  mauticContactId: integer("mautic_contact_id"),
  lastKnownSegmentId: integer("last_known_segment_id"),
  firstLoginSyncedAt: timestamp("first_login_synced_at"),
  firstJobCreatedSyncedAt: timestamp("first_job_created_synced_at"),
  lastSyncedAt: timestamp("last_synced_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  emailIdx: uniqueIndex("mautic_contact_links_email_idx").on(table.email),
  userIdx: uniqueIndex("mautic_contact_links_user_idx").on(table.userId),
  contactIdx: index("mautic_contact_links_contact_idx").on(table.mauticContactId),
  orgIdx: index("mautic_contact_links_org_idx").on(table.organizationId),
}));

// Organization invites
export const organizationInvites = pgTable("organization_invites", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: text("email").notNull(),
  role: text("role").notNull().default('member'),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  invitedBy: integer("invited_by").notNull().references(() => users.id),
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: integer("accepted_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgEmailIdx: uniqueIndex("org_invites_org_email_idx").on(table.organizationId, table.email),
  tokenIdx: uniqueIndex("org_invites_token_idx").on(table.token),
}));

// Organization join requests (for domain-based join)
export const organizationJoinRequests = pgTable("organization_join_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text("status").notNull().default('pending'), // 'pending', 'approved', 'rejected'
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  respondedAt: timestamp("responded_at"),
  respondedBy: integer("responded_by").references(() => users.id),
  rejectionReason: text("rejection_reason"),
}, (table) => ({
  orgUserIdx: uniqueIndex("org_join_requests_org_user_idx").on(table.organizationId, table.userId),
  statusIdx: index("org_join_requests_status_idx").on(table.status),
}));

// Domain claim requests (admin-approved)
export const domainClaimRequests = pgTable("domain_claim_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  domain: text("domain").notNull(),
  status: text("status").notNull().default('pending'), // 'pending', 'approved', 'rejected'
  requestedBy: integer("requested_by").notNull().references(() => users.id),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
}, (table) => ({
  domainIdx: index("domain_claim_requests_domain_idx").on(table.domain),
  statusIdx: index("domain_claim_requests_status_idx").on(table.status),
  orgIdx: index("domain_claim_requests_org_idx").on(table.organizationId),
}));

// Subscription plans
export const subscriptionPlans = pgTable("subscription_plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  pricePerSeatMonthly: integer("price_per_seat_monthly").notNull(), // paise
  pricePerSeatAnnual: integer("price_per_seat_annual").notNull(),
  aiCreditsPerSeatMonthly: integer("ai_credits_per_seat_monthly").notNull(),
  maxCreditRolloverMonths: integer("max_credit_rollover_months").default(3),
  features: jsonb("features").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  nameIdx: uniqueIndex("subscription_plans_name_idx").on(table.name),
  isActiveIdx: index("subscription_plans_is_active_idx").on(table.isActive),
}));

// Organization subscriptions
export const organizationSubscriptions = pgTable("organization_subscriptions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  planId: integer("plan_id").notNull().references(() => subscriptionPlans.id),

  seats: integer("seats").notNull().default(1),
  paidSeats: integer("paid_seats").notNull().default(0), // Seats actually paid for (for MRR calculation)
  billingCycle: text("billing_cycle").notNull(), // 'monthly', 'annual'
  status: text("status").notNull().default('active'), // 'active', 'past_due', 'cancelled', 'trialing'

  startDate: timestamp("start_date").notNull(),
  currentPeriodStart: timestamp("current_period_start").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelledAt: timestamp("cancelled_at"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),

  cashfreeSubscriptionId: text("cashfree_subscription_id"),
  cashfreeCustomerId: text("cashfree_customer_id"),

  gracePeriodEndDate: timestamp("grace_period_end_date"),
  paymentFailureCount: integer("payment_failure_count").default(0),

  // Admin override
  adminOverride: boolean("admin_override").default(false),
  adminOverrideReason: text("admin_override_reason"),
  adminOverrideBy: integer("admin_override_by").references(() => users.id),

  featureOverrides: jsonb("feature_overrides"),

  // Bonus credits (admin-granted pool shared by org)
  bonusCredits: integer("bonus_credits").default(0),
  bonusCreditsGrantedAt: timestamp("bonus_credits_granted_at"),
  bonusCreditsReason: text("bonus_credits_reason"),
  bonusCreditsGrantedBy: integer("bonus_credits_granted_by").references(() => users.id),

  // Custom credit limit override (for Business plan customization)
  customCreditLimit: integer("custom_credit_limit"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdx: uniqueIndex("org_subscriptions_org_idx").on(table.organizationId),
  statusIdx: index("org_subscriptions_status_idx").on(table.status),
  planIdx: index("org_subscriptions_plan_idx").on(table.planId),
  cashfreeSubIdx: index("org_subscriptions_cashfree_sub_idx").on(table.cashfreeSubscriptionId),
}));

// Organization-level AI credit balance
export const organizationCreditBalances = pgTable("organization_credit_balances", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  recurringAllocated: integer("recurring_allocated").notNull().default(0),
  recurringUsed: integer("recurring_used").notNull().default(0),
  rolloverCredits: integer("rollover_credits").notNull().default(0),
  purchasedCredits: integer("purchased_credits").notNull().default(0),
  purchasedUsed: integer("purchased_used").notNull().default(0),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdx: uniqueIndex("org_credit_balances_org_idx").on(table.organizationId),
}));

// Credit ledger for resets, usage, purchases, and admin adjustments
export const organizationCreditTransactions = pgTable("organization_credit_transactions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: integer("user_id").references(() => users.id),
  type: text("type").notNull(), // cycle_reset, usage, purchase, bonus_grant, bonus_clear, custom_limit, migration
  amount: integer("amount").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgIdx: index("org_credit_transactions_org_idx").on(table.organizationId),
  typeIdx: index("org_credit_transactions_type_idx").on(table.type),
  createdAtIdx: index("org_credit_transactions_created_at_idx").on(table.createdAt),
}));

// Payment transactions
export const paymentTransactions = pgTable("payment_transactions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  subscriptionId: integer("subscription_id").references(() => organizationSubscriptions.id),

  type: text("type").notNull(), // 'subscription', 'seat_addition', 'refund'
  amount: integer("amount").notNull(), // paise
  taxAmount: integer("tax_amount").default(0).notNull(),
  totalAmount: integer("total_amount").notNull(),
  currency: text("currency").default('INR').notNull(),
  status: text("status").notNull(), // 'pending', 'completed', 'failed', 'refunded'

  cashfreeOrderId: text("cashfree_order_id").unique(),
  cashfreePaymentId: text("cashfree_payment_id"),
  cashfreePaymentMethod: text("cashfree_payment_method"),

  metadata: jsonb("metadata"),
  failureReason: text("failure_reason"),

  invoiceNumber: text("invoice_number"),
  invoiceUrl: text("invoice_url"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  orgIdx: index("payment_transactions_org_idx").on(table.organizationId),
  subIdx: index("payment_transactions_sub_idx").on(table.subscriptionId),
  statusIdx: index("payment_transactions_status_idx").on(table.status),
  cashfreeOrderIdx: uniqueIndex("payment_transactions_cashfree_order_idx").on(table.cashfreeOrderId),
  createdAtIdx: index("payment_transactions_created_at_idx").on(table.createdAt),
}));

// Webhook events (for idempotency)
export const webhookEvents = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // 'cashfree'
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
  status: text("status").notNull(), // 'processed', 'skipped', 'failed'
  errorMessage: text("error_message"),
}, (table) => ({
  eventIdIdx: uniqueIndex("webhook_events_event_id_idx").on(table.provider, table.eventId),
  eventTypeIdx: index("webhook_events_event_type_idx").on(table.eventType),
}));

// Subscription alerts
export const subscriptionAlerts = pgTable("subscription_alerts", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => organizationSubscriptions.id),
  alertType: text("alert_type").notNull(), // 'payment_failed', 'grace_period_start', 'grace_period_end', 'renewal_reminder', 'seats_reduced'
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  recipientEmail: text("recipient_email").notNull(),
  emailStatus: text("email_status").default('sent').notNull(),
}, (table) => ({
  subIdx: index("subscription_alerts_sub_idx").on(table.subscriptionId),
  alertTypeIdx: index("subscription_alerts_type_idx").on(table.alertType),
}));

// Subscription audit log
export const subscriptionAuditLog = pgTable("subscription_audit_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  subscriptionId: integer("subscription_id").references(() => organizationSubscriptions.id),
  action: text("action").notNull(), // 'created', 'upgraded', 'downgraded', 'seats_added', 'seats_removed', 'cancelled', 'reactivated', 'admin_override'
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  performedBy: integer("performed_by").references(() => users.id),
  performedAt: timestamp("performed_at").defaultNow().notNull(),
  reason: text("reason"),
}, (table) => ({
  orgIdx: index("subscription_audit_log_org_idx").on(table.organizationId),
  subIdx: index("subscription_audit_log_sub_idx").on(table.subscriptionId),
  actionIdx: index("subscription_audit_log_action_idx").on(table.action),
  performedAtIdx: index("subscription_audit_log_performed_at_idx").on(table.performedAt),
}));

// Checkout intents - for public checkout flow before org/user creation
export const checkoutIntents = pgTable("checkout_intents", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  orgName: text("org_name").notNull(),
  userId: integer("user_id").references(() => users.id), // nullable - set if user already exists
  organizationId: integer("organization_id").references(() => organizations.id), // nullable - set if org already exists
  planId: integer("plan_id").notNull().references(() => subscriptionPlans.id),
  seats: integer("seats").notNull().default(1),
  billingCycle: text("billing_cycle").notNull().default('monthly'), // 'monthly' | 'annual'
  gstin: text("gstin"),
  billingName: text("billing_name"),
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingPincode: text("billing_pincode"),
  status: text("status").notNull().default('pending'), // 'pending', 'paid', 'claimed', 'expired'
  cashfreeOrderId: text("cashfree_order_id").unique(),
  claimToken: text("claim_token").unique(), // for claiming after payment
  claimedAt: timestamp("claimed_at"),
  claimedBy: integer("claimed_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  paidAt: timestamp("paid_at"),
}, (table) => ({
  emailIdx: index("checkout_intents_email_idx").on(table.email),
  statusIdx: index("checkout_intents_status_idx").on(table.status),
  claimTokenIdx: uniqueIndex("checkout_intents_claim_token_idx").on(table.claimToken),
  cashfreeOrderIdx: uniqueIndex("checkout_intents_cashfree_order_idx").on(table.cashfreeOrderId),
  expiresAtIdx: index("checkout_intents_expires_at_idx").on(table.expiresAt),
}));

// =====================================================
// SIGNAL SOURCING TABLES
// =====================================================

// Job Sourcing Runs — tracks each Signal sourcing request per job
export const jobSourcingRuns = pgTable("job_sourcing_runs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  requestId: text("request_id").notNull().unique(), // Vanta-generated UUID sent to Signal
  externalJobId: text("external_job_id").notNull(), // e.g. "vanta:jobs:123"
  status: text("status").notNull().default('pending'), // pending, submitted, processing, completed, failed, expired
  contextHash: text("context_hash").notNull(), // sha256 of canonicalized job context
  callbackUrl: text("callback_url"),
  meta: jsonb("meta"), // Signal response metadata (candidate counts, etc.)
  errorMessage: text("error_message"),
  candidateCount: integer("candidate_count").default(0),
  expiresAt: timestamp("expires_at"),
  submittedAt: timestamp("submitted_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgJobIdx: index("job_sourcing_runs_org_job_idx").on(table.organizationId, table.jobId),
  requestIdIdx: uniqueIndex("job_sourcing_runs_request_id_idx").on(table.requestId),
  statusIdx: index("job_sourcing_runs_status_idx").on(table.status),
  // NOTE: partial unique index for active run dedupe is in bootstrapSchema.ts
  // (Drizzle doesn't support WHERE clause on unique indexes)
  expiresAtIdx: index("job_sourcing_runs_expires_at_idx").on(table.expiresAt),
}));

// Job Sourced Candidates — links Signal candidates to Vanta jobs
export const jobSourcedCandidates = pgTable("job_sourced_candidates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  requestId: text("request_id").notNull().references(() => jobSourcingRuns.requestId),
  signalCandidateId: text("signal_candidate_id").notNull(), // Signal's candidate ID
  fitScore: integer("fit_score"), // 0-100
  fitBreakdown: jsonb("fit_breakdown"), // Signal's fit breakdown object
  sourceType: text("source_type").notNull(), // raw Signal values: 'pool_enriched' | 'pool' | 'discovered'
  state: text("state").notNull().default('new'), // new, shortlisted, hidden, converted
  candidateSummary: jsonb("candidate_summary"), // Signal intelligence snapshot for display
  foundEmail: text("found_email"),
  foundEmails: jsonb("found_emails"),
  emailResolvedAt: timestamp("email_resolved_at"),
  emailResolveStatus: text("email_resolve_status"),
  outreachCount: integer("outreach_count").notNull().default(0),
  lastOutreachRound: integer("last_outreach_round"),
  lastOutreachCampaignId: text("last_outreach_campaign_id"),
  lastOutreachAt: timestamp("last_outreach_at"),
  lastOutreachStatus: text("last_outreach_status"),
  convertedApplicationId: integer("converted_application_id").references(() => applications.id),
  appliedAt: timestamp("applied_at"),
  appliedFromCampaignId: text("applied_from_campaign_id"),
  appliedAfterRound: integer("applied_after_round"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Primary dedup: one entry per job+signal candidate
  jobCandidateIdx: uniqueIndex("job_sourced_candidates_job_candidate_idx").on(table.jobId, table.signalCandidateId),
  orgJobIdx: index("job_sourced_candidates_org_job_idx").on(table.organizationId, table.jobId),
  requestIdx: index("job_sourced_candidates_request_idx").on(table.requestId),
  stateIdx: index("job_sourced_candidates_state_idx").on(table.state),
  fitScoreIdx: index("job_sourced_candidates_fit_score_idx").on(table.fitScore),
  sourceTypeIdx: index("job_sourced_candidates_source_type_idx").on(table.sourceType),
}));

export const sourcedCandidateOutreachCampaigns = pgTable("sourced_candidate_outreach_campaigns", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  campaignId: text("campaign_id").notNull().unique(),
  round: integer("round").notNull(),
  status: text("status").notNull().default("completed"),
  audienceCount: integer("audience_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  subjectTemplate: text("subject_template"),
  htmlBodyTemplate: text("html_body_template"),
  extraContext: text("extra_context"),
  launchedBy: integer("launched_by").notNull().references(() => users.id),
  launchedAt: timestamp("launched_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  jobRoundIdx: index("scoc_job_round_idx").on(table.jobId, table.round),
  jobIdx: index("scoc_job_idx").on(table.jobId),
  orgIdx: index("scoc_org_idx").on(table.organizationId),
  launchedByIdx: index("scoc_launched_by_idx").on(table.launchedBy),
}));

// Auto-scheduled follow-up campaigns (rounds 2 & 3 fired automatically 3 days apart)
export const scheduledOutreachCampaigns = pgTable("scheduled_outreach_campaigns", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  round: integer("round").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: text("status").notNull().default("pending"), // pending | sent | cancelled | failed
  triggeredBy: integer("triggered_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
  resultCampaignId: text("result_campaign_id"),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
});

export type ScheduledOutreachCampaign = typeof scheduledOutreachCampaigns.$inferSelect;

export const sourcedCandidateOutreachLog = pgTable("sourced_candidate_outreach_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  sourcedCandidateId: integer("sourced_candidate_id").notNull().references(() => jobSourcedCandidates.id, { onDelete: 'cascade' }),
  campaignId: text("campaign_id"),
  campaignRound: integer("campaign_round"),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  bodyHtml: text("body_html"),
  aiDraftBody: text("ai_draft_body"),
  aiDraftSubject: text("ai_draft_subject"),
  wasEdited: boolean("was_edited").notNull().default(false),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  sentBy: integer("sent_by").notNull().references(() => users.id),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
}, (table) => ({
  jobIdx: index("scol_job_idx").on(table.jobId),
  candidateIdx: index("scol_candidate_idx").on(table.sourcedCandidateId),
  campaignIdx: index("scol_campaign_idx").on(table.campaignId),
  orgIdx: index("scol_org_idx").on(table.organizationId),
}));

// =====================================================
// END SIGNAL SOURCING TABLES
// =====================================================

// =====================================================
// END ORGANIZATION & SUBSCRIPTION TABLES
// =====================================================

// ActiveKG Graph Sync: Track async resume sync jobs
export const applicationGraphSyncJobs = pgTable("application_graph_sync_jobs", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: 'cascade' }).unique(),
  organizationId: integer("organization_id").references(() => organizations.id),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  effectiveRecruiterId: integer("effective_recruiter_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"), // pending, processing, succeeded, failed, dead_letter
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
  lastError: text("last_error"),
  activekgTenantId: text("activekg_tenant_id").notNull(),
  activekgParentNodeId: text("activekg_parent_node_id"),
  chunkCount: integer("chunk_count"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  statusNextAttemptIdx: index("app_graph_sync_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
  orgIdx: index("app_graph_sync_org_idx").on(table.organizationId),
  recruiterIdx: index("app_graph_sync_recruiter_idx").on(table.effectiveRecruiterId),
}));

export const resumeImportBatches = pgTable("resume_import_batches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  uploadedByUserId: integer("uploaded_by_user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("queued"), // queued, processing, ready_for_review, completed, failed
  fileCount: integer("file_count").notNull().default(0),
  processedCount: integer("processed_count").notNull().default(0),
  readyCount: integer("ready_count").notNull().default(0),
  needsReviewCount: integer("needs_review_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgJobIdx: index("resume_import_batches_org_job_idx").on(table.organizationId, table.jobId),
  uploaderIdx: index("resume_import_batches_uploader_idx").on(table.uploadedByUserId),
  statusIdx: index("resume_import_batches_status_idx").on(table.status),
}));

export const resumeImportItems = pgTable("resume_import_items", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => resumeImportBatches.id, { onDelete: 'cascade' }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  uploadedByUserId: integer("uploaded_by_user_id").notNull().references(() => users.id),
  originalFilename: text("original_filename").notNull(),
  gcsPath: text("gcs_path"),
  contentHash: text("content_hash"),
  extractedText: text("extracted_text"),
  extractionMethod: text("extraction_method").notNull().default("failed"), // native_text, mistral_ocr, failed
  parsedName: text("parsed_name"),
  parsedEmail: text("parsed_email"),
  parsedPhone: text("parsed_phone"),
  status: text("status").notNull().default("queued"), // queued, processing, processed, needs_review, finalized, failed, duplicate
  errorReason: text("error_reason"),
  applicationId: integer("application_id").references(() => applications.id, { onDelete: 'set null' }),
  sourceMetadata: jsonb("source_metadata"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
  lastProcessedAt: timestamp("last_processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  batchIdx: index("resume_import_items_batch_idx").on(table.batchId),
  statusAttemptIdx: index("resume_import_items_status_attempt_idx").on(table.status, table.nextAttemptAt),
  batchStatusIdx: index("resume_import_items_batch_status_idx").on(table.batchId, table.status),
  jobEmailIdx: index("resume_import_items_job_email_idx").on(table.jobId, table.parsedEmail),
  contentHashIdx: index("resume_import_items_content_hash_idx").on(table.batchId, table.contentHash),
  applicationIdx: index("resume_import_items_application_idx").on(table.applicationId),
  uniqueContentHashPerBatch: uniqueIndex("resume_import_items_batch_content_hash_unique")
    .on(table.batchId, table.contentHash)
    .where(sql`${table.contentHash} IS NOT NULL`),
}));

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  jobs: many(jobs),
  reviewedJobs: many(jobs, { relationName: "reviewedJobs" }),
  mauticContactLinks: many(mauticContactLinks),
  sourcedCandidateOutreachCampaigns: many(sourcedCandidateOutreachCampaigns),
  sourcedCandidateOutreachLogs: many(sourcedCandidateOutreachLog),
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
  hiringManager: one(users, {
    fields: [jobs.hiringManagerId],
    references: [users.id],
    relationName: "managedJobs",
  }),
  reviewedBy: one(users, {
    fields: [jobs.reviewedBy],
    references: [users.id],
    relationName: "reviewedJobs",
  }),
  client: one(clients, {
    fields: [jobs.clientId],
    references: [clients.id],
  }),
  applications: many(applications),
  analytics: one(jobAnalytics, {
    fields: [jobs.id],
    references: [jobAnalytics.jobId],
  }),
  shortlists: many(clientShortlists),
  sourcingRuns: many(jobSourcingRuns),
  sourcedCandidates: many(jobSourcedCandidates),
  sourcedCandidateOutreachCampaigns: many(sourcedCandidateOutreachCampaigns),
  sourcedCandidateOutreachLogs: many(sourcedCandidateOutreachLog),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  job: one(jobs, {
    fields: [applications.jobId],
    references: [jobs.id],
  }),
  currentStageRel: one(pipelineStages, {
    fields: [applications.currentStage],
    references: [pipelineStages.id],
  }),
  stageChangedByUser: one(users, {
    fields: [applications.stageChangedBy],
    references: [users.id],
  }),
  stageHistory: many(applicationStageHistory),
  feedback: many(applicationFeedback),
  clientFeedback: many(clientFeedback),
  shortlistItems: many(clientShortlistItems),
}));

export const pipelineStagesRelations = relations(pipelineStages, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [pipelineStages.createdBy],
    references: [users.id],
  }),
  applications: many(applications),
}));

export const applicationStageHistoryRelations = relations(applicationStageHistory, ({ one }) => ({
  application: one(applications, {
    fields: [applicationStageHistory.applicationId],
    references: [applications.id],
  }),
  fromStageRel: one(pipelineStages, {
    fields: [applicationStageHistory.fromStage],
    references: [pipelineStages.id],
  }),
  toStageRel: one(pipelineStages, {
    fields: [applicationStageHistory.toStage],
    references: [pipelineStages.id],
  }),
  changedByUser: one(users, {
    fields: [applicationStageHistory.changedBy],
    references: [users.id],
  }),
}));

export const applicationFeedbackRelations = relations(applicationFeedback, ({ one }) => ({
  application: one(applications, {
    fields: [applicationFeedback.applicationId],
    references: [applications.id],
  }),
  author: one(users, {
    fields: [applicationFeedback.authorId],
    references: [users.id],
  }),
}));

export const emailTemplatesRelations = relations(emailTemplates, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [emailTemplates.createdBy],
    references: [users.id],
  }),
  auditLogs: many(emailAuditLog),
}));

export const emailAuditLogRelations = relations(emailAuditLog, ({ one }) => ({
  application: one(applications, {
    fields: [emailAuditLog.applicationId],
    references: [applications.id],
  }),
  template: one(emailTemplates, {
    fields: [emailAuditLog.templateId],
    references: [emailTemplates.id],
  }),
  sentByUser: one(users, {
    fields: [emailAuditLog.sentBy],
    references: [users.id],
  }),
}));

export const automationSettingsRelations = relations(automationSettings, ({ one }) => ({
  updatedByUser: one(users, {
    fields: [automationSettings.updatedBy],
    references: [users.id],
  }),
}));

export const automationEventsRelations = relations(automationEvents, ({ one }) => ({
  triggeredByUser: one(users, {
    fields: [automationEvents.triggeredBy],
    references: [users.id],
  }),
}));

export const whatsappTemplatesRelations = relations(whatsappTemplates, ({ many }) => ({
  auditLogs: many(whatsappAuditLog),
}));

export const whatsappAuditLogRelations = relations(whatsappAuditLog, ({ one }) => ({
  application: one(applications, {
    fields: [whatsappAuditLog.applicationId],
    references: [applications.id],
  }),
  template: one(whatsappTemplates, {
    fields: [whatsappAuditLog.templateId],
    references: [whatsappTemplates.id],
  }),
  sentByUser: one(users, {
    fields: [whatsappAuditLog.sentBy],
    references: [users.id],
  }),
}));

export const jobAnalyticsRelations = relations(jobAnalytics, ({ one }) => ({
  job: one(jobs, {
    fields: [jobAnalytics.jobId],
    references: [jobs.id],
  }),
}));

export const jobAuditLogRelations = relations(jobAuditLog, ({ one }) => ({
  job: one(jobs, {
    fields: [jobAuditLog.jobId],
    references: [jobs.id],
  }),
  performedBy: one(users, {
    fields: [jobAuditLog.performedBy],
    references: [users.id],
  }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [clients.createdBy],
    references: [users.id],
  }),
  jobs: many(jobs),
  shortlists: many(clientShortlists),
  feedback: many(clientFeedback),
}));

export const clientShortlistsRelations = relations(clientShortlists, ({ one, many }) => ({
  client: one(clients, {
    fields: [clientShortlists.clientId],
    references: [clients.id],
  }),
  job: one(jobs, {
    fields: [clientShortlists.jobId],
    references: [jobs.id],
  }),
  createdBy: one(users, {
    fields: [clientShortlists.createdBy],
    references: [users.id],
  }),
  items: many(clientShortlistItems),
}));

export const clientShortlistItemsRelations = relations(clientShortlistItems, ({ one }) => ({
  shortlist: one(clientShortlists, {
    fields: [clientShortlistItems.shortlistId],
    references: [clientShortlists.id],
  }),
  application: one(applications, {
    fields: [clientShortlistItems.applicationId],
    references: [applications.id],
  }),
}));

export const clientFeedbackRelations = relations(clientFeedback, ({ one }) => ({
  application: one(applications, {
    fields: [clientFeedback.applicationId],
    references: [applications.id],
  }),
  client: one(clients, {
    fields: [clientFeedback.clientId],
    references: [clients.id],
  }),
  shortlist: one(clientShortlists, {
    fields: [clientFeedback.shortlistId],
    references: [clientShortlists.id],
  }),
}));

export const formsRelations = relations(forms, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [forms.createdBy],
    references: [users.id],
  }),
  fields: many(formFields),
  invitations: many(formInvitations),
}));

export const formFieldsRelations = relations(formFields, ({ one }) => ({
  form: one(forms, {
    fields: [formFields.formId],
    references: [forms.id],
  }),
}));

export const formInvitationsRelations = relations(formInvitations, ({ one }) => ({
  application: one(applications, {
    fields: [formInvitations.applicationId],
    references: [applications.id],
  }),
  form: one(forms, {
    fields: [formInvitations.formId],
    references: [forms.id],
  }),
  sentBy: one(users, {
    fields: [formInvitations.sentBy],
    references: [users.id],
  }),
  response: one(formResponses, {
    fields: [formInvitations.id],
    references: [formResponses.invitationId],
  }),
}));

export const formResponsesRelations = relations(formResponses, ({ one, many }) => ({
  invitation: one(formInvitations, {
    fields: [formResponses.invitationId],
    references: [formInvitations.id],
  }),
  application: one(applications, {
    fields: [formResponses.applicationId],
    references: [applications.id],
  }),
  answers: many(formResponseAnswers),
}));

export const formResponseAnswersRelations = relations(formResponseAnswers, ({ one }) => ({
  response: one(formResponses, {
    fields: [formResponseAnswers.responseId],
    references: [formResponses.id],
  }),
  field: one(formFields, {
    fields: [formResponseAnswers.fieldId],
    references: [formFields.id],
  }),
}));

export const candidateResumesRelations = relations(candidateResumes, ({ one, many }) => ({
  user: one(users, {
    fields: [candidateResumes.userId],
    references: [users.id],
  }),
  applications: many(applications),
}));

export const resumeImportBatchesRelations = relations(resumeImportBatches, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [resumeImportBatches.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, {
    fields: [resumeImportBatches.jobId],
    references: [jobs.id],
  }),
  uploadedByUser: one(users, {
    fields: [resumeImportBatches.uploadedByUserId],
    references: [users.id],
  }),
  items: many(resumeImportItems),
}));

export const resumeImportItemsRelations = relations(resumeImportItems, ({ one }) => ({
  batch: one(resumeImportBatches, {
    fields: [resumeImportItems.batchId],
    references: [resumeImportBatches.id],
  }),
  organization: one(organizations, {
    fields: [resumeImportItems.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, {
    fields: [resumeImportItems.jobId],
    references: [jobs.id],
  }),
  uploadedByUser: one(users, {
    fields: [resumeImportItems.uploadedByUserId],
    references: [users.id],
  }),
  application: one(applications, {
    fields: [resumeImportItems.applicationId],
    references: [applications.id],
  }),
}));

export const userAiUsageRelations = relations(userAiUsage, ({ one }) => ({
  user: one(users, {
    fields: [userAiUsage.userId],
    references: [users.id],
  }),
}));

export const hiringManagerInvitationsRelations = relations(hiringManagerInvitations, ({ one }) => ({
  invitedByUser: one(users, {
    fields: [hiringManagerInvitations.invitedBy],
    references: [users.id],
  }),
}));

export const jobRecruitersRelations = relations(jobRecruiters, ({ one }) => ({
  job: one(jobs, {
    fields: [jobRecruiters.jobId],
    references: [jobs.id],
  }),
  recruiter: one(users, {
    fields: [jobRecruiters.recruiterId],
    references: [users.id],
  }),
  addedByUser: one(users, {
    fields: [jobRecruiters.addedBy],
    references: [users.id],
  }),
}));

export const coRecruiterInvitationsRelations = relations(coRecruiterInvitations, ({ one }) => ({
  job: one(jobs, {
    fields: [coRecruiterInvitations.jobId],
    references: [jobs.id],
  }),
  invitedByUser: one(users, {
    fields: [coRecruiterInvitations.invitedBy],
    references: [users.id],
  }),
}));

export const aiFitJobsRelations = relations(aiFitJobs, ({ one }) => ({
  user: one(users, {
    fields: [aiFitJobs.userId],
    references: [users.id],
  }),
  application: one(applications, {
    fields: [aiFitJobs.applicationId],
    references: [applications.id],
  }),
}));

// =====================================================
// ORGANIZATION & SUBSCRIPTION RELATIONS
// =====================================================

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  members: many(organizationMembers),
  mauticContactLinks: many(mauticContactLinks),
  invites: many(organizationInvites),
  joinRequests: many(organizationJoinRequests),
  domainClaimRequests: many(domainClaimRequests),
  subscription: one(organizationSubscriptions, {
    fields: [organizations.id],
    references: [organizationSubscriptions.organizationId],
  }),
  transactions: many(paymentTransactions),
  auditLogs: many(subscriptionAuditLog),
  jobs: many(jobs),
  clients: many(clients),
  forms: many(forms),
  emailTemplates: many(emailTemplates),
  pipelineStages: many(pipelineStages),
  talentPool: many(talentPool),
  sourcingRuns: many(jobSourcingRuns),
  sourcedCandidates: many(jobSourcedCandidates),
  sourcedCandidateOutreachCampaigns: many(sourcedCandidateOutreachCampaigns),
  sourcedCandidateOutreachLogs: many(sourcedCandidateOutreachLog),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
  invitedByUser: one(users, {
    fields: [organizationMembers.invitedBy],
    references: [users.id],
    relationName: "invitedByUser",
  }),
}));

export const mauticContactLinksRelations = relations(mauticContactLinks, ({ one }) => ({
  user: one(users, {
    fields: [mauticContactLinks.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [mauticContactLinks.organizationId],
    references: [organizations.id],
  }),
}));

export const organizationInvitesRelations = relations(organizationInvites, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationInvites.organizationId],
    references: [organizations.id],
  }),
  invitedByUser: one(users, {
    fields: [organizationInvites.invitedBy],
    references: [users.id],
  }),
  acceptedByUser: one(users, {
    fields: [organizationInvites.acceptedBy],
    references: [users.id],
    relationName: "acceptedByUser",
  }),
}));

export const organizationJoinRequestsRelations = relations(organizationJoinRequests, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationJoinRequests.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationJoinRequests.userId],
    references: [users.id],
  }),
  respondedByUser: one(users, {
    fields: [organizationJoinRequests.respondedBy],
    references: [users.id],
    relationName: "respondedByUser",
  }),
}));

export const domainClaimRequestsRelations = relations(domainClaimRequests, ({ one }) => ({
  organization: one(organizations, {
    fields: [domainClaimRequests.organizationId],
    references: [organizations.id],
  }),
  requestedByUser: one(users, {
    fields: [domainClaimRequests.requestedBy],
    references: [users.id],
  }),
  reviewedByUser: one(users, {
    fields: [domainClaimRequests.reviewedBy],
    references: [users.id],
    relationName: "reviewedByUser",
  }),
}));

export const subscriptionPlansRelations = relations(subscriptionPlans, ({ many }) => ({
  subscriptions: many(organizationSubscriptions),
}));

export const organizationSubscriptionsRelations = relations(organizationSubscriptions, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [organizationSubscriptions.organizationId],
    references: [organizations.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [organizationSubscriptions.planId],
    references: [subscriptionPlans.id],
  }),
  transactions: many(paymentTransactions),
  alerts: many(subscriptionAlerts),
  auditLogs: many(subscriptionAuditLog),
  adminOverrideByUser: one(users, {
    fields: [organizationSubscriptions.adminOverrideBy],
    references: [users.id],
    relationName: "adminOverrideByUser",
  }),
}));

export const paymentTransactionsRelations = relations(paymentTransactions, ({ one }) => ({
  organization: one(organizations, {
    fields: [paymentTransactions.organizationId],
    references: [organizations.id],
  }),
  subscription: one(organizationSubscriptions, {
    fields: [paymentTransactions.subscriptionId],
    references: [organizationSubscriptions.id],
  }),
}));

export const webhookEventsRelations = relations(webhookEvents, () => ({}));

export const subscriptionAlertsRelations = relations(subscriptionAlerts, ({ one }) => ({
  subscription: one(organizationSubscriptions, {
    fields: [subscriptionAlerts.subscriptionId],
    references: [organizationSubscriptions.id],
  }),
}));

export const subscriptionAuditLogRelations = relations(subscriptionAuditLog, ({ one }) => ({
  organization: one(organizations, {
    fields: [subscriptionAuditLog.organizationId],
    references: [organizations.id],
  }),
  subscription: one(organizationSubscriptions, {
    fields: [subscriptionAuditLog.subscriptionId],
    references: [organizationSubscriptions.id],
  }),
  performedByUser: one(users, {
    fields: [subscriptionAuditLog.performedBy],
    references: [users.id],
  }),
}));

export const checkoutIntentsRelations = relations(checkoutIntents, ({ one }) => ({
  user: one(users, {
    fields: [checkoutIntents.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [checkoutIntents.organizationId],
    references: [organizations.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [checkoutIntents.planId],
    references: [subscriptionPlans.id],
  }),
  claimedByUser: one(users, {
    fields: [checkoutIntents.claimedBy],
    references: [users.id],
    relationName: "claimedByUser",
  }),
}));

// =====================================================
// SIGNAL SOURCING RELATIONS
// =====================================================

export const jobSourcingRunsRelations = relations(jobSourcingRuns, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [jobSourcingRuns.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, {
    fields: [jobSourcingRuns.jobId],
    references: [jobs.id],
  }),
  candidates: many(jobSourcedCandidates),
}));

export const jobSourcedCandidatesRelations = relations(jobSourcedCandidates, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [jobSourcedCandidates.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, {
    fields: [jobSourcedCandidates.jobId],
    references: [jobs.id],
  }),
  sourcingRun: one(jobSourcingRuns, {
    fields: [jobSourcedCandidates.requestId],
    references: [jobSourcingRuns.requestId],
  }),
  convertedApplication: one(applications, {
    fields: [jobSourcedCandidates.convertedApplicationId],
    references: [applications.id],
  }),
  outreachCampaign: one(sourcedCandidateOutreachCampaigns, {
    fields: [jobSourcedCandidates.lastOutreachCampaignId],
    references: [sourcedCandidateOutreachCampaigns.campaignId],
  }),
  outreachLogs: many(sourcedCandidateOutreachLog),
}));

export const sourcedCandidateOutreachCampaignsRelations = relations(sourcedCandidateOutreachCampaigns, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [sourcedCandidateOutreachCampaigns.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, {
    fields: [sourcedCandidateOutreachCampaigns.jobId],
    references: [jobs.id],
  }),
  launcher: one(users, {
    fields: [sourcedCandidateOutreachCampaigns.launchedBy],
    references: [users.id],
  }),
  outreachLogs: many(sourcedCandidateOutreachLog),
}));

export const sourcedCandidateOutreachLogRelations = relations(sourcedCandidateOutreachLog, ({ one }) => ({
  organization: one(organizations, {
    fields: [sourcedCandidateOutreachLog.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, {
    fields: [sourcedCandidateOutreachLog.jobId],
    references: [jobs.id],
  }),
  sourcedCandidate: one(jobSourcedCandidates, {
    fields: [sourcedCandidateOutreachLog.sourcedCandidateId],
    references: [jobSourcedCandidates.id],
  }),
  campaign: one(sourcedCandidateOutreachCampaigns, {
    fields: [sourcedCandidateOutreachLog.campaignId],
    references: [sourcedCandidateOutreachCampaigns.campaignId],
  }),
  sender: one(users, {
    fields: [sourcedCandidateOutreachLog.sentBy],
    references: [users.id],
  }),
}));

// =====================================================
// END SIGNAL SOURCING RELATIONS
// =====================================================

// =====================================================
// END ORGANIZATION & SUBSCRIPTION RELATIONS
// =====================================================

// Types and insert schemas for new tables
export const insertPipelineStageSchema = createInsertSchema(pipelineStages).pick({
  name: true,
  order: true,
  color: true,
  isDefault: true,
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).pick({
  name: true,
  subject: true,
  body: true,
  templateType: true,
  isDefault: true,
});

export const insertApplicationFeedbackSchema = createInsertSchema(applicationFeedback).pick({
  applicationId: true,
  overallScore: true,
  recommendation: true,
  notes: true,
}).extend({
  applicationId: z.number().int().positive(),
  overallScore: z.number().int().min(1).max(5),
  recommendation: z.enum(['advance', 'hold', 'reject']),
  notes: z.string().max(2000).optional(),
});

export const insertConsultantSchema = createInsertSchema(consultants).pick({
  name: true,
  email: true,
  experience: true,
  linkedinUrl: true,
  domains: true,
  description: true,
  photoUrl: true,
  isActive: true,
}).extend({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  experience: z.string().min(1).max(50),
  linkedinUrl: z.string().url().optional(),
  domains: z.string().min(1).max(1000),
  description: z.string().max(2000).optional(),
  photoUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
});

export const insertClientSchema = createInsertSchema(clients).pick({
  name: true,
  domain: true,
  primaryContactName: true,
  primaryContactEmail: true,
  notes: true,
}).extend({
  name: z.string().min(1).max(200),
  domain: z.string().max(200).optional(),
  primaryContactName: z.string().max(200).optional(),
  primaryContactEmail: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  firstName: true,
  lastName: true,
  role: true,
});

// Registration payload extends insertUserSchema with optional org invite token
export const registerPayloadSchema = insertUserSchema.extend({
  inviteToken: z.string().length(64).optional(),
});

export type RegisterPayload = z.infer<typeof registerPayloadSchema>;

export const insertContactSchema = createInsertSchema(contactSubmissions).pick({
  name: true,
  email: true,
  phone: true,
  company: true,
  location: true,
  message: true,
});

const countWords = (value: string): number =>
  value
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

export const insertJobSchema = createInsertSchema(jobs).pick({
  title: true,
  location: true,
  type: true,
  description: true,
  originalJD: true,
  skills: true,
  deadline: true,
  clientId: true,
  hiringManagerId: true,
  salaryMin: true,
  salaryMax: true,
  salaryPeriod: true,
  goodToHaveSkills: true,
  educationRequirement: true,
  experienceYears: true,
  experienceYearsMax: true,
}).extend({
  title: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  type: z.enum(["full-time", "part-time", "contract", "remote"]),
  description: z.string().min(10).max(20000),
  originalJD: z.string().min(10).max(20000).optional(),
  skills: z.array(z.string().min(1).max(50)).max(20).optional(),
  deadline: z.string().transform(str => new Date(str)).optional(),
  clientId: z.number().int().positive().optional(),
  hiringManagerId: z.number().int().positive().optional(),
  salaryMin: z.number().int().positive().optional(),
  salaryMax: z.number().int().positive().optional(),
  salaryPeriod: z.enum(["per_month", "per_year"]).optional(),
  goodToHaveSkills: z.array(z.string().min(1).max(50)).max(20).optional(),
  educationRequirement: z.string().max(500).optional(),
  experienceYears: z.number().int().min(0).max(50).optional(),
  experienceYearsMax: z.number().int().min(0).max(50).optional(),
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
  phone: z.string().regex(/^\d{10}$/, "Please enter exactly 10 digits for your phone number"),
  coverLetter: z.string().max(2000).optional(),
  status: z.enum(["submitted", "reviewed", "shortlisted", "rejected"]).optional(),
  notes: z.string().max(1000).optional(),
  whatsappConsent: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean()
  ).default(true),
});

// Zod schema for recruiter-add endpoint (separate from public apply)
export const recruiterAddApplicationSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.preprocess((val) => {
    const raw = val === undefined || val === null ? '' : String(val);
    return raw.replace(/\D/g, '');
  }, z.string().regex(/^\d{10}$/, "Please enter exactly 10 digits for your phone number")),
  coverLetter: z.string().max(2000).optional(),
  source: z.enum(['recruiter_add', 'referral', 'linkedin', 'indeed', 'other']).default('recruiter_add'),
  sourceMetadata: z.preprocess((val) => {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  }, z.object({
    referrer: z.string().optional(),
    platform: z.string().optional(),
    notes: z.string().max(500).optional(),
  }).optional()),
  currentStage: z.coerce.number().int().positive().optional(), // Initial stage assignment
  whatsappConsent: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean()
  ).default(true),
});

export const insertUserProfileSchema = createInsertSchema(userProfiles).pick({
  displayName: true,
  company: true,
  photoUrl: true,
  bio: true,
  skills: true,
  linkedin: true,
  location: true,
  isPublic: true,
}).extend({
  displayName: z.string().max(100).optional(),
  company: z.string().max(200).optional(),
  photoUrl: z.string().url().max(500).optional(),
  bio: z.string().max(2000).optional(),
  skills: z.array(z.string().min(1).max(50)).max(20).optional(),
  linkedin: z.string().url().optional(),
  location: z.string().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
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
export type RecruiterAddApplication = z.infer<typeof recruiterAddApplicationSchema>;
export type Application = typeof applications.$inferSelect;

export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfiles.$inferSelect;

export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

export type InsertJobAnalytics = z.infer<typeof insertJobAnalyticsSchema>;
export type JobAnalytics = typeof jobAnalytics.$inferSelect;

export type JobAuditLog = typeof jobAuditLog.$inferSelect;

export type PipelineStage = typeof pipelineStages.$inferSelect;
export type InsertPipelineStage = z.infer<typeof insertPipelineStageSchema>;

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;

export type ApplicationStageHistory = typeof applicationStageHistory.$inferSelect;

export type ApplicationFeedback = typeof applicationFeedback.$inferSelect;
export type InsertApplicationFeedback = z.infer<typeof insertApplicationFeedbackSchema>;

export type EmailAuditLog = typeof emailAuditLog.$inferSelect;

export type AutomationSetting = typeof automationSettings.$inferSelect;

export type Consultant = typeof consultants.$inferSelect;
export type InsertConsultant = z.infer<typeof insertConsultantSchema>;

// Client Shortlists: Insert schemas and types
export const insertClientShortlistSchema = z.object({
  clientId: z.number().int().positive(),
  jobId: z.number().int().positive(),
  title: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  applicationIds: z.array(z.number().int().positive()).min(1).max(50), // 1-50 candidates
  expiresAt: z.string().datetime().optional(),
});

export const insertClientFeedbackSchema = z.object({
  applicationId: z.number().int().positive(),
  recommendation: z.enum(['advance', 'reject', 'hold']),
  notes: z.string().max(2000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

export type ClientShortlist = typeof clientShortlists.$inferSelect;
export type InsertClientShortlist = z.infer<typeof insertClientShortlistSchema>;

export type ClientShortlistItem = typeof clientShortlistItems.$inferSelect;

export type ClientFeedback = typeof clientFeedback.$inferSelect;
export type InsertClientFeedback = z.infer<typeof insertClientFeedbackSchema>;

// Forms Feature: Insert schemas and types
export const insertFormSchema = createInsertSchema(forms).pick({
  name: true,
  description: true,
  isPublished: true,
}).extend({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  isPublished: z.boolean().optional(),
});

export const insertFormFieldSchema = z.object({
  type: z.enum(['short_text', 'long_text', 'yes_no', 'select', 'date', 'file', 'email']),
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  options: z.string().optional(), // JSON string for select options
  order: z.number().int().min(0),
});

export const insertFormInvitationSchema = z.object({
  applicationId: z.number().int().positive(),
  formId: z.number().int().positive(),
  customMessage: z.string().max(1000).optional(),
});

export const insertFormResponseSchema = z.object({
  invitationId: z.number().int().positive(),
  applicationId: z.number().int().positive(),
});

export const insertFormResponseAnswerSchema = z.object({
  fieldId: z.number().int().positive(),
  value: z.string().optional(),
  fileUrl: z.string().url().optional(),
});

export type Form = typeof forms.$inferSelect;
export type InsertForm = z.infer<typeof insertFormSchema>;

export type FormField = typeof formFields.$inferSelect;
export type InsertFormField = z.infer<typeof insertFormFieldSchema>;

export type FormInvitation = typeof formInvitations.$inferSelect;
export type InsertFormInvitation = z.infer<typeof insertFormInvitationSchema>;

export type FormResponse = typeof formResponses.$inferSelect;
export type InsertFormResponse = z.infer<typeof insertFormResponseSchema>;

export type FormResponseAnswer = typeof formResponseAnswers.$inferSelect;
export type InsertFormResponseAnswer = z.infer<typeof insertFormResponseAnswerSchema>;

// Talent Pool: Insert schema and types
export const insertTalentPoolSchema = createInsertSchema(talentPool).pick({
  email: true,
  name: true,
  phone: true,
  source: true,
  formResponseId: true,
  notes: true,
  resumeUrl: true,
}).extend({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),
  source: z.enum(['external_form', 'manual', 'import']).optional(),
  notes: z.string().max(2000).optional(),
  resumeUrl: z.string().url().optional(),
});

export type TalentPool = typeof talentPool.$inferSelect;
export type InsertTalentPool = z.infer<typeof insertTalentPoolSchema>;

// AI Matching: Insert schemas and types
export const insertCandidateResumeSchema = createInsertSchema(candidateResumes).pick({
  label: true,
  gcsPath: true,
  extractedText: true,
  isDefault: true,
}).extend({
  label: z.string().min(1).max(100),
  gcsPath: z.string().min(1),
  extractedText: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const insertUserAiUsageSchema = createInsertSchema(userAiUsage).pick({
  kind: true,
  tokensIn: true,
  tokensOut: true,
  costUsd: true,
  metadata: true,
}).extend({
  kind: z.enum(['fit', 'content', 'role', 'feedback', 'summary']),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  costUsd: z.string(), // Decimal as string
  metadata: z.record(z.any()).optional(),
});

export type CandidateResume = typeof candidateResumes.$inferSelect;
export type InsertCandidateResume = z.infer<typeof insertCandidateResumeSchema>;

export type UserAiUsage = typeof userAiUsage.$inferSelect;
export type InsertUserAiUsage = z.infer<typeof insertUserAiUsageSchema>;

export const insertResumeImportBatchSchema = createInsertSchema(resumeImportBatches).pick({
  organizationId: true,
  jobId: true,
  uploadedByUserId: true,
  status: true,
  fileCount: true,
  processedCount: true,
  readyCount: true,
  needsReviewCount: true,
  failedCount: true,
}).extend({
  status: z.enum(['queued', 'processing', 'ready_for_review', 'completed', 'failed']).optional(),
});

export const insertResumeImportItemSchema = createInsertSchema(resumeImportItems).pick({
  batchId: true,
  organizationId: true,
  jobId: true,
  uploadedByUserId: true,
  originalFilename: true,
  gcsPath: true,
  contentHash: true,
  extractedText: true,
  extractionMethod: true,
  parsedName: true,
  parsedEmail: true,
  parsedPhone: true,
  status: true,
  errorReason: true,
  applicationId: true,
  sourceMetadata: true,
  attempts: true,
  nextAttemptAt: true,
  lastProcessedAt: true,
}).extend({
  extractionMethod: z.enum(['native_text', 'mistral_ocr', 'failed']).optional(),
  parsedEmail: z.string().email().optional().nullable(),
  parsedPhone: z.string().regex(/^\d{10}$/).optional().nullable(),
  status: z.enum(['queued', 'processing', 'processed', 'needs_review', 'finalized', 'failed', 'duplicate']).optional(),
  errorReason: z.string().max(1000).optional().nullable(),
  sourceMetadata: z.record(z.any()).optional().nullable(),
});

// Rejection reasons enum for analytics
export const rejectionReasons = [
  'skills_mismatch',
  'experience_gap',
  'salary_expectations',
  'culture_fit',
  'withdrew',
  'no_show',
  'position_filled',
  'other'
] as const;
export type RejectionReason = typeof rejectionReasons[number];

// Automation Events: Insert schemas and types
export const insertAutomationEventSchema = z.object({
  automationKey: z.string().min(1).max(100),
  targetType: z.enum(['application', 'job', 'user']),
  targetId: z.number().int().positive(),
  outcome: z.enum(['success', 'failed', 'skipped']).default('success'),
  errorMessage: z.string().max(1000).optional(),
  metadata: z.record(z.any()).optional(),
  triggeredBy: z.number().int().positive().optional(),
});

export type AutomationEvent = typeof automationEvents.$inferSelect;
export type InsertAutomationEvent = z.infer<typeof insertAutomationEventSchema>;

// WhatsApp: Insert schemas and types
export const insertWhatsappTemplateSchema = createInsertSchema(whatsappTemplates).pick({
  name: true,
  metaTemplateName: true,
  metaTemplateId: true,
  language: true,
  templateType: true,
  category: true,
  bodyTemplate: true,
  status: true,
}).extend({
  name: z.string().min(1).max(200),
  metaTemplateName: z.string().min(1).max(100),
  metaTemplateId: z.string().max(100).optional(),
  language: z.string().length(2).default('en'),
  templateType: z.enum(['application_received', 'interview_invite', 'status_update', 'offer_extended', 'rejection']),
  category: z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']).default('UTILITY'),
  bodyTemplate: z.string().min(1).max(1024),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});

export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type InsertWhatsappTemplate = z.infer<typeof insertWhatsappTemplateSchema>;

export type WhatsappAuditLog = typeof whatsappAuditLog.$inferSelect;

// Hiring Manager Invitations: Insert schemas and types
export const insertHiringManagerInvitationSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().max(100).optional(),
});

export type HiringManagerInvitation = typeof hiringManagerInvitations.$inferSelect;
export type InsertHiringManagerInvitation = z.infer<typeof insertHiringManagerInvitationSchema>;

// Job Recruiters: Insert schemas and types
export const insertJobRecruiterSchema = z.object({
  jobId: z.number().int().positive(),
  recruiterId: z.number().int().positive(),
});

export type JobRecruiter = typeof jobRecruiters.$inferSelect;
export type InsertJobRecruiter = z.infer<typeof insertJobRecruiterSchema>;

// Co-Recruiter Invitations: Insert schemas and types
export const insertCoRecruiterInvitationSchema = z.object({
  jobId: z.number().int().positive(),
  email: z.string().email().max(255),
});

export type CoRecruiterInvitation = typeof coRecruiterInvitations.$inferSelect;
export type InsertCoRecruiterInvitation = z.infer<typeof insertCoRecruiterInvitationSchema>;

// AI Fit Jobs: Insert schemas and types
export const insertAiFitJobSchema = z.object({
  bullJobId: z.string().min(1),
  queueName: z.enum(['ai:interactive', 'ai:batch']),
  userId: z.number().int().positive(),
  applicationId: z.number().int().positive().optional(),
  applicationIds: z.array(z.number().int().positive()).optional(),
  status: z.enum(['pending', 'active', 'completed', 'failed', 'cancelled']).default('pending'),
  progress: z.number().int().min(0).max(100).default(0),
  processedCount: z.number().int().min(0).default(0),
  totalCount: z.number().int().min(0).optional(),
  result: z.record(z.any()).optional(),
  error: z.string().optional(),
  errorCode: z.enum(['QUOTA_EXHAUSTED', 'CIRCUIT_OPEN', 'VALIDATION', 'TRANSIENT', 'ENQUEUE_FAILED']).optional(),
});

export type AiFitJob = typeof aiFitJobs.$inferSelect;
export type InsertAiFitJob = z.infer<typeof insertAiFitJobSchema>;

// ActiveKG Graph Sync: Types
export type ApplicationGraphSyncJob = typeof applicationGraphSyncJobs.$inferSelect;
export type InsertApplicationGraphSyncJob = typeof applicationGraphSyncJobs.$inferInsert;
export type ResumeImportBatch = typeof resumeImportBatches.$inferSelect;
export type InsertResumeImportBatch = z.infer<typeof insertResumeImportBatchSchema>;
export type ResumeImportItem = typeof resumeImportItems.$inferSelect;
export type InsertResumeImportItem = z.infer<typeof insertResumeImportItemSchema>;

// Batch fit result types (for clarity)
export interface BatchFitResultItem {
  applicationId: number;
  status: 'success' | 'cached' | 'requiresPaid' | 'error';
  score?: number;
  label?: string;
  reasons?: string[];
  error?: string;
}

export interface BatchFitResult {
  results: BatchFitResultItem[];
  summary: {
    total: number;
    succeeded: number;
    cached: number;
    requiresPaid: number;
    errors: number;
  };
}

// =====================================================
// ORGANIZATION & SUBSCRIPTION INSERT SCHEMAS & TYPES
// =====================================================

// Organization role enum
export const organizationRoles = ['owner', 'admin', 'member'] as const;
export type OrganizationRole = typeof organizationRoles[number];

// Organization membership status
export const membershipStatuses = ['active', 'inactive', 'pending'] as const;
export type MembershipStatus = typeof membershipStatuses[number];

// Subscription statuses
export const subscriptionStatuses = ['active', 'past_due', 'cancelled', 'trialing'] as const;
export type SubscriptionStatus = typeof subscriptionStatuses[number];

// Billing cycles
export const billingCycles = ['monthly', 'annual'] as const;
export type BillingCycle = typeof billingCycles[number];

// Join request statuses
export const joinRequestStatuses = ['pending', 'approved', 'rejected'] as const;
export type JoinRequestStatus = typeof joinRequestStatuses[number];

// Domain claim statuses
export const domainClaimStatuses = ['pending', 'approved', 'rejected'] as const;
export type DomainClaimStatus = typeof domainClaimStatuses[number];

// Payment transaction types
export const paymentTransactionTypes = ['subscription', 'seat_addition', 'credit_pack', 'refund'] as const;
export type PaymentTransactionType = typeof paymentTransactionTypes[number];

// Payment statuses
export const paymentStatuses = ['pending', 'completed', 'failed', 'refunded'] as const;
export type PaymentStatus = typeof paymentStatuses[number];

// Webhook statuses
export const webhookStatuses = ['processing', 'processed', 'skipped', 'failed'] as const;
export type WebhookStatus = typeof webhookStatuses[number];

// Subscription audit actions
export const subscriptionAuditActions = [
  'created', 'upgraded', 'downgraded', 'seats_added', 'seats_removed',
  'cancelled', 'reactivated', 'admin_override'
] as const;
export type SubscriptionAuditAction = typeof subscriptionAuditActions[number];

// Insert Schemas
export const insertOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  logo: z.string().url().optional(),
  domain: z.string().max(255).optional(),
  gstin: z.string().max(15).optional(),
  billingName: z.string().max(200).optional(),
  billingAddress: z.string().max(500).optional(),
  billingCity: z.string().max(100).optional(),
  billingState: z.string().max(100).optional(),
  billingPincode: z.string().max(10).optional(),
  billingContactEmail: z.string().email().optional(),
  billingContactName: z.string().max(200).optional(),
  settings: z.record(z.any()).optional(),
});

export const insertOrganizationMemberSchema = z.object({
  organizationId: z.number().int().positive(),
  userId: z.number().int().positive(),
  role: z.enum(organizationRoles).default('member'),
  seatAssigned: z.boolean().default(true),
});

export const insertOrganizationInviteSchema = z.object({
  organizationId: z.number().int().positive(),
  email: z.string().email().max(255),
  role: z.enum(organizationRoles).default('member'),
});

export const insertOrganizationJoinRequestSchema = z.object({
  organizationId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

export const insertDomainClaimRequestSchema = z.object({
  organizationId: z.number().int().positive(),
  domain: z.string().min(1).max(255),
});

export const insertSubscriptionPlanSchema = z.object({
  name: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  pricePerSeatMonthly: z.number().int().min(0),
  pricePerSeatAnnual: z.number().int().min(0),
  aiCreditsPerSeatMonthly: z.number().int().min(0),
  maxCreditRolloverMonths: z.number().int().min(0).default(3),
  features: z.record(z.any()),
  sortOrder: z.number().int().default(0),
});

export const insertOrganizationSubscriptionSchema = z.object({
  organizationId: z.number().int().positive(),
  planId: z.number().int().positive(),
  seats: z.number().int().min(1).default(1),
  billingCycle: z.enum(billingCycles),
  status: z.enum(subscriptionStatuses).default('active'),
  startDate: z.date(),
  currentPeriodStart: z.date(),
  currentPeriodEnd: z.date(),
});

export const insertPaymentTransactionSchema = z.object({
  organizationId: z.number().int().positive(),
  subscriptionId: z.number().int().positive().optional(),
  type: z.enum(paymentTransactionTypes),
  amount: z.number().int().min(0),
  taxAmount: z.number().int().min(0).default(0),
  totalAmount: z.number().int().min(0),
  currency: z.string().default('INR'),
  status: z.enum(paymentStatuses),
  metadata: z.record(z.any()).optional(),
});

export const insertWebhookEventSchema = z.object({
  provider: z.string().min(1),
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  payload: z.record(z.any()),
  status: z.enum(webhookStatuses),
  errorMessage: z.string().optional(),
});

export const insertSubscriptionAlertSchema = z.object({
  subscriptionId: z.number().int().positive(),
  alertType: z.string().min(1),
  recipientEmail: z.string().email(),
  emailStatus: z.string().default('sent'),
});

export const insertSubscriptionAuditLogSchema = z.object({
  organizationId: z.number().int().positive(),
  subscriptionId: z.number().int().positive().optional(),
  action: z.enum(subscriptionAuditActions),
  previousValue: z.record(z.any()).optional(),
  newValue: z.record(z.any()).optional(),
  reason: z.string().max(500).optional(),
});

export const checkoutIntentStatuses = ['pending', 'paid', 'claimed', 'expired'] as const;

export const insertCheckoutIntentSchema = z.object({
  email: z.string().email(),
  orgName: z.string().min(2).max(100),
  userId: z.number().int().positive().optional(),
  organizationId: z.number().int().positive().optional(),
  planId: z.number().int().positive(),
  seats: z.number().int().min(1).default(1),
  billingCycle: z.enum(['monthly', 'annual']).default('monthly'),
  gstin: z.string().max(20).optional(),
  billingName: z.string().max(200).optional(),
  billingAddress: z.string().max(500).optional(),
  billingCity: z.string().max(100).optional(),
  billingState: z.string().max(100).optional(),
  billingPincode: z.string().max(10).optional(),
  status: z.enum(checkoutIntentStatuses).default('pending'),
  cashfreeOrderId: z.string().optional(),
  claimToken: z.string().optional(),
  expiresAt: z.date(),
});

// Types
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type InsertOrganizationMember = z.infer<typeof insertOrganizationMemberSchema>;

export type MauticContactLink = typeof mauticContactLinks.$inferSelect;

export type OrganizationInvite = typeof organizationInvites.$inferSelect;
export type InsertOrganizationInvite = z.infer<typeof insertOrganizationInviteSchema>;

export type OrganizationJoinRequest = typeof organizationJoinRequests.$inferSelect;
export type InsertOrganizationJoinRequest = z.infer<typeof insertOrganizationJoinRequestSchema>;

export type DomainClaimRequest = typeof domainClaimRequests.$inferSelect;
export type InsertDomainClaimRequest = z.infer<typeof insertDomainClaimRequestSchema>;

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;

export type OrganizationSubscription = typeof organizationSubscriptions.$inferSelect;
export type InsertOrganizationSubscription = z.infer<typeof insertOrganizationSubscriptionSchema>;
export type OrganizationCreditBalance = typeof organizationCreditBalances.$inferSelect;
export type OrganizationCreditTransaction = typeof organizationCreditTransactions.$inferSelect;

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;

export type SubscriptionAlert = typeof subscriptionAlerts.$inferSelect;
export type InsertSubscriptionAlert = z.infer<typeof insertSubscriptionAlertSchema>;

export type SubscriptionAuditLog = typeof subscriptionAuditLog.$inferSelect;
export type InsertSubscriptionAuditLog = z.infer<typeof insertSubscriptionAuditLogSchema>;

export type CheckoutIntent = typeof checkoutIntents.$inferSelect;
export type InsertCheckoutIntent = z.infer<typeof insertCheckoutIntentSchema>;

// =====================================================
// END ORGANIZATION & SUBSCRIPTION INSERT SCHEMAS & TYPES
// =====================================================

// =====================================================
// SIGNAL SOURCING ENUMS, INSERT SCHEMAS & TYPES
// =====================================================

// Sourcing run statuses
export const sourcingRunStatuses = ['pending', 'submitted', 'processing', 'completed', 'failed', 'expired'] as const;
export type SourcingRunStatus = typeof sourcingRunStatuses[number];

// Raw Signal source types — store as-is, derive UI buckets at read time
export const signalSourceTypes = ['pool_enriched', 'pool', 'discovered'] as const;
export type SignalSourceType = typeof signalSourceTypes[number];

// Recruiter-managed candidate states
export const sourcedCandidateStates = ['new', 'shortlisted', 'hidden', 'converted'] as const;
export type SourcedCandidateState = typeof sourcedCandidateStates[number];

export const insertJobSourcingRunSchema = z.object({
  organizationId: z.number().int().positive(),
  jobId: z.number().int().positive(),
  requestId: z.string().min(1).max(255),
  externalJobId: z.string().min(1).max(255),
  contextHash: z.string().min(1).max(128),
  callbackUrl: z.string().url().optional(),
  meta: z.record(z.any()).optional(),
  expiresAt: z.date().optional(),
});

export const insertJobSourcedCandidateSchema = z.object({
  organizationId: z.number().int().positive(),
  jobId: z.number().int().positive(),
  requestId: z.string().min(1).max(255),
  signalCandidateId: z.string().min(1).max(255),
  fitScore: z.number().int().min(0).max(100).optional(),
  fitBreakdown: z.record(z.any()).optional(),
  sourceType: z.enum(signalSourceTypes),
  candidateSummary: z.record(z.any()).optional(),
  foundEmail: z.string().email().optional(),
  foundEmails: z.array(z.string().email()).optional(),
  emailResolvedAt: z.date().optional(),
  emailResolveStatus: z.enum(['pending', 'resolved', 'not_found', 'failed']).optional(),
  outreachCount: z.number().int().min(0).max(3).optional(),
  lastOutreachRound: z.number().int().min(1).max(3).optional(),
  lastOutreachCampaignId: z.string().min(1).max(255).optional(),
  lastOutreachAt: z.date().optional(),
  lastOutreachStatus: z.enum(['sent', 'failed']).optional(),
  appliedAt: z.date().optional(),
  appliedFromCampaignId: z.string().min(1).max(255).optional(),
  appliedAfterRound: z.number().int().min(1).max(3).optional(),
});

export type JobSourcingRun = typeof jobSourcingRuns.$inferSelect;
export type InsertJobSourcingRun = z.infer<typeof insertJobSourcingRunSchema>;

export type JobSourcedCandidate = typeof jobSourcedCandidates.$inferSelect;
export type InsertJobSourcedCandidate = z.infer<typeof insertJobSourcedCandidateSchema>;
export type SourcedCandidateOutreachCampaign = typeof sourcedCandidateOutreachCampaigns.$inferSelect;
export type SourcedCandidateOutreachLog = typeof sourcedCandidateOutreachLog.$inferSelect;

// =====================================================
// END SIGNAL SOURCING INSERT SCHEMAS & TYPES
// =====================================================

// =====================================================
// RECRUITER FEEDBACK EVENTS (Global Memory)
// =====================================================

export const recruiterFeedbackEvents = pgTable("recruiter_feedback_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  jobId: integer("job_id").notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  userId: integer("user_id").references(() => users.id),
  signalCandidateId: text("signal_candidate_id").notNull(),
  action: text("action").notNull(), // 'shortlisted' | 'hidden' | 'converted'
  eventId: text("event_id").notNull().unique(), // idempotency key

  // Snapshot of candidate state at action time
  rankAtTime: integer("rank_at_time"),
  fitScoreAtTime: integer("fit_score_at_time"),
  sourceTypeAtTime: text("source_type_at_time"),
  matchTierAtTime: text("match_tier_at_time"),
  locationMatchAtTime: text("location_match_at_time"),

  // Job context for aggregation
  roleFamily: text("role_family"),
  locationCountryCode: text("location_country_code"),
  seniorityBand: text("seniority_band"),

  // Forward-sync status
  syncedToSignalAt: timestamp("synced_to_signal_at"), // null = not yet synced

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  eventIdIdx: uniqueIndex("rfb_event_id_idx").on(table.eventId),
  orgJobIdx: index("rfb_org_job_idx").on(table.organizationId, table.jobId),
  candidateIdx: index("rfb_candidate_idx").on(table.signalCandidateId),
  actionIdx: index("rfb_action_idx").on(table.action),
  unsyncedIdx: index("rfb_unsynced_idx").on(table.syncedToSignalAt),
}));
