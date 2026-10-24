import { z } from 'zod';
export const ReadyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
});

export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
