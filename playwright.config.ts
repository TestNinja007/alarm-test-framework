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
