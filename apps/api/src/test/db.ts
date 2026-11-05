import { describe } from 'vitest';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export const describeWithDb = describe.skipIf(!testDatabaseUrl);

// Never connected to: the pool only connects on the first query.
export const UNUSED_DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
