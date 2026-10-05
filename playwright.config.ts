import { defineConfig, devices } from '@playwright/test';
import { env } from './src/support/env.js';

/**
 * Two kinds of project, because two kinds of test.
 *
 * `api` needs no browser at all and runs in a second or two. `chromium`,
 * `firefox` and `webkit` exist for behaviour that genuinely depends on a
 * browser. Testing a date rule through a rendered form would be slower,
 * flakier and would prove less than asserting it against the endpoint.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',

  // Every spec is independent by construction: tests that write data get their
  // own account, so there is nothing to serialise except clock pinning.
  fullyParallel: true,

  // A test marked .only is someone's debugging left behind. It must not pass CI.
  forbidOnly: Boolean(process.env.CI),

  /*
   * No retries. A test that passes on the second attempt is a test nobody can
   * trust, and retrying buries the evidence that would let it be fixed. If a
   * spec is genuinely flaky it is repaired or removed.
   */
  retries: 0,

  /*
   * Capped deliberately. The application under test is a single Node
   * process, and its password hashing is memory-hard by design and runs on
   * a four-thread pool. Twelve workers do not make the suite faster; they
   * make the target slow enough that tests time out and look flaky.
   *
   * Four is right for the API project, which runs 33 specs at it without a
   * single stall. The browser projects are capped lower, at two, by the
   * `test:ui` and `test:browsers` scripts and by CI — measured, not guessed:
   *
   * | Concurrent browser contexts | 8 UI specs |
   * | --- | --- |
   * | 1 | pass, every run |
   * | 2 | pass, 24 of 24 executions, 21.6s |
   * | 3 | intermittent |
   * | 4 | intermittent, and 6x slower per test |
   *
   * Above two, operations stall for exactly 10,000 ms at a time — on API
   * requests the server logs as answering in milliseconds, and on clicks that
   * hang after the element is reported visible, enabled and stable. The
   * application is not the constraint: its event-loop lag stays at 2 ms
   * throughout, 548 of 549 requests complete inside 2 s, raising the database
   * pool from 10 to 40 changes nothing, and the machine sits at 10-20% CPU
   * across 20 cores. The exact-10s signature points below the test layer,
   * on a machine whose TLS interception has already broken two package
   * managers in this project.
   *
   * It is capped rather than explained, which is the honest state of it. The
   * cap costs nothing: two workers is both reliable and faster.
   */
  workers: 4,

  // Long enough for a cold start on free hosting, short enough that a hang fails.
  timeout: 30_000,
  expect: { timeout: 7_000 },

  globalSetup: './src/globalSetup.ts',
  globalTeardown: './src/globalTeardown.ts',

  reporter: [
    process.env.CI ? ['github'] : ['list'],
    ['html', { open: 'never' }],
    // Read by src/summary.ts to put the result on the run page itself.
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    baseURL: env.baseUrl,
    // Kept only for failures: an artefact for every pass is noise nobody reads.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      use: {},
    },
    {
      name: 'chromium',
      testMatch: /.*\.ui\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: /.*\.ui\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: /.*\.ui\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
