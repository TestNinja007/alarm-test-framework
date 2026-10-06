# Requirement mapping

Which requirement each case verifies. The chain is requirement → case → spec →
run; this is its first link.

## The existing ten

| Case | Name | Verifies |
| --- | --- | --- |
| TC1 | Login to website | R-29 |
| TC2 | Create User | R-30 |
| TC3 | Create Alarm | R-31, R-24 |
| TC4 | Alarm Notification | R-32 |
| TC5 | Alarm Disable Button | R-28 |
| TC6 | Alarm Groups | R-20, R-23, R-33 |
| TC7 | Voice Clarity | R-25 (manual) |
| TC8 | Cross Browser Functionality | R-32 (manual) |
| TC9 | CRUD on Alarm | R-31, R-34 |
| TC10 | CRUD on Alarm Group | R-33 |

## What the mapping exposed

Six of those point at requirements that did not exist until now.

R-01 to R-28 were written from the application's documented rules, and those
rules are overwhelmingly about **refusal** — what is rejected, with which
status and which field error. Almost nothing stated the plain capability:
that a registered user can sign in, that an alarm can be created, that it
fires.

That is a normal thing for mapping to find, and it is the argument for doing
it. A requirement set made only of edge cases describes a product nobody can
use correctly.

## Added

| | |
| --- | --- |
| **R-29** | A registered and verified user who supplies the correct email and password is signed in and receives a session. |
| **R-30** | Registration with an unused address creates an unverified account and issues a six-digit code. Supplying that code verifies the account and signs the user in. |
| **R-31** | A signed-in user can create an alarm with a name, a time, a timezone, a start date and a recurrence rule. It appears in their list and in the occurrence preview. |
| **R-32** | An enabled alarm raises a browser notification at each occurrence and speaks its message, for as long as the application is open. |
| **R-33** | A group can be created, renamed and deleted. An alarm can be moved between groups, into a group from none, and out of a group to none. |
| **R-34** | An alarm can be edited and deleted by its owner, and only by its owner. |

These now live in the application README beside R-01 to R-28, which is where
R-13 to R-28 were written out too — they had been carried as numbers with no
sentences, which is DEF-17 and what blocked the matrix. The README is the one
set of numbers the plan, the cases and the source share.

The matrix built from them is [`docs/traceability.md`](../traceability.md),
generated rather than written.

## Still uncovered by any case

Nothing, now. Every one of the 34 requirements has at least one case against
it — see [the matrix](../traceability.md), which is generated and will say so
or not without anyone remembering to update this.

Thirteen requirements have a case and no spec, which is a different and
honester statement than the one this section used to make.

## One mapping worth a second look

`TC10b` in the groups spec asserts R-10 — that deleting a group deletes its
alarms and the confirmation names how many. But it is numbered against TC10
(CRUD on an alarm group), while R-10's own cases are TC30 and TC51. So the
matrix reports R-10 as having no spec, which is true by the numbering and
misleading about the coverage.

Left as it stands rather than quietly re-pointed: the case numbering belongs
to whoever designed the cases, and a matrix that is massaged to look complete
is the thing this document exists to prevent.
