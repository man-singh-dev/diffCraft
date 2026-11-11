import fp from 'fastify-plugin';
import { createRelay, DEFAULT_RELAY_OPTIONS, type RelayOptions } from './relay.js';

export interface NotificationsPluginOptions {
  relay?: Partial<RelayOptions> & { enabled?: boolean };
}

export const notificationsPlugin = fp<NotificationsPluginOptions>(
  async (app, { relay: { enabled = true, ...overrides } = {} }) => {
    if (!enabled) return;
    const relay = createRelay(
      {
        db: app.db,
        log: app.log.child({ module: 'outbox-relay' }),
        emit: (userId, notification) =>
          app.realtime.emitToUser(userId, 'notification:new', notification),
        canDeliver: () => app.realtime.canReachAllInstances(),
      },
      { ...DEFAULT_RELAY_OPTIONS, ...overrides },
    );

    // Like the Socket.IO cluster, only a listening server relays; apps used through inject() never do.
    app.addHook('onListen', async () => relay.start());
    app.addHook('preClose', () => relay.stop());
  },
  { name: 'notifications', dependencies: ['db'] },
);
