# Alarm Configurator — test framework

End-to-end, API and integration tests for
[alarm-configurator](https://github.com/TestNinja007/alarm-configurator).

The application under test is deliberately separate from this repository: it
knows nothing about these tests, and these tests reach it only through its
public surface — the UI, the REST API, and the database.

## Layout

| | |
| --- | --- |
| `docs/test-cases/` | Test design. The canonical copy, version-controlled and reviewable. |
| `tests/` | The executable tests. |
| `fixtures/` | Setup, teardown and shared helpers. |

## The system under test

Running locally, with test hooks on:

```
TEST_SUPPORT=1 MAIL_TRANSPORT=capture TTS_PROVIDER=mock npm start
```

Its README documents the rules the tests verify — R-01 to R-12, A-01 to A-08,
T-01 to T-04 — along with the test-ID convention, the seeded data and the
hooks for resetting the database and controlling the clock.
