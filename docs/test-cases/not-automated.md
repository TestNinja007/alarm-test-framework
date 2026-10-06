# The four cases that are not automated

Fifty-seven of the sixty-one designed cases have a spec. These four do not, and
each is a different reason — which is more useful than a single number.

| Case | Why |
| --- | --- |
| **TC7** — Voice clarity | Judgement, not assertion |
| **TC8** — Cross-browser functionality | Satisfied structurally, not as a spec |
| **TC45** — Each repeat says something different | Blocked by a tier gate |
| **TC46** — Notification appears correctly on the desktop | Outside the browser |

## TC7 — Voice clarity

Whether a synthesised voice is *clear* is a judgement about audio, made by
someone listening. A spec could assert that speech was requested and that a
voice resolved — [TC47](../traceability.md) already does both — but neither is
the question this case asks.

Kept as a manual case rather than automated into something weaker that shares
its number.

## TC8 — Cross-browser functionality

Every browser spec runs on Chromium, Firefox and WebKit, in three separate CI
jobs. The case is therefore satisfied by how the suite is arranged rather than
by a spec of its own, and writing one would mean asserting that the matrix
exists.

The cases that genuinely differ between engines — native date and time
pickers, the speech synthesiser, the timezone list — are
[TC47 to TC50](../traceability.md), and those are automated.

## TC45 — Each repeat says something different

**Blocked by the product, not by the harness.** The case needs an alarm
repeating within a day, so that there are earlier occurrences and a final one.
Within-day repetition is gated to paid tiers, and the only account the test
hooks can create is on the basic tier:

```
422 tier_limit — Repeating within a day is not available on the basic tier.
```

Everything else it needs exists: the notification harness built for
[TC4 and TC27](../../tests/alarms/notification.ui.spec.ts) controls the clock,
records what was spoken, and waits for the scheduler.

**This is worth more than the case.** Within-day repetition is one of the
product's two stated differentiators, and it cannot be tested through the
interface by any account the test hooks can produce. A test-support route that
can create an account but not an account that can use the product's main
feature is a testability gap, and the fix is a tier on `POST /test/users`.

Filed rather than worked around: creating a paid account by writing to the
database directly would make the spec pass and leave the gap.

## TC46 — Notification appears correctly on the desktop

The operating system's notification, as the operating system draws it. A
browser can be asked to raise one and can be observed asking —
[TC4](../../tests/alarms/notification.ui.spec.ts) stubs `Notification` and
asserts the title and body it was given — but what the desktop then shows is
outside the browser and outside anything Playwright can see.

Kept manual. The half that is automatable is automated, under its own number,
rather than leaving TC46 half-done.
