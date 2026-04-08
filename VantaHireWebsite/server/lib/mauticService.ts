import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { mauticContactLinks, organizations, users } from '@shared/schema';
import { getUserOrganization } from './organizationService';

type MauticConfig = {
  baseUrl: string;
  username: string;
  password: string;
};

type SyncContext = {
  user: typeof users.$inferSelect;
  organization: typeof organizations.$inferSelect | null;
};

const ELIGIBLE_ROLES = new Set(['recruiter', 'hiring_manager']);

function getMauticConfig(): MauticConfig | null {
  const baseUrl = process.env.MAUTIC_BASE_URL?.trim().replace(/\/+$/, '');
  const username = process.env.MAUTIC_USERNAME?.trim();
  const password = process.env.MAUTIC_PASSWORD?.trim();

  if (!baseUrl || !username || !password) {
    return null;
  }

  return { baseUrl, username, password };
}

function getSegmentId(envKey: string, fallback: number | null): number | null {
  const raw = process.env[envKey];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getPointValue(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildAuthHeader(config: MauticConfig): string {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
}

async function mauticRequest<T = any>(
  config: MauticConfig,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: buildAuthHeader(config),
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Mautic ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as T;
}

function extractContactId(payload: any): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (typeof payload.contact?.id === 'number') {
    return payload.contact.id;
  }

  if (typeof payload.contact?.id === 'string') {
    const parsed = Number(payload.contact.id);
    return Number.isInteger(parsed) ? parsed : null;
  }

  const contacts = payload.contacts;
  if (Array.isArray(contacts) && contacts.length > 0) {
    const first = contacts[0];
    const parsed = Number(first?.id);
    return Number.isInteger(parsed) ? parsed : null;
  }

  if (contacts && typeof contacts === 'object') {
    const first = Object.values(contacts)[0] as any;
    const parsed = Number(first?.id);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

async function resolveSyncContext(userId: number, organizationId?: number | null): Promise<SyncContext | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user || !ELIGIBLE_ROLES.has(user.role)) {
    return null;
  }

  let organization: typeof organizations.$inferSelect | null = null;

  if (organizationId != null) {
    organization = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    }) ?? null;
  } else {
    const orgResult = await getUserOrganization(userId);
    organization = orgResult?.organization ?? null;
  }

  return { user, organization };
}

async function upsertLinkStub(context: SyncContext): Promise<typeof mauticContactLinks.$inferSelect> {
  const [link] = await db
    .insert(mauticContactLinks)
    .values({
      userId: context.user.id,
      organizationId: context.organization?.id ?? null,
      email: context.user.username,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: mauticContactLinks.email,
      set: {
        userId: context.user.id,
        organizationId: context.organization?.id ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return link;
}

async function updateLinkById(
  linkId: number,
  values: Partial<typeof mauticContactLinks.$inferInsert>,
): Promise<void> {
  await db
    .update(mauticContactLinks)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(eq(mauticContactLinks.id, linkId));
}

async function findContactIdByEmail(config: MauticConfig, email: string): Promise<number | null> {
  const payload = await mauticRequest<any>(
    config,
    `/api/contacts?search=${encodeURIComponent(email)}`,
    { method: 'GET' },
  );
  return extractContactId(payload);
}

async function ensureRemoteContact(
  config: MauticConfig,
  context: SyncContext,
  link: typeof mauticContactLinks.$inferSelect,
): Promise<number> {
  const payload = {
    firstname: context.user.firstName ?? '',
    lastname: context.user.lastName ?? '',
    email: context.user.username,
    company: context.organization?.name ?? '',
  };

  let contactId = link.mauticContactId ?? null;

  if (!contactId) {
    contactId = await findContactIdByEmail(config, context.user.username);
  }

  const response = contactId
    ? await mauticRequest<any>(config, `/api/contacts/${contactId}/edit`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
    : await mauticRequest<any>(config, '/api/contacts/new', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

  const resolvedContactId = extractContactId(response) ?? contactId;

  if (!resolvedContactId) {
    throw new Error(`Could not resolve Mautic contact ID for ${context.user.username}`);
  }

  await updateLinkById(link.id, {
    mauticContactId: resolvedContactId,
    lastSyncedAt: new Date(),
    lastError: null,
    organizationId: context.organization?.id ?? null,
  });

  return resolvedContactId;
}

async function moveToSegment(
  config: MauticConfig,
  contactId: number,
  newSegmentId: number,
  oldSegmentId?: number | null,
): Promise<void> {
  if (oldSegmentId && oldSegmentId > 0 && oldSegmentId !== newSegmentId) {
    await mauticRequest(config, `/api/segments/${oldSegmentId}/contact/${contactId}/remove`, {
      method: 'POST',
    });
  }

  await mauticRequest(config, `/api/segments/${newSegmentId}/contact/${contactId}/add`, {
    method: 'POST',
  });
}

async function addPoints(config: MauticConfig, contactId: number, delta: number): Promise<void> {
  if (!delta) {
    return;
  }

  if (delta > 0) {
    await mauticRequest(config, `/api/contacts/${contactId}/points/plus/${delta}`, {
      method: 'POST',
    });
    return;
  }

  await mauticRequest(config, `/api/contacts/${contactId}/points/minus/${Math.abs(delta)}`, {
    method: 'POST',
  });
}

async function tagContact(config: MauticConfig, contactId: number, tags: string[]): Promise<void> {
  const normalizedTags = tags.map((tag) => tag.trim()).filter(Boolean);
  if (normalizedTags.length === 0) {
    return;
  }

  await mauticRequest(config, `/api/contacts/${contactId}/edit`, {
    method: 'PATCH',
    body: JSON.stringify({
      tags: normalizedTags.join(','),
    }),
  });
}

async function withLinkedContact(
  userId: number,
  organizationId: number | null | undefined,
): Promise<{ config: MauticConfig; context: SyncContext; link: typeof mauticContactLinks.$inferSelect; contactId: number } | null> {
  const config = getMauticConfig();
  if (!config) {
    return null;
  }

  const context = await resolveSyncContext(userId, organizationId);
  if (!context) {
    return null;
  }

  const link = await upsertLinkStub(context);
  let contactId: number;
  try {
    contactId = await ensureRemoteContact(config, context, link);
  } catch (error: any) {
    await updateLinkById(link.id, {
      lastError: error?.message || 'Unknown Mautic sync error',
    });
    throw error;
  }
  const refreshedLink = await db.query.mauticContactLinks.findFirst({
    where: eq(mauticContactLinks.id, link.id),
  });

  return {
    config,
    context,
    link: refreshedLink ?? link,
    contactId,
  };
}

function runAsync(label: string, runner: () => Promise<void>): void {
  setImmediate(() => {
    runner().catch((error) => {
      console.error(`[Mautic] ${label} failed:`, error);
    });
  });
}

export function queueMauticSignupSync(userId: number, organizationId?: number | null): void {
  runAsync('signup-sync', async () => {
    const linked = await withLinkedContact(userId, organizationId);
    if (!linked) {
      return;
    }
    await updateLinkById(linked.link.id, { lastError: null });
  });
}

export async function createOrUpdateMauticContact(userId: number, organizationId?: number | null): Promise<number | null> {
  const linked = await withLinkedContact(userId, organizationId);
  return linked?.contactId ?? null;
}

export async function moveMauticContactToSegment(
  userId: number,
  newSegmentId: number,
  oldSegmentId?: number | null,
  organizationId?: number | null,
): Promise<void> {
  const linked = await withLinkedContact(userId, organizationId);
  if (!linked) {
    return;
  }

  await moveToSegment(linked.config, linked.contactId, newSegmentId, oldSegmentId ?? linked.link.lastKnownSegmentId);
  await updateLinkById(linked.link.id, {
    lastKnownSegmentId: newSegmentId,
    lastSyncedAt: new Date(),
    lastError: null,
  });
}

export async function addMauticPoints(userId: number, delta: number, organizationId?: number | null): Promise<void> {
  const linked = await withLinkedContact(userId, organizationId);
  if (!linked) {
    return;
  }

  await addPoints(linked.config, linked.contactId, delta);
  await updateLinkById(linked.link.id, {
    lastSyncedAt: new Date(),
    lastError: null,
  });
}

export async function tagMauticContact(userId: number, tags: string[], organizationId?: number | null): Promise<void> {
  const linked = await withLinkedContact(userId, organizationId);
  if (!linked) {
    return;
  }

  await tagContact(linked.config, linked.contactId, tags);
  await updateLinkById(linked.link.id, {
    lastSyncedAt: new Date(),
    lastError: null,
  });
}

export function queueMauticFirstLoginSync(userId: number, organizationId?: number | null): void {
  runAsync('first-login-sync', async () => {
    const linked = await withLinkedContact(userId, organizationId);
    if (!linked) {
      return;
    }

    if (linked.link.firstLoginSyncedAt) {
      return;
    }

    try {
      const onboardedSegmentId = getSegmentId('MAUTIC_SEGMENT_ONBOARDED_PARTNERS', 18);
      if (onboardedSegmentId) {
        await moveToSegment(
          linked.config,
          linked.contactId,
          onboardedSegmentId,
          linked.link.lastKnownSegmentId,
        );
      }

      await addPoints(
        linked.config,
        linked.contactId,
        getPointValue('MAUTIC_POINTS_FIRST_LOGIN', 10),
      );

      await updateLinkById(linked.link.id, {
        firstLoginSyncedAt: new Date(),
        lastKnownSegmentId: onboardedSegmentId ?? linked.link.lastKnownSegmentId ?? null,
        lastSyncedAt: new Date(),
        lastError: null,
      });
    } catch (error: any) {
      await updateLinkById(linked.link.id, {
        lastError: error?.message || 'Unknown Mautic login sync error',
      });
      throw error;
    }
  });
}

export function queueMauticFirstJobCreatedSync(userId: number, organizationId: number): void {
  runAsync('first-job-created-sync', async () => {
    const linked = await withLinkedContact(userId, organizationId);
    if (!linked) {
      return;
    }

    if (linked.link.firstJobCreatedSyncedAt) {
      return;
    }

    try {
      await addPoints(
        linked.config,
        linked.contactId,
        getPointValue('MAUTIC_POINTS_FIRST_JOB_CREATED', 5),
      );

      await updateLinkById(linked.link.id, {
        firstJobCreatedSyncedAt: new Date(),
        lastSyncedAt: new Date(),
        lastError: null,
      });
    } catch (error: any) {
      await updateLinkById(linked.link.id, {
        lastError: error?.message || 'Unknown Mautic first-job sync error',
      });
      throw error;
    }
  });
}

export function queueMauticSourcingRunSync(userId: number, organizationId: number): void {
  runAsync('sourcing-run-sync', async () => {
    const linked = await withLinkedContact(userId, organizationId);
    if (!linked) {
      return;
    }

    try {
      await addPoints(
        linked.config,
        linked.contactId,
        getPointValue('MAUTIC_POINTS_SOURCING_RUN', 5),
      );

      await updateLinkById(linked.link.id, {
        lastSyncedAt: new Date(),
        lastError: null,
      });
    } catch (error: any) {
      await updateLinkById(linked.link.id, {
        lastError: error?.message || 'Unknown Mautic sourcing sync error',
      });
      throw error;
    }
  });
}

export function queueMauticOutreachSync(
  userId: number,
  organizationId: number | null | undefined,
  channel: 'email' | 'whatsapp',
): void {
  runAsync(`outreach-sync:${channel}`, async () => {
    const linked = await withLinkedContact(userId, organizationId);
    if (!linked) {
      return;
    }

    try {
      await addPoints(
        linked.config,
        linked.contactId,
        getPointValue('MAUTIC_POINTS_OUTREACH', 5),
      );

      await updateLinkById(linked.link.id, {
        lastSyncedAt: new Date(),
        lastError: null,
      });
    } catch (error: any) {
      await updateLinkById(linked.link.id, {
        lastError: error?.message || `Unknown Mautic ${channel} sync error`,
      });
      throw error;
    }
  });
}
