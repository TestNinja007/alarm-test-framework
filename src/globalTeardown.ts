import { request } from '@playwright/test';
import { TestHooks } from './support/testHooks.js';
import { closeDatabase } from './support/db.js';
import { env } from './support/env.js';

/**
 * Leaves the target as it was found.
 *
 * Mostly this is about the clock. A run that pinned time and then failed would
 * otherwise leave the server permanently in the past, and the next person to
 * open the application would find alarms behaving impossibly with no clue why.
 *
 * The database is deliberately not reset here. The data a failing run left
 * behind is evidence, and the next run restores the seed before it starts
 * anyway.
 */
export default async function globalTeardown(): Promise<void> {
  const context = await request.newContext({ baseURL: env.baseUrl });

  try {
    const hooks = new TestHooks(context);
    const health = await hooks.health();
    if (health.clock.mode !== 'system') {
      await hooks.releaseClock();
      console.log('Clock released.');
    }
  } catch {
    // The application being gone by now is not a failure of the run: the suite
    // has already reported, and this is housekeeping.
  } finally {
    await context.dispose();
    await closeDatabase();
  }
}
