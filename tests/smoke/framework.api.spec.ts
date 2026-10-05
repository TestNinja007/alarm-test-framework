import { request } from '@playwright/test';
import { test, expect, describeWithDatabase } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';
import { countRows } from '../../src/support/db.js';
import { env } from '../../src/support/env.js';

/**
 * Checks on the framework itself, not on the product.
 *
 * These exist so a failing suite can be read. If they pass, the harness
 * reached the application, authenticated, isolated itself and can see the
 * database — and any other failure is about the software. If they fail,
 * nothing below them means anything.
 *
 * Product behaviour belongs in the designed test cases, which these are not.
 */

test.describe('framework plumbing @smoke', () => {
  test('the target is reachable and supports testing', async ({ hooks }) => {
    const health = await hooks.health();

    expect(health.status).toBe('ok');
    expect(health.database).toBe('up');
    expect(health.testSupport, 'test hooks must be mounted').toBe(true);
  });

  test('a new account starts empty and sees none of the seeded data', async ({ freshUser }) => {
    const context = await request.newContext({ baseURL: env.baseUrl });
    const client = new ApiClient(context);
    await client.signIn(freshUser.email, freshUser.password);

    const groups = await client.json<{ items: unknown[] }>(await client.get('/folders'));
    const alarms = await client.json<{ total: number }>(await client.get('/alarms'));

    // The point of the fixture: a brand-new account sees nothing, so tests
    // that create data cannot collide with each other.
    expect(groups.items).toHaveLength(0);
    expect(alarms.total).toBe(0);

    await context.dispose();
  });

  test('throwaway accounts are unique', async ({ hooks }) => {
    const [first, second] = await Promise.all([hooks.createUser(), hooks.createUser()]);

    expect(first.email).not.toBe(second.email);
  });

  test('the seeded account carries the seeded data', async ({ seededApi }) => {
    const groups = await seededApi.json<{ items: Array<{ name: string }> }>(
      await seededApi.get('/folders'),
    );

    expect(groups.items.length).toBeGreaterThan(0);
  });

  test('a mutating call carries the CSRF token', async ({ userApi }) => {
    // Proves the client adds the header. Without it the API answers 403, and
    // every write in the suite would fail in a way that looks like a product bug.
    const name = `Plumbing ${Date.now()}`;
    const response = await userApi.post('/folders', { name });

    expect(response.status(), await response.text()).toBe(201);
  });

  test('the clock can be pinned and released @serial', async ({ hooks }) => {
    const pinned = '2026-06-15T18:00:00.000Z';

    await hooks.pinClock(pinned);
    const whilePinned = await hooks.health();
    expect(whilePinned.clock.mode).toBe('fixed');
    expect(whilePinned.clock.now).toBe(pinned);

    await hooks.releaseClock();
    const afterwards = await hooks.health();
    expect(afterwards.clock.mode).toBe('system');
  });
});

describeWithDatabase('database access @smoke @db', () => {
  test('the suite can query the database directly', async () => {
    // Enough to prove the connection and credentials work. Assertions about
    // product behaviour belong in the designed cases.
    const users = await countRows('users');

    expect(users).toBeGreaterThan(0);
  });
});
