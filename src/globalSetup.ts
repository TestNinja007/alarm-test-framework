import { request } from '@playwright/test';
import { TestHooks } from './support/testHooks.js';
import { env } from './support/env.js';

/**
 * Runs once, before anything else.
 *
 * Two jobs, both about failing early and legibly. It checks the target can
 * support the suite at all — a missing test hook or an unreachable database
 * produces one clear message here rather than sixty confusing ones later. Then
 * it restores the seed profile, so the run starts from a known state no matter
 * what the previous run left behind.
 *
 * The reset happens here rather than per test on purpose: with workers running
 * in parallel, a reset between tests would have each one wiping the others'
 * data. Isolation comes from throwaway accounts instead.
 */
export default async function globalSetup(): Promise<void> {
  const context = await request.newContext({ baseURL: env.baseUrl });
  const hooks = new TestHooks(context);

  try {
    const health = await hooks.health();
    console.log(
      `Target ${env.baseUrl} — version ${health.version}, database ${health.database}, ` +
        `clock ${health.clock.mode}`,
    );

    await hooks.assertAvailable();

    // Any clock left pinned by an interrupted run would silently change every
    // date in this one.
    if (health.clock.mode !== 'system') {
      console.log('Clock was left pinned by a previous run; releasing it.');
      await hooks.releaseClock();
    }

    const startedAt = Date.now();
    await hooks.reset('demo');
    console.log(`Seed profile restored in ${Date.now() - startedAt} ms.`);

    /*
     * Warm the application before any worker touches it.
     *
     * The first request after an idle period pays for a database
     * connection being established and for code being compiled, and the
     * first test should not be the one that pays it. Without this the
     * opening specs of a run would intermittently find the loading state
     * rather than the page, while every later spec passed - which looks
     * like flakiness and is really a cold start.
     *
     * The alternative would be retries. Retries would hide this instead of
     * fixing it, and would hide the next thing too.
     */
    const warmedAt = Date.now();
    await Promise.all([
      context.get('/'),
      context.get('/api/v1/auth/me'),
      context.get('/api/v1/health'),
    ]);
    console.log(`Application warmed in ${Date.now() - warmedAt} ms.`);
  } catch (error) {
    // Rethrown with the address, because "connect ECONNREFUSED" on its own
    // never says which thing was not running.
    throw new Error(
      `Could not prepare ${env.baseUrl} for testing.\n` +
        `${error instanceof Error ? error.message : String(error)}\n\n` +
        'Start the application with TEST_SUPPORT=1, or set BASE_URL to one that is.',
    );
  } finally {
    await context.dispose();
  }
}
