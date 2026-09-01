import { z } from "zod";
import type { Express, Request, Response, NextFunction } from "express";
import { requireAuth, requireRole } from "./auth";
import {
  createOrganization,
  OrganizationSelfServiceGrantDeniedError,
  getOrganization,
  updateOrganization,
  deleteOrganization,
  getUserOrganization,
  isUserInOrganization,
  createOrganizationInvite,
  getOrganizationInviteByToken,
  getPendingInvitesForOrganization,
  acceptOrganizationInvite,
  cancelOrganizationInvite,
  createJoinRequest,
  getPendingJoinRequests,
  respondToJoinRequest,
  createDomainClaimRequest,
  findOrganizationByUserEmailDomain,
  isPublicEmailDomain,
  getEmailDomain,
} from "./lib/organizationService";
import {
  getOrganizationMembers,
  getMemberById,
  leaveOrganization,
  canManageMembers,
  canManageBilling,
  getUserJobsInOrg,
} from "./lib/membershipService";
import {
  changeOrganizationMemberRoleAndRevoke,
  parsePrivilegeGrantId,
  reassignOrganizationJobs,
  removeOrganizationMemberAndRevoke,
} from "./lib/privilegeGrantRevocation";
import { createFreeSubscription } from "./lib/subscriptionService";
import { hasAvailableSeats } from "./lib/seatService";
import { initializeMemberCredits } from "./lib/creditService";
import { insertOrganizationSchema, organizationRoles } from "@shared/schema";
import { getEmailService } from "./simpleEmailService";

// Input validation schemas
const createOrgSchema = z.object({
  name: z.string().min(1).max(200),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  logo: z.string().url().optional().nullable(),
  billingName: z.string().max(200).optional().nullable(),
  billingAddress: z.string().max(500).optional().nullable(),
  billingCity: z.string().max(100).optional().nullable(),
  billingState: z.string().max(100).optional().nullable(),
  billingPincode: z.string().max(10).optional().nullable(),
  billingContactEmail: z.string().email().optional().nullable(),
  billingContactName: z.string().max(200).optional().nullable(),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  // Only 'member' role can be invited - owner can promote to admin after joining
});

const respondJoinRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  rejectionReason: z.string().max(500).optional(),
});

const changeRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

const reassignContentSchema = z.object({
  toUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const domainClaimSchema = z.object({
  domain: z.string().min(1).max(255),
});

export function registerOrganizationRoutes(
  app: Express,
  csrfProtection: any
) {
  // ===== Organization CRUD =====

  // Create organization
  app.post("/api/organizations", requireAuth, requireRole(['recruiter']), csrfProtection, async (req, res) => {
    try {
      const user = req.user!;

      const validatedData = createOrgSchema.parse(req.body);

      const org = await createOrganization(validatedData, user.id);

      // Create free subscription for new org
      await createFreeSubscription(org.id);

      // Initialize credits for owner
      const orgResult = await getUserOrganization(user.id);
      if (orgResult) {
        await initializeMemberCredits(orgResult.membership.id, org.id);
      }

      const {
        authorityOrigin: _authorityOrigin,
        selfCreatedByUserId: _selfCreatedByUserId,
        ...organizationResponse
      } = org;
      res.status(201).json(organizationResponse);
    } catch (error: any) {
      console.error("Error creating organization:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
        return;
      }
      if (error instanceof OrganizationSelfServiceGrantDeniedError) {
        res.status(403).json({
          error: "ORGANIZATION_CREATION_NOT_ALLOWED",
          code: "ORGANIZATION_CREATION_NOT_ALLOWED",
        });
        return;
      }
      res.status(503).json({ error: "ORGANIZATION_CREATE_UNAVAILABLE", code: "ORGANIZATION_CREATE_UNAVAILABLE" });
    }
  });

  // Get current organization
  app.get("/api/organizations/current", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      res.json({
        organization: orgResult.organization,
        membership: orgResult.membership,
      });
    } catch (error: any) {
      console.error("Error getting current organization:", error);
      res.status(500).json({ error: "Failed to get organization" });
    }
  });

  // Update organization
  app.patch("/api/organizations/current", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageBilling(orgResult.membership.role as any)) {
        res.status(403).json({ error: "Only organization owner can update settings" });
        return;
      }

      const data = updateOrgSchema.parse(req.body);

      // Build update data conditionally to handle exactOptionalPropertyTypes
      const updateData: Parameters<typeof updateOrganization>[1] = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.logo !== undefined && data.logo !== null) updateData.logo = data.logo;
      if (data.billingName !== undefined && data.billingName !== null) updateData.billingName = data.billingName;
      if (data.billingAddress !== undefined && data.billingAddress !== null) updateData.billingAddress = data.billingAddress;
      if (data.billingCity !== undefined && data.billingCity !== null) updateData.billingCity = data.billingCity;
      if (data.billingState !== undefined && data.billingState !== null) updateData.billingState = data.billingState;
      if (data.billingPincode !== undefined && data.billingPincode !== null) updateData.billingPincode = data.billingPincode;
      if (data.billingContactEmail !== undefined && data.billingContactEmail !== null) updateData.billingContactEmail = data.billingContactEmail;
      if (data.billingContactName !== undefined && data.billingContactName !== null) updateData.billingContactName = data.billingContactName;

      const updated = await updateOrganization(orgResult.organization.id, updateData);

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating organization:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to update organization" });
    }
  });

  // Delete organization
  app.delete("/api/organizations/current", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (orgResult.membership.role !== 'owner') {
        res.status(403).json({ error: "Only organization owner can delete the organization" });
        return;
      }

      await deleteOrganization(orgResult.organization.id);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting organization:", error);
      res.status(500).json({ error: error.message || "Failed to delete organization" });
    }
  });

  // ===== Members =====

  // List organization members
  app.get("/api/organizations/members", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      const members = await getOrganizationMembers(orgResult.organization.id);

      res.json(members);
    } catch (error: any) {
      console.error("Error listing members:", error);
      res.status(500).json({ error: "Failed to list members" });
    }
  });

  // Invite member
  app.post("/api/organizations/members/invite", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to invite members" });
        return;
      }

      const { email } = inviteMemberSchema.parse(req.body);

      // Check if seats are available
      const seatsAvailable = await hasAvailableSeats(orgResult.organization.id);
      if (!seatsAvailable) {
        res.status(400).json({ error: "No seats available. Please purchase more seats first." });
        return;
      }

      // Check if email is already in an organization
      // This is handled by the createOrganizationInvite function

      // Always invite as 'member' - owner can promote to admin after joining
      const invite = await createOrganizationInvite(
        orgResult.organization.id,
        email,
        'member',
        user.id
      );

      const emailService = await getEmailService();
      if (emailService) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        const inviteCode = invite.token;
        const inviteUrl = `${baseUrl}/recruiter-auth?invite=${inviteCode}`;
        const inviterName = user.firstName || user.username;
        const orgName = orgResult.organization.name;

        const subject = `You are invited to join ${orgName} on VantaHire`;
        const html = `
          <h2>You're invited to join ${orgName}</h2>
          <p>Hello,</p>
          <p>${inviterName} invited you to join <strong>${orgName}</strong> on VantaHire.</p>
          <p style="margin: 24px 0;">
            <a href="${inviteUrl}" style="background-color: #7B38FB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              Accept Invitation
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">Or copy this link: <a href="${inviteUrl}">${inviteUrl}</a></p>
          <p style="color: #666; font-size: 14px; margin-top: 16px;">Your invite code (if needed): <strong>${inviteCode}</strong></p>
        `;
        const text = `You're invited to join ${orgName} on VantaHire.\n\nClick to accept: ${inviteUrl}\n\nOr use invite code: ${inviteCode}`;

        const sent = await emailService.sendEmail({
          to: invite.email,
          subject,
          html,
          text,
        });

        if (!sent) {
          console.warn(`Failed to send org invite email to ${invite.email}`);
        }
      } else {
        console.warn('Email service not available. Invite created but email not sent.');
      }

      res.status(201).json(invite);
    } catch (error: any) {
      console.error("Error inviting member:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to invite member" });
    }
  });

  // Remove member
  app.delete("/api/organizations/members/:id", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const memberId = parsePrivilegeGrantId(req.params.id);
      if (memberId === null) {
        res.status(400).json({ error: "INVALID_ORGANIZATION_MEMBER_ID", code: "INVALID_ORGANIZATION_MEMBER_ID" });
        return;
      }
      const result = await removeOrganizationMemberAndRevoke(user.id, memberId);
      if (!result.ok) {
        if (result.reason === "forbidden") {
          res.status(403).json({ error: "MEMBER_ADMIN_ACCESS_DENIED", code: "MEMBER_ADMIN_ACCESS_DENIED" });
        } else if (result.reason === "not_found") {
          res.status(404).json({ error: "ORGANIZATION_MEMBER_NOT_FOUND", code: "ORGANIZATION_MEMBER_NOT_FOUND" });
        } else if (result.reason === "conflict") {
          const code = result.code === "jobs_owned" ? "MEMBER_JOBS_REASSIGN_REQUIRED" : "ORGANIZATION_MEMBER_PROTECTED";
          res.status(409).json({ error: code, code });
        } else {
          res.status(503).json({ error: "MEMBER_ADMIN_UNAVAILABLE", code: "MEMBER_ADMIN_UNAVAILABLE" });
        }
        return;
      }
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: "MEMBER_ADMIN_UNAVAILABLE", code: "MEMBER_ADMIN_UNAVAILABLE" });
    }
  });

  // Change member role
  app.patch("/api/organizations/members/:id/role", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const memberId = parsePrivilegeGrantId(req.params.id);
      if (memberId === null) {
        res.status(400).json({ error: "INVALID_ORGANIZATION_MEMBER_ID", code: "INVALID_ORGANIZATION_MEMBER_ID" });
        return;
      }
      const { role } = changeRoleSchema.parse(req.body);
      const result = await changeOrganizationMemberRoleAndRevoke(user.id, memberId, role);
      if (!result.ok) {
        if (result.reason === "forbidden") {
          res.status(403).json({ error: "MEMBER_ADMIN_ACCESS_DENIED", code: "MEMBER_ADMIN_ACCESS_DENIED" });
        } else if (result.reason === "not_found") {
          res.status(404).json({ error: "ORGANIZATION_MEMBER_NOT_FOUND", code: "ORGANIZATION_MEMBER_NOT_FOUND" });
        } else if (result.reason === "conflict") {
          const code = result.code === "role_unchanged" ? "ORGANIZATION_MEMBER_ROLE_UNCHANGED" : "ORGANIZATION_MEMBER_PROTECTED";
          res.status(409).json({ error: code, code });
        } else {
          res.status(503).json({ error: "MEMBER_ADMIN_UNAVAILABLE", code: "MEMBER_ADMIN_UNAVAILABLE" });
        }
        return;
      }
      res.json(result.value);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
        return;
      }
      res.status(503).json({ error: "MEMBER_ADMIN_UNAVAILABLE", code: "MEMBER_ADMIN_UNAVAILABLE" });
    }
  });

  // Reassign member's content
  app.post("/api/organizations/members/:id/reassign", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const fromMemberId = parsePrivilegeGrantId(req.params.id);
      if (fromMemberId === null) {
        res.status(400).json({ error: "INVALID_ORGANIZATION_MEMBER_ID", code: "INVALID_ORGANIZATION_MEMBER_ID" });
        return;
      }
      const { toUserId } = reassignContentSchema.parse(req.body);
      const result = await reassignOrganizationJobs(user.id, fromMemberId, toUserId);
      if (!result.ok) {
        if (result.reason === "forbidden") {
          res.status(403).json({ error: "MEMBER_ADMIN_ACCESS_DENIED", code: "MEMBER_ADMIN_ACCESS_DENIED" });
        } else if (result.reason === "not_found") {
          res.status(404).json({ error: "ORGANIZATION_MEMBER_NOT_FOUND", code: "ORGANIZATION_MEMBER_NOT_FOUND" });
        } else if (result.reason === "conflict") {
          const code = result.code === "owner_source" ? "ORGANIZATION_OWNER_REASSIGN_FORBIDDEN" : "ORGANIZATION_REASSIGN_TARGET_INVALID";
          res.status(409).json({ error: code, code });
        } else {
          res.status(503).json({ error: "MEMBER_ADMIN_UNAVAILABLE", code: "MEMBER_ADMIN_UNAVAILABLE" });
        }
        return;
      }
      res.json({ success: true, reassignedCount: result.reassignedCount });
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
        return;
      }
      res.status(503).json({ error: "MEMBER_ADMIN_UNAVAILABLE", code: "MEMBER_ADMIN_UNAVAILABLE" });
    }
  });

  // Leave organization
  app.post("/api/organizations/members/leave", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      await leaveOrganization(user.id);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error leaving organization:", error);
      res.status(500).json({ error: error.message || "Failed to leave organization" });
    }
  });

  // ===== Invites =====

  // List pending invites
  app.get("/api/organizations/invites", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to view invites" });
        return;
      }

      const invites = await getPendingInvitesForOrganization(orgResult.organization.id);

      res.json(invites);
    } catch (error: any) {
      console.error("Error listing invites:", error);
      res.status(500).json({ error: "Failed to list invites" });
    }
  });

  // Cancel invite
  app.delete("/api/organizations/invites/:id", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const inviteId = parseInt(req.params.id ?? '0');
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to cancel invites" });
        return;
      }

      await cancelOrganizationInvite(inviteId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error canceling invite:", error);
      res.status(500).json({ error: error.message || "Failed to cancel invite" });
    }
  });

  // Get invite details (public)
  app.get("/api/invites/:token", async (req, res) => {
    try {
      const token = req.params.token ?? '';
      const invite = await getOrganizationInviteByToken(token);

      if (!invite) {
        res.status(404).json({ error: "Invite not found or expired" });
        return;
      }

      // Check if invite has expired
      if (new Date() > invite.expiresAt) {
        res.status(410).json({ error: "This invite has expired" });
        return;
      }

      const inviterFullName = invite.invitedByUser
        ? [invite.invitedByUser.firstName, invite.invitedByUser.lastName].filter(Boolean).join(' ').trim()
        : '';
      const inviterName = inviterFullName || invite.invitedByUser?.username || 'A team member';

      res.json({
        organizationName: invite.organization.name,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        inviterName,
      });
    } catch (error: any) {
      console.error("Error getting invite:", error);
      res.status(500).json({ error: "Failed to get invite details" });
    }
  });

  // Accept invite
  app.post("/api/invites/:token/accept", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const token = req.params.token ?? '';

      // Check if user is already in an organization
      if (await isUserInOrganization(user.id)) {
        res.status(400).json({ error: "You are already a member of an organization. Leave your current organization first." });
        return;
      }

      const membership = await acceptOrganizationInvite(token, user.id, user.username);

      // Initialize credits for new member - best-effort, don't fail join if this fails
      // Lazy-init fallback exists in /api/onboarding-status
      try {
        await initializeMemberCredits(membership.id, membership.organizationId);
      } catch (creditError) {
        console.error('Failed to initialize credits for new member (will retry on onboarding):', {
          memberId: membership.id,
          orgId: membership.organizationId,
          error: creditError,
        });
      }

      res.json({ success: true, membership });
    } catch (error: any) {
      console.error("Error accepting invite:", error);
      const msg = error.message || "Failed to accept invite";

      // Return appropriate 4xx codes based on error type
      if (msg.includes("different email address")) {
        res.status(403).json({ error: msg });
      } else if (msg.includes("No seats available")) {
        res.status(409).json({ error: msg });
      } else if (msg.includes("Invalid") || msg.includes("expired") || msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  // ===== Join Requests =====

  // Request to join organization
  app.post("/api/organizations/request-join/:orgId", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const orgId = parseInt(req.params.orgId ?? '0');

      // Check if user is already in an organization
      if (await isUserInOrganization(user.id)) {
        res.status(400).json({ error: "You are already a member of an organization" });
        return;
      }

      const request = await createJoinRequest(orgId, user.id);

      res.status(201).json(request);
    } catch (error: any) {
      console.error("Error requesting to join:", error);
      res.status(500).json({ error: error.message || "Failed to request to join" });
    }
  });

  // List pending join requests
  app.get("/api/organizations/join-requests", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to view join requests" });
        return;
      }

      const requests = await getPendingJoinRequests(orgResult.organization.id);

      res.json(requests);
    } catch (error: any) {
      console.error("Error listing join requests:", error);
      res.status(500).json({ error: "Failed to list join requests" });
    }
  });

  // Respond to join request
  app.post("/api/organizations/join-requests/:id/respond", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const requestId = parseInt(req.params.id ?? '0');
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to respond to join requests" });
        return;
      }

      const { status, rejectionReason } = respondJoinRequestSchema.parse(req.body);

      // Check if seats are available for approval
      if (status === 'approved') {
        const seatsAvailable = await hasAvailableSeats(orgResult.organization.id);
        if (!seatsAvailable) {
          res.status(400).json({ error: "No seats available. Please purchase more seats first." });
          return;
        }
      }

      const member = await respondToJoinRequest(
        requestId,
        status,
        user.id,
        rejectionReason
      );

      // Initialize credits for new member if approved
      if (status === 'approved' && member) {
        await initializeMemberCredits(member.id, orgResult.organization.id);
      }

      res.json({ success: true, member });
    } catch (error: any) {
      console.error("Error responding to join request:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to respond to join request" });
    }
  });

  // ===== Domain =====

  // Request domain claim
  app.post("/api/organizations/domain/request", requireAuth, csrfProtection, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (orgResult.membership.role !== 'owner') {
        res.status(403).json({ error: "Only organization owner can claim a domain" });
        return;
      }

      const { domain } = domainClaimSchema.parse(req.body);

      // Check if it's a public email domain
      if (isPublicEmailDomain(domain)) {
        res.status(400).json({ error: "Cannot claim a public email domain" });
        return;
      }

      const request = await createDomainClaimRequest(orgResult.organization.id, domain, user.id);

      res.status(201).json(request);
    } catch (error: any) {
      console.error("Error requesting domain claim:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to request domain claim" });
    }
  });

  // Find organization by email domain (for join request UI)
  app.get("/api/organizations/by-email-domain", requireAuth, async (req, res) => {
    try {
      const user = req.user!;

      // Get domain from user's email
      const domain = getEmailDomain(user.username);

      if (!domain || isPublicEmailDomain(domain)) {
        res.json({ organization: null });
        return;
      }

      const org = await findOrganizationByUserEmailDomain(domain);

      res.json({
        organization: org ? {
          id: org.id,
          name: org.name,
          domain: org.domain,
        } : null,
      });
    } catch (error: any) {
      console.error("Error finding organization by domain:", error);
      res.status(500).json({ error: "Failed to find organization" });
    }
  });

  // Get member's jobs in organization (for reassignment UI)
  app.get("/api/organizations/members/:id/jobs", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const memberId = parseInt(req.params.id ?? '0');
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to view member's jobs" });
        return;
      }

      const member = await getMemberById(memberId);
      if (!member || member.organizationId !== orgResult.organization.id) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      const jobs = await getUserJobsInOrg(member.userId, orgResult.organization.id);

      res.json(jobs);
    } catch (error: any) {
      console.error("Error getting member's jobs:", error);
      res.status(500).json({ error: "Failed to get member's jobs" });
    }
  });

  // ===== Organization Analytics =====

  // Candidate privacy is enforced inside orgAnalyticsService in SQL before
  // every application count/group. These routes pass only the authenticated
  // caller's organization and never post-filter an already-computed result.

  // Get organization analytics overview
  app.get("/api/organizations/analytics", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      const { getOrgAnalyticsOverview } = await import("./lib/orgAnalyticsService");
      const analytics = await getOrgAnalyticsOverview(orgResult.organization.id);

      res.json(analytics);
    } catch (error: any) {
      console.error("Error getting organization analytics:", error);
      res.status(500).json({ error: "Failed to get organization analytics" });
    }
  });

  // Get time to fill by job
  app.get("/api/organizations/analytics/time-to-fill", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      const { getTimeToFillByJob } = await import("./lib/orgAnalyticsService");
      const data = await getTimeToFillByJob(orgResult.organization.id);

      res.json(data);
    } catch (error: any) {
      console.error("Error getting time to fill:", error);
      res.status(500).json({ error: "Failed to get time to fill data" });
    }
  });

  // Get time in stage breakdown
  app.get("/api/organizations/analytics/stage-breakdown", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      const { getTimeInStageBreakdown } = await import("./lib/orgAnalyticsService");
      const data = await getTimeInStageBreakdown(orgResult.organization.id);

      res.json(data);
    } catch (error: any) {
      console.error("Error getting stage breakdown:", error);
      res.status(500).json({ error: "Failed to get stage breakdown" });
    }
  });

  // Get source performance
  app.get("/api/organizations/analytics/sources", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      const { getSourcePerformance } = await import("./lib/orgAnalyticsService");
      const data = await getSourcePerformance(orgResult.organization.id);

      res.json(data);
    } catch (error: any) {
      console.error("Error getting source performance:", error);
      res.status(500).json({ error: "Failed to get source performance" });
    }
  });

  // Get recruiter performance
  app.get("/api/organizations/analytics/recruiters", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to view recruiter performance" });
        return;
      }

      const { getRecruiterPerformance } = await import("./lib/orgAnalyticsService");
      const data = await getRecruiterPerformance(orgResult.organization.id);

      res.json(data);
    } catch (error: any) {
      console.error("Error getting recruiter performance:", error);
      res.status(500).json({ error: "Failed to get recruiter performance" });
    }
  });

  // Get hiring manager performance
  app.get("/api/organizations/analytics/hiring-managers", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to view hiring manager performance" });
        return;
      }

      const { getHiringManagerPerformance } = await import("./lib/orgAnalyticsService");
      const data = await getHiringManagerPerformance(orgResult.organization.id);

      res.json(data);
    } catch (error: any) {
      console.error("Error getting hiring manager performance:", error);
      res.status(500).json({ error: "Failed to get hiring manager performance" });
    }
  });

  // Get team activity
  app.get("/api/organizations/analytics/team", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to view team analytics" });
        return;
      }

      const { getTeamActivity } = await import("./lib/orgAnalyticsService");
      const activity = await getTeamActivity(orgResult.organization.id);

      res.json(activity);
    } catch (error: any) {
      console.error("Error getting team activity:", error);
      res.status(500).json({ error: "Failed to get team activity" });
    }
  });

  // Get AI credit usage
  app.get("/api/organizations/analytics/ai-usage", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      if (!canManageMembers(orgResult.membership.role as any)) {
        res.status(403).json({ error: "You don't have permission to view AI usage" });
        return;
      }

      const { getAiCreditUsage } = await import("./lib/orgAnalyticsService");
      const usage = await getAiCreditUsage(orgResult.organization.id);

      res.json(usage);
    } catch (error: any) {
      console.error("Error getting AI usage:", error);
      res.status(500).json({ error: "Failed to get AI usage" });
    }
  });

  // Get hiring funnel stats
  app.get("/api/organizations/analytics/funnel", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const orgResult = await getUserOrganization(user.id);

      if (!orgResult) {
        res.status(404).json({ error: "Not a member of any organization" });
        return;
      }

      const { getHiringFunnel } = await import("./lib/orgAnalyticsService");
      const funnel = await getHiringFunnel(orgResult.organization.id);

      res.json(funnel);
    } catch (error: any) {
      console.error("Error getting hiring funnel:", error);
      res.status(500).json({ error: "Failed to get hiring funnel" });
    }
  });
}
