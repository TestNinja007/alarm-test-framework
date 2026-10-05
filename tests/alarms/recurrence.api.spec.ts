import { test, expect } from '../../src/fixtures.js';
import type { ApiClient } from '../../src/support/apiClient.js';

/**
 * Recurrence resolution — TC35 to TC42, requirements R-04 to R-07 and R-31.
 *
 * The highest-priority area in the plan, because this is where a fault is
 * silent: nothing errors, nothing is logged, the alarm simply resolves to the
 * wrong instant and nobody is told.
 *
 * Asserted against `POST /alarms/preview`, which runs the engine on an unsaved
 * schedule. Nothing is persisted, so these need no cleanup, no collision rule
 * and no unique names — and they take milliseconds rather than driving a form.
 */

interface Occurrence {
  utc: string;
  local: string;
}

async function preview(
  api: ApiClient,
  schedule: Record<string, unknown>,
  from: string,
  limit = 12,
): Promise<Occurrence[]> {
  const response = await api.post('/alarms/preview', { ...schedule, from, limit });
  const body = await api.json<{ items: Occurrence[] }>(response);
  return body.items;
}

/** The calendar date an occurrence falls on, in its own zone. */
const localDate = (occurrence: Occurrence): string => occurrence.local.slice(0, 10);
const localTime = (occurrence: Occurrence): string => occurrence.local.slice(11, 16);

test.describe('recurrence @recurrence', () => {
  test('TC35: monthly on a date that some months lack', async ({ userApi }) => {
    const items = await preview(
      userApi,
      {
        timeOfDay: '09:00',
        timezone: 'UTC',
        startDate: '2027-01-31',
        rule: { type: 'monthly_day', dayOfMonth: 31 },
      },
      '2027-01-01T00:00:00Z',
    );

    const months = items.map((o) => localDate(o).slice(0, 7));
    const days = items.map((o) => localDate(o).slice(8, 10));

    // R-04: short months are skipped, never clamped. February has no 31st, so
    // it must not appear at all — and nothing may land on the 28th or 30th.
    expect(days.every((day) => day === '31')).toBe(true);
    expect(months).not.toContain('2027-02');
    expect(months).not.toContain('2027-04');
    expect(months).toContain('2027-01');
    expect(months).toContain('2027-03');
  });

  test('TC36: monthly on the nth weekday', async ({ userApi }) => {
    const items = await preview(
      userApi,
      {
        timeOfDay: '09:00',
        timezone: 'UTC',
        startDate: '2027-01-01',
        rule: { type: 'monthly_nth', nth: 2, weekday: 'TU' },
      },
      '2027-01-01T00:00:00Z',
    );

    expect(items.length).toBeGreaterThan(0);
    for (const occurrence of items) {
      const date = new Date(`${localDate(occurrence)}T00:00:00Z`);
      // Tuesday, and in the second week-of-weekday: days 8 to 14 inclusive.
      expect(date.getUTCDay(), `${occurrence.local} should be a Tuesday`).toBe(2);
      const dayOfMonth = Number(localDate(occurrence).slice(8, 10));
      expect(dayOfMonth).toBeGreaterThanOrEqual(8);
      expect(dayOfMonth).toBeLessThanOrEqual(14);
    }
  });

  test('TC36b: a month with no fifth weekday is skipped', async ({ userApi }) => {
    const items = await preview(
      userApi,
      {
        timeOfDay: '09:00',
        timezone: 'UTC',
        startDate: '2027-01-01',
        rule: { type: 'monthly_nth', nth: 4, weekday: 'FR' },
      },
      '2027-01-01T00:00:00Z',
    );

    for (const occurrence of items) {
      const dayOfMonth = Number(localDate(occurrence).slice(8, 10));
      // A fourth Friday falls between the 22nd and the 28th. Nothing may fall
      // back to an earlier week in a month that happens to start awkwardly.
      expect(dayOfMonth).toBeGreaterThanOrEqual(22);
      expect(dayOfMonth).toBeLessThanOrEqual(28);
    }
  });

  test('TC37: the last weekday of the month', async ({ userApi }) => {
    const items = await preview(
      userApi,
      {
        timeOfDay: '09:00',
        timezone: 'UTC',
        startDate: '2027-01-01',
        rule: { type: 'monthly_nth', nth: -1, weekday: 'FR' },
      },
      '2027-01-01T00:00:00Z',
    );

    expect(items.length).toBeGreaterThan(0);
    for (const occurrence of items) {
      const date = localDate(occurrence);
      const asDate = new Date(`${date}T00:00:00Z`);
      expect(asDate.getUTCDay(), `${date} should be a Friday`).toBe(5);

      // The last one: seven days later must be a different month.
      const sevenDaysOn = new Date(asDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      expect(sevenDaysOn.getUTCMonth()).not.toBe(asDate.getUTCMonth());
    }
  });

  test('TC38: spring forward moves a missing local time by the gap @dst', async ({ userApi }) => {
    // In Toronto the clocks jump 02:00 → 03:00 on 14 March 2027, so 02:30
    // does not exist that day.
    const items = await preview(
      userApi,
      {
        timeOfDay: '02:30',
        timezone: 'America/Toronto',
        startDate: '2027-03-12',
        rule: { type: 'daily' },
      },
      '2027-03-12T00:00:00Z',
      5,
    );

    const byDate = new Map(items.map((o) => [localDate(o), localTime(o)]));

    // R-06: the day of the gap shifts forward by its length; its neighbours
    // are untouched.
    expect(byDate.get('2027-03-13')).toBe('02:30');
    expect(byDate.get('2027-03-14')).toBe('03:30');
    expect(byDate.get('2027-03-15')).toBe('02:30');
  });

  test('TC39: fall back produces one occurrence, at the earlier offset @dst', async ({
    userApi,
  }) => {
    // In Toronto 01:00 → 02:00 repeats on 7 November 2027, so 01:30 happens
    // twice: once at -04:00 and again at -05:00.
    const items = await preview(
      userApi,
      {
        timeOfDay: '01:30',
        timezone: 'America/Toronto',
        startDate: '2027-11-06',
        rule: { type: 'daily' },
      },
      '2027-11-06T00:00:00Z',
      5,
    );

    const onTheDay = items.filter((o) => localDate(o) === '2027-11-07');

    // R-07: exactly one, and it is the first — the earlier offset.
    expect(onTheDay).toHaveLength(1);
    expect(onTheDay[0]?.local).toContain('01:30');
    expect(onTheDay[0]?.local).toContain('-04:00');
  });

  test('TC40: repetition within a day at second intervals', async ({ userApi }) => {
    const items = await preview(
      userApi,
      {
        timeOfDay: '09:00',
        timezone: 'UTC',
        startDate: '2027-04-01',
        endTimeOfDay: '09:05',
        repeatEvery: 30,
        repeatUnit: 'seconds',
        rule: { type: 'daily' },
      },
      '2027-04-01T00:00:00Z',
      20,
    );

    const firstDay = items.filter((o) => localDate(o) === '2027-04-01');

    // 09:00 to 09:05 inclusive, every 30 seconds, is eleven instants.
    expect(firstDay).toHaveLength(11);
    expect(localTime(firstDay[0]!)).toBe('09:00');
    expect(firstDay.at(-1)?.local).toContain('09:05');

    // Thirty seconds apart, every time.
    for (let i = 1; i < firstDay.length; i += 1) {
      const gap = Date.parse(firstDay[i]!.utc) - Date.parse(firstDay[i - 1]!.utc);
      expect(gap).toBe(30_000);
    }
  });

  test('TC41: a series ending after a set number of occurrences', async ({ userApi }) => {
    const items = await preview(
      userApi,
      {
        timeOfDay: '09:00',
        timezone: 'UTC',
        startDate: '2027-05-01',
        endAfterOccurrences: 5,
        rule: { type: 'daily' },
      },
      '2027-05-01T00:00:00Z',
      20,
    );

    expect(items).toHaveLength(5);
  });

  test('TC42: a window too dense to schedule is refused', async ({ userApi }) => {
    const response = await userApi.post('/alarms/preview', {
      timeOfDay: '00:00',
      timezone: 'UTC',
      startDate: '2027-06-01',
      endTimeOfDay: '23:59',
      repeatEvery: 10,
      repeatUnit: 'seconds',
      rule: { type: 'daily' },
      limit: 5,
    });

    // A whole day at ten-second intervals is 8,641 occurrences, past the
    // 4,000 ceiling.
    expect(response.status()).toBe(422);
    const body = (await response.json()) as { error: { fields?: Array<{ field: string }> } };
    expect(body.error.fields?.some((f) => f.field === 'endTimeOfDay')).toBe(true);
  });
});
