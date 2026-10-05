import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { ApiClient } from './support/apiClient.js';
import { TestHooks, type ThrowawayUser } from './support/testHooks.js';
import { databaseAvailable } from './support/db.js';
import { env } from './support/env.js';

/**
 * The fixtures every spec builds on.
 *
 * Two things shape the design, and both are worth knowing before adding to it.
 *
 * **State is restored once per run, not between tests.** Workers run in
 * parallel, so a reset between tests would have each one wiping the others'
 * data. Isolation comes from accounts instead.
 *
 * **Authentication is per worker, not per test.** The application hashes
 * passwords with scrypt, which is memory-hard by design and runs on Node's
 * libuv thread pool — four threads by default. Creating and signing in to an
 * account costs two of those operations, so a suite that did it once per test
 * queued a dozen of them at a time and stalled the whole process, including
 * requests that had nothing to do with authentication. Signing in once per
 * worker and reusing the session removes the queue.
 *
 * The cost is that tests within a worker share an account. Anything needing a
 * pristine one asks for `freshUser` explicitly and pays for it.
 */

interface WorkerFixtures {
  /** One throwaway account for this worker, created once. */
  workerUser: ThrowawayUser;
  /** An API client signed in as that account, reused across the worker. */
  userApi: ApiClient;
  /** Cookies from that sign-in, for browser contexts. */
  authState: { cookies: unknown[]; origins: unknown[] };
}

interface TestFixtures {
  /** An unauthenticated API client. */
  api: ApiClient;
  /** The application's test-support endpoints. */
  hooks: TestHooks;
  /** A pristine account created for this test alone. Costs a hash; use when needed. */
  freshUser: ThrowawayUser;
  /** An API client signed in as the seeded, read-only account. */
  seededApi: ApiClient;
  /** A browser page already signed in, without filling in the form. */
  signedInPage: Page;
}

async function newApiContext(storageState?: unknown): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: env.baseUrl,
    ...(storageState ? { storageState: storageState as never } : {}),
  });
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerUser: [
    async ({}, use) => {
      const context = await newApiContext();
      const user = await new TestHooks(context).createUser();
      await context.dispose();
      await use(user);
      // Not deleted: the next run's reset removes it, and a teardown that
      // deleted accounts would mask a failure to create one.
    },
    { scope: 'worker' },
  ],

  userApi: [
    async ({ workerUser }, use) => {
      const context = await newApiContext();
      const client = new ApiClient(context);
      const response = await client.signIn(workerUser.email, workerUser.password);
      expect(response.ok(), 'the worker account should be able to sign in').toBeTruthy();
      await use(client);
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  authState: [
    async ({ workerUser }, use) => {
      const context = await newApiContext();
      const response = await context.post(`${env.apiPrefix}/auth/login`, {
        data: { email: workerUser.email, password: workerUser.password },
      });
      expect(response.ok(), 'signing in to capture the session').toBeTruthy();
      const state = await context.storageState();
      await context.dispose();
      await use(state as never);
    },
    { scope: 'worker' },
  ],

  api: async ({}, use) => {
    const context = await newApiContext();
    await use(new ApiClient(context));
    await context.dispose();
  },

  hooks: async ({}, use) => {
    const context = await newApiContext();
    await use(new TestHooks(context));
    await context.dispose();
  },

  freshUser: async ({ hooks }, use) => {
    await use(await hooks.createUser());
  },

  seededApi: async ({}, use) => {
    const context = await newApiContext();
    const client = new ApiClient(context);
    const response = await client.signIn(env.seededUser.email, env.seededUser.password);
    expect(response.ok(), 'the seeded account should be able to sign in').toBeTruthy();
    await use(client);
    await context.dispose();
  },

  /**
   * A page carrying the worker's session cookie, with no sign-in of its own.
   *
   * Thirty specs that each fill in the sign-in form are thirty specs that fail
   * when that form breaks, which tells you nothing the one spec testing
   * sign-in did not — and each one would cost another scrypt verification.
   */
  signedInPage: async ({ browser, authState }, use) => {
    const context = await browser.newContext({
      baseURL: env.baseUrl,
      storageState: authState as never,
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

/** Skips a spec when direct database access was not configured. */
export const describeWithDatabase = (title: string, body: () => void): void => {
  test.describe(title, () => {
    test.skip(!databaseAvailable(), 'DATABASE_URL is not set');
    body();
  });
};

export { expect };
