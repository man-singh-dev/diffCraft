import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotificationBell } from './notification-bell';

describe('NotificationBell', () => {
  it('names the unread count on the button and shows a capped badge', () => {
    const html = renderToStaticMarkup(<NotificationBell initialUnread={12} />);
    expect(html).toContain('aria-label="Notifications, 12 unread"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>9\+<\/span>/);
  });

  it('has no badge at zero, and the dropdown starts closed', () => {
    const html = renderToStaticMarkup(<NotificationBell initialUnread={0} />);
    expect(html).toContain('aria-label="Notifications"');
    expect(html).not.toContain('9+');
    expect(html).not.toContain('role="region"');
  });
});
