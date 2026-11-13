import pg from 'pg';

const url = new URL(process.env.DATABASE_URL ?? '');
const name = decodeURIComponent(url.pathname.slice(1));
// Dropped on every run: refuse anything that isn't a dedicated e2e database.
if (!/^[a-z0-9_]+_e2e$/.test(name)) {
  console.error('prepare-db: DATABASE_URL must point at a database whose name ends in _e2e');
  process.exit(1);
}

url.pathname = '/postgres';
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
  console.log(`prepare-db: recreated ${name}`);
} finally {
  await client.end();
}
