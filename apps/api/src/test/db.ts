import { describe } from 'vitest';

/** Set (and already migrated by global-setup.ts) when the test database is available. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** `describe` for tests that need the test database; skipped when TEST_DATABASE_URL is unset. */
export const describeWithDb = describe.skipIf(!testDatabaseUrl);

/** A well-formed URL that is never connected to: the pool only connects on the first query. */
export const UNUSED_DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
