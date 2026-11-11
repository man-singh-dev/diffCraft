import {
  ListNotificationsQuerySchema,
  type NotificationListResponse,
  type UnreadCountResponse,
} from '@diffcraft/shared';
import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError, ValidationError } from '../../errors.js';
import { authUser, requireAuth } from '../auth/require-auth.js';
import { decodeCursor } from '../reviews/cursor.js';
import { InvalidCursorError } from '../reviews/errors.js';
import { UUID_PATTERN } from '../workspaces/require-workspace-role.js';
import { countUnread, listNotifications, markAllRead, markRead } from './service.js';

export class NotificationNotFoundError extends NotFoundError {
  constructor() {
    super('notification_not_found', 'Notification not found.');
  }
}

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get<{ Reply: NotificationListResponse }>('/', async (request) => {
    const parsed = ListNotificationsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const { limit, cursor: rawCursor } = parsed.data;
    const cursor = rawCursor === undefined ? undefined : decodeCursor(rawCursor);
    if (cursor === null) throw new InvalidCursorError();
    return listNotifications(app.db, authUser(request).id, { limit, cursor });
  });

  app.get<{ Reply: UnreadCountResponse }>('/unread-count', async (request) => ({
    count: await countUnread(app.db, authUser(request).id),
  }));

  app.post<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
    const { id } = request.params;
    // Someone else's id and a missing one get the same 404.
    if (!UUID_PATTERN.test(id) || !(await markRead(app.db, authUser(request).id, id))) {
      throw new NotificationNotFoundError();
    }
    return reply.code(204).send();
  });

  app.post('/read-all', async (request, reply) => {
    await markAllRead(app.db, authUser(request).id);
    return reply.code(204).send();
  });
};
