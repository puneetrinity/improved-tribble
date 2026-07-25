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
    };

export async function deliverWithRevalidatedContact<T>(
  input: ContactRevalidationInput,
  dependencies: {
    revalidate: (candidate: ContactRevalidationInput) => Promise<ContactRevalidationResult>;
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
    };
  }

  return {
    status: 'sent',
    email,
    value: await dependencies.deliver(email),
    contact,
  };
}
