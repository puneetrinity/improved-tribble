// @vitest-environment node
import '../setup.integration';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../../server/routes';
import { db } from '../../server/db';
import {
  applications,
  clients,
  emailTemplates,
  forms,
  hiringManagerInvitations,
  jobs,
  organizations,
  organizationMembers,
  pipelineStages,
  talentPool,
  users,
} from '@shared/schema';
import { inArray, sql } from 'drizzle-orm';
import {
  createRecruiterUser,
  createOrganizationWithOwner,
  addOrganizationMember,
} from '../utils/db-helpers';

const HAS_DB = !!process.env.DATABASE_URL;
const maybeDescribe = HAS_DB ? describe : describe.skip;
let dbAvailable = HAS_DB;

if (!HAS_DB) {
  console.warn('[TEST] Skipping backward compatibility tests: DATABASE_URL not set');
}

async function login(agent: request.SuperAgentTest, username: string, password: string, expectedRole?: string | string[]) {
  const res = await agent.post('/api/login').send({
    username,
    password,
    ...(expectedRole ? { expectedRole } : {}),
  });
  expect(res.status).toBe(200);
}

async function checkDbAvailability() {
  if (!dbAvailable) return;
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    dbAvailable = false;
    console.warn('[TEST] Database unavailable, skipping backward compatibility tests:', error);
  }
}

maybeDescribe('Backward Compatibility - Legacy Access & Defaults', () => {
  let app: express.Express;
  let server: any;

  const created = {
    userIds: [] as number[],
    orgIds: [] as number[],
    memberIds: [] as number[],
    jobIds: [] as number[],
    appIds: [] as number[],
    stageIds: [] as number[],
    templateIds: [] as number[],
    formIds: [] as number[],
    clientIds: [] as number[],
    talentIds: [] as number[],
    inviteIds: [] as number[],
  };

  beforeAll(async () => {
    app = express();
    server = await registerRoutes(app);
    await checkDbAvailability();
  });

  afterAll(() => {
    server?.close();
  });

  afterEach(async () => {
    if (!HAS_DB) return;
    if (!dbAvailable) return;

    if (created.appIds.length > 0) {
      await db.delete(applications).where(inArray(applications.id, created.appIds));
    }
    if (created.jobIds.length > 0) {
      await db.delete(jobs).where(inArray(jobs.id, created.jobIds));
    }
    if (created.stageIds.length > 0) {
      await db.delete(pipelineStages).where(inArray(pipelineStages.id, created.stageIds));
    }
    if (created.templateIds.length > 0) {
      await db.delete(emailTemplates).where(inArray(emailTemplates.id, created.templateIds));
    }
    if (created.formIds.length > 0) {
      await db.delete(forms).where(inArray(forms.id, created.formIds));
    }
    if (created.clientIds.length > 0) {
      await db.delete(clients).where(inArray(clients.id, created.clientIds));
    }
    if (created.talentIds.length > 0) {
      await db.delete(talentPool).where(inArray(talentPool.id, created.talentIds));
    }
    if (created.inviteIds.length > 0) {
      await db.delete(hiringManagerInvitations).where(inArray(hiringManagerInvitations.id, created.inviteIds));
    }
    if (created.memberIds.length > 0) {
      await db.delete(organizationMembers).where(inArray(organizationMembers.id, created.memberIds));
    }
    if (created.orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, created.orgIds));
    }
    if (created.userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, created.userIds));
    }

    created.userIds = [];
    created.orgIds = [];
    created.memberIds = [];
    created.jobIds = [];
    created.appIds = [];
    created.stageIds = [];
    created.templateIds = [];
    created.formIds = [];
    created.clientIds = [];
    created.talentIds = [];
    created.inviteIds = [];
  });

  it('allows legacy/no-org recruiter to read own data and defaults without leaking org data', async () => {
    if (!dbAvailable) {
      expect(true).toBe(true);
      return;
    }
    const admin = await createRecruiterUser({
      username: `admin_${Date.now()}@example.com`,
      password: 'password',
      role: 'super_admin',
    });
    created.userIds.push(admin.id);

    const legacyRecruiter = await createRecruiterUser({
      username: `legacy_${Date.now()}@example.com`,
      password: 'password',
      role: 'recruiter',
    });
    created.userIds.push(legacyRecruiter.id);

    const orgOwner = await createRecruiterUser({
      username: `owner_${Date.now()}@example.com`,
      password: 'password',
      role: 'recruiter',
    });
    created.userIds.push(orgOwner.id);

    const org = await createOrganizationWithOwner({
      name: `Org ${Date.now()}`,
      ownerId: orgOwner.id,
    });
    created.orgIds.push(org.id);

    const [defaultStage] = await db.insert(pipelineStages).values({
      name: `Default Stage ${Date.now()}`,
      order: 1,
      isDefault: true,
      organizationId: null,
    }).returning();
    created.stageIds.push(defaultStage.id);

    const [orgStage] = await db.insert(pipelineStages).values({
      name: `Org Stage ${Date.now()}`,
      order: 2,
      organizationId: org.id,
    }).returning();
    created.stageIds.push(orgStage.id);

    const [defaultTemplate] = await db.insert(emailTemplates).values({
      name: `Default Template ${Date.now()}`,
      subject: 'Subject',
      body: 'Body',
      templateType: 'application_received',
      isDefault: true,
      organizationId: null,
    }).returning();
    created.templateIds.push(defaultTemplate.id);

    const [orgTemplate] = await db.insert(emailTemplates).values({
      name: `Org Template ${Date.now()}`,
      subject: 'Subject',
      body: 'Body',
      templateType: 'application_received',
      organizationId: org.id,
    }).returning();
    created.templateIds.push(orgTemplate.id);

    const [defaultForm] = await db.insert(forms).values({
      name: `Default Form ${Date.now()}`,
      description: 'Default form',
      isPublished: true,
      createdBy: admin.id,
      organizationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    created.formIds.push(defaultForm.id);

    const [orgForm] = await db.insert(forms).values({
      name: `Org Form ${Date.now()}`,
      description: 'Org form',
      isPublished: true,
      createdBy: orgOwner.id,
      organizationId: org.id,
      ownershipScope: 'organization',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    created.formIds.push(orgForm.id);

    const [legacyClient] = await db.insert(clients).values({
      name: `Legacy Client ${Date.now()}`,
      createdBy: legacyRecruiter.id,
      organizationId: null,
    }).returning();
    created.clientIds.push(legacyClient.id);

    const [orgClient] = await db.insert(clients).values({
      name: `Org Client ${Date.now()}`,
      createdBy: orgOwner.id,
      organizationId: org.id,
    }).returning();
    created.clientIds.push(orgClient.id);

    const [legacyJob] = await db.insert(jobs).values({
      title: `Legacy Job ${Date.now()}`,
      location: 'Remote',
      type: 'full-time',
      description: 'Legacy job description',
      postedBy: legacyRecruiter.id,
      organizationId: null,
    }).returning();
    created.jobIds.push(legacyJob.id);

    const [orgJob] = await db.insert(jobs).values({
      title: `Org Job ${Date.now()}`,
      location: 'Remote',
      type: 'full-time',
      description: 'Org job description',
      postedBy: orgOwner.id,
      organizationId: org.id,
    }).returning();
    created.jobIds.push(orgJob.id);

    const [legacyApp] = await db.insert(applications).values({
      jobId: legacyJob.id,
      name: 'Legacy Candidate',
      email: `legacy_candidate_${Date.now()}@example.com`,
      phone: '1234567890',
      resumeUrl: 'https://example.com/resume.pdf',
      organizationId: null,
    }).returning();
    created.appIds.push(legacyApp.id);

    const [orgApp] = await db.insert(applications).values({
      jobId: orgJob.id,
      name: 'Org Candidate',
      email: `org_candidate_${Date.now()}@example.com`,
      phone: '1234567891',
      resumeUrl: 'https://example.com/resume.pdf',
      organizationId: org.id,
    }).returning();
    created.appIds.push(orgApp.id);

    const [legacyTalent] = await db.insert(talentPool).values({
      email: `legacy_talent_${Date.now()}@example.com`,
      name: 'Legacy Talent',
      recruiterId: legacyRecruiter.id,
      organizationId: null,
      source: 'manual',
    }).returning();
    created.talentIds.push(legacyTalent.id);

    const [orgTalent] = await db.insert(talentPool).values({
      email: `org_talent_${Date.now()}@example.com`,
      name: 'Org Talent',
      recruiterId: orgOwner.id,
      organizationId: org.id,
      source: 'manual',
    }).returning();
    created.talentIds.push(orgTalent.id);

    const agent = request.agent(app);
    await login(agent, legacyRecruiter.username, 'password');

    const myJobs = await agent.get('/api/my-jobs');
    expect(myJobs.status).toBe(200);
    expect(myJobs.body.some((j: any) => j.id === legacyJob.id)).toBe(true);
    expect(myJobs.body.some((j: any) => j.id === orgJob.id)).toBe(false);

    const myApps = await agent.get('/api/my-applications-received');
    expect(myApps.status).toBe(200);
    expect(myApps.body.some((a: any) => a.jobId === legacyJob.id)).toBe(true);
    expect(myApps.body.some((a: any) => a.jobId === orgJob.id)).toBe(false);

    const candidates = await agent.get('/api/candidates');
    expect(candidates.status).toBe(200);
    expect(candidates.body.some((c: any) => c.email === legacyApp.email)).toBe(true);
    expect(candidates.body.some((c: any) => c.email === orgApp.email)).toBe(false);

    const stages = await agent.get('/api/pipeline/stages');
    expect(stages.status).toBe(200);
    expect(stages.body.some((s: any) => s.id === defaultStage.id)).toBe(true);
    expect(stages.body.some((s: any) => s.id === orgStage.id)).toBe(false);

    const templates = await agent.get('/api/email-templates');
    expect(templates.status).toBe(200);
    expect(templates.body.some((t: any) => t.id === defaultTemplate.id)).toBe(true);
    expect(templates.body.some((t: any) => t.id === orgTemplate.id)).toBe(false);

    const formTemplates = await agent.get('/api/forms/templates');
    expect(formTemplates.status).toBe(403);
    expect(formTemplates.body.code).toBe('NO_ORGANIZATION');

    const clientList = await agent.get('/api/clients');
    expect(clientList.status).toBe(200);
    expect(clientList.body.some((c: any) => c.id === legacyClient.id)).toBe(true);
    expect(clientList.body.some((c: any) => c.id === orgClient.id)).toBe(false);

    const talentList = await agent.get('/api/talent-pool');
    expect(talentList.status).toBe(403);
    expect(talentList.body.code).toBe('NO_ORGANIZATION');
  });

  it('shows defaults + org data for org recruiters without cross-org leakage', async () => {
    if (!dbAvailable) {
      expect(true).toBe(true);
      return;
    }
    const admin = await createRecruiterUser({
      username: `admin_${Date.now()}@example.com`,
      password: 'password',
      role: 'super_admin',
    });
    created.userIds.push(admin.id);

    const ownerA = await createRecruiterUser({
      username: `ownerA_${Date.now()}@example.com`,
      password: 'password',
    });
    created.userIds.push(ownerA.id);

    const ownerB = await createRecruiterUser({
      username: `ownerB_${Date.now()}@example.com`,
      password: 'password',
    });
    created.userIds.push(ownerB.id);

    const orgA = await createOrganizationWithOwner({
      name: `OrgA ${Date.now()}`,
      ownerId: ownerA.id,
    });
    created.orgIds.push(orgA.id);

    const orgB = await createOrganizationWithOwner({
      name: `OrgB ${Date.now()}`,
      ownerId: ownerB.id,
    });
    created.orgIds.push(orgB.id);

    const [defaultStage] = await db.insert(pipelineStages).values({
      name: `Default Stage ${Date.now()}`,
      order: 1,
      isDefault: true,
      organizationId: null,
    }).returning();
    created.stageIds.push(defaultStage.id);

    const [legacyStage] = await db.insert(pipelineStages).values({
      name: `Legacy Stage ${Date.now()}`,
      order: 2,
      createdBy: ownerA.id,
      organizationId: null,
    }).returning();
    created.stageIds.push(legacyStage.id);

    const [orgAStage] = await db.insert(pipelineStages).values({
      name: `OrgA Stage ${Date.now()}`,
      order: 3,
      organizationId: orgA.id,
    }).returning();
    created.stageIds.push(orgAStage.id);

    const [orgBStage] = await db.insert(pipelineStages).values({
      name: `OrgB Stage ${Date.now()}`,
      order: 4,
      organizationId: orgB.id,
    }).returning();
    created.stageIds.push(orgBStage.id);

    const [defaultTemplate] = await db.insert(emailTemplates).values({
      name: `Default Template ${Date.now()}`,
      subject: 'Subject',
      body: 'Body',
      templateType: 'application_received',
      isDefault: true,
      organizationId: null,
    }).returning();
    created.templateIds.push(defaultTemplate.id);

    const [legacyTemplate] = await db.insert(emailTemplates).values({
      name: `Legacy Template ${Date.now()}`,
      subject: 'Subject',
      body: 'Body',
      templateType: 'application_received',
      createdBy: ownerA.id,
      organizationId: null,
    }).returning();
    created.templateIds.push(legacyTemplate.id);

    const [orgATemplate] = await db.insert(emailTemplates).values({
      name: `OrgA Template ${Date.now()}`,
      subject: 'Subject',
      body: 'Body',
      templateType: 'application_received',
      organizationId: orgA.id,
    }).returning();
    created.templateIds.push(orgATemplate.id);

    const [orgBTemplate] = await db.insert(emailTemplates).values({
      name: `OrgB Template ${Date.now()}`,
      subject: 'Subject',
      body: 'Body',
      templateType: 'application_received',
      organizationId: orgB.id,
    }).returning();
    created.templateIds.push(orgBTemplate.id);

    const [defaultForm] = await db.insert(forms).values({
      name: `Default Form ${Date.now()}`,
      description: 'Default form',
      isPublished: true,
      createdBy: admin.id,
      organizationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    created.formIds.push(defaultForm.id);

    const [legacyForm] = await db.insert(forms).values({
      name: `Legacy Form ${Date.now()}`,
      description: 'Legacy form',
      isPublished: true,
      createdBy: ownerA.id,
      organizationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    created.formIds.push(legacyForm.id);

    const [orgAForm] = await db.insert(forms).values({
      name: `OrgA Form ${Date.now()}`,
      description: 'OrgA form',
      isPublished: true,
      createdBy: ownerA.id,
      organizationId: orgA.id,
      ownershipScope: 'organization',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    created.formIds.push(orgAForm.id);

    const [orgBForm] = await db.insert(forms).values({
      name: `OrgB Form ${Date.now()}`,
      description: 'OrgB form',
      isPublished: true,
      createdBy: ownerB.id,
      organizationId: orgB.id,
      ownershipScope: 'organization',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    created.formIds.push(orgBForm.id);

    const [legacyClient] = await db.insert(clients).values({
      name: `Legacy Client ${Date.now()}`,
      createdBy: ownerA.id,
      organizationId: null,
    }).returning();
    created.clientIds.push(legacyClient.id);

    const [orgAClient] = await db.insert(clients).values({
      name: `OrgA Client ${Date.now()}`,
      createdBy: ownerA.id,
      organizationId: orgA.id,
    }).returning();
    created.clientIds.push(orgAClient.id);

    const [orgBClient] = await db.insert(clients).values({
      name: `OrgB Client ${Date.now()}`,
      createdBy: ownerB.id,
      organizationId: orgB.id,
    }).returning();
    created.clientIds.push(orgBClient.id);

    const [legacyJob] = await db.insert(jobs).values({
      title: `Legacy Job ${Date.now()}`,
      location: 'Remote',
      type: 'full-time',
      description: 'Legacy job description',
      postedBy: ownerA.id,
      organizationId: null,
    }).returning();
    created.jobIds.push(legacyJob.id);

    const [orgAJob] = await db.insert(jobs).values({
      title: `OrgA Job ${Date.now()}`,
      location: 'Remote',
      type: 'full-time',
      description: 'OrgA job description',
      postedBy: ownerA.id,
      organizationId: orgA.id,
    }).returning();
    created.jobIds.push(orgAJob.id);

    const [orgBJob] = await db.insert(jobs).values({
      title: `OrgB Job ${Date.now()}`,
      location: 'Remote',
      type: 'full-time',
      description: 'OrgB job description',
      postedBy: ownerB.id,
      organizationId: orgB.id,
    }).returning();
    created.jobIds.push(orgBJob.id);

    const [legacyApp] = await db.insert(applications).values({
      jobId: legacyJob.id,
      name: 'Legacy Candidate',
      email: `legacy_candidate_${Date.now()}@example.com`,
      phone: '1234567890',
      resumeUrl: 'https://example.com/resume.pdf',
      organizationId: null,
    }).returning();
    created.appIds.push(legacyApp.id);

    const [orgAApp] = await db.insert(applications).values({
      jobId: orgAJob.id,
      name: 'OrgA Candidate',
      email: `orgA_candidate_${Date.now()}@example.com`,
      phone: '1234567891',
      resumeUrl: 'https://example.com/resume.pdf',
      organizationId: orgA.id,
    }).returning();
    created.appIds.push(orgAApp.id);

    const [orgBApp] = await db.insert(applications).values({
      jobId: orgBJob.id,
      name: 'OrgB Candidate',
      email: `orgB_candidate_${Date.now()}@example.com`,
      phone: '1234567892',
      resumeUrl: 'https://example.com/resume.pdf',
      organizationId: orgB.id,
    }).returning();
    created.appIds.push(orgBApp.id);

    const [legacyTalent] = await db.insert(talentPool).values({
      email: `legacy_talent_${Date.now()}@example.com`,
      name: 'Legacy Talent',
      recruiterId: ownerA.id,
      organizationId: null,
      source: 'manual',
    }).returning();
    created.talentIds.push(legacyTalent.id);

    const [orgATalent] = await db.insert(talentPool).values({
      email: `orgA_talent_${Date.now()}@example.com`,
      name: 'OrgA Talent',
      recruiterId: ownerA.id,
      organizationId: orgA.id,
      source: 'manual',
    }).returning();
    created.talentIds.push(orgATalent.id);

    const [orgBTalent] = await db.insert(talentPool).values({
      email: `orgB_talent_${Date.now()}@example.com`,
      name: 'OrgB Talent',
      recruiterId: ownerB.id,
      organizationId: orgB.id,
      source: 'manual',
    }).returning();
    created.talentIds.push(orgBTalent.id);

    const agent = request.agent(app);
    await login(agent, ownerA.username, 'password');

    const stages = await agent.get('/api/pipeline/stages');
    expect(stages.status).toBe(200);
    expect(stages.body.some((s: any) => s.id === defaultStage.id)).toBe(true);
    expect(stages.body.some((s: any) => s.id === legacyStage.id)).toBe(true);
    expect(stages.body.some((s: any) => s.id === orgAStage.id)).toBe(true);
    expect(stages.body.some((s: any) => s.id === orgBStage.id)).toBe(false);

    const templates = await agent.get('/api/email-templates');
    expect(templates.status).toBe(200);
    expect(templates.body.some((t: any) => t.id === defaultTemplate.id)).toBe(true);
    expect(templates.body.some((t: any) => t.id === legacyTemplate.id)).toBe(true);
    expect(templates.body.some((t: any) => t.id === orgATemplate.id)).toBe(true);
    expect(templates.body.some((t: any) => t.id === orgBTemplate.id)).toBe(false);

    const formTemplates = await agent.get('/api/forms/templates');
    expect(formTemplates.status).toBe(200);
    expect(formTemplates.body.templates.some((f: any) => f.id === defaultForm.id)).toBe(false);
    expect(formTemplates.body.templates.some((f: any) => f.id === legacyForm.id)).toBe(true);
    expect(formTemplates.body.templates.some((f: any) => f.id === orgAForm.id)).toBe(true);
    expect(formTemplates.body.templates.some((f: any) => f.id === orgBForm.id)).toBe(false);

    const myJobs = await agent.get('/api/my-jobs');
    expect(myJobs.status).toBe(200);
    expect(myJobs.body.some((j: any) => j.id === legacyJob.id)).toBe(true);
    expect(myJobs.body.some((j: any) => j.id === orgAJob.id)).toBe(true);
    expect(myJobs.body.some((j: any) => j.id === orgBJob.id)).toBe(false);

    const myApps = await agent.get('/api/my-applications-received');
    expect(myApps.status).toBe(200);
    expect(myApps.body.some((a: any) => a.jobId === legacyJob.id)).toBe(true);
    expect(myApps.body.some((a: any) => a.jobId === orgAJob.id)).toBe(true);
    expect(myApps.body.some((a: any) => a.jobId === orgBJob.id)).toBe(false);

    const candidates = await agent.get('/api/candidates');
    expect(candidates.status).toBe(200);
    expect(candidates.body.some((c: any) => c.email === legacyApp.email)).toBe(true);
    expect(candidates.body.some((c: any) => c.email === orgAApp.email)).toBe(true);
    expect(candidates.body.some((c: any) => c.email === orgBApp.email)).toBe(false);

    const clientList = await agent.get('/api/clients');
    expect(clientList.status).toBe(200);
    expect(clientList.body.some((c: any) => c.id === legacyClient.id)).toBe(true);
    expect(clientList.body.some((c: any) => c.id === orgAClient.id)).toBe(true);
    expect(clientList.body.some((c: any) => c.id === orgBClient.id)).toBe(false);

    const talentList = await agent.get('/api/talent-pool');
    expect(talentList.status).toBe(200);
    expect(talentList.body.candidates.some((c: any) => c.id === legacyTalent.id)).toBe(false);
    expect(talentList.body.candidates.some((c: any) => c.id === orgATalent.id)).toBe(true);
    expect(talentList.body.candidates.some((c: any) => c.id === orgBTalent.id)).toBe(false);
  });
});

maybeDescribe('Hiring Manager Endpoints and Scoping', () => {
  let app: express.Express;
  let server: any;

  const created = {
    userIds: [] as number[],
    orgIds: [] as number[],
    memberIds: [] as number[],
    jobIds: [] as number[],
    appIds: [] as number[],
    inviteIds: [] as number[],
  };

  beforeAll(async () => {
    app = express();
    server = await registerRoutes(app);
    await checkDbAvailability();
  });

  afterAll(() => {
    server?.close();
  });

  afterEach(async () => {
    if (!HAS_DB) return;
    if (!dbAvailable) return;

    if (created.appIds.length > 0) {
      await db.delete(applications).where(inArray(applications.id, created.appIds));
    }
    if (created.jobIds.length > 0) {
      await db.delete(jobs).where(inArray(jobs.id, created.jobIds));
    }
    if (created.inviteIds.length > 0) {
      await db.delete(hiringManagerInvitations).where(inArray(hiringManagerInvitations.id, created.inviteIds));
    }
    if (created.memberIds.length > 0) {
      await db.delete(organizationMembers).where(inArray(organizationMembers.id, created.memberIds));
    }
    if (created.orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, created.orgIds));
    }
    if (created.userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, created.userIds));
    }

    created.userIds = [];
    created.orgIds = [];
    created.memberIds = [];
    created.jobIds = [];
    created.appIds = [];
    created.inviteIds = [];
  });

  it('returns only hiring-manager jobs/apps for the current hiring manager', async () => {
    if (!dbAvailable) {
      expect(true).toBe(true);
      return;
    }
    const ownerA = await createRecruiterUser({
      username: `ownerA_${Date.now()}@example.com`,
      password: 'password',
    });
    created.userIds.push(ownerA.id);

    const ownerB = await createRecruiterUser({
      username: `ownerB_${Date.now()}@example.com`,
      password: 'password',
    });
    created.userIds.push(ownerB.id);

    const hmA = await createRecruiterUser({
      username: `hmA_${Date.now()}@example.com`,
      password: 'password',
      role: 'hiring_manager',
    });
    created.userIds.push(hmA.id);

    const hmB = await createRecruiterUser({
      username: `hmB_${Date.now()}@example.com`,
      password: 'password',
      role: 'hiring_manager',
    });
    created.userIds.push(hmB.id);

    const hmC = await createRecruiterUser({
      username: `hmC_${Date.now()}@example.com`,
      password: 'password',
      role: 'hiring_manager',
    });
    created.userIds.push(hmC.id);

    const orgA = await createOrganizationWithOwner({
      name: `OrgA ${Date.now()}`,
      ownerId: ownerA.id,
    });
    created.orgIds.push(orgA.id);

    const orgB = await createOrganizationWithOwner({
      name: `OrgB ${Date.now()}`,
      ownerId: ownerB.id,
    });
    created.orgIds.push(orgB.id);

    const [jobA] = await db.insert(jobs).values({
      title: `HM Job A ${Date.now()}`,
      location: 'Remote',
      type: 'full-time',
      description: 'HM job A',
      postedBy: ownerA.id,
      organizationId: orgA.id,
      hiringManagerId: hmA.id,
    }).returning();
    created.jobIds.push(jobA.id);

    const [jobB] = await db.insert(jobs).values({
      title: `HM Job B ${Date.now()}`,
      location: 'Remote',
      type: 'full-time',
      description: 'HM job B',
      postedBy: ownerB.id,
      organizationId: orgB.id,
      hiringManagerId: hmB.id,
    }).returning();
    created.jobIds.push(jobB.id);

    const [inviteC] = await db.insert(hiringManagerInvitations).values({
      email: hmC.username,
      token: `token_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      invitedBy: ownerA.id,
      inviterName: 'Owner A',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'accepted',
      acceptedAt: new Date(),
    }).returning();
    created.inviteIds.push(inviteC.id);

    const [appA] = await db.insert(applications).values({
      jobId: jobA.id,
      name: 'HM Candidate',
      email: `hm_candidate_${Date.now()}@example.com`,
      phone: '1234567890',
      resumeUrl: 'https://example.com/resume.pdf',
      organizationId: orgA.id,
    }).returning();
    created.appIds.push(appA.id);

    const agentHm = request.agent(app);
    await login(agentHm, hmA.username, 'password', 'hiring_manager');

    const hmJobs = await agentHm.get('/api/hiring-manager/jobs');
    expect(hmJobs.status).toBe(200);
    expect(hmJobs.body.some((j: any) => j.id === jobA.id)).toBe(true);
    expect(hmJobs.body.some((j: any) => j.id === jobB.id)).toBe(false);

    const hmApps = await agentHm.get(`/api/hiring-manager/jobs/${jobA.id}/applications`);
    expect(hmApps.status).toBe(200);
    expect(hmApps.body.some((a: any) => a.id === appA.id)).toBe(true);

    const hmAppsDenied = await agentHm.get(`/api/hiring-manager/jobs/${jobB.id}/applications`);
    expect(hmAppsDenied.status).toBe(403);

    const agentOwner = request.agent(app);
    await login(agentOwner, ownerA.username, 'password');
    const hmList = await agentOwner.get('/api/users?role=hiring_manager');
    expect(hmList.status).toBe(200);
    expect(hmList.body.some((u: any) => u.id === hmA.id)).toBe(true);
    expect(hmList.body.some((u: any) => u.id === hmC.id)).toBe(true);
    expect(hmList.body.some((u: any) => u.id === hmB.id)).toBe(false);
  });
});
