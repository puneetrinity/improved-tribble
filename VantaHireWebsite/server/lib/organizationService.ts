import { db } from "../db";
import {
  organizations,
  organizationMembers,
  organizationJoinRequests,
  domainClaimRequests,
  organizationSubscriptions,
  subscriptionPlans,
  users,
  type Organization,
  type InsertOrganization,
  type OrganizationMember,
  type OrganizationJoinRequest,
  type DomainClaimRequest,
  type OrganizationRole,
} from "@shared/schema";
import { eq, and, desc, sql, or } from "drizzle-orm";
import slugify from "slugify";
import { mergeDuplicatePipelineStagesForOrg } from "./pipelineStageMerge";

// Backfill orphaned jobs, applications, clients, and child tables for a user joining an organization
// This ensures legacy records (created before org existed) are associated with the new org
export async function backfillUserRecordsToOrg(
  tx: any, // Drizzle transaction object
  userId: number,
  organizationId: number
): Promise<void> {
  // Update orphaned jobs posted by this user
  await tx.execute(sql`
    UPDATE jobs
    SET organization_id = ${organizationId}
    WHERE posted_by = ${userId}
      AND organization_id IS NULL
  `);

  // Update orphaned clients created by this user
  await tx.execute(sql`
    UPDATE clients
    SET organization_id = ${organizationId}
    WHERE created_by = ${userId}
      AND organization_id IS NULL
  `);

  // Update orphaned applications for this user's jobs that are now in the org
  // Condition: app has no org, app's job is posted by this user, and job is now in this org
  await tx.execute(sql`
    UPDATE applications a
    SET organization_id = ${organizationId}
    FROM jobs j
    WHERE a.organization_id IS NULL
      AND a.job_id = j.id
      AND j.posted_by = ${userId}
      AND j.organization_id = ${organizationId}
  `);

  // Update child tables (job_analytics, job_audit_log) for this user's jobs
  await tx.execute(sql`
    UPDATE job_analytics ja
    SET organization_id = ${organizationId}
    FROM jobs j
    WHERE ja.organization_id IS NULL
      AND ja.job_id = j.id
      AND j.posted_by = ${userId}
      AND j.organization_id = ${organizationId}
  `);

  await tx.execute(sql`
    UPDATE job_audit_log jal
    SET organization_id = ${organizationId}
    FROM jobs j
    WHERE jal.organization_id IS NULL
      AND jal.job_id = j.id
      AND j.posted_by = ${userId}
      AND j.organization_id = ${organizationId}
  `);

  // Update orphaned pipeline stages created by this user (excluding defaults)
  await tx.execute(sql`
    UPDATE pipeline_stages
    SET organization_id = ${organizationId}
    WHERE created_by = ${userId}
      AND organization_id IS NULL
      AND (is_default IS NULL OR is_default = false)
  `);

  // Update orphaned email templates created by this user (excluding defaults)
  await tx.execute(sql`
    UPDATE email_templates
    SET organization_id = ${organizationId}
    WHERE created_by = ${userId}
      AND organization_id IS NULL
      AND (is_default IS NULL OR is_default = false)
  `);

  // Update orphaned forms created by this user
  await tx.execute(sql`
    UPDATE forms
    SET organization_id = ${organizationId}
    WHERE created_by = ${userId}
      AND organization_id IS NULL
  `);

  // Update form_invitations for this user's forms that are now in the org
  await tx.execute(sql`
    UPDATE form_invitations fi
    SET organization_id = ${organizationId}
    FROM forms f
    WHERE fi.organization_id IS NULL
      AND fi.form_id = f.id
      AND f.created_by = ${userId}
      AND f.organization_id = ${organizationId}
  `);

  // Update form_responses for this user's forms that are now in the org
  await tx.execute(sql`
    UPDATE form_responses fr
    SET organization_id = ${organizationId}
    FROM form_invitations fi
    INNER JOIN forms f ON fi.form_id = f.id
    WHERE fr.organization_id IS NULL
      AND fr.invitation_id = fi.id
      AND f.created_by = ${userId}
      AND f.organization_id = ${organizationId}
  `);
}

// Public email domains that cannot claim domain verification
const PUBLIC_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com',
  'yandex.com', 'gmx.com', 'fastmail.com', 'tutanota.com',
];

export function isPublicEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? PUBLIC_EMAIL_DOMAINS.includes(domain) : false;
}

export function getEmailDomain(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain || null;
}

export async function generateUniqueSlug(name: string): Promise<string> {
  const baseSlug = slugify(name, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await db.query.organizations.findFirst({
      where: eq(organizations.slug, slug),
    });
    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

// Organization CRUD
export class OrganizationSelfServiceGrantDeniedError extends Error {
  constructor() {
    super("ORGANIZATION_SELF_SERVICE_GRANT_DENIED");
    this.name = "OrganizationSelfServiceGrantDeniedError";
  }
}

export async function createOrganization(
  data: { name: string; slug?: string },
  ownerId: number
): Promise<Organization> {
  const slug = data.slug || await generateUniqueSlug(data.name);

  const org = await db.transaction(async (tx: any) => {
    const [storedUser] = await tx
      .select({
        id: users.id,
        role: users.role,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.id, ownerId))
      .for('update');
    if (!storedUser || storedUser.role !== 'recruiter' || storedUser.emailVerified !== true) {
      throw new OrganizationSelfServiceGrantDeniedError();
    }

    const existingMemberships = await tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, ownerId));
    const existingSelfServiceOrganizations = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(
        eq(organizations.authorityOrigin, 'self_service_recruiter'),
        eq(organizations.selfCreatedByUserId, ownerId),
      ));
    if (existingMemberships.length !== 0 || existingSelfServiceOrganizations.length !== 0) {
      throw new OrganizationSelfServiceGrantDeniedError();
    }

    // Create organization
    const [createdOrg] = await tx.insert(organizations).values({
      name: data.name,
      slug,
      authorityOrigin: 'self_service_recruiter',
      selfCreatedByUserId: ownerId,
    }).returning();
    if (!createdOrg) throw new Error("ORGANIZATION_CREATE_RESULT_INVALID");

    const org = createdOrg.signalTenantId
      ? createdOrg
      : (await tx.update(organizations)
          .set({
            signalTenantId: `org_${createdOrg.id}`,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, createdOrg.id))
          .returning())[0]!;

    // Add owner as first member
    await tx.insert(organizationMembers).values({
      organizationId: org.id,
      userId: ownerId,
      role: 'owner',
      seatAssigned: true,
      joinedAt: new Date(),
    });

    // Backfill orphaned jobs and applications for this user
    await backfillUserRecordsToOrg(tx, ownerId, org.id);

    return org;
  });

  try {
    await mergeDuplicatePipelineStagesForOrg(org.id, { dryRun: false });
  } catch (error) {
    console.warn('[Org Backfill] Failed to merge duplicate pipeline stages after org creation:', error);
  }

  return org;
}

export async function getOrganization(id: number): Promise<Organization | undefined> {
  return db.query.organizations.findFirst({
    where: eq(organizations.id, id),
  });
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
  return db.query.organizations.findFirst({
    where: eq(organizations.slug, slug),
  });
}

export async function getOrganizationByDomain(domain: string): Promise<Organization | undefined> {
  return db.query.organizations.findFirst({
    where: and(
      eq(organizations.domain, domain.toLowerCase()),
      eq(organizations.domainVerified, true)
    ),
  });
}

/**
 * Get an organization's Signal tenant ID.
 * Returns null if the org has no Signal integration configured.
 */
export async function getSignalTenantId(orgId: number): Promise<string | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { signalTenantId: true },
  });
  return org?.signalTenantId ?? null;
}

/**
 * Require an organization's Signal tenant ID.
 * Throws if the org has no Signal integration configured.
 */
export async function requireSignalTenantId(orgId: number): Promise<string> {
  const tenantId = await getSignalTenantId(orgId);
  if (!tenantId) {
    throw new Error(`Organization ${orgId} has no Signal integration configured. Set signal_tenant_id in organization settings.`);
  }
  return tenantId;
}

/**
 * Set or update an organization's Signal tenant ID.
 */
export async function setSignalTenantId(orgId: number, signalTenantId: string): Promise<Organization | undefined> {
  const [updated] = await db.update(organizations)
    .set({ signalTenantId, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .returning();
  return updated;
}

export async function updateOrganization(
  id: number,
  updates: Partial<InsertOrganization>
): Promise<Organization | undefined> {
  const [updated] = await db.update(organizations)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  return updated;
}

export async function deleteOrganization(id: number): Promise<void> {
  await db.delete(organizations).where(eq(organizations.id, id));
}

// Get user's current organization
export async function getUserOrganization(userId: number): Promise<{
  organization: Organization;
  membership: OrganizationMember;
} | null> {
  const membership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
    with: {
      organization: true,
    },
  });

  if (!membership || !membership.organization) return null;

  return {
    organization: membership.organization,
    membership: membership as OrganizationMember,
  };
}

// Check if user is in any organization
export async function isUserInOrganization(userId: number): Promise<boolean> {
  const membership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
  });
  return !!membership;
}

// Get organization with subscription info
export async function getOrganizationWithSubscription(orgId: number): Promise<{
  organization: Organization;
  subscription: typeof organizationSubscriptions.$inferSelect | null;
  plan: typeof subscriptionPlans.$inferSelect | null;
} | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    with: {
      subscription: {
        with: {
          plan: true,
        },
      },
    },
  });

  if (!org) return null;

  return {
    organization: org,
    subscription: org.subscription || null,
    plan: org.subscription?.plan || null,
  };
}

// Join requests (for domain-based joining)
export async function createJoinRequest(
  organizationId: number,
  userId: number
): Promise<OrganizationJoinRequest> {
  // Check if already in org
  const inOrg = await isUserInOrganization(userId);
  if (inOrg) {
    throw new Error('You are already a member of an organization');
  }

  // Check if pending request exists
  const existing = await db.query.organizationJoinRequests.findFirst({
    where: and(
      eq(organizationJoinRequests.organizationId, organizationId),
      eq(organizationJoinRequests.userId, userId),
      eq(organizationJoinRequests.status, 'pending')
    ),
  });

  if (existing) {
    throw new Error('You already have a pending request to join this organization');
  }

  const [request] = await db.insert(organizationJoinRequests).values({
    organizationId,
    userId,
    status: 'pending',
  }).returning();

  return request;
}

export async function getPendingJoinRequests(orgId: number): Promise<(OrganizationJoinRequest & { user: typeof users.$inferSelect })[]> {
  const requests = await db.query.organizationJoinRequests.findMany({
    where: and(
      eq(organizationJoinRequests.organizationId, orgId),
      eq(organizationJoinRequests.status, 'pending')
    ),
    with: {
      user: true,
    },
    orderBy: desc(organizationJoinRequests.requestedAt),
  });

  return requests as (OrganizationJoinRequest & { user: typeof users.$inferSelect })[];
}

export async function respondToJoinRequest(
  requestId: number,
  status: 'approved' | 'rejected',
  respondedBy: number,
  rejectionReason?: string
): Promise<OrganizationMember | null> {
  const request = await db.query.organizationJoinRequests.findFirst({
    where: eq(organizationJoinRequests.id, requestId),
  });

  if (!request) {
    throw new Error('Join request not found');
  }

  if (request.status !== 'pending') {
    throw new Error('Join request has already been processed');
  }

  // Transaction: update request + add member (if approved) + backfill records
  const member = await db.transaction(async (tx: any) => {
    await tx.update(organizationJoinRequests)
      .set({
        status,
        respondedAt: new Date(),
        respondedBy,
        rejectionReason: rejectionReason || null,
      })
      .where(eq(organizationJoinRequests.id, requestId));

    if (status === 'approved') {
      // Check if user is still not in any org (unique constraint will also enforce this)
      const inOrg = await isUserInOrganization(request.userId);
      if (inOrg) {
        throw new Error('User has already joined another organization');
      }

      // Add user to organization
      const [member] = await tx.insert(organizationMembers).values({
        organizationId: request.organizationId,
        userId: request.userId,
        role: 'member',
        seatAssigned: true,
        joinedAt: new Date(),
      }).returning();

      // Backfill orphaned jobs and applications for this user
      await backfillUserRecordsToOrg(tx, request.userId, request.organizationId);

      return member;
    }

    return null;
  });

  if (member) {
    try {
      await mergeDuplicatePipelineStagesForOrg(request.organizationId, { dryRun: false });
    } catch (error) {
      console.warn('[Org Backfill] Failed to merge duplicate pipeline stages after join approval:', error);
    }
  }

  return member;
}

// Domain claim requests (admin-approved)
export async function createDomainClaimRequest(
  organizationId: number,
  domain: string,
  requestedBy: number
): Promise<DomainClaimRequest> {
  // Check if domain is public email domain
  if (PUBLIC_EMAIL_DOMAINS.includes(domain.toLowerCase())) {
    throw new Error('Cannot claim a public email domain');
  }

  // Check if domain is already claimed
  const existingOrg = await getOrganizationByDomain(domain);
  if (existingOrg) {
    throw new Error('Domain is already claimed by another organization');
  }

  // Check if there's already a pending request for this domain
  const pendingRequest = await db.query.domainClaimRequests.findFirst({
    where: and(
      eq(domainClaimRequests.domain, domain.toLowerCase()),
      eq(domainClaimRequests.status, 'pending')
    ),
  });

  if (pendingRequest) {
    throw new Error('There is already a pending claim for this domain');
  }

  const [request] = await db.insert(domainClaimRequests).values({
    organizationId,
    domain: domain.toLowerCase(),
    requestedBy,
    status: 'pending',
  }).returning();

  return request;
}

export async function getPendingDomainClaimRequests(): Promise<(DomainClaimRequest & {
  organization: Organization;
  requestedByUser: typeof users.$inferSelect;
})[]> {
  const requests = await db.query.domainClaimRequests.findMany({
    where: eq(domainClaimRequests.status, 'pending'),
    with: {
      organization: true,
      requestedByUser: true,
    },
    orderBy: desc(domainClaimRequests.requestedAt),
  });

  return requests as (DomainClaimRequest & {
    organization: Organization;
    requestedByUser: typeof users.$inferSelect;
  })[];
}

export async function respondToDomainClaim(
  claimId: number,
  status: 'approved' | 'rejected',
  reviewedBy: number,
  rejectionReason?: string
): Promise<void> {
  const claim = await db.query.domainClaimRequests.findFirst({
    where: eq(domainClaimRequests.id, claimId),
  });

  if (!claim) {
    throw new Error('Domain claim request not found');
  }

  if (claim.status !== 'pending') {
    throw new Error('Domain claim has already been processed');
  }

  await db.update(domainClaimRequests)
    .set({
      status,
      reviewedBy,
      reviewedAt: new Date(),
      rejectionReason: rejectionReason || null,
    })
    .where(eq(domainClaimRequests.id, claimId));

  if (status === 'approved') {
    // Update organization with verified domain
    await db.update(organizations)
      .set({
        domain: claim.domain,
        domainVerified: true,
        domainApprovedBy: reviewedBy,
        domainApprovedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, claim.organizationId));
  }
}

// Find organization by user's email domain (for "Request to Join" flow)
export async function findOrganizationByUserEmailDomain(email: string): Promise<Organization | null> {
  const domain = getEmailDomain(email);
  if (!domain || isPublicEmailDomain(email)) {
    return null;
  }

  const org = await getOrganizationByDomain(domain);
  return org || null;
}
