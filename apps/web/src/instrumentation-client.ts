import { z } from 'zod';

// Before any schema runs: Zod otherwise probes for eval with Function(''), which the CSP blocks and reports as a violation.
z.config({ jitless: true });
