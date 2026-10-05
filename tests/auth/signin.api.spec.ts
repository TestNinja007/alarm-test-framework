import { request } from '@playwright/test';
import { test, expect } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';
import { env } from '../../src/support/env.js';

/**
 * Signing in — TC1, TC11, TC12, TC14, TC33, requirements R-29 and R-18.
 *
 * Shallow on purpose. Sign-in is simple, standard, and fails loudly: if it
 * breaks nobody can reach anything and you find out at once. The depth in this
 * plan goes to the things that fail quietly.
 */

async function freshClient(): Promise<ApiClient> {
  return new ApiClient(await request.newContext({ baseURL: env.baseUrl }));
}

test.describe('sign in @auth', () => {
  test('TC1: a registered user can sign in', async ({ workerUser }) => {
    const client = await freshClient();

    const response = await client.signIn(workerUser.email, workerUser.password);

    expect(response.status()).toBe(200);
    const session = await response.json();
    expect(session.csrfToken, 'a CSRF token is issued with the session').toBeTruthy();
    expect(session.user.email).toBe(workerUser.email);

    // The session works for a subsequent request, not only at the moment of issue.
    const me = await client.get('/auth/me');
    expect(me.status()).toBe(200);
  });

  test('TC11: the wrong password is refused', async ({ workerUser }) => {
    const client = await freshClient();

    const response = await client.signIn(workerUser.email, 'Definitely-not-it-123');

    expect(response.status()).toBe(401);
    // No session: the next call must fail too, not merely the sign-in.
    expect((await client.get('/auth/me')).status()).toBe(401);
  });

  test('TC12: an unknown address is refused identically to a wrong password', async ({
    workerUser,
  }) => {
    const wrongPassword = await (await freshClient()).signIn(
      workerUser.email,
      'Definitely-not-it-123',
    );
    const unknownAddress = await (await freshClient()).signIn(
      `nobody-${Date.now()}@example.test`,
      'Definitely-not-it-123',
    );

    const first = (await wrongPassword.json()) as { error: { message: string; code: string } };
    const second = (await unknownAddress.json()) as { error: { message: string; code: string } };

    // The whole point: if these differed, the response would say which
    // addresses have accounts.
    expect(unknownAddress.status()).toBe(wrongPassword.status());
    expect(second.error.message).toBe(first.error.message);
    expect(second.error.code).toBe(first.error.code);
  });

  test('TC14: repeated failures are rate limited', async ({}) => {
    // An address with no account, so the limiter is exercised without eleven
    // password hashes: the attempt is counted before the user is looked up.
    const address = `ratelimit-${Date.now()}@example.test`;
    const client = await freshClient();

    const codes: string[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await client.signIn(address, 'Definitely-not-it-123');
      const body = (await response.json()) as { error: { code: string } };
      codes.push(body.error.code);
    }

    // Ten attempts are refused as credentials; the eleventh is refused as a limit.
    expect(codes.slice(0, 10).every((code) => code === 'unauthenticated')).toBe(true);
    expect(codes[10]).toBe('rate_limited');
  });

  test('TC33: a signed-out caller cannot read alarms', async ({ api }) => {
    const response = await api.get('/alarms');

    expect(response.status()).toBe(401);
  });

  test('TC33b: signing out ends the session', async ({ workerUser }) => {
    const client = await freshClient();
    await client.signIn(workerUser.email, workerUser.password);
    expect((await client.get('/alarms')).status()).toBe(200);

    await client.signOut();

    expect((await client.get('/alarms')).status()).toBe(401);
  });
});
