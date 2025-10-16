export type ClientConfig = {
  apolloAppId: string | null;
};

let cached: ClientConfig | null = null;

export async function getClientConfig(): Promise<ClientConfig> {
  if (cached) return cached;
  try {
    const res = await fetch('/api/client-config');
    if (!res.ok) throw new Error('config fetch failed');
    const data = await res.json();
    cached = { apolloAppId: data?.apolloAppId ?? null };
    return cached;
  } catch {
    cached = { apolloAppId: null };
    return cached;
  }
}

