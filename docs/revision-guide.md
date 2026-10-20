# Revision guide — the testing work on Nudge

A guide for *learning* the testing work, not for operating it. Every decision
is written as **what was done → why → what was rejected**, and points at the
file where you can see it in practice.

The rest of the documentation tells you *what is true*. This tells you *why it
was done that way*, which is the part that is easy to lose and the part worth
being able to explain.

## Using this with Claude

Upload this file and the code listed in [The code to read alongside](#the-code-to-read-alongside)
to a Claude Project, and give the Project an instruction like:

> I'm revising testing work on this project. Use the revision guide as the map
> and the code as the reference. Explain *why* decisions were made, not just
> what. Quiz me, and correct me when I explain something back wrong.

Each section ends with questions. Answer them in your own words before reading
the answer back — explaining is the test of understanding, recognising is not.

## Contents

1. [The shape of it](#1-the-shape-of-it)
2. [Framework design](#2-framework-design)
3. [API testing](#3-api-testing)
4. [UI testing across three engines](#4-ui-testing-across-three-engines)
5. [The database layer](#5-the-database-layer)
6. [Performance testing](#6-performance-testing)
7. [The defects, and what each kind taught](#7-the-defects-and-what-each-kind-taught)
8. [Traceability and test management](#8-traceability-and-test-management)
9. [Continuous integration](#9-continuous-integration)
10. [What is incomplete](#10-what-is-incomplete)
11. [The lessons that kept coming back](#11-the-lessons-that-kept-coming-back)
12. [Testing a microservice — the speech service](#12-testing-a-microservice--the-speech-service)
13. [The code to read alongside](#the-code-to-read-alongside)

---

## 1. The shape of it

**What was tested.** Nudge, an alarm configurator: groups of alarms, recurrence
rules, spoken messages, notifications in the browser. It was built
*deliberately as a system under test*, with **34 documented behavioural rules**
(R-01 to R-34) and **8 architectural rules** (A-01 to A-08), so there is a
written definition of "correct" to test against.
→ `alarm-configurator/README.md`

**Two repositories.** The application and the test framework are separate.

- *Why:* the suite is written against the application's published interface —
  its HTTP API and its screens — not against internals it could see if it lived
  in the same repository. A test that reaches into private code tests the code's
  shape, and breaks when someone refactors without changing behaviour.
- *Rejected:* tests inside the application repository, which is easier to set
  up and quietly encourages that coupling.

**Two test stacks.**

| Stack | Owns |
| --- | --- |
| Playwright + TypeScript | UI specs on Chromium, Firefox and WebKit, with API tests as the oracle behind them |
| pytest | The database layer — act through the API or UI, then query PostgreSQL directly |

The split is about *kinds of question*, not tool preference. See section 5.

**Two services — one of them deliberately.** The application is a single
monolith with one exception: generated speech was extracted into its own service
on 20 October, to learn and demonstrate how microservices are tested. Section 12
covers it. Everything else is one process and one database, and that is the
right design for an application with one owner.

**The numbers, as of 20 October 2026.**

| | |
| --- | --- |
| Playwright specs | 78 — api 49, and 27 on each browser engine |
| pytest tests | 68, covering both services' schemas and the boundary between them |
| Application tests | 91 — 75 in the main API, 16 in the speech service, including contract tests |
| Requirements with a case | 34 of 34 |
| Requirements with an automated spec | 33 of 34 |
| Designed cases automated | 57 of 61 |
| Defects found | 22 — 20 fixed, 1 open, 1 by design |

### Test yourself

1. Why is the test framework in a separate repository from the application?
2. What is the difference between what the two test stacks are for?
3. What makes Nudge a "deliberate" system under test, and why does that matter?

---

## 2. Framework design

→ `README.md` ("The decisions worth knowing"), `src/fixtures.ts`, `playwright.config.ts`

### State is restored once per run, not between tests

- **What:** the database is reset to a known seed at the start of the run, and
  never again during it.
- **Why:** tests run in parallel workers. A reset between tests would have each
  worker wiping the data another worker is in the middle of using.
- **Rejected:** a reset before every test — the textbook answer, and wrong as
  soon as there is more than one worker.

### Isolation comes from throwaway accounts

- **What:** any test that creates or changes something asks the application for
  a brand-new account first. Tests that only *read* use one seeded account that
  nothing ever modifies.
- **Why:** if two tests cannot see each other's data, they cannot interfere,
  whatever order they run in. This replaces the reset-between-tests approach.
- **Rejected:** a shared test account for everything — which caused a real
  failure here: the basic tier allows **two groups**, and three specs each
  making one on a shared account left the third failing on a tier limit that
  had nothing to do with what it was testing. That is why `freshApi` and
  `freshUserPage` exist alongside the shared `userApi`.

### Time is pinned, never waited for

- **What:** the application exposes one clock that a test can set. A spec about
  daylight saving pins the clock to the exact instant and asserts the result.
- **Why:** the alternative is waiting for March. Pinning turns a time-dependent
  behaviour into a fixed input and an expected output.
- **The catch:** pinning is *server-wide* — it affects every worker. So those
  specs carry the `@serial` tag and run in a separate pass, alone.

### There are no retries

- **What:** `retries: 0` in `playwright.config.ts`.
- **Why:** a test that passes on the second attempt is a test nobody can trust,
  and retrying hides the evidence needed to fix it. A flaky spec is repaired or
  deleted.
- **Rejected:** retries, which make the dashboard green and the suite
  meaningless.

### Workers were measured, not guessed

- **What:** two workers for the browser projects, four for the API project.
- **Why:** at two workers the UI specs passed 24 of 24 executions; at three and
  four they failed intermittently, each failure costing a flat ten seconds. More
  workers was both *less reliable and slower*.

### The file name decides where a spec runs

- **What:** `*.api.spec.ts` runs without a browser; `*.ui.spec.ts` runs on all
  three engines.
- **The trap:** a file matching neither pattern is collected by no project and
  runs **nowhere**, silently. That happened once during this work.

### Sign-in for browser specs happens through the API

- **What:** browser specs sign in with an HTTP call and hand the session cookie
  to the browser, rather than filling in the sign-in form.
- **Why:** thirty specs that each use the form are thirty specs that fail when
  the form breaks — which tells you nothing the one spec *for* sign-in does not.

### The clicks are the test; the API is the oracle

- **What:** a UI spec drives the screen the way a person would, then asks the
  server what was actually stored.
- **Why:** neither half is enough alone. An API test cannot see a form that
  reports success and writes nothing. A UI assertion alone cannot tell a saved
  record from a value cached on the page. *An element appearing is not a record
  saved.*

### Test yourself

1. Why would resetting the database between tests break a parallel suite?
2. A test passes on its second attempt. Why is that worse than failing?
3. Why do clock-pinning specs need to run alone?
4. Why do browser specs not sign in through the sign-in form?
5. What can a UI-only assertion not tell you?

---

## 3. API testing

→ `tests/security/security.api.spec.ts`, `tests/alarms/conflicts.api.spec.ts`

### Another account's alarm is "not found", not "forbidden" (TC32)

- **What:** requesting an alarm that belongs to someone else returns **404**.
- **Why:** a 403 *confirms the identifier exists*. That turns the endpoint into
  an oracle — an attacker can probe identifiers and learn which ones are real.
  A 404 is the same answer an invented identifier gets, so it reveals nothing.
- **This is the single most useful API security idea in the suite.** Be able to
  explain it in one sentence.

### Testing CSRF needs a client that can leave the token out (TC54)

- **What:** a write carrying a valid session cookie but no `X-CSRF-Token` header
  must be refused.
- **The interesting part:** the suite's API client *always* adds the token —
  which is the right default, and makes the guard untestable. A client that
  cannot omit the header cannot check that omitting it is refused. So a
  `postRaw` method was added for exactly this.
- **A judgement call worth knowing:** the application refuses with **401**, and
  the test asserts *refused, with a message naming the token* — not a specific
  status code. The case says "refused"; pinning 403 would have been asserting a
  convention the product never stated.

### Write the test from the rule, not from watching the application

- **What:** TC13 asserts that an empty sign-in password is caught *before
  anything is sent*, because rule A-02 promises client-side validation.
- **What it found:** the form had none — **DEF-21**. A test written by first
  using the form and recording what it did would have asserted the banner it
  showed, and passed.
- **The lesson:** a test that describes current behaviour can only ever confirm
  it. A test that describes the *specification* can find where they differ.

### Dates are computed, not written down

- **What:** collision tests use a date about thirty days from today.
- **Why:** rule R-08 only checks for collisions in the **next 90 days**. A
  hardcoded date six months away has nothing to collide with, so a collision
  test passes for the wrong reason — and starts failing for no reason once that
  date passes.

### Test yourself

1. Why 404 and not 403 for another account's alarm? Say it in one sentence.
2. Why did testing CSRF require changing the test client?
3. Why does TC54 assert "refused" rather than a specific status code?
4. How did a test written from the rule find a defect that a test written from
   observation would have missed?
5. Why would a hardcoded date make a collision test pass when it should not?

---

## 4. UI testing across three engines

→ `tests/alarms/notification.ui.spec.ts`, `tests/compatibility/compatibility.ui.spec.ts`

### The same specs on every engine

- **What:** every UI spec runs identically on Chromium, Firefox and WebKit — 27
  each, no engine-specific branches.
- **Compatibility specs assert *capability*, not appearance.** Date pickers,
  speech voices and timezone lists genuinely differ between engines, and that is
  not a defect. TC47 does not assert *which* voice — a CI machine has almost
  none, and demanding a particular one would fail for being run somewhere else.
  It asserts that the form answers, and answers *honestly* when it cannot speak.

### Observing what the browser does

The application raises notifications and speaks out loud. A test cannot hear,
so both are **stubbed** — replaced with recorders — using `addInitScript`,
which runs *before* the application's own code.

- **Why before:** the application reads notification permission when it starts.
  A stub installed afterwards is too late.
- **A trap worth remembering:** `window.speechSynthesis` is a read-only
  property. Assigning a stub to it *silently does nothing*, and the real
  engine — which on a test machine has no voices — answers instead. That looks
  exactly like the application failing to speak. `Object.defineProperty` works.

### Making the scheduler observable

- **The problem (DEF-05):** switching an alarm off did not stop it speaking. A
  regression test has to wait until *this browser* has reacted — but nothing
  showed that it had.
- **What was added:** the page reports how many timers are armed
  (`data-armed-alarms`), so a test can wait for that number to change.
- **Worth knowing:** that is a change to the product *made to enable a test*.
  Defensible in an application built as a system under test, and documented as
  such — but a real trade-off.

### Phone width (TC50)

- **What:** no sideways scrolling at 390 pixels, and every control reachable.
- **It found DEF-22:** the create wizard was 546px wide in a 390px screen,
  because a layout rule meant to stop fields *growing* also stopped them
  *shrinking*.
- **And later caught a regression:** adding one link to the top bar pushed the
  dashboard sideways. TC50 failed on the next run.
- **A correction worth understanding:** the first version asserted controls were
  visible *without scrolling*. That was wrong — a form taller than a phone is
  ordinary. The test now asserts controls are *reachable*.

### Test yourself

1. Why does the voice test not check which voice was used?
2. Why must notification stubs be installed before the application loads?
3. What goes wrong if you stub `speechSynthesis` by assignment?
4. What did `data-armed-alarms` make possible, and what was the cost?
5. What is the difference between "visible" and "reachable", and why did it matter?

---

## 5. The database layer

→ `database/conftest.py`, `database/tests/`

### Why a second stack

- **The question it answers:** the API can prove the application *refuses* a
  stale session or a duplicate name. It cannot prove what is *in the rows*
  afterwards — and those are different questions with different answers.
- **The clearest example:** an API can report an alarm as gone simply by
  filtering on a group that no longer exists. A deletion that orphans rows looks
  identical through the interface.
- **History:** three database assertions first lived inside Playwright specs
  using a TypeScript database helper. That helper was deleted when they moved,
  so the convenient wrong path no longer exists.

### Act, then read

- **What:** every test does something through the API or a browser, then queries
  PostgreSQL. The connection is read-only.
- **Why:** a test that sets up its data with `INSERT` is only asserting that SQL
  works — never the question. Every row examined was created by the application.

### Declarations and behaviour are two different guarantees

- **Behaviour:** delete a group, check its alarms are gone. Proves the
  application did the right thing *once*.
- **Declaration:** read the schema and check `ON DELETE CASCADE` exists. Proves
  the *database* will keep doing it even if someone deletes the application's
  own tidy-up code.
- Both are tested. Also: every `SET NULL` in the schema is deliberate — there is
  exactly one, on `ui_state.folder_id`, and it is correct.

### Partial unique indexes, and why NULL matters

- **The rule:** an ungrouped alarm's name must be unique among that account's
  ungrouped alarms (R-21).
- **Why an ordinary unique index cannot do it:** in PostgreSQL *every NULL is
  distinct*. A unique index on `(folder_id, name)` would allow any number of
  identical ungrouped names, because each NULL `folder_id` counts as different.
- **What the application does:** a *second, partial* index —
  `alarms_unfiled_name_key ... WHERE folder_id IS NULL` — keyed on the user.
- **Important:** the application was **already correct** here. The test pins it
  so it cannot be quietly undone. This was not a defect found.

### Comparing whole result sets

- **The risk:** a list sorted by a non-unique key and fetched page by page has no
  defined order between equal keys. The database may return the same row on two
  pages and another on none. Every page looks fine; one alarm is just missing.
- **The protection:** `ORDER BY lower(name), id` — the `id` breaks ties.
- **The test:** three alarms sharing a name, fetched one per page, must each
  appear exactly once. Again: the application was **already correct**; the test
  exists so nobody tidies away the tiebreaker.

### Rows the browser writes

- **What:** half-filled wizard drafts (`alarm_drafts`) and remembered view
  settings (`ui_state`) are written by the interface as someone uses it — not by
  a deliberate save. No API call reproduces that.
- **So:** these tests drive a real browser first. This is where "query the
  database after a UI action" means something more than "after an API action".

### Refused is not the same as deleted

- **What:** sessions and verification codes are checked *as rows*.
- **Why:** the Playwright suite proves a stale session is *refused*. That says
  nothing about whether its row is gone. A session the API rejects while the
  table still holds it is a credential waiting for a bug in the rejecting code.

### An audit that found two broken tests

Checking the layer against the actual schema — rather than against a summary of
it — found two of its own tests that passed without testing anything:

1. One asserted that no foreign key used `SET NULL`, but only looked at two of
   the ten tables. It could never fail. A test that cannot fail reads as
   coverage, which is worse than having no test.
2. One called a test hook with the wrong HTTP method, got a 404, read it as
   "feature not present", and **skipped — permanently**. It passed by never
   running.

### Test yourself

1. Give a concrete example of something the API cannot tell you about the database.
2. Why does the database layer never insert its own test data?
3. What is the difference between testing a cascade's *behaviour* and its *declaration*?
4. Why can an ordinary unique index not enforce uniqueness among ungrouped alarms?
5. How can paging lose a row while every page looks correct?
6. Why is "the session was refused" not the same as "the session is gone"?
7. Describe the two broken tests the audit found. Why is a test that cannot fail dangerous?

---

## 6. Performance testing

→ `k6/README.md`, `k6/results/`, and DEF-08 in `docs/defects/README.md`

### Five profiles, each for one question

| Profile | Question |
| --- | --- |
| smoke | Does the script work at all, before a long run? |
| load | How does a normal working day behave? (20 users) |
| stress | Where does it start to bend? (steps to 100) |
| spike | Does it recover from a sudden surge? |
| auth | What is the ceiling on sign-ins? |

### DEF-08 — the case worth knowing in full

This is the best single story in the project, because it is about *how you know
what you know*.

1. **The symptom.** At 20 users, most requests took about 130ms. A handful took
   **50 seconds**, and on a second run **1 minute 40**. Every p95 threshold
   *passed*. Only the maximum showed it.
2. **The first diagnosis — the connection pool.** Plausible, tidy, written down
   as the cause. **It was wrong.**
3. **Three experiments disproved it:**

   | Tried | Expected if it were the pool | Observed |
   | --- | --- | --- |
   | Raised the pool from 10 to 40 | Problem disappears | No change |
   | Added a 5-second acquisition timeout | 50s becomes a 5s error | Maxima got *longer* |
   | Compared client timings to the server's own log | Server sees the same delays | Nothing like it |

4. **The decisive measurement.** Across 6,959 responses in a run where the client
   measured 1m40s, the server logged **zero** responses between 1 and 5 seconds.
   *A hundred-second request that the server thinks it answered in thirty
   milliseconds did not spend that time in the application.*
5. **The signature.** Slow requests clustered at **exactly 10,070ms**, and the
   same ten-second shape appeared independently in browser tests. That looks
   like a timeout-and-retry on the connection path — a *direction*, recorded as
   one, not a conclusion.
6. **Instrumentation.** The k6 scripts were changed to record *where* each
   request's time went: `waiting` (the server thinking) versus `blocked` and
   `connecting` (before the server is involved).
7. **The instrumented run did not reproduce it.** 101,501 requests at 100 users,
   zero failures, maximum 287ms, connection path never above a few milliseconds.
8. **Status:** open, *not reproducible on the current machine*. It rules out the
   application and rules out load. It does not explain the original symptom —
   and closing it would claim a fix nobody made.

### Read the maximum, not the p95

The p95 hides the slowest 5% by definition. Every p95 threshold passed on both
runs that found DEF-08. **The measurement that found it was the maximum.**

### A minimum far above zero is a constant

One run today crossed a threshold because a deliberate 600ms delay was left on.
The giveaway was `min = 603ms` — a floor that exact is a configured delay or a
round trip, never load. (The README said to turn it off; it was not read.)

### Test yourself

1. What question does each of the five profiles answer?
2. Why did raising the pool size from 10 to 40 rule out the pool?
3. What did comparing the client's timings with the server's log prove?
4. Why is "it no longer reproduces" not a fix?
5. Why did p95 hide DEF-08?
6. A response time minimum is 603ms. What does that tell you?

---

## 7. The defects, and what each kind taught

→ `docs/defects/README.md` — the richest single document in the project.

### How they were found

| Method | Count | Defects |
| --- | --- | --- |
| Exploratory, local | 7 | DEF-04, 05, 06, 10, 12, 13, 14 |
| Automated test | 5 | DEF-09, 19, 20, 21, 22 |
| Configuration review | 2 | DEF-03, 11 |
| Documentation review | 2 | DEF-15, 17 |
| Load test | 2 | DEF-08, 18 |
| Exploratory, deployed | 1 | DEF-01 |
| Production log review | 1 | DEF-02 |
| Deployment failure | 1 | DEF-07 |
| While diagnosing another | 1 | DEF-16 |

**Neither Critical defect came from automation.** One came from exploring the
live site, one from reading production logs. The automated suite found the
subtler faults; a person looking at the running system found the two serious
ones. That is an argument for both, not against either.

### The stories worth being able to tell

**DEF-01 (Critical) — the code was on the page.** The verification code was
returned in the registration response *as well as* emailed. Anyone could
register an address they did not own, read the code off the page, and hold a
verified account. Found by using the deployed site.

**DEF-02 (Critical) — a health check took the site down.** The health check
waited on the mail server. When mail was slow, health failed, and the whole
site returned 502. A dependency that should have been reported was made
load-bearing. Found by reading production logs.

**DEF-05 (High) — switching an alarm off did not stop it speaking.** Three
separate faults, which is why it looked intermittent: the schedule was not
refreshed when an alarm changed; timers were only ever added, never cancelled;
and speech already handed to the browser could outlive the page. *A bug that
looks random is often several bugs.*

**DEF-15 and DEF-17 — documentation that was not true.** A rule the application
no longer had, and sixteen requirements referenced by test cases but written
down nowhere. This is why the traceability matrix is *generated*, not
hand-written — a hand-kept copy drifts.

**DEF-19 — a pool failure looked like a server bug.** It surfaced as an unhandled
500. It now answers **503 with Retry-After**, because the two mean opposite
things to a caller: 500 means "your request was wrong", 503 means "try again
shortly". The fix also had to *not* do this for genuine query errors — retrying
forever against a request that can never succeed is worse.

**DEF-21 — the form promised something it did not do.** See section 3. Found
because the test was written from the rule.

**DEF-22 — the phone layout.** See section 4. Diagnosed by *measuring* which
element overflowed rather than reading the stylesheet: the field was 546px
inside a 324px container, which pointed at shrinking rather than width.

### Test yourself

1. Which methods found the two Critical defects, and what does that suggest?
2. Tell the DEF-05 story. Why did it look intermittent?
3. Why does DEF-19 return 503 rather than 500 — and what would be wrong with
   returning 503 for every database error?
4. How did DEF-15 change the way traceability is maintained?

---

## 8. Traceability and test management

→ `docs/traceability.md`, `docs/test-cases/`, `scripts/`

### Requirement → case → spec

Every requirement links to at least one designed test case; each case links to
the spec that automates it. **34 of 34** requirements have a case; **33 of 34**
have a spec.

### Who owns what

- **Test cases are designed in TestQuality** — steps, expected results,
  priorities. That is test design.
- **The repository derives bookkeeping**, never design. `test_is_automated` in
  the exports is set by a script reading the specs, because whether a spec
  exists is a fact about the repository, not a judgement.

### Generated, not hand-written

The matrix is rebuilt by `scripts/traceability.py` from the requirements, the
case exports and the spec titles. A hand-maintained fourth copy starts correct
and drifts — DEF-15 one layer up.

### One spec-finder, not two

`scripts/specscan.py` is the only code that finds specs, and it reads both
stacks. It exists because two copies of that logic once disagreed: one matched
only single-quoted test titles while some were double-quoted, so the matrix
reported specs as missing that were running perfectly well.

### The four cases not automated — each a decision

| Case | Why not |
| --- | --- |
| TC7 — voice clarity | A judgement about audio, not something to assert |
| TC8 — cross-browser | Satisfied by running every spec on three engines |
| TC45 — repeat messages | Needs a paid tier, and paid tiers are out of scope |
| TC46 — desktop notification | What the operating system draws is outside the browser |

### Test yourself

1. Why is the traceability matrix generated rather than written by hand?
2. Why may a script set `test_is_automated` but not write test steps?
3. Pick two of the four unautomated cases and explain why each is a decision rather than a gap.

---

## 9. Continuous integration

→ `.github/workflows/ci.yml`

### Six jobs

| Job | Does |
| --- | --- |
| api, chromium, firefox, webkit | The Playwright matrix — one job per engine |
| database | The pytest layer, with its own PostgreSQL |
| report | Merges the results and publishes them |

- **One job per engine**, not one job cycling through them: three browsers
  competing for one machine made the slower ones time out, and separate jobs
  make a WebKit failure visible *as* a WebKit failure.
- **Two passes** in each: everything in parallel, then the `@serial`
  clock-pinning specs alone.
- **The report job waits for the database job.** Otherwise a failing database
  run could be reported as a green run.

### Refuse to pass by skipping

The database tests skip when no database is configured — correct on a laptop. In
CI that would make a broken workflow look green, so the job **fails** if the
database URL is missing.

### One results site, two reports

Published at a GitHub Pages site with a front page linking both reports. They
are **not merged into one**, because the only format both tools share is JUnit
XML, which would throw away Playwright's traces and screenshots — the most
useful thing in that report.

### Two CI lessons

- **A corrupt upload survives "re-run failed jobs".** The report job failed three
  times. Three of four test results downloaded; one upload was corrupt. Re-running
  only the failed job never re-uploads the corrupt one. Re-running *all* jobs did.
- **A hardcoded path can make a test never run in CI.** One test looked for the
  application at `../alarm-configurator`; CI checks it out at `app/`. It skipped
  on every CI run and passed locally — found only by *reading the CI log*, since
  nothing went red.

### Test yourself

1. Why one CI job per browser instead of one job running all three?
2. Why must the report job wait for the database job?
3. Why does the database job fail rather than skip when the database is missing?
4. Why were the two reports not merged into one?
5. How can a test pass locally and never run in CI, without anything failing?

---

## 10. What is incomplete

Stated plainly, because knowing the gaps is part of knowing the work.

- **Sequences have no requirements and no tests.** The feature works — verified
  end to end — but no documented rule mentions it, so the matrix does not know it
  exists and the suite would not notice if it broke.
- **The sequence tier cap is not enforced.** The decision was one sequence on the
  basic tier; a basic account can currently create any number.
- **DEF-08 is open** — not reproducible, cause not established.
- **Verification and reset codes are stored unhashed.** Not a defect against any
  rule; a decision still to be made, with the argument both ways in the test.
- **R-26 is uncovered on purpose** — it needs a paid tier, which is out of scope.
- **The performance workflow has never run in CI**, and the Docker compose setup
  has never been run.
- **The speech service is not deployed.** It runs locally and in CI only.
  Production is unchanged — generated speech was already off there.
- **Its data isolation is a convention, not a permission.** Both services use
  one database role; a separate role needs a superuser.
- **The speech service has no designed test cases** — only the engineering
  tests written alongside it, as with sequences.

---

## 11. The lessons that kept coming back

These recurred enough to be worth knowing as principles.

**1. A green test can know nothing.** It happened repeatedly: a test that checked
two of ten tables; a test that skipped forever on a 404; a test that never ran
in CI; a collision test with dates beyond the collision window. *Passing is not
evidence until you know the test could have failed.*

**2. Read the maximum.** Averages and percentiles exist to summarise, which
means they hide. DEF-08 was invisible at p95.

**3. Measure from more than one side.** DEF-08 was misdiagnosed from the
client's view alone. The server's own log, the event loop, and the per-phase
breakdown were what separated "the application is slow" from "something before
the application is slow".

**4. A specific result is not a universal claim.** "Some flows are verified at
three layers" is true; "*every* UI action is" is not. "Tests guard against
paging losing a row" is true; "*found* a paging bug" is not — the application
was already correct. Claims like these unravel at the first follow-up question,
and the real work does not need them.

**5. Documentation drifts unless it is generated or owned.** DEF-15, DEF-17, the
traceability matrix, the spec-finder — every hand-kept copy eventually
disagreed with reality.

**6. Write decisions down when they are made.** Several agreed decisions were
lost between sessions and only rediscovered after something had been built the
wrong way. They now live in `CLAUDE.md` in each repository.

### Test yourself

1. Give two examples of a test that passed without testing anything.
2. Why is "it passed" not evidence on its own?
3. What is the difference between "the tests guard against X" and "found X"?

---

## 12. Testing a microservice — the speech service

→ `alarm-configurator/src/speech/`, `alarm-configurator/src/api/src/speech/`,
`database/tests/test_speech_service.py`

### Why there is one at all

- **What:** generated speech runs as its own service, with its own process, its
  own data and its own tests. The main API calls it over HTTP.
- **Why:** to learn and demonstrate microservices testing. **Not** because the
  application needed it — one application with one owner has none of the
  problems microservices solve. Say it that way: *"I extracted the speech service
  to practise contract testing"* is honest and strong; *"the app needed
  microservices"* is not true.
- **Why speech:** measured, not guessed. About 370 lines owning one table that
  nothing referenced, and no backend code outside it imported it — its only
  consumer was the browser. Mail was tangled into four places, including the
  health check that caused DEF-02.
- **Rejected:** converting the whole application — a rewrite of working code for
  no benefit, with every existing test needing rework.

### Splitting responsibilities

The main API kept what belongs to the **user** — signing in, the tier gate, the
per-user rate limit. The speech service took what belongs to **speech** — the
provider, the cache, the bytes. The browser did not change at all: same routes,
same shapes. *A good extraction is invisible to the callers of the thing extracted.*

The speech service's routes are **versioned** (`/v1/...`), because they are now
an interface between two services. Unversioned, every change would need both
deployed together.

### Contract testing — the skill this was for

The idea: **check that two services agree, without running both together.**

1. **The consumer** (the main API) runs its client against a mock that Pact
   provides, and records every request it makes and every answer it relies on,
   in a contract file.
2. **The provider** (the speech service) replays every recorded request against
   its real routes and fails if any answer differs.

**The proof it works:** renaming a field in the speech service (`generated` →
`wasGenerated`) failed its contract test — *even after its own unit test was
updated to match*. Its team could fix their own tests; nothing they did on their
side could satisfy the main API's recorded expectation. That is how a breaking
change gets caught before deployment rather than in production.

**Describe only what the consumer uses.** The first version of the audio
interaction pinned `audio/wav`. That is only what the mock provider makes —
ElevenLabs returns `audio/mpeg` — so the contract would have failed the first
time it met real audio. Worse, it constrained bytes the main API never reads; it
passes them straight through. The contract now asks for a status and an audio
Content-Type, nothing about the bytes. *An over-specified contract stops the
provider changing things nobody depends on.*

**No secrets in the contract.** The file is committed, so it says "a valid
token" as a placeholder, and the provider swaps in its real token as each
request is replayed. A wrong token in the 401 interaction is left as recorded.

**Provider states** put the service in the condition each interaction needs —
"audio exists", "generation is switched off". The "audio exists" state carries
the example bytes in the contract itself, so they live in one place rather than
being copied into both sides.

### Testing a service in isolation

The speech service's own tests replace its one dependency — ElevenLabs — with a
fake `fetch`, so every failure can be produced on demand: a spent quota, a bad
key, a provider that cannot be reached. *Waiting for a real service to fail in
each of those ways is not a test plan.*

Its storage sits behind an interface with an in-memory version, so the contract
and unit tests run in a CI job with no database. That is not cheating: the
contract is about the HTTP conversation, and persistence is checked separately
by the database layer against real PostgreSQL.

### When a dependency fails — the part that does not exist in a monolith

A function call returns or throws. A call to another service can also be
refused at the door, hang until someone gives up, come back busy, or come back
with an answer that will never change. Each wants a different response:

| What happened | Status | Meaning to the caller |
| --- | --- | --- |
| Down, too slow, or busy | **503** + `Retry-After` | It may recover — try later |
| Answered, and refused for good (bad provider key) | **502** | Asking again gets the same answer |
| Rejected the main API's token | **502**, logged as an error | An operator problem — nothing else will ever report it |
| No speech service configured | 404, settings say off | Reads the same as a feature never built |

Three things worth being able to explain:

- **A timeout is not optional.** A service that never answers would hang every
  request touching it — which is how one slow dependency takes a site down. The
  client gives up after a fixed time, and a test proves it.
- **The main API's health check does not depend on speech.** Stopping the speech
  service mid-run left the main API healthy. That is DEF-02 learned properly: a
  dependency that should be *reported* must not be made *load-bearing*.
- **Settings say "unavailable" before anything fails.** So the browser uses its
  own voice from the start, rather than failing on the first alarm and falling
  back then.

### Data: schema per service

- **What:** the speech service owns a `speech` schema; the main API's schema no
  longer holds any speech data.
- **Why not a separate database:** the local database user can create a schema
  but not a database or a role. Schema per service is one of the three
  recognised ways to keep a service's data private.
- **The honest limit:** both services connect as the same role, so the
  isolation is **a convention enforced by tests, not a permission**. The
  database layer fails if the main schema ever holds speech data again, if a
  foreign key crosses the boundary, or if the two migration ledgers overlap.
- **Proven:** planting a `speech_audio` table back in the main schema made two
  of those tests fail.

### Three bugs found while building it — all in tests

1. **A security test that tested the opposite of its claim.** "Fails closed with
   no token configured" called `configWith({}, undefined)`. In JavaScript,
   *passing `undefined` to a parameter with a default uses the default* — so it
   configured a token and tested the open path. Fixed, then proven by breaking
   the server to fail open and watching the test catch it.
2. **A contract that was too narrow** — the `audio/wav` pin above.
3. **Database tests that passed for the wrong reason.** Once `speech_audio`
   existed in two schemas, helpers that asked about a table by name alone
   quietly found the speech service's copy and kept passing. Every schema
   question now names its schema.

### Test yourself

1. Why was speech chosen to extract, rather than mail or the whole application?
2. What does a contract test check, and why does neither side need the other running?
3. A provider's team renames a field and updates their own unit tests. Why does the build still fail?
4. Why did the audio contract stop specifying `audio/wav`? What principle does that illustrate?
5. Why can't the contract file contain the real service token, and how does verification work without it?
6. What is the difference between a 503 and a 502 from the main API, and why does it matter?
7. Why must the main API's health check not depend on the speech service?
8. What is "schema per service", and what is the honest limit of how it is done here?
9. Explain the default-parameter bug. Why is it especially dangerous in a security test?

---

## The code to read alongside

Upload these with this guide. Paths are relative to each repository.

**The rules being tested**
- `alarm-configurator/README.md` — the 34 behavioural rules

**The reasoning, in full**
- `alarm-test-framework/README.md`
- `alarm-test-framework/CLAUDE.md`
- `alarm-test-framework/docs/defects/README.md`
- `alarm-test-framework/docs/test-summary.md`
- `alarm-test-framework/docs/traceability.md`
- `alarm-test-framework/docs/test-cases/not-automated.md`
- `alarm-test-framework/k6/README.md`
- `alarm-test-framework/k6/results/2026-10-05-first-run.md`
- `alarm-test-framework/k6/results/2026-10-10-instrumented-run.md`

**Code that shows the ideas**
- `tests/security/security.api.spec.ts` — 404 vs 403, CSRF
- `tests/alarms/notification.ui.spec.ts` — stubbing, pinned clock, the scheduler
- `tests/compatibility/compatibility.ui.spec.ts` — three engines, phone width
- `src/fixtures.ts` — throwaway accounts
- `playwright.config.ts` — workers, retries, projects
- `database/conftest.py` — the database layer's plumbing
- `database/tests/test_cascades.py` — declarations versus behaviour
- `database/tests/test_result_sets.py` — paging and set comparison
- `database/tests/test_speech_service.py` — each service owning its own data

**The speech service — testing a microservice**
- `alarm-configurator/src/api/src/speech/client.ts` — calling another service, and every way it can fail
- `alarm-configurator/src/api/src/speech/client.test.ts` — a dependency failing, on demand
- `alarm-configurator/src/api/src/speech/client.pact.test.ts` — the contract, from the consumer
- `alarm-configurator/src/speech/src/contract.pact.test.ts` — the contract, from the provider
- `alarm-configurator/src/speech/src/server.ts` — the service itself
- `alarm-configurator/src/speech/src/server.test.ts` — the service in isolation

Both repositories are public on GitHub:
[alarm-test-framework](https://github.com/TestNinja007/alarm-test-framework) ·
[alarm-configurator](https://github.com/TestNinja007/alarm-configurator)
