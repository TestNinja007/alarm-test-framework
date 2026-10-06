import { test, expect } from '../../src/fixtures.js';

/**
 * TC24, TC25, TC31, TC34 and TC43 — collisions, namespaces and self-destruct.
 * Requirements R-08, R-09, R-21, R-27.
 *
 * Four of these are refusals the application has to get exactly right and
 * nobody would notice it getting slightly wrong: a name that should collide
 * and does not, a schedule that should collide and does not, a namespace that
 * is wider than intended. Each produces a duplicate rather than an error, and
 * a duplicate alarm is a second notification at the same moment.
 *
 * R-08 is the interesting one. Two enabled alarms may not share a UTC instant
 * within the next ninety days, which means the check is not a comparison of
 * two fields but of two *expansions* — and it has to be re-run when either
 * alarm is edited, not only when one is created. TC34 is that second half.
 */

interface Created {
  id: string;
  name: string;
}

interface ConflictBody {
  error: {
    code: string;
    details?: { conflictingAlarmId?: string; conflictingAlarmName?: string };
    fields?: Array<{ field: string }>;
  };
}

/**
 * Thirty days out, computed rather than written down.
 *
 * R-08 only compares the next ninety days, so a fixed date far enough in the
 * future has nothing to collide with and the collision specs pass by being
 * wrong — which is how the first version of this file behaved. Computing it
 * also means these do not quietly start failing when the hardcoded year
 * arrives.
 */
const soon = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

const daily = (overrides: Record<string, unknown> = {}) => ({
  timeOfDay: '11:20',
  timezone: 'UTC',
  startDate: soon(),
  rule: { type: 'daily' },
  ...overrides,
});

test.describe('names and collisions @validation', () => {
  test('TC24: two alarms in one group may not share a name', async ({ freshApi }) => {
    const folder = await freshApi.json<Created>(
      await freshApi.post('/folders', { name: `Names ${Date.now()}` }),
    );
    const name = `Stretch ${Date.now()}`;
    await freshApi.json(
      await freshApi.post('/alarms', daily({ name, folderId: folder.id, timeOfDay: '11:21' })),
    );

    const duplicate = await freshApi.post(
      '/alarms',
      daily({ name, folderId: folder.id, timeOfDay: '11:22' }),
    );
    expect(duplicate.status(), 'the same name in the same group is a conflict').toBe(409);
    const body = (await duplicate.json()) as ConflictBody;
    expect(body.error.fields?.map((f) => f.field), 'the error names the field').toContain('name');

    /*
     * R-09 compares case-insensitively after trimming, which is the part worth
     * asserting separately: a rule that only catches the identical string
     * lets "Stretch" and " stretch " coexist, and a person reading the list
     * sees the same alarm twice.
     */
    const varied = await freshApi.post(
      '/alarms',
      daily({ name: `  ${name.toUpperCase()}  `, folderId: folder.id, timeOfDay: '11:23' }),
    );
    expect(varied.status(), 'case and surrounding spaces should not make it a new name').toBe(409);
  });

  test('TC31: ungrouped alarms share one namespace, separate from each group', async ({
    freshApi,
  }) => {
    const name = `Loose ${Date.now()}`;
    await freshApi.json(await freshApi.post('/alarms', daily({ name, timeOfDay: '12:01' })));

    const duplicate = await freshApi.post('/alarms', daily({ name, timeOfDay: '12:02' }));
    expect(duplicate.status(), 'two ungrouped alarms may not share a name').toBe(409);

    /*
     * And the namespace stops there. Ungrouped is one bucket, not a rule
     * across the whole account — the same name inside a group is free, which
     * is what makes "Stretch" usable in both a Work group and an Evening one.
     */
    const folder = await freshApi.json<Created>(
      await freshApi.post('/folders', { name: `Elsewhere ${Date.now()}` }),
    );
    const inGroup = await freshApi.post(
      '/alarms',
      daily({ name, folderId: folder.id, timeOfDay: '12:03' }),
    );
    expect(
      inGroup.ok(),
      `the same name inside a group should be free — ${await inGroup.text()}`,
    ).toBeTruthy();
  });

  test('TC25: two enabled alarms may not fire at the same instant', async ({ freshApi }) => {
    const folder = await freshApi.json<Created>(
      await freshApi.post('/folders', { name: `Collide ${Date.now()}` }),
    );
    const first = await freshApi.json<Created>(
      await freshApi.post(
        '/alarms',
        daily({ name: `First ${Date.now()}`, folderId: folder.id, timeOfDay: '13:30' }),
      ),
    );

    const colliding = await freshApi.post(
      '/alarms',
      daily({ name: `Second ${Date.now()}`, folderId: folder.id, timeOfDay: '13:30' }),
    );
    expect(colliding.status(), 'the same instant in the same group is a conflict').toBe(409);

    // The refusal names the other alarm, so the person can go and look at it.
    const body = (await colliding.json()) as ConflictBody;
    expect(body.error.details?.conflictingAlarmId, 'the conflict names which alarm').toBe(first.id);

    /*
     * A disabled alarm is invisible to the rule. It has to be: otherwise
     * switching an alarm off would still reserve its slot, and the only way
     * to reuse the time would be to delete it.
     */
    const disabled = await freshApi.post(`/alarms/${first.id}/disable`);
    expect(disabled.ok(), 'disabling the first alarm').toBeTruthy();

    const nowFree = await freshApi.post(
      '/alarms',
      daily({ name: `Third ${Date.now()}`, folderId: folder.id, timeOfDay: '13:30' }),
    );
    expect(
      nowFree.ok(),
      `a disabled alarm should not reserve its instant — ${await nowFree.text()}`,
    ).toBeTruthy();
  });

  test('TC34: an alarm cannot be edited into a collision', async ({ freshApi }) => {
    const folder = await freshApi.json<Created>(
      await freshApi.post('/folders', { name: `Edit ${Date.now()}` }),
    );
    const first = await freshApi.json<Created>(
      await freshApi.post(
        '/alarms',
        daily({ name: `Fixed ${Date.now()}`, folderId: folder.id, timeOfDay: '14:30' }),
      ),
    );
    const second = await freshApi.json<Created>(
      await freshApi.post(
        '/alarms',
        daily({ name: `Moving ${Date.now()}`, folderId: folder.id, timeOfDay: '14:45' }),
      ),
    );

    /*
     * The collision rule is easy to apply on create and easy to forget on
     * update, and forgetting it leaves exactly the state the rule exists to
     * prevent — reached by a different door.
     */
    // PUT, not PATCH: the update is a whole-resource replace, so the body
    // carries everything the alarm should end up being.
    const moved = await freshApi.put(`/alarms/${second.id}`, {
      ...daily({ name: second.name, folderId: folder.id, timeOfDay: '14:30' }),
    });
    expect(moved.status(), 'editing into an occupied instant is a conflict').toBe(409);
    const body = (await moved.json()) as ConflictBody;
    expect(body.error.details?.conflictingAlarmId).toBe(first.id);

    // And the refusal left it where it was.
    const after = await freshApi.json<{ timeOfDay: string }>(
      await freshApi.get(`/alarms/${second.id}`),
    );
    expect(after.timeOfDay, 'a refused edit changes nothing').toBe('14:45');
  });
});

test.describe('self-destructing alarms @lifecycle', () => {
  test('TC43: an alarm with nothing left to fire removes itself; one with something left stays', async ({
    freshApi,
  }) => {
    /*
     * Swept when the list is read rather than by a scheduler, which is why
     * this is observable at all: the server never learns that an alarm went
     * off, only that it has no occurrence left — the same thing a moment
     * later, and computable from the rule alone.
     */
    const spent = await freshApi.json<Created>(
      await freshApi.post(
        '/alarms',
        daily({
          name: `Spent ${Date.now()}`,
          startDate: '2020-01-01',
          endAfterOccurrences: 1,
          selfDestruct: true,
          timeOfDay: '15:10',
        }),
      ),
    );

    const remaining = await freshApi.json<Created>(
      await freshApi.post(
        '/alarms',
        daily({
          name: `Pending ${Date.now()}`,
          startDate: '2099-01-01',
          endAfterOccurrences: 5,
          selfDestruct: true,
          timeOfDay: '15:20',
        }),
      ),
    );

    const list = await freshApi.json<{ items: Created[] }>(await freshApi.get('/alarms'));
    const ids = list.items.map((a) => a.id);

    expect(ids, 'an alarm whose last occurrence has passed should be gone').not.toContain(spent.id);
    expect(ids, 'an alarm with occurrences ahead of it should remain').toContain(remaining.id);
  });
});
