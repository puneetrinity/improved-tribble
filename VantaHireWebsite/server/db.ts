import * as schema from "@shared/schema";

// Support both Neon (serverless) and standard Postgres on Railway
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Configure it in Railway Variables (see DEPLOY_RAILWAY.md).",
  );
}

const isNeon = /neon\.tech/i.test(databaseUrl) || process.env.DATABASE_USE_NEON === '1';

let db: any;
let pool: any;

if (isNeon) {
  // Neon serverless driver over WebSocket
  const { Pool, neonConfig } = await import('@neondatabase/serverless');
  const ws = (await import('ws')).default as any;
  const { drizzle } = await import('drizzle-orm/neon-serverless');

  neonConfig.webSocketConstructor = ws;
  pool = new Pool({ connectionString: databaseUrl });
  db = drizzle({ client: pool, schema });
} else {
  // Standard Postgres (Railway, RDS, etc.)
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');

  // Enable SSL in production unless explicitly disabled
  const useSsl = process.env.DATABASE_SSL === 'true' || /sslmode=require/i.test(databaseUrl) || process.env.NODE_ENV === 'production';
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  } as any);
  db = drizzle(pool, { schema });
}

export { db, pool };
