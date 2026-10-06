# The four cases that are not automated

Fifty-seven of the sixty-one designed cases have a spec. These four do not, and
each is a different reason — which is more useful than a single number. All
four are decisions about what to cover, not work left undone.

| Case | Why |
| --- | --- |
| **TC7** — Voice clarity | Judgement, not assertion |
| **TC8** — Cross-browser functionality | Satisfied structurally, not as a spec |
| **TC45** — Each repeat says something different | Out of scope: paid tiers |
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

**Out of scope.** The case needs an alarm repeating within a day, so that there
are earlier occurrences and a final one. Within-day repetition sits behind a
paid tier, and [paid tiers are not under test](../../README.md#what-is-not-under-test).

So this is a boundary rather than a blockage. The harness is one parameter
short of reaching it — a `tier` on `POST /test/users` — and everything else the
case needs already exists: the notification harness built for
[TC4 and TC27](../../tests/alarms/notification.ui.spec.ts) controls the clock,
records what was spoken, and waits for the scheduler.

**What this costs, stated plainly.** R-26 has no automated spec, and within-day
repetition is one of the product's two stated differentiators. That is worth
knowing when deciding whether the boundary should move; it is not a reason to
move it today.

What is *not* out of scope is basic-tier behaviour at the gate, and that is
covered: the limit of two groups, and the refusal when a third is attempted,
are what a new user meets on their first day.

## TC46 — Notification appears correctly on the desktop

The operating system's notification, as the operating system draws it. A
browser can be asked to raise one and can be observed asking —
[TC4](../../tests/alarms/notification.ui.spec.ts) stubs `Notification` and
asserts the title and body it was given — but what the desktop then shows is
outside the browser and outside anything Playwright can see.

Kept manual. The half that is automatable is automated, under its own number,
rather than leaving TC46 half-done.
