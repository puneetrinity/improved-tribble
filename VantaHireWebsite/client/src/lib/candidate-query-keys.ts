export function candidatePrivateQueryKey<
  const TParts extends readonly unknown[] = readonly [],
>(
  path: string,
  candidateId: number | null,
  ...parts: TParts
): readonly [string, "candidate", number | null, ...TParts] {
  return [path, "candidate", candidateId, ...parts] as const;
}

const EXACT_USER_SCOPED_PATHS = new Set([
  "/api/profile",
  "/api/profile-status",
]);

export function isUserScopedQueryPath(path: unknown): boolean {
  if (typeof path !== "string") return false;

  return (
    EXACT_USER_SCOPED_PATHS.has(path) ||
    path.startsWith("/api/my-") ||
    path.startsWith("/api/candidate/") ||
    path.startsWith("/api/ai/")
  );
}
