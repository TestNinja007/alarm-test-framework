import type { APIRequestContext } from '@playwright/test';
import { apiPath } from './env.js';

/**
 * The application's own test-support endpoints, which exist only when it runs
 * with TEST_SUPPORT=1.
 *
 * They are the reason this suite can be deterministic: state is restored
 * rather than accumulated, and time is set rather than waited for. With the
 * flag off these routes are not registered at all, so a call returns an
 * ordinary 404 — which is why `assertAvailable` exists and runs before
 * anything else.
 */

export interface ThrowawayUser {
  id: string;
  email: string;
  password: string;
  name: string;
}

export interface Health {
  status: string;
  version: string;
  database: string;
  testSupport: boolean;
  demoMode: boolean;
  registrationOpen: boolean;
  /** The application says 'fixed', not 'pinned', when time is held. */
  clock: { mode: 'system' | 'fixed'; now: string };
}

export class TestHooks {
  constructor(private readonly request: APIRequestContext) {}

  async health(): Promise<Health> {
    const response = await this.request.get(apiPath('/health'));
    if (!response.ok()) throw new Error(`Health check failed: ${response.status()}`);
    return (await response.json()) as Health;
  }

  /**
   * Fails the run early, with a readable reason, when the target cannot
   * support the suite.
   *
   * A wall of red caused by hooks that were never mounted tells you nothing
   * about the software, so this is checked once rather than discovered
   * sixty times.
   */
  async assertAvailable(): Promise<void> {
    const health = await this.health();
    if (health.database !== 'up') {
      throw new Error(`The application reports its database as "${health.database}".`);
    }
    if (!health.testSupport) {
      throw new Error(
        'TEST_SUPPORT is off on the target, so /test/* is not mounted. ' +
          'The suite cannot reset state or pin the clock. Point BASE_URL at an ' +
          'instance started with TEST_SUPPORT=1.',
      );
    }
  }

  /** Restores the database to a known profile. Measured in hundreds of ms. */
  async reset(profile: 'demo' | 'empty' = 'demo'): Promise<void> {
    const response = await this.request.post(apiPath('/test/reset'), { data: { profile } });
    if (!response.ok()) {
      throw new Error(`Reset failed: ${response.status()} ${await response.text()}`);
    }
  }

  /**
   * Pins the server clock.
   *
   * Server-wide state: every worker sees it. Specs that pin time carry the
   * @serial tag and run in their own pass with one worker, or they will
   * change the time underneath each other.
   */
  async pinClock(instant: Date | string): Promise<void> {
    const now = typeof instant === 'string' ? instant : instant.toISOString();
    const response = await this.request.put(apiPath('/test/clock'), { data: { now } });
    if (!response.ok()) {
      throw new Error(`Pinning the clock failed: ${response.status()} ${await response.text()}`);
    }
  }

  async releaseClock(): Promise<void> {
    const response = await this.request.put(apiPath('/test/clock'), { data: { mode: 'system' } });
    if (!response.ok()) {
      throw new Error(`Releasing the clock failed: ${response.status()}`);
    }
  }

  /**
   * A fresh account with no groups and no alarms.
   *
   * This is what lets the suite run in parallel without a reset between every
   * test: tests that create data get their own user instead of competing for
   * the seeded one.
   */
  async createUser(): Promise<ThrowawayUser> {
    const response = await this.request.post(apiPath('/test/users'), { data: {} });
    if (!response.ok()) {
      throw new Error(`Creating a throwaway user failed: ${response.status()}`);
    }
    return (await response.json()) as ThrowawayUser;
  }

  /** Messages the capture transport is holding, for the auth flows. */
  async mail(): Promise<Array<{ to: string; subject: string; text: string }>> {
    const response = await this.request.get(apiPath('/test/mail'));
    if (!response.ok()) throw new Error(`Reading captured mail failed: ${response.status()}`);
    const body = (await response.json()) as { items?: Array<{ to: string; subject: string; text: string }> };
    return body.items ?? [];
  }

  async clearMail(): Promise<void> {
    await this.request.delete(apiPath('/test/mail'));
  }

  /** The outstanding verification code for an address, without an inbox. */
  async verificationCode(email: string): Promise<string> {
    const response = await this.request.get(apiPath('/test/verification-code'), {
      params: { email },
    });
    if (!response.ok()) {
      throw new Error(`No verification code for ${email}: ${response.status()}`);
    }
    const body = (await response.json()) as { code: string };
    return body.code;
  }

  async passwordResetCode(email: string): Promise<string> {
    const response = await this.request.get(apiPath('/test/password-reset-code'), {
      params: { email },
    });
    if (!response.ok()) {
      throw new Error(`No reset code for ${email}: ${response.status()}`);
    }
    const body = (await response.json()) as { code: string };
    return body.code;
  }
}
