import { describe, inject } from 'vitest';
import { testDatabaseUrl } from './db.js';

export const testRedisUrl = inject('testRedisUrl');

export const describeWithDbAndRedis = describe.skipIf(!testDatabaseUrl || !testRedisUrl);

// Port 1 is closed, so connecting is refused.
export const UNUSED_REDIS_URL = 'redis://127.0.0.1:1';
