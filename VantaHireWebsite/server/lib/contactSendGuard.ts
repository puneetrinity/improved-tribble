import type {
  ContactRevalidationInput,
  ContactRevalidationResult,
} from './contactResolutionCore';

export type GuardedContactDelivery<T> =
  | {
      status: 'sent';
      email: string;
      value: T;
      contact: ContactRevalidationResult;
    }
  | {
      status: 'skipped';
      email: null;
      value: null;
      contact: ContactRevalidationResult;
      skipReason: 'contact_unavailable' | 'org_suppressed' | 'platform_suppressed';
    };

export async function deliverWithRevalidatedContact<T>(
  input: ContactRevalidationInput,
  dependencies: {
    revalidate: (candidate: ContactRevalidationInput) => Promise<ContactRevalidationResult>;
    isSuppressed?: (email: string, candidate: ContactRevalidationInput) => Promise<boolean>;
    deliver: (email: string) => Promise<T>;
  },
): Promise<GuardedContactDelivery<T>> {
  const contact = await dependencies.revalidate(input);
  const email = contact.persisted && contact.state === 'found'
    ? contact.emails[0] ?? null
    : null;
  if (!email) {
    return {
      status: 'skipped',
      email: null,
      value: null,
      contact,
      skipReason: contact.state === 'suppressed'
        ? 'platform_suppressed'
        : 'contact_unavailable',
    };
  }
  if (await dependencies.isSuppressed?.(email, input)) {
    return {
      status: 'skipped',
      email: null,
      value: null,
      contact,
      skipReason: 'org_suppressed',
    };
  }

  return {
    status: 'sent',
    email,
    value: await dependencies.deliver(email),
    contact,
  };
}
