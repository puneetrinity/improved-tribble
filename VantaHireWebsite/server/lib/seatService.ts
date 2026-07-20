import { db } from "../db";
import {
  organizationMembers,
  organizationSubscriptions,
  subscriptionPlans,
  users,
  type OrganizationMember,
} from "@shared/schema";
import { eq, and, desc, sql, asc, ne } from "drizzle-orm";
import { getSeatedMembersCount, getMembersByActivity } from "./membershipService";
import { getOrganizationSubscription, updateSubscriptionSeats } from "./subscriptionService";
import { initializeMemberCredits } from "./creditService";

export interface SeatUsage {
  purchased: number;
  assigned: number;
  available: number;
}

export interface MemberWithActivity {
  memberId: number;
  userId: number;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  seatAssigned: boolean;
  lastActivityAt: Date | null;
  joinedAt: Date;
}

// Get seat usage for organization
export async function getSeatUsage(orgId: number): Promise<SeatUsage> {
  const subscription = await getOrganizationSubscription(orgId);
  if (!subscription) {
    return { purchased: 1, assigned: 0, available: 1 }; // Default free tier
  }

  const assignedCount = await getSeatedMembersCount(orgId);

  return {
    purchased: subscription.seats,
    assigned: assignedCount,
    available: Math.max(0, subscription.seats - assignedCount),
  };
}

// Check if seats are available
export async function hasAvailableSeats(orgId: number): Promise<boolean> {
  const usage = await getSeatUsage(orgId);
  return usage.available > 0;
}

// Assign seat to member
export async function assignSeat(memberId: number): Promise<OrganizationMember> {
  const member = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.id, memberId),
  });

  if (!member) {
    throw new Error('Member not found');
  }

  if (member.seatAssigned) {
    return member; // Already has seat
  }

  // Check if seats available
  const hasSeats = await hasAvailableSeats(member.organizationId);
  if (!hasSeats) {
    throw new Error('No seats available. Please purchase more seats.');
  }

  const [updated] = await db.update(organizationMembers)
    .set({ seatAssigned: true })
    .where(eq(organizationMembers.id, memberId))
    .returning();

  await initializeMemberCredits(memberId, member.organizationId);

  return updated;
}

// Unassign seat from member
export async function unassignSeat(memberId: number): Promise<OrganizationMember> {
  const member = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.id, memberId),
  });

  if (!member) {
    throw new Error('Member not found');
  }

  // Cannot unassign owner's seat
  if (member.role === 'owner') {
    throw new Error('Cannot remove seat from organization owner');
  }

  if (!member.seatAssigned) {
    return member; // Already unseated
  }

  const [updated] = await db.update(organizationMembers)
    .set({
      seatAssigned: false,
    })
    .where(eq(organizationMembers.id, memberId))
    .returning();

  return updated;
}

// Get members with activity info for seat selection UI
export async function getMembersForSeatSelection(orgId: number): Promise<MemberWithActivity[]> {
  const members = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.organizationId, orgId),
    with: {
      user: {
        columns: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: [
      // Owner first
      sql`CASE WHEN ${organizationMembers.role} = 'owner' THEN 0 ELSE 1 END`,
      // Then by activity (most active first)
      desc(organizationMembers.lastActivityAt),
      // Then by tenure
      asc(organizationMembers.joinedAt),
    ],
  });

  return members.map((m: typeof members[number]) => ({
    memberId: m.id,
    userId: m.userId,
    username: m.user.username,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    role: m.role,
    seatAssigned: m.seatAssigned,
    lastActivityAt: m.lastActivityAt,
    joinedAt: m.joinedAt,
  }));
}

// Reduce seats with member selection
export async function reduceSeats(
  orgId: number,
  newSeatCount: number,
  memberIdsToKeep: number[],
  performedBy?: number
): Promise<{ success: boolean; unseatedCount: number }> {
  const subscription = await getOrganizationSubscription(orgId);
  if (!subscription) {
    throw new Error('No subscription found');
  }

  // Ensure at least 1 seat (for owner)
  if (newSeatCount < 1) {
    throw new Error('Must have at least 1 seat');
  }

  // Get current members
  const currentMembers = await getMembersForSeatSelection(orgId);
  const ownerMember = currentMembers.find(m => m.role === 'owner');

  if (!ownerMember) {
    throw new Error('Organization has no owner');
  }

  // Owner must always be in the keep list
  if (!memberIdsToKeep.includes(ownerMember.memberId)) {
    memberIdsToKeep = [ownerMember.memberId, ...memberIdsToKeep];
  }

  // Ensure keep list matches seat count
  if (memberIdsToKeep.length > newSeatCount) {
    throw new Error(`Cannot keep ${memberIdsToKeep.length} members with ${newSeatCount} seats`);
  }

  // Find members to unseat
  const memberIdsToUnseat = currentMembers
    .filter(m => m.seatAssigned && !memberIdsToKeep.includes(m.memberId))
    .map(m => m.memberId);

  // Unseat members not in keep list
  if (memberIdsToUnseat.length > 0) {
    await db.update(organizationMembers)
      .set({
        seatAssigned: false,
      })
      .where(and(
        eq(organizationMembers.organizationId, orgId),
        sql`${organizationMembers.id} IN (${sql.join(memberIdsToUnseat, sql`, `)})`
      ));
  }

  // Update subscription seat count
  await updateSubscriptionSeats(subscription.id, newSeatCount, performedBy);

  return {
    success: true,
    unseatedCount: memberIdsToUnseat.length,
  };
}

// Auto-downgrade: determine who keeps seats based on activity
export async function autoSelectMembersForSeats(
  orgId: number,
  targetSeatCount: number
): Promise<number[]> {
  const members = await getMembersByActivity(orgId);

  // Owner always first (already sorted this way)
  const keepIds: number[] = [];

  for (const member of members) {
    if (keepIds.length >= targetSeatCount) break;

    // Owner always keeps seat
    if (member.role === 'owner') {
      keepIds.push(member.id);
      continue;
    }

    // Add most active members up to target count
    keepIds.push(member.id);
  }

  return keepIds;
}

// Execute auto-downgrade (for payment failure after grace period)
export async function executeAutoDowngrade(
  orgId: number,
  targetSeatCount: number
): Promise<{ unseatedMembers: OrganizationMember[] }> {
  // Auto-select who keeps seats
  const keepIds = await autoSelectMembersForSeats(orgId, targetSeatCount);

  // Get members to unseat
  const allMembers = await db.query.organizationMembers.findMany({
    where: and(
      eq(organizationMembers.organizationId, orgId),
      eq(organizationMembers.seatAssigned, true)
    ),
  });

  const membersToUnseat = allMembers.filter((m: typeof allMembers[number]) => !keepIds.includes(m.id));

  // Unseat members
  const unseatedMembers: OrganizationMember[] = [];
  for (const member of membersToUnseat) {
    const unseated = await unassignSeat(member.id);
    unseatedMembers.push(unseated);
  }

  return { unseatedMembers };
}

// Re-seat all previously unseated members (after payment recovery)
export async function reseatAllMembers(orgId: number): Promise<number> {
  const subscription = await getOrganizationSubscription(orgId);
  if (!subscription) {
    return 0;
  }

  const unseatedMembers = await db.query.organizationMembers.findMany({
    where: and(
      eq(organizationMembers.organizationId, orgId),
      eq(organizationMembers.seatAssigned, false)
    ),
    orderBy: [
      // Owner first
      sql`CASE WHEN ${organizationMembers.role} = 'owner' THEN 0 ELSE 1 END`,
      // Then by join date (oldest first)
      asc(organizationMembers.joinedAt),
    ],
  });

  const seatsAvailable = subscription.seats - await getSeatedMembersCount(orgId);
  const toReseat = unseatedMembers.slice(0, seatsAvailable);

  if (toReseat.length === 0) {
    return 0;
  }

  // Update seat status
  await db.update(organizationMembers)
    .set({ seatAssigned: true })
    .where(sql`${organizationMembers.id} IN (${sql.join(toReseat.map((m: typeof toReseat[number]) => m.id), sql`, `)})`);

  // Allocate credits to each reseated member
  for (const member of toReseat) {
    await initializeMemberCredits(member.id, orgId);
  }

  return toReseat.length;
}

// Check if user has an assigned seat
export async function isUserSeated(userId: number): Promise<boolean> {
  const membership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
  });

  return membership?.seatAssigned ?? false;
}

// Get unseated member info (for blocked page)
export async function getUnseatedMemberInfo(userId: number): Promise<{
  organizationName: string;
  ownerEmail: string;
  reason: string;
} | null> {
  const membership = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.seatAssigned, false)
    ),
    with: {
      organization: true,
    },
  });

  if (!membership || !membership.organization) {
    return null;
  }

  // Get owner email
  const owner = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, membership.organizationId),
      eq(organizationMembers.role, 'owner')
    ),
    with: {
      user: {
        columns: {
          username: true,
        },
      },
    },
  });

  return {
    organizationName: membership.organization.name,
    ownerEmail: owner?.user?.username || 'info@ealana.com',
    reason: 'Your seat has been removed due to subscription changes.',
  };
}
