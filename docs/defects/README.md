# Defect register

Every defect found in Nudge so far, with how it was found, what caused it and
what now guards it.

The register lives here rather than in the application repository because it is
a test deliverable — the test plan promises it — and because the interesting
column is not the fix. It is **how found**. A list of twenty-two defects says
little; nineteen defects sorted by the activity that caught them says what the
testing is actually worth.

Defects are filed against the product. Where a fix exists the commit is named,
and lives in
[TestNinja007/alarm-configurator](https://github.com/TestNinja007/alarm-configurator).

## How these are classified

**Severity** is impact, independent of who cares:

| | |
| --- | --- |
| **Critical** | Data exposed or lost, or the service unavailable. |
| **High** | A primary flow cannot be completed, or completes with a wrong result the person would act on. |
| **Medium** | A flow is completable but obstructed, or wrong in a secondary path. |
| **Low** | Cosmetic, diagnostic, documentation, or affecting a narrow subset. |
| **Informational** | Measured, by design, worth writing down. Not a defect; recorded so it is not rediscovered as one. |

**Priority** is fix order, and follows the test plan's own criterion: anything
functional is P1, the supporting paths around it are P2, and everything else is
P3. Severity and priority disagree on purpose — DEF-11 is a Medium that is P3,
because a broken container entrypoint stops nobody who is not using the
container.

## The register

| ID | Defect | Severity | Priority | Status | Found by |
| --- | --- | --- | --- | --- | --- |
| [DEF-01](#def-01) | Verification code returned in the registration response on the deployed site | Critical | P1 | Fixed | Exploratory, deployed |
| [DEF-02](#def-02) | Health check awaited the mail server; the whole site returned 502 | Critical | P1 | Fixed | Production log review |
| [DEF-03](#def-03) | SMTP credentials would have been sent unencrypted | High | P1 | Fixed | Configuration review |
| [DEF-04](#def-04) | An alarm could not be created without a spoken message | High | P1 | Fixed | Exploratory, local |
| [DEF-05](#def-05) | Disabling an alarm did not stop it speaking | High | P1 | Fixed | Exploratory, local |
| [DEF-06](#def-06) | Seeded accounts could not sign in after a fresh seed | High | P1 | Fixed | Exploratory, local |
| [DEF-07](#def-07) | The production build failed: devDependencies were skipped | High | P1 | Fixed | Deployment failure |
| [DEF-08](#def-08) | Database-backed endpoints show multi-second maxima under load — cause not identified | Medium | P1 | **Open** | Load test |
| [DEF-09](#def-09) | An occurrence count of zero was accepted and silently meant "never ends" | Medium | P1 | Fixed | **Automated test** |
| [DEF-10](#def-10) | An alarm could not be created without first creating a group | Medium | P2 | Fixed | Exploratory, local |
| [DEF-11](#def-11) | A CRLF checkout broke the container entrypoint | Medium | P3 | Fixed | Configuration review |
| [DEF-12](#def-12) | Signing out landed on the sign-in form | Low | P3 | Fixed | Exploratory, local |
| [DEF-13](#def-13) | No way back from the signed-out forms but the browser's back button | Low | P3 | Fixed | Exploratory, local |
| [DEF-14](#def-14) | The alarms table was announced as "this folder" on a page that is not one | Low | P3 | Fixed | Exploratory, local |
| [DEF-15](#def-15) | A documented rule the application no longer had | Low | P2 | Fixed | Documentation review |
| [DEF-16](#def-16) | A failing mail check reported no reason | Low | P3 | Fixed | While diagnosing DEF-02 |
| [DEF-17](#def-17) | Sixteen requirements are cited by the test cases and written down nowhere | Low | P2 | Fixed | Documentation review |
| [DEF-18](#def-18) | Authentication throughput is bounded by scrypt on four threads | Informational | — | By design | Load test |
| [DEF-19](#def-19) | A database connection the pool cannot obtain becomes an unhandled 500 | Medium | P2 | Fixed | **Automated test** |
| [DEF-20](#def-20) | Completing registration, and completing a password reset, answered 500 | High | P1 | Fixed | **Automated test** |
| [DEF-21](#def-21) | The sign-in form had no client-side field validation, contrary to A-02 | Low | P3 | Fixed | **Automated test** |
| [DEF-22](#def-22) | The create wizard scrolled sideways at phone width | Medium | P2 | Fixed | **Automated test** |

Three are open, and DEF-17 is no longer one of them. DEF-08 is the more interesting one: it was recorded with a
confident root cause, three experiments disproved that cause, and the entry now
carries the disproof rather than a tidier story. A register that only ever
accumulates correct diagnoses is a register nobody checked.

## What the distribution says

| Activity | Defects |
| --- | --- |
| Exploratory use, local | 7 |
| Configuration review | 2 |
| Documentation review | 2 |
| Load testing | 2 |
| Exploratory use, deployed | 1 |
| Production log review | 1 |
| Deployment failure | 1 |
| Automated test | 6 |
| While diagnosing another defect | 1 |

**Six defects were found by the automated suite.** That number is low for a
reason worth stating rather than hiding: the suite was written after the
product, so it inherited an application whose obvious faults had already been
exercised by hand. Its value is the next twenty-two, not these. And the first it
did catch, DEF-09, was the first fault in the application that nobody had found
by using it — a wrong answer returned with a success status, which is precisely
the kind a person does not notice and an assertion cannot miss.

**Half of these were outside functional testing entirely.** Nine of twenty-two —
DEF-02, DEF-03, DEF-07, DEF-08, DEF-11, DEF-15, DEF-16, DEF-17 and DEF-18 —
came from reading configuration, reading logs, a failed deploy, a load run, or
comparing documentation against behaviour. No amount of clicking the interface
finds a default that sends passwords in the clear, or a connection pool with no
timeout. That is the argument for the spread of testing types in the plan, made
from this project's own history rather than from a textbook.

**Two were the same mistake a fortnight apart.** DEF-04 and DEF-09 share one
root cause: a nullable field declared as a union of a type and null, which
Ajv's type coercion satisfies by converting the value rather than rejecting it.
The first turned `null` into `""`; the second turned `0` into `null`. Finding a
fault twice in different clothes is the signal to go looking for the rest of
its family, which is why every nullable field in the alarm schema was
converted, not only the two that had failed.

---

## DEF-01

**Verification code returned in the registration response on the deployed site**

| | |
| --- | --- |
| Severity | Critical |
| Priority | P1 |
| Status | Fixed — `bf46829` |
| Component | Registration, mail transport |
| Requirement | R-30 |
| Environment | Deployed instance, Brevo HTTPS transport |
| Found by | Registering a real address on the deployed site |

**Steps to reproduce.** With `MAIL_TRANSPORT=brevo`, register any email
address. Read the response body.

**Expected.** The code is delivered to the address and appears nowhere else. A
caller who does not control the inbox learns nothing.

**Actual.** The six-digit verification code was returned in the response *and*
emailed. Anyone could register an address they did not own, read the code off
the page, and hold a verified account on it.

**Root cause.** The decision to hand the code back was written as
`transport === 'smtp'` — a check for one transport name rather than for the
property that mattered, which is whether the transport delivers anywhere at
all. Adding `brevo` later fell through to the development branch by omission.
Nothing was wrong with the new transport; the guard was the wrong shape from
the start and worked only as long as nothing was added.

**Fix.** Callers ask `deliversExternally()` instead of comparing names, so a
transport added in future cannot reintroduce this by being forgotten. The
`capture` transport, which sends nothing, still returns the code, because that
is its entire purpose.

**Regression coverage.** None yet. A case asserting that the registration
response carries no code whenever the transport delivers externally is the
guard this needs, and it belongs in the security set.

---

## DEF-02

**Health check awaited the mail server; the whole site returned 502**

| | |
| --- | --- |
| Severity | Critical |
| Priority | P1 |
| Status | Fixed — `3ac792c` |
| Component | `GET /health`, SMTP transport |
| Requirement | T-04 |
| Environment | Deployed instance, SMTP transport with no credentials configured |
| Found by | Reading the deployed logs |

**Steps to reproduce.** Point the SMTP transport at a host that accepts a
connection and then sends nothing. Call `/health`.

**Expected.** Health answers immediately, and reports what it knows.

**Actual.** Every health check logged "incoming request" and none logged
"request completed". The platform concluded the service was dead and the entire
site returned 502 — including every page that has nothing to do with mail.

**Root cause.** `/health` awaited `transporter.verify()`, which opens an SMTP
connection. The host accepted it and stayed silent, and nodemailer's default
timeouts are measured in minutes, so the request never finished. A health
endpoint that depends on a third party answering reports the third party's
availability, not its own.

**Fix.** Health reports a cached reachability value, refreshed in the
background at most once a minute and never awaited; it is `null` until the
first probe finishes, which is a real state and is typed as one. The SMTP
transport also carries explicit connection, greeting and socket timeouts, so
nothing can hang for minutes again.

**Verified.** Against a socket that accepts and then stays silent: ten
consecutive health checks returned 200 in about six milliseconds each, and the
background probe settled to `reachable: false` a few seconds later.

**Regression coverage.** Partial. `src/globalSetup.ts` asserts health before
every run, so a hanging health endpoint fails the suite immediately rather than
eighty specs later. Nothing yet asserts the timeout behaviour itself, which
would need a deliberately silent socket in the harness.

---

## DEF-03

**SMTP credentials would have been sent unencrypted**

| | |
| --- | --- |
| Severity | High |
| Priority | P1 |
| Status | Fixed — `2fc2666` |
| Component | Mail configuration |
| Requirement | — (configuration) |
| Environment | Any deployment using SMTP on port 587 |
| Found by | Reading the mail configuration while preparing to deploy |

**Steps to reproduce.** Configure SMTP against a real provider on port 587
without setting `MAIL_IGNORE_TLS`. Observe that STARTTLS is skipped.

**Expected.** Transport encryption is the default. Skipping it is something you
have to ask for.

**Actual.** `MAIL_IGNORE_TLS` defaulted to on, which suited the local mail
catcher and nothing else. Against a real provider the SMTP login would have
gone over the wire in the clear.

**Root cause.** A default chosen for the convenience of the development
environment and never revisited for any other. The local catcher needs no TLS,
so the setting that made it work became the setting everything inherited.

**Fix.** The default is off. The compose file turns it on explicitly for the
local catcher, which is the only place it belongs. The mail settings are also
declared in the deployment blueprint with the login, password and from-address
marked `sync: false`, so they are set in the dashboard rather than committed.

**Regression coverage.** None, and automation is the wrong instrument — this is
a default in a configuration file. It is caught by review, and the
counter-measure that generalises is the one applied: insecure settings are
opt-in per environment rather than opt-out globally.

---

## DEF-04

**An alarm could not be created without a spoken message**

| | |
| --- | --- |
| Severity | High |
| Priority | P1 |
| Status | Fixed — `168c629` |
| Component | Alarm schema, validation |
| Requirement | R-24, R-31 |
| Environment | All |
| Found by | Creating an alarm while working on something else |

**Steps to reproduce.** `POST /alarms` with a valid name, time, timezone, start
date and rule, and no `speechText` at all.

**Expected.** 201. A spoken message is optional; an alarm with none simply does
not speak.

**Actual.** Refused, with a field error demanding a message — for an alarm that
had deliberately not asked to speak. The most ordinary creation the product
supports was impossible through the API.

**Root cause.** `speechText` was declared
`Type.Union([Type.String(), Type.Null()])`, which compiles to `anyOf`. Fastify
enables Ajv's type coercion by default, and Ajv tries the branches in order: it
reached the string branch first and satisfied it by coercing `null` into `""`.
The string branch had no pattern to fail, so the coercion stuck, `speechText`
arrived as an empty string rather than absent, and the rule that refuses an
*empty* message correctly refused it.

The dated fields escaped only by accident: `""` fails their format pattern, so
Ajv fell through to the null branch and the value survived.

**Fix.** The nullable fields are declared as nullable **types**
(`type: ['string', 'null']`) rather than unions of types. A nullable type has
no alternative branch to coerce into, and applies its string constraints only
to strings. A whitespace-only message is still refused, which is the rule that
was always intended.

**Regression coverage.** Incidental but real: the `validAlarm()` helper in
`tests/alarms/validation.api.spec.ts` omits `speechText` entirely, so every
positive create in the suite — TC58 through TC61 and all nine recurrence specs
— would fail if this returned. No dedicated case asserts it, which is a gap
worth closing precisely because the coverage it has today is a side effect of
how a helper happens to be written.

---

## DEF-05

**Disabling an alarm did not stop it speaking**

| | |
| --- | --- |
| Severity | High |
| Priority | P1 |
| Status | Fixed — `0e4ecbd` |
| Component | Notification scheduler (browser) |
| Requirement | R-28, R-32 |
| Environment | All browsers |
| Found by | Switching an alarm off and listening |

**Steps to reproduce.** Create an alarm repeating every ten seconds. Let it
fire. Switch it off. Wait.

**Expected.** It stops.

**Actual.** It kept speaking for up to another two minutes. Closing the tab did
not stop it either — it carried on talking with the site shut.

**Root cause.** Three separate omissions, which is why it looked intermittent:
how long it kept talking depended on how many occurrences happened to be inside
the two-minute lookahead when you switched it off.

1. Nothing invalidated the upcoming query when an alarm changed, so the
   scheduler did not learn about the change until the next thirty-second poll.
2. The scheduler only ever *added* timers. It never reconciled, so a timer
   armed for an occurrence that had since left the feed still fired.
3. A `speechSynthesis` utterance already handed to the browser can outlive the
   page that queued it, and React's cleanup is not guaranteed to run when a tab
   closes.

The server was right throughout — a disabled alarm leaves the upcoming feed
immediately, confirmed by disabling one and watching its fifty occurrences go
to zero. The whole fault was in the browser, which is worth noting because an
API-only suite could not have found it.

**Fix.** Toggling, bulk toggling, deleting an alarm, saving one in the wizard
and deleting a group all invalidate the upcoming query. The scheduler disarms
every timer whose occurrence is no longer in the feed before arming new ones,
which covers disabling, deleting and rescheduling with one rule rather than
three. A `pagehide` listener cancels both speech synthesis and the audio
element, and so does switching notifications off.

**Regression coverage.** TC27 covers it as a written case — disable an alarm
due inside the lookahead and assert nothing fires — and is one of the specs not
yet automated. It needs `page.clock` and a stubbed `speechSynthesis`, and it is
the highest-value case in the unautomated set: this defect is the proof that
the fault is reachable, silent from the server's point of view, and audible to
nobody but the user.

---

## DEF-06

**Seeded accounts could not sign in after a fresh seed**

| | |
| --- | --- |
| Severity | High |
| Priority | P1 |
| Status | Fixed — `1f37b10` |
| Component | Seed data, `POST /test/users` |
| Requirement | T-01, T-03, R-29 |
| Environment | All |
| Found by | Reseeding the database |

**Steps to reproduce.** Run the seed against a database created after the email
verification migration. Sign in as any seeded account.

**Expected.** 200 and a session. A seeded account has no inbox and is verified
by definition.

**Actual.** 401. Every seeded account, and every throwaway account from
`POST /test/users`, was unverified and could not sign in — which is to say the
entire test fixture was unusable, and so was every test that would have
depended on it.

**Root cause.** A regression introduced by email verification. The migration
back-filled `email_verified_at` on existing rows, so the running database kept
working and nothing looked wrong. Both *insert* paths — the seed and the
throwaway-user hook — were missed. The fault was invisible until somebody
created a database from nothing, which is the one thing a working development
environment rarely does.

**Fix.** Both insert paths set `email_verified_at`, since neither kind of
account has an inbox to check.

**Regression coverage.** Structural, and the strongest kind in this register.
`src/globalSetup.ts` resets the seed before every run and the worker-scoped
`workerUser` fixture signs in through `POST /test/users`, so a return of this
defect fails the entire suite at setup, in every project, before a single spec
runs. The lesson generalises past the fix: a migration that back-fills hides
the insert path it forgot, so the test for it has to start from an empty
database.

---

## DEF-07

**The production build failed: devDependencies were skipped**

| | |
| --- | --- |
| Severity | High |
| Priority | P1 |
| Status | Fixed — `718cd60` |
| Component | Build, deployment |
| Requirement | — (deployment) |
| Environment | Render |
| Found by | The first deploy failing |

**Steps to reproduce.** Run `npm ci` with `NODE_ENV=production`, then build the
web bundle.

**Expected.** The build succeeds.

**Actual.** It failed on its first import. Vite, `@vitejs/plugin-react` and the
React types were absent.

**Root cause.** The deploy set `NODE_ENV=production`, which `npm ci` honours by
skipping devDependencies — where every build tool lives. The build tools are
development dependencies and the build is a production step, so the convention
and the requirement point in opposite directions.

**Reproduced locally.** 135 packages installed under `NODE_ENV=production`
against 481 with `--include=dev`, the former matching Render's log exactly.
Worth recording as technique rather than detail: the fastest route to this
answer was reproducing the *package count*, not the error message.

**Fix.** The install includes dev dependencies explicitly. A `.node-version`
file also pins Node, because the root `engines` range of `>=22` let the platform
resolve to 26.10.0 — not the Active LTS the project targets, and liable to
change again without warning.

**Regression coverage.** CI builds the application from source on every run in
all four projects, so a build that cannot build fails immediately. The Node
version is pinned by file rather than asserted by a test.

---

## DEF-08

**Database-backed endpoints show multi-second maxima under load — cause not identified**

| | |
| --- | --- |
| Severity | Medium |
| Priority | P1 |
| Status | **Open — originally diagnosed as the connection pool; that was wrong** |
| Component | Not established. Not the application's own request handling. |
| Requirement | — (non-functional) |
| Environment | Local, one process, PostgreSQL 18, Windows |
| Found by | `k6 run k6/load.js` — see [the first run](../../k6/results/2026-10-05-first-run.md) |

**Steps to reproduce.** Run the mixed load profile at 20 virtual users against
one process. Read the maximum, not the p95.

**Expected.** Either the request is served, or it is refused within a time a
caller can do something about.

**Actual.** Client-measured maxima of **50.2 s** on the first run and
**1m40s** on the second, on `GET /alarms` and `GET /me/upcoming`, with a
small percentage of outright failures. The distribution is sharply bimodal:
p95 stays near 130 ms while a handful of requests take a hundred times that.

### The original diagnosis, and why it was wrong

This was first recorded as the pool being created with `max: 10` and no
`connectionTimeoutMillis`: twenty virtual users each making four
database-backed requests exhaust it, and the rest queue with nothing to cut
them off. It was a tidy explanation, it fit the evidence available at the
time, and it is **not what is happening.** Three experiments say so.

| Experiment | Expected if the pool were the cause | Observed |
| --- | --- | --- |
| Raise `max` from 10 to 40 | Queueing disappears | No change |
| Add `connectionTimeoutMillis: 5000` | A 50 s hang becomes a 5 s error | No change; maxima got *longer* |
| Compare client timings against the application's own request log | Server-side responses as slow as the client's | **Nothing like it** |

The third is conclusive. Across 6,959 responses the application logged during
a run in which k6 measured a 1m40s maximum:

| Server-measured response time | Count |
| --- | --- |
| under 100 ms | 6,591 |
| 100 ms – 1 s | 357 |
| 1 s – 5 s | **0** |
| 5 s – 30 s | 11 |
| over 30 s | **0** |

The application never took longer than about ten seconds for anything, and
never once took between one and five seconds. A hundred-second request that
the server believes it answered in thirty milliseconds did not spend that time
in the application.

### What the evidence actually points at

The slow responses cluster at **exactly 10,070 ms**, and the same exact-ten-second
signature turned up independently while automating the browser specs: a
`GET /auth/me` that timed out at 10,000 ms carrying valid cookies, a `click`
that hung for 10,000 ms after Playwright reported the element visible, enabled
and stable, and a `/health` that took 10,011 ms while the event loop lag
stayed at 2 ms. Meanwhile the event loop is idle throughout, the machine sits
at 10–20% CPU across 20 cores, and some requests report a duration of 0 s,
which is a connection that never completed rather than a slow one.

A timeout-and-retry signature on the connection path, not a queue. This is a
machine whose TLS interception has already broken two package managers in this
project. That is a direction, not a conclusion, and it is written here as one.

### Why it stays open, and stays filed

The symptom is real and reproducible. What it is *not* is a defect in the
request handling, which is what the register claimed for a day. It is left
open with the misdiagnosis shown rather than quietly rewritten, because the
useful part of this entry is now the method: a client-side measurement alone
could not distinguish "the application is slow" from "something between the
client and the application is slow," and the thing that separated them was
comparing three independent measurements — the client's, the server's own
request log, and the event loop.

**What has been changed anyway.** `connectionTimeoutMillis` and a configurable
`max` are now on the pool (`DATABASE_ACQUIRE_TIMEOUT_MS`,
`DATABASE_POOL_MAX`). An unbounded wait for a connection is a latent hazard
worth removing on its own merits — but it fixed nothing here, and is recorded
as a hardening change rather than as the resolution of this defect.

**The scripts can now answer this; the run has not happened.** The profiles
asserted `status === 200` and discarded everything else, which is why a
hundred-second request left a number behind and no account of itself. They now
record what k6 always knew and nobody read: the per-phase breakdown.

| Metric | Time in it means |
| --- | --- |
| `phase_waiting` | the server thinking — the only phase its request log should agree with |
| `phase_blocked` | waiting for a connection slot or a dial, **before** the server is handed anything |
| `phase_connecting` | the TCP handshake |

Failures and slow requests print `error_code`, `status`, the dominant phase and
the body. `error_code` is the single most localising field k6 offers and was
never captured; status `0` alone cannot tell a timeout from a refused dial.

**What this predicts, written down before the run so it can be wrong.** If the
ten-second cluster is `blocked` or `connecting`, these requests never reached
the application and the direction recorded above becomes a finding. If it is
`waiting`, the application is lying in its own request log and this defect is
somewhere entirely different. The classifier is unit-tested against DEF-08's
own numbers — 10,070 ms with the server reporting 31 ms — in
[`tests/smoke/k6Diagnostics.api.spec.ts`](../../tests/smoke/k6Diagnostics.api.spec.ts),
so the interpretation is verified even though the measurement is not.

**Still outstanding, and it is now one thing.** k6 is not installed on this
machine, so no instrumented run exists. The scripts are written and their
logic is tested; they have not been executed. That distinction is kept
deliberately — the compose stack in the application repository is shipped
untested and says so, and this should not quietly become a second one.

**Later evidence, from a different direction.** A process left up for about
three hours began failing pool acquisitions outright, with
`Connection terminated unexpectedly` as the cause — an existing pooled
connection dropping, not a request queueing behind others. Restarting the
process cleared it. Whatever is interfering with connections here does so
over time and is not a function of load alone, which narrows this further
away from the pool-sizing explanation that was first recorded.
See [DEF-19](#def-19).

**Why a p95 would have hidden all of this.** Every p95 threshold in the profile
passed, on both runs. The measurement that found it was the maximum.

---

## DEF-09

**An occurrence count of zero was accepted and silently meant "never ends"**

| | |
| --- | --- |
| Severity | Medium |
| Priority | P1 |
| Status | Fixed — `eccba38` |
| Component | Alarm schema, validation |
| Requirement | R-31 |
| Environment | All |
| Found by | **The automated suite, on its first proper run** |

**Steps to reproduce.** `POST /alarms` with `endAfterOccurrences: 0`.

**Expected.** 422, with the error naming `endAfterOccurrences`. Zero
occurrences is not a series.

**Actual.** 201, and an alarm that never ends. The request was accepted and
quietly meant something else — the worst of the available outcomes, because the
caller has no indication anything went wrong and the alarm fires forever.

**Root cause.** The same trap as DEF-04, a fortnight later.
`Type.Union([Type.Integer(), Type.Null()])` compiles to `anyOf`; Ajv tried the
integer branch, failed its `minimum`, then satisfied the null branch by
coercing `0` into `null`. And `null` is how this schema spells "no limit".

`1001` was refused correctly throughout, because nothing coerces it to null —
which is why a test of only the upper bound would have passed and reported the
field as sound. Both ends, or neither.

**Fix.** `endAfterOccurrences` and `repeatEvery` are nullable integer types
rather than unions. A nullable type applies its `minimum` only to numbers, so
`null` still passes and `0` is refused.

**Regression coverage.** TC60, in `tests/alarms/validation.api.spec.ts`:
occurrence counts of 1 and 1000 are accepted, 0 and 1001 are not. The spec
stands unchanged from the run in which it failed, because it was right.

**Two things worth noting beyond the fix.** It is the first fault in the
application that nobody had found by using it, caught within seconds of the
first suite run. And TC60 is a **P3** case — the lowest priority in the
boundary set — which found the highest-impact silent fault in the register.
Priority is a reasonable guide to what to write first and a poor predictor of
what will fail.

---

## DEF-10

**An alarm could not be created without first creating a group**

| | |
| --- | --- |
| Severity | Medium |
| Priority | P2 |
| Status | Fixed — `f23d12b` |
| Component | Dashboard, routing |
| Requirement | R-31, R-33 |
| Environment | All |
| Found by | Trying to make an alarm on a new account |

**Steps to reproduce.** Sign in to an account with no groups. Try to create an
alarm from the dashboard.

**Expected.** An alarm can be created without choosing where it belongs.
Alarms without a group are a supported, documented state.

**Actual.** No route in. Every path to the wizard went through a group first,
so the feature that lets an alarm exist without one was reachable only by
opening Unfiled and creating it there — deciding where something belongs before
deciding what it is, which is backwards for anything made in the moment.

**Root cause.** The capability was added at the schema, the API and the data
model, and the interface was never given an entry point to match. A feature
that exists everywhere except where someone would use it.

**Fix.** A New alarm button on the dashboard, going straight to the wizard with
no group chosen.

**Regression coverage.** None yet. The groups set covers moving an alarm
between groups and out of one; the case that matters here is creating an alarm
from an account that has no groups at all, which belongs with whatever
exercises an empty account.

---

## DEF-11

**A CRLF checkout broke the container entrypoint**

| | |
| --- | --- |
| Severity | Medium |
| Priority | P3 |
| Status | Fixed — `6cbfbaa` |
| Component | Container build |
| Requirement | — (environment) |
| Environment | Docker image built from a Windows checkout |
| Found by | Reading the checkout settings |

**Steps to reproduce.** Clone on Windows with default Git settings. Build the
image. Run it.

**Expected.** The entrypoint executes.

**Actual.** It does not. A CRLF shebang fails inside a Linux image, and the
error does not say so.

**Root cause.** Git on Windows checks out text files with CRLF by default. A
shell script is a text file to Git and a binary contract to the kernel.

**Fix.** `.gitattributes` normalises the repository to LF, and names
`*.sh` and `*.sql` explicitly, because both are read by Linux containers.

**Regression coverage.** None. The container environment is unverified by the
project's own admission and nothing in CI builds the image — which makes this
the one defect in the register whose fix is itself untested.

---

## DEF-12

**Signing out landed on the sign-in form**

| | |
| --- | --- |
| Severity | Low |
| Priority | P3 |
| Status | Fixed — `f23d12b` |
| Component | Navigation |
| Requirement | — (usability) |
| Environment | All |
| Found by | Signing out |

**Expected.** Leaving takes you to the front door.

**Actual.** It took you to the sign-in form, as though the point of leaving
were to come straight back.

**Root cause.** Correct when written — the sign-in form was the only signed-out
page that existed. A landing page was added later and nothing revisited where
sign-out pointed. A defect created by an addition elsewhere, which is the kind
regression testing exists for and the kind no changelog flags.

**Fix.** Sign-out goes to the landing page.

**Regression coverage.** None. An assertion on the post-sign-out URL is cheap
and belongs with the authentication set.

---

## DEF-13

**No way back from the signed-out forms but the browser's back button**

| | |
| --- | --- |
| Severity | Low |
| Priority | P3 |
| Status | Fixed — `ce65e1c` |
| Component | Signed-out layout |
| Requirement | — (usability) |
| Environment | All |
| Found by | Opening the sign-in page and changing my mind |

**Expected.** The logo in the top left goes home, as it has on every website
for twenty years.

**Actual.** The lockup was decoration. Someone who opened the sign-in page and
thought better of it had the browser's back button and nothing else.

**Fix.** The lockup is a link to the landing page on all five signed-out forms,
styled to stay a mark rather than become a link: inherited colour, no
underline, the wordmark picking up the accent on hover, and a focus ring offset
far enough to sit around the whole lockup rather than crop it.

**Regression coverage.** None. Worth one assertion per signed-out page, which
a loop over five routes covers in four lines.

---

## DEF-14

**The alarms table was announced as "this folder" on a page that is not one**

| | |
| --- | --- |
| Severity | Low |
| Priority | P3 |
| Status | Fixed — `418867e` |
| Component | Alarms table, accessible caption |
| Requirement | — (accessibility) |
| Environment | All; screen readers only |
| Found by | Reading the Unfiled page's markup |

**Expected.** The caption describes the page it is on.

**Actual.** It fell back to "this folder" on the Unfiled page, which is
explicitly not a folder — the whole point of that page is that these alarms
have none.

**Root cause.** A default written when every alarms table had a folder to name.
Making alarms work without one left the fallback describing a case it was never
designed for.

**Why it survived.** A screen reader is the only thing that reads this string.
Nothing visible was wrong, so nothing visible flagged it, and the first pass
over the page did not catch it.

**Fix.** The caption names the unfiled case directly.

**Regression coverage.** None, and this is the clearest argument in the
register for the accessibility work that is currently deferred: an automated
check of accessible names would have caught it without anyone thinking to look.

---

## DEF-15

**A documented rule the application no longer had**

| | |
| --- | --- |
| Severity | Low |
| Priority | P2 |
| Status | Fixed — `58d3601` |
| Component | README, rule A-08 |
| Requirement | A-08 |
| Environment | — |
| Found by | Reading the rules table in order to write the framework from it |

**Expected.** The documented rules describe the application.

**Actual.** A-08 claimed an alarm cannot be created before a folder exists.
That had been true, and was the entire point of the setup dependency, until
alarms were allowed to exist without a group — and nobody updated the sentence.
The engine suite count was stale too: 30 tests, not 21.

**Why this is a defect and not a typo.** The rules table is the specification
the test framework is written against. A framework built from it would have
asserted a rule the application does not have, failed, and been believed —
sending somebody to fix working behaviour. A wrong specification does not
produce no tests. It produces confident wrong ones.

**Fix.** A-08 now states that an alarm no longer needs a group, and points at
the section describing it.

**Regression coverage.** None available by automation — this is documentation
drifting from behaviour, and the only instrument is the mapping exercise that
caught it. Doing that mapping deliberately, rather than as a side effect of
needing the numbers, is what the traceability matrix is for.

---

## DEF-16

**A failing mail check reported no reason**

| | |
| --- | --- |
| Severity | Low |
| Priority | P3 |
| Status | Fixed — `57ab801` |
| Component | `GET /health`, mail transport |
| Requirement | T-04 |
| Environment | Deployed instance |
| Found by | Trying to diagnose DEF-02 and having nothing to go on |

**Expected.** A failing check says what failed.

**Actual.** `reachable: false` and nothing else. Wrong credentials, a blocked
port and an unreachable host were indistinguishable — three different problems
with three different fixes, reported identically.

**Fix.** The failure is logged and surfaced in health, where the error code
distinguishes them: `EAUTH` for bad credentials, `ETIMEDOUT` or `ECONNREFUSED`
for a port that never opened.

**Regression coverage.** None, and low value — this is diagnosability rather
than behaviour. It earns its place in the register because it is part of why
DEF-02 took as long to find as it did, and because "the system cannot tell you
why it is unhappy" is a defect class in its own right.

---

## DEF-17

**Sixteen requirements are cited by the test cases and written down nowhere**

| | |
| --- | --- |
| Severity | Low |
| Priority | P2 |
| Status | Fixed — `76ef520` |
| Component | Requirements, README |
| Requirement | R-13 to R-28 |
| Environment | — |
| Found by | Looking across both repositories for one authoritative list |

**Steps to reproduce.** Collect every `R-nn` referenced in `docs/test-cases/`
and `tests/`. Compare against the rules table in the application README.

**Expected.** Every requirement a case claims to verify has text somewhere
saying what it requires.

**Actual.** The README documents R-01 to R-12. The cases and specs cite R-01 to
R-34. R-29 to R-34 have text in
[requirement-mapping.md](../test-cases/requirement-mapping.md), added when
mapping exposed that the documented rules were almost entirely about refusal.
**R-13 to R-28 have an identifier and no definition.** They were derived from
the application's behaviour while the cases were being written, and the numbers
were recorded while the sentences were not.

**Why it matters now.** A traceability matrix maps requirements to cases to
specs to runs. Sixteen of its rows currently have no left-hand side. The matrix
cannot be built correctly on top of this, and building it anyway would produce
a document that looks complete and traces nothing — the same failure as DEF-15,
one layer up.

**Proposed fix.** Write R-13 to R-28 out in full and put the whole set, R-01 to
R-34, in one place that both repositories cite. The application README is the
natural home, since R-01 to R-12 already live there and the mapping document
already says the rest belong beside them.

**Fixed.** R-13 to R-28 are written out in the application README beside
R-01 to R-12, and R-29 to R-34 moved there from the framework's mapping
document, so all thirty-four share one place. Every figure was taken from the
code rather than remembered — ten characters for a password, fifteen minutes
and five attempts for a verification code, ten failed sign-ins per
fifteen-minute window, two hundred characters for a spoken message.

**Regression coverage.** Structural:
[](../../scripts/traceability.py) reads the
requirements out of that table, so a requirement cited by a case and missing
from it appears in the matrix as a row with no rule rather than passing
unnoticed.

---

## DEF-18

**Authentication throughput is bounded by scrypt on four threads**

| | |
| --- | --- |
| Severity | Informational |
| Priority | — |
| Status | By design; now documented |
| Component | `src/api/src/auth/password.ts` |
| Requirement | — (non-functional) |
| Environment | Local, one process |
| Found by | `k6 run k6/auth.js`, after the browser suite stalled |

**Measured.** 81 requests a second against `POST /auth/login`, against 495 for
an endpoint doing comparable computation without hashing — roughly six times
the cost per request. 6,523 requests at 20 virtual users, no failures, p95
236 ms.

**Why.** Passwords are hashed with scrypt at `N=16384, r=8, p=1`. It is
memory-hard by design — that is the point of the algorithm — and it runs on
Node's libuv thread pool, which is four threads by default.

**Not a defect.** Recorded because the consequence is not obvious from the
number: concurrent sign-ins occupy that pool and slow requests that have
nothing to do with authentication. That is exactly how it was first noticed.
The browser suite signed in once per test, queued around fourteen hash
operations across four threads, and the whole application appeared to hang —
which looked like a product defect and was not. Writing it down is what stops
the next person spending a day on it.

**What it changed.** The framework signs in once per *worker* rather than once
per test, through the worker-scoped `workerUser` and `authState` fixtures in
`src/fixtures.ts`. Four workers, four sign-ins, reused `storageState`.

**What it means if it ever does become a defect.** The ceiling moves with
`UV_THREADPOOL_SIZE` or with more processes, not by weakening the hash. Anyone
tempted to lower `N` to make this graph look better should read this entry
first.

---

## DEF-19

**A database connection the pool cannot obtain becomes an unhandled 500**

| | |
| --- | --- |
| Severity | Medium |
| Priority | P2 |
| Status | Fixed — `2c28e4e` |
| Component | `src/api/src/db/pool.ts`, error handling |
| Requirement | — (non-functional) |
| Environment | Local, a process that had been up about three hours |
| Found by | **The suite**, failing five specs that had passed all day |

**Steps to reproduce.** Leave the application running for a few hours under
intermittent load. Run the suite.

**Expected.** If the pool cannot produce a connection, the caller is told so in
terms it can act on — 503, and a signal that retrying is reasonable.

**Actual.** Five specs failed on `Creating a throwaway user failed: 500`. The
application logged `Unhandled error` with
`Connection terminated due to connection timeout: Connection terminated
unexpectedly`, and a response time of **5,051 ms** — the acquisition timeout
exactly. Restarting the process made the suite green again: 48 passing.

**Two separate faults, and only the second is this entry.**

*Connections are dying and the pool is not recovering.* The cause under the
timeout is `Connection terminated unexpectedly` — an existing pooled
connection dropped, not a queue. Over hours the pool shrinks until acquisition
cannot succeed. That belongs with [DEF-08](#def-08), whose connection-layer
symptoms this matches, and it is still unexplained.

*A pool failure is reported as an unhandled 500.* This part is plainly wrong
regardless of what kills the connections. A caller cannot distinguish "the
server is briefly out of connections, try again" from "your request was
wrong", and the two want opposite responses. 503 with `Retry-After`, and the
error caught where it is raised rather than reaching the generic handler.

**Note on provenance.** The acquisition timeout that produced this 500 was
added as a hardening change against DEF-08 — it converted a hang into an
error, exactly as specified. Doing so made a pre-existing problem visible and
made the suite fail. That is the change working, not misfiring: a hang is not
better than an error, it is only quieter. But the fix was half of one, and
this entry is the other half.

**The fix.** `pool.query`, and the `connect` inside `withTransaction`, now
translate an acquisition failure into a 503 carrying `Retry-After` — caught
where it is raised rather than at the generic handler, as this entry asked. The
handler logs it as a warning, because an unavailable database is an operational
event worth seeing in the logs; that much the 500 got right.

Recognition is matched on the error *message*, because node-postgres gives an
acquisition timeout no code. That is fragile and the fragility points one way:
a message they rename stops being recognised and the caller gets the old 500
back — the behaviour being replaced, not something worse.

**Regression coverage, in two halves.** Seven unit tests in
`acquisitionFailure.test.ts` name the three messages this depends on, so a
rename upstream breaks a test instead of quietly restoring the defect.

The other half is the one that must not be got wrong: an error carrying a
`code` is a real query error and travels untouched, *even when its message
mentions a timeout*. Translating too eagerly would turn genuine faults into
"try again", and a caller would retry forever against a request that can never
succeed. The suite confirms that end to end — every conflict case still
answers 409.

**What is not covered.** No spec drives a real pool exhaustion and asserts the
503 over HTTP; doing so would need a fault-injection hook in the application,
which was not added. The status and the header are pinned at the point they
are decided, which is where a regression would originate, and the end-to-end
path keeps the incidental coverage it always had: any spec that creates a
throwaway account fails if this returns.

**This fixed the reporting, not the cause.** Connections are still dying and
the pool is still not recovering over hours. That remains with
[DEF-08](#def-08).

---

## DEF-20

**Completing registration, and completing a password reset, answered 500**

| | |
| --- | --- |
| Severity | High |
| Priority | P1 |
| Status | Fixed — `06bbcb9` |
| Component | `POST /auth/verify`, `POST /auth/reset-password` |
| Requirement | R-30 |
| Environment | All |
| Found by | **The first spec ever to walk the registration path** |

**Steps to reproduce.** Register an account. Enter the verification code.

**Expected.** The address is confirmed and the account is signed in.

**Actual.** 500, and "An unexpected error occurred" on the confirm screen.

**And the account was fine.** It had been created, the address had been
verified, and it signed in perfectly afterwards — the failure was entirely in
answering. So the person is told registration failed, by an application that
has just completed it. They retry, the code is now spent, and the second
attempt fails for real.

**Root cause.** Both routes answer `SessionSchema`, whose `UserSchema`
has required `role` and `tier` since those columns were added. Both select
only `id, email, name` and return a user without them, so
`fast-json-stringify` threw `"role" is required!` on the way out. Only
`POST /auth/login` was updated when the fields arrived.

Note where this fails: not on input validation, where a missing field is
reported as a 422 naming it, but on **response serialisation**, where it is an
unhandled 500. A schema that is enforced in both directions catches the
caller's mistakes loudly and its own quietly.

**The same shape as [DEF-06](#def-06).** A shared schema gained fields and not
every handler feeding it was found. That is twice now, which makes it a
pattern rather than an incident: the thing to check when a shared type changes
is every producer of it, and the compiler did not help because the row type
was written by hand to match the query.

**Why it went unnoticed for so long.** Registration was unexercised at any
layer. Every spec in the suite takes its account from `POST /test/users`,
which inserts a row directly — correct for a spec about something else, and it
meant nothing had ever walked the path a person walks. The reset-password half
is still unexercised and was found by reading, not by running.

**Regression coverage.** TC2 drives registration end to end through the
browser, including the code, and asserts the session afterwards. The
reset-password half has none.

---

## DEF-21

**The sign-in form had no client-side field validation, contrary to A-02**

| | |
| --- | --- |
| Severity | Low |
| Priority | P3 |
| Status | Fixed — `9416750` |
| Component | Sign-in form |
| Requirement | A-02, R-29 |
| Environment | All |
| Found by | **TC13, written against the documented rule rather than the behaviour** |

**Steps to reproduce.** Open the sign-in form. Enter an email, leave the
password blank, submit.

**Expected.** A-02: "Field-level validation with inline errors, client- and
server-side." The submission is refused, the error appears on the password,
and no request is sent.

**Actual.** The form posted the empty password, the server refused it, and the
result was a general banner that did not say which field was wrong. No field
error existed on that form at all — not even for the server's own field
errors, which the registration form had been mapping onto its fields all
along.

**Why it is only Low.** Nothing is at risk: the server refuses it either way.
The cost is a pointless round trip and an error that makes the person re-read
the form to work out which part of it the application is complaining about.

**Why it is worth a number anyway.** It is a documented rule that was not
true, which is the same class as [DEF-15](#def-15) — and the only reason it
was found is that the case was written from A-02 rather than from watching the
form. A test written by using the application first would have asserted the
banner and passed.

**The fix keeps the asymmetry.** The client checks emptiness only. Whether the
credentials are *right* stays on the server, which answers an unknown address
and a wrong password identically so the form cannot be used to discover which
addresses have accounts.

**Regression coverage.** TC13, which asserts all three clauses — refused, on
the field, and that no request was made. The third is what makes it a browser
test: an API spec can only observe the request a correct implementation never
makes.

---

## DEF-22

**The create wizard scrolled sideways at phone width**

| | |
| --- | --- |
| Severity | Medium |
| Priority | P2 |
| Status | Fixed — `58f079b` |
| Component | Form layout |
| Requirement | R-31, A-02 |
| Environment | Any viewport under about 560px |
| Found by | **TC50, at 390px** |

**Steps to reproduce.** Open the create wizard at 390px wide. Scroll sideways.

**Actual.** The page is 592px wide in a 390px viewport. The spoken-message
input renders 546px and pushes everything past the edge, so the form scrolls
horizontally and part of it sits off-screen.

**Root cause, in two parts, and the first hid the second.** Inputs took an
intrinsic width rather than filling their field — which at desktop width fits
inside the card and looks deliberate. And `.field` carried `flex: 0 0 auto`,
so it could not shrink below its content at all. Setting `width: 100%` on the
inputs alone changed nothing, because 100% of a 546px field is still 546px.

That second part is the interesting one. The rule's own comment explains it
was written to stop fields *growing* to fill the card. Setting shrink to `0`
as well stopped them getting smaller than their content, which is a different
wish that nobody expressed.

**How it was diagnosed.** By measuring the ancestor chain of the overflowing
element, not by reading the stylesheet: the field was 546px inside a 324px
fieldset. A child wider than its parent is a shrink problem, and that reading
is what made the second cause visible after the obvious fix did nothing.

**Why no one had noticed.** Every other form field is outside a fieldset and
narrow enough to fit, and the application is developed on a desktop. A
phone-width check is a thing you do or do not do; it is not a thing you
stumble into.

**Regression coverage.** TC50 asserts no horizontal overflow on the dashboard
and the wizard at 390px, and that the controls stay reachable — reachable, not
visible without scrolling, because a form taller than a phone is ordinary.

---

## Filing a defect

The fields above are the template. Two of them are routinely missing from
defect reports and matter most here:

- **How found.** Not credit — diagnosis. A register where everything was found
  by exploratory testing is telling you where the automation is not.
- **Regression coverage.** What stops it coming back, named specifically, or
  the honest word *none*. A fixed defect with no guard is a defect with a
  schedule.

Severity is argued. Priority is negotiated.
