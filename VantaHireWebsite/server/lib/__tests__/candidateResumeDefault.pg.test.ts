// Default résumé on real PostgreSQL: one default per candidate under concurrent uploads and
// make-default calls, and an insert failure never removes the existing default.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../shared/schema";
import { runReleaseMigration, type MigrationClient } from "../../schema-control/runner";
import { insertLibraryResume, makeLibraryResumeDefault } from "../candidateResumeDefault";

const url = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_RESUME_DEFAULT_TEST_DISPOSABLE === "1" && Boolean(url);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema-migrations");
let pool: Pool | undefined; let db: any; let owner: Client | undefined;

async function client(): Promise<Client> { const c = new Client({ connectionString: url, connectionTimeoutMillis: 2_000 }); await c.connect(); return c; }
async function connect(): Promise<MigrationClient> { const c = await client(); return { query: (t, p) => c.query(t, p as any), end: () => c.end() }; }
const defaults = async (userId: number) => (await owner!.query("SELECT id FROM candidate_resumes WHERE user_id=$1 AND is_default ORDER BY id", [userId])).rows.map(r => r.id);
const count = async (userId: number) => Number((await owner!.query("SELECT count(*) n FROM candidate_resumes WHERE user_id=$1", [userId])).rows[0].n);
const resume = (userId: number, n: number, requestDefault = false) => ({ userId, label: `cv${n}`, gcsPath: `gs://synthetic/${userId}/${n}`, extractedText: "", requestDefault });

describe.skipIf(!enabled)("default résumé on PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("requires NODE_ENV=test");
    const parsed = new URL(url);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || Boolean(parsed.searchParams.get("host")?.startsWith("/"));
    if (!local || !parsed.pathname.includes("_test")) throw new Error("Refusing: not a local disposable *_test database.");
    const c = await client();
    try {
      await c.query("DROP SCHEMA IF EXISTS schema_control CASCADE"); await c.query("DROP SCHEMA IF EXISTS public CASCADE");
      await c.query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
    } finally { await c.end(); }
    await runReleaseMigration({ migrationsDir, connect,
      creds: { migrateUrl: url, expectedTargetId: "flow-resume-default-test-target", environment: "development", allowFreshInitialization: true } });
    owner = await client();
    await owner.query(`INSERT INTO users (id,username,password,role,email_verified) VALUES
      (901,'a@example.invalid','x','candidate',true),(902,'b@example.invalid','x','candidate',true),(903,'c@example.invalid','x','candidate',true),(904,'d@example.invalid','x','candidate',true)`);
    pool = new Pool({ connectionString: url, max: 8 }); db = drizzle(pool, { schema });
  }, 120_000);
  afterAll(async () => { await owner?.end(); await pool?.end(); });

  it("concurrent first uploads leave exactly one default", async () => {
    await Promise.all([1, 2, 3].map(n => insertLibraryResume(db, resume(901, n))));
    expect(await count(901)).toBe(3);
    expect(await defaults(901)).toHaveLength(1);
  });

  it("make-default racing an upload leaves exactly one default, owned by the candidate", async () => {
    const first = await insertLibraryResume(db, resume(902, 1));
    const second = await insertLibraryResume(db, resume(902, 2));
    expect(await defaults(902)).toEqual([first.id]);
    await Promise.all([makeLibraryResumeDefault(db, 902, second.id), insertLibraryResume(db, resume(902, 3))]);
    expect(await defaults(902)).toEqual([second.id]);
    // Someone else's résumé is never made default.
    expect(await makeLibraryResumeDefault(db, 901, second.id)).toBe(false);
    expect(await defaults(902)).toEqual([second.id]);
  });

  it("an insert that fails keeps the candidate's existing default", async () => {
    const first = await insertLibraryResume(db, resume(903, 1));
    // gcs_path is NOT NULL: the insert fails inside the same transaction, after defaults were cleared.
    await expect(insertLibraryResume(db, { ...resume(903, 2, true), userId: 903, gcsPath: null as never })).rejects.toThrow();
    expect(await defaults(903)).toEqual([first.id]);
  });

  it("a later upload stays non-default unless asked; asking moves the default", async () => {
    const first = await insertLibraryResume(db, resume(904, 1));
    const later = await insertLibraryResume(db, resume(904, 2));
    expect(later.isDefault).toBe(false);
    const asked = await insertLibraryResume(db, resume(904, 3, true));
    expect(await defaults(904)).toEqual([asked.id]);
    expect(first.isDefault).toBe(true);
  });
});
