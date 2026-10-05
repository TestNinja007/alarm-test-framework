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

These belong in the application README beside R-01 to R-28, so the plan, the
cases and the source keep sharing one set of numbers.

## Still uncovered by any case

Listed so the gap is visible rather than implied. All are P1 by the plan's own
criterion — they fail silently.

| Requirement | Subject |
| --- | --- |
| R-04 | `monthly_day` skipping months too short for the date |
| R-05 | `monthly_nth`, including months with no fifth weekday |
| R-06 | Spring forward — a local time that does not exist |
| R-07 | Fall back — a local time that happens twice |
| R-08 | Two enabled alarms refused the same instant |
| R-27 | A self-destructing alarm removing itself |
| — | Within-day repetition at second and minute intervals |

The last one has no requirement number yet and is one of the product's two
stated differentiators.
