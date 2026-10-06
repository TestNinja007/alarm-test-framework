import { test, expect } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';
import { env } from '../../src/support/env.js';
import { request as playwrightRequest } from '@playwright/test';

/**
 * TC32, TC54 and TC56 — the security set.
 * Requirements R-17, R-29, R-34.
 *
 * Three P1 cases that had no spec at all. Each asserts something invisible
 * from the interface and expensive to be wrong about: that one account cannot
 * reach another's data, that a stolen cookie alone is not enough to write, and
 * that resetting a password actually ends the sessions it was meant to end.
 *
 * TC55 — that a password is not recoverable from what is stored — moved to
 * `database/`. It is the clearest case for that stack existing: no API will
 * ever tell you what a password column contains, and that is the question.
 */

const alarm = (name: string) => ({
  name,
  timeOfDay: '08:00',
  timezone: 'UTC',
  startDate: '2027-02-01',
  rule: { type: 'daily' },
});

test.describe('authorisation and sessions @security', () => {
  test("TC32: one account cannot read, edit or delete another's alarm", async ({
    userApi,
    freshUser,
  }) => {
    const mine = await userApi.json<{ id: string }>(await userApi.post('/alarms', alarm('Mine')));

    const context = await playwrightRequest.newContext({ baseURL: env.baseUrl });
    const theirs = new ApiClient(context);
    await theirs.signIn(freshUser.email, freshUser.password);

    /*
     * 404, not 403. A forbidden response confirms the identifier exists,
     * which turns the endpoint into an oracle for probing which alarms other
     * people have. Not found is the same answer an invented identifier gets,
     * and tells an attacker nothing.
     */
    const read = await theirs.get(`/alarms/${mine.id}`);
    expect(read.status(), 'another account should be told it does not exist').toBe(404);

    const edited = await theirs.patch(`/alarms/${mine.id}`, { name: 'Taken over' });
    expect(edited.status()).toBe(404);

    const deleted = await theirs.delete(`/alarms/${mine.id}`);
    expect(deleted.status()).toBe(404);

    await context.dispose();

    // And none of that touched it.
    const after = await userApi.json<{ name: string }>(await userApi.get(`/alarms/${mine.id}`));
    expect(after.name, 'the alarm should be exactly as it was').toBe('Mine');
  });

  test('TC54: a write carrying the session but no CSRF token is refused', async ({ userApi }) => {
    const before = await userApi.json<{ total: number }>(await userApi.get('/alarms'));

    /*
     * The cookie travels with the context either way; only the header
     * differs. The assertion is refusal and the reason given, not a
     * particular status: the case says the request is refused, and pinning
     * 403 here would be asserting a convention the product never stated. It
     * answers 401 — see DEF-21, which is about what that costs a client
     * rather than about this test.
     */
    for (const [label, headers] of [
      ['no CSRF token', {}],
      ['the wrong CSRF token', { 'x-csrf-token': 'not-the-token' }],
    ] as const) {
      const response = await userApi.postRaw('/alarms', alarm(`Rejected ${label}`), headers);
      expect(response.status(), `a write with ${label} should be refused`).toBeGreaterThanOrEqual(
        400,
      );
      const body = (await response.json()) as { error: { message: string } };
      expect(
        body.error.message,
        'the refusal should say it was the token, not leave the caller guessing',
      ).toMatch(/csrf/i);
    }

    // Refused, not merely reported as refused.
    const after = await userApi.json<{ total: number }>(await userApi.get('/alarms'));
    expect(after.total, 'neither request should have created anything').toBe(before.total);
  });

  test('TC56: completing a password reset ends every other session', async ({ hooks, freshUser }) => {
    // Two clients, same account, each with its own session.
    const firstContext = await playwrightRequest.newContext({ baseURL: env.baseUrl });
    const secondContext = await playwrightRequest.newContext({ baseURL: env.baseUrl });
    const first = new ApiClient(firstContext);
    const second = new ApiClient(secondContext);

    for (const client of [first, second]) {
      const response = await client.signIn(freshUser.email, freshUser.password);
      expect(response.ok(), 'both clients should start signed in').toBeTruthy();
    }
    expect((await second.get('/auth/me')).ok(), 'the second client is signed in').toBeTruthy();

    await first.post('/auth/forgot-password', { email: freshUser.email });
    const code = await hooks.passwordResetCode(freshUser.email);
    const newPassword = 'a-replacement-password';

    const reset = await first.postRaw('/auth/reset-password', {
      email: freshUser.email,
      code,
      password: newPassword,
    });
    expect(reset.ok(), `the reset should succeed — ${await reset.text()}`).toBeTruthy();

    // The client that performed the reset is signed in on the new password.
    await first.adoptSession();
    expect((await first.get('/auth/me')).ok(), 'the resetting client stays signed in').toBeTruthy();

    /*
     * And the other one is not. This is the half that matters: a reset exists
     * because someone may have lost control of the account, so leaving the
     * other sessions alive leaves whoever took it still signed in.
     */
    const stale = await second.get('/auth/me');
    expect(stale.status(), "the other client's session should have ended").toBe(401);

    await firstContext.dispose();
    await secondContext.dispose();
  });
});
