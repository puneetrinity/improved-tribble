import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface UseOrganizationOptions {
  enabled?: boolean;
}

// Types
export interface Organization {
  id: number;
  name: string;
  slug: string;
  logo?: string | null;
  domain?: string | null;
  domainVerified: boolean;
  gstin?: string | null;
  billingName?: string | null;
  billingAddress?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPincode?: string | null;
  billingContactEmail?: string | null;
  billingContactName?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Membership {
  role: 'owner' | 'admin' | 'member';
  seatAssigned: boolean;
  joinedAt: string;
  creditsAllocated?: number;
  creditsUsed?: number;
}

export interface OrganizationMember {
  id: number;
  userId: number;
  role: 'owner' | 'admin' | 'member';
  seatAssigned: boolean;
  lastActivityAt?: string;
  creditsAllocated: number;
  creditsUsed: number;
  joinedAt: string;
  user: {
    id: number;
    username: string;
    firstName?: string | null;
    lastName?: string | null;
  };
}

export interface OrganizationInvite {
  id: number;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

export interface JoinRequest {
  id: number;
  userId: number;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  user: {
    username: string;
    firstName?: string | null;
    lastName?: string | null;
  };
}

// API functions
async function fetchCurrentOrganization() {
  const res = await fetch('/api/organizations/current', {
    credentials: 'include',
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error('Failed to fetch organization');
  }
  return res.json();
}

async function fetchMembers() {
  const res = await fetch('/api/organizations/members', {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch members');
  }
  return res.json();
}

async function fetchInvites() {
  const res = await fetch('/api/organizations/invites', {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch invites');
  }
  return res.json();
}

async function fetchJoinRequests() {
  const res = await fetch('/api/organizations/join-requests', {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch join requests');
  }
  return res.json();
}

// Hooks
export function useOrganization(options: UseOrganizationOptions = {}) {
  const { enabled = true } = options;

  return useQuery<{ organization: Organization; membership: Membership } | null>({
    queryKey: ['organization', 'current'],
    queryFn: fetchCurrentOrganization,
    staleTime: 1000 * 60, // 1 minute
    enabled,
  });
}

export function useOrganizationMembers() {
  return useQuery<OrganizationMember[]>({
    queryKey: ['organization', 'members'],
    queryFn: fetchMembers,
    staleTime: 1000 * 30, // 30 seconds
  });
}

export function useOrganizationInvites() {
  return useQuery<OrganizationInvite[]>({
    queryKey: ['organization', 'invites'],
    queryFn: fetchInvites,
    staleTime: 1000 * 30,
  });
}

export function useJoinRequests() {
  return useQuery<JoinRequest[]>({
    queryKey: ['organization', 'join-requests'],
    queryFn: fetchJoinRequests,
    staleTime: 1000 * 30,
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await apiRequest('POST', '/api/organizations', data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create organization');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<Organization>) => {
      const res = await apiRequest('PATCH', '/api/organizations/current', data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update organization');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();

  return useMutation({
    // Role is optional - backend always assigns 'member' (owner can promote after join)
    mutationFn: async (data: { email: string }) => {
      const res = await apiRequest('POST', '/api/organizations/members/invite', data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to invite member');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', 'invites'] });
    },
  });
}

export function useCancelInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inviteId: number) => {
      const res = await apiRequest('DELETE', `/api/organizations/invites/${inviteId}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to cancel invite');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', 'invites'] });
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (memberId: number) => {
      const res = await apiRequest('DELETE', `/api/organizations/members/${memberId}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to remove member');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', 'members'] });
    },
  });
}

export function useRespondToJoinRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { requestId: number; status: 'approved' | 'rejected'; rejectionReason?: string }) => {
      const res = await apiRequest(
        'POST',
        `/api/organizations/join-requests/${data.requestId}/respond`,
        { status: data.status, rejectionReason: data.rejectionReason },
      );
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to respond to join request');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', 'join-requests'] });
      queryClient.invalidateQueries({ queryKey: ['organization', 'members'] });
    },
  });
}

export function useLeaveOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/organizations/members/leave');
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to leave organization');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
  });
}

/**
 * Get jobs owned by a specific member (for reassignment UI)
 */
export function useMemberJobs(memberId: number | null) {
  return useQuery({
    queryKey: ['organization', 'members', memberId, 'jobs'],
    queryFn: async () => {
      if (!memberId) return [];
      const res = await fetch(`/api/organizations/members/${memberId}/jobs`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch member jobs');
      }
      return res.json() as Promise<number[]>;
    },
    enabled: !!memberId,
  });
}

/**
 * Reassign jobs from one member to another
 */
export function useReassignJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { fromMemberId: number; toUserId: number }) => {
      const res = await apiRequest(
        'POST',
        `/api/organizations/members/${data.fromMemberId}/reassign`,
        { toUserId: data.toUserId },
      );
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to reassign jobs');
      }
      return res.json() as Promise<{ success: boolean; reassignedCount: number }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', 'members'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
