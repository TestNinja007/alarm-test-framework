import { test, expect } from '../../src/fixtures.js';
import type { ApiClient } from '../../src/support/apiClient.js';

/**
 * Refusals and limits — TC19 to TC23, TC26, TC58 to TC61.
 * Requirements R-01, R-02, R-03, R-11, R-12, R-24, R-31.
 *
 * More than half the documented requirements describe a refusal, so a suite
 * that never triggers one leaves most of the contract untested.
 *
 * Each assertion checks the status *and* which field the error landed on. A
 * rejection that blames the wrong field is still a defect: it sends the person
 * to correct something that was never wrong.
 */

interface ErrorBody {
  error: { code: string; message: string; fields?: Array<{ field: string; code: string }> };
}

const validAlarm = (overrides: Record<string, unknown> = {}) => ({
  name: `Alarm ${Math.random().toString(36).slice(2, 10)}`,
  timeOfDay: '09:00',
  timezone: 'UTC',
  startDate: '2027-01-04',
  rule: { type: 'daily' },
  ...overrides,
});

async function expectRejection(
  api: ApiClient,
  body: Record<string, unknown>,
  field: string,
): Promise<ErrorBody> {
  const response = await api.post('/alarms', body);
  const parsed = (await response.json()) as ErrorBody;

  expect(response.status(), `expected a rejection, got ${response.status()}`).toBeGreaterThanOrEqual(
    400,
  );
  expect(
    parsed.error.fields?.map((f) => f.field),
    `the error should name ${field}`,
  ).toContain(field);

  return parsed;
}

test.describe('alarm validation @validation', () => {
  test('TC19: an end date before the start date is refused', async ({ userApi }) => {
    await expectRejection(
      userApi,
      validAlarm({ startDate: '2027-03-10', endDate: '2027-03-01' }),
      'endDate',
    );
  });

  test('TC20: 24:00 is not a time of day', async ({ userApi }) => {
    const response = await userApi.post('/alarms', validAlarm({ timeOfDay: '24:00' }));

    // Times run 00:00 to 23:59; midnight is the start of a day, not its end.
    expect(response.status()).toBe(422);
  });

  test('TC21: an unknown timezone is refused', async ({ userApi }) => {
    await expectRejection(userApi, validAlarm({ timezone: 'Mars/Olympus_Mons' }), 'timezone');
  });

  test('TC22: a weekly rule with no weekday is refused', async ({ userApi }) => {
    const response = await userApi.post(
      '/alarms',
      validAlarm({ rule: { type: 'weekly', byWeekday: [] } }),
    );

    // A weekly rule selecting no days has no occurrences at all.
    expect(response.status()).toBe(422);
  });

  test('TC23: an interval outside 1 to 365 is refused', async ({ userApi }) => {
    for (const every of [0, 366]) {
      const response = await userApi.post(
        '/alarms',
        validAlarm({ rule: { type: 'interval', every, unit: 'days' } }),
      );
      expect(response.status(), `every=${every} should be refused`).toBe(422);
    }
  });

  test('TC26: a voice with no message, and a blank message, are refused', async ({ userApi }) => {
    await expectRejection(userApi, validAlarm({ speechVoice: 'female' }), 'speechText');

    // Whitespace is not a message. Rejecting it is the difference between
    // "say nothing" and "say nothing, loudly".
    await expectRejection(userApi, validAlarm({ speechText: '   ' }), 'speechText');
  });

  test('TC26b: a closing message with nothing before it is refused', async ({ userApi }) => {
    await expectRejection(
      userApi,
      validAlarm({ speechFinalText: 'That is the last one' }),
      'speechFinalText',
    );
  });
});

test.describe('boundaries @boundary', () => {
  test('TC58: alarm names of 1 and 80 characters are accepted, 0 and 81 are not', async ({
    userApi,
  }) => {
    for (const length of [1, 80]) {
      const response = await userApi.post(
        '/alarms',
        validAlarm({ name: 'n'.repeat(length), timeOfDay: `0${length % 9}:1${length % 9}` }),
      );
      expect(response.status(), `a ${length}-character name should be accepted`).toBe(201);
    }

    for (const length of [0, 81]) {
      const response = await userApi.post('/alarms', validAlarm({ name: 'n'.repeat(length) }));
      expect(response.status(), `a ${length}-character name should be refused`).toBe(422);
    }
  });

  test('TC59: interval limits of 1 and 365 are accepted', async ({ userApi }) => {
    for (const [index, every] of [1, 365].entries()) {
      const response = await userApi.post(
        '/alarms',
        validAlarm({
          rule: { type: 'interval', every, unit: 'days' },
          timeOfDay: `1${index}:30`,
        }),
      );
      expect(response.status(), `every=${every} should be accepted`).toBe(201);
    }
  });

  test('TC60: occurrence counts of 1 and 1000 are accepted, 0 and 1001 are not', async ({
    userApi,
  }) => {
    for (const [index, count] of [1, 1000].entries()) {
      const response = await userApi.post(
        '/alarms',
        validAlarm({ endAfterOccurrences: count, timeOfDay: `1${index + 4}:45` }),
      );
      expect(response.status(), `${count} occurrences should be accepted`).toBe(201);
    }

    for (const count of [0, 1001]) {
      const response = await userApi.post('/alarms', validAlarm({ endAfterOccurrences: count }));
      expect(response.status(), `${count} occurrences should be refused`).toBe(422);
    }
  });

  test('TC61: a spoken message of 200 characters is accepted, 201 is not', async ({ userApi }) => {
    const accepted = await userApi.post(
      '/alarms',
      validAlarm({ speechText: 'a'.repeat(200), speechVoice: 'female', timeOfDay: '18:05' }),
    );
    expect(accepted.status()).toBe(201);

    const refused = await userApi.post(
      '/alarms',
      validAlarm({ speechText: 'a'.repeat(201), speechVoice: 'female' }),
    );
    expect(refused.status()).toBe(422);
  });
});
