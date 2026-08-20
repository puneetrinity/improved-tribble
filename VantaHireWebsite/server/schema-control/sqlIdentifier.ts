export class SchemaIdentifierError extends Error {}

/**
 * Runtime/migration role names are configuration, not free-form SQL. Restrict
 * them to ordinary unquoted PostgreSQL identifiers, then still quote them at
 * the SQL boundary. This makes every dynamic privilege statement auditable.
 */
export function assertRoleName(value: string): string {
  const role = value.trim();
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new SchemaIdentifierError(
      "FLOW_RUNTIME_ROLE must be a lowercase PostgreSQL identifier (letters, digits, underscore; max 63 bytes).",
    );
  }
  return role;
}

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
