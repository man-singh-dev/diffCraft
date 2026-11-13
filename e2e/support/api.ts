import { randomUUID } from 'node:crypto';
import type { APIRequestContext, APIResponse, PlaywrightWorkerArgs } from '@playwright/test';
import { WEB_URL } from '../env';
import { verificationLinkFor } from './mail';

type StorageState = Awaited<ReturnType<APIRequestContext['storageState']>>;

export const PASSWORD = 'correct horse battery staple';

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
  storageState: StorageState;
}

async function json<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function ok(response: APIResponse): Promise<void> {
  if (!response.ok()) {
    throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
  }
}

export const uniqueEmail = (label = 'user') => `e2e-${label}-${randomUUID()}@example.com`;

/** Registers, verifies through the emailed link and logs in, all through the web app's /api rewrite. */
export async function createUser(
  playwright: PlaywrightWorkerArgs['playwright'],
  displayName: string,
): Promise<TestUser> {
  const request = await playwright.request.newContext({ baseURL: WEB_URL });
  try {
    const email = uniqueEmail(displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const user = await json<{ id: string }>(
      await request.post('/api/v1/auth/register', {
        data: { email, password: PASSWORD, displayName },
      }),
    );
    const token = new URL(await verificationLinkFor(request, email)).searchParams.get('token');
    await ok(await request.post('/api/v1/auth/verify-email', { data: { token } }));
    await ok(await request.post('/api/v1/auth/login', { data: { email, password: PASSWORD } }));
    return { id: user.id, email, displayName, storageState: await request.storageState() };
  } finally {
    await request.dispose();
  }
}

export interface Review {
  id: string;
  number: number;
  workspaceId: string;
}

export interface ReviewFile {
  id: string;
  newPath: string | null;
  oldPath: string | null;
}

export interface Thread {
  id: string;
}

export interface LineAnchor {
  fileId: string;
  side: 'old' | 'new';
  line: number;
}

/** API calls made as one user. */
export class UserApi {
  private constructor(private readonly request: APIRequestContext) {}

  static async as(
    playwright: PlaywrightWorkerArgs['playwright'],
    user: TestUser,
  ): Promise<UserApi> {
    return new UserApi(
      await playwright.request.newContext({ baseURL: WEB_URL, storageState: user.storageState }),
    );
  }

  dispose() {
    return this.request.dispose();
  }

  async createWorkspace(name: string): Promise<{ id: string }> {
    return json(await this.request.post('/api/v1/workspaces', { data: { name } }));
  }

  async addMember(workspaceId: string, email: string, role = 'member'): Promise<void> {
    await ok(
      await this.request.post(`/api/v1/workspaces/${workspaceId}/members`, {
        data: { email, role },
      }),
    );
  }

  async createReview(
    workspaceId: string,
    title: string,
    patch: string,
    description?: string,
  ): Promise<Review> {
    return json(
      await this.request.post(`/api/v1/workspaces/${workspaceId}/reviews`, {
        data: { title, patch, description },
      }),
    );
  }

  private reviewUrl(review: Review) {
    return `/api/v1/workspaces/${review.workspaceId}/reviews/${review.number}`;
  }

  async files(review: Review): Promise<ReviewFile[]> {
    return json(await this.request.get(`${this.reviewUrl(review)}/files`));
  }

  async createThread(review: Review, body: string, anchor?: LineAnchor): Promise<Thread> {
    return json(
      await this.request.post(`${this.reviewUrl(review)}/threads`, { data: { body, anchor } }),
    );
  }

  async reply(review: Review, threadId: string, body: string): Promise<void> {
    await ok(
      await this.request.post(`${this.reviewUrl(review)}/threads/${threadId}/comments`, {
        data: { body },
      }),
    );
  }

  async assignReviewers(review: Review, userIds: string[]): Promise<void> {
    await ok(await this.request.post(`${this.reviewUrl(review)}/reviewers`, { data: { userIds } }));
  }

  async decide(
    review: Review,
    decision: 'approve' | 'request_changes',
    body?: string,
  ): Promise<void> {
    await ok(
      await this.request.post(`${this.reviewUrl(review)}/decisions`, { data: { decision, body } }),
    );
  }

  async merge(review: Review): Promise<void> {
    await ok(await this.request.post(`${this.reviewUrl(review)}/merge`));
  }

  async close(review: Review): Promise<void> {
    await ok(await this.request.patch(this.reviewUrl(review), { data: { status: 'closed' } }));
  }

  async runAnalysis(review: Review): Promise<void> {
    await ok(await this.request.post(`${this.reviewUrl(review)}/analyses`));
  }

  async latestAnalysis(review: Review): Promise<{ job: { status: string } | null }> {
    return json(await this.request.get(`${this.reviewUrl(review)}/analyses/latest`));
  }
}
