import { test, expect } from '../../src/fixtures.js';

/**
 * TC17 and TC18 — the verification code's refusals.
 * Requirements R-15, R-16.
 *
 * The code is the only thing standing between registering an address and
 * holding an account on it, so both of its limits matter: it must not be
 * guessable by repetition, and it must not last indefinitely. Neither is
 * visible from a successful registration, which is why TC2 passing says
 * nothing about either.
 *
 * Both assert the same quiet thing after the refusal — that the account is
 * still unverified. A code refused by an endpoint that verified the account
 * anyway would look identical from the response.
 */

const password = 'a-long-enough-password';

async function register(api: {
  post: (p: string, d?: unknown) => Promise<{ ok(): boolean; text(): Promise<string> }>;
}) {
  const email = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const response = await api.post('/auth/register', { email, name: 'Code Tester', password });
  expect(response.ok(), `registration should succeed — ${await response.text()}`).toBeTruthy();
  return email;
}

/** Any six digits that are not the real code. */
const wrongCode = (real: string) => (real === '000000' ? '111111' : '000000');

test.describe('verification codes @auth @validation', () => {
  test.beforeEach(async ({ api }) => {
    const health = await api.json<{ registrationOpen: boolean }>(await api.get('/health'));
    test.skip(!health.registrationOpen, 'registration is closed on this instance');
  });

  test('TC17: a wrong code is refused, and five wrong ones burn the code entirely', async ({
    api,
    hooks,
  }) => {
    const email = await register(api);
    const real = await hooks.verificationCode(email);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await api.post('/auth/verify', { email, code: wrongCode(real) });
      expect(response.status(), `attempt ${attempt} should be refused`).toBeGreaterThanOrEqual(400);
    }

    /*
     * R-16's second half, and the half worth having: after the attempts are
     * spent the CORRECT code is refused too. A limiter that only rejects wrong
     * codes slows an attacker down and stops nothing, because the attacker is
     * the one supplying wrong codes.
     */
    const withRealCode = await api.post('/auth/verify', { email, code: real });
    expect(
      withRealCode.status(),
      'the right code should be refused once the attempts are spent',
    ).toBeGreaterThanOrEqual(400);

    // And none of that verified anything: the account still cannot sign in.
    const signIn = await api.post('/auth/login', { email, password });
    expect(signIn.status(), 'the account should still be unverified').toBe(401);
  });

  test('TC18: a code older than fifteen minutes is refused as expired @serial', async ({
    api,
    hooks,
  }) => {
    const email = await register(api);
    const real = await hooks.verificationCode(email);

    /*
     * Pinned rather than waited for. The code lives fifteen minutes, and a
     * test that waited would be the slowest in the suite by two orders of
     * magnitude. Pinning is server-wide state, which is why this spec carries
     * @serial and runs in a pass of its own.
     */
    await hooks.pinClock(new Date(Date.now() + 16 * 60_000));
    try {
      const expired = await api.post('/auth/verify', { email, code: real });
      expect(expired.status(), 'a code past its life should be refused').toBeGreaterThanOrEqual(
        400,
      );

      const body = (await expired.json()) as { error: { fields?: Array<{ code: string }> } };
      expect(
        body.error.fields?.map((f) => f.code),
        'the refusal should say it expired, not that it was wrong',
      ).toContain('expired');

      const signIn = await api.post('/auth/login', { email, password });
      expect(signIn.status(), 'the account should still be unverified').toBe(401);
    } finally {
      // Whatever happened above, the clock goes back: every other spec in the
      // run computes session expiry from it.
      await hooks.releaseClock();
    }
  });
});
