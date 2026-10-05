import http from 'k6/http';

/**
 * Signing in, once, for the whole test run.
 *
 * Deliberately not per virtual user. The application hashes passwords with
 * scrypt, which is memory-hard by design and runs on Node's four-thread pool,
 * so a hundred virtual users each signing in would measure the hashing rather
 * than the endpoints under test. One session is established in setup() and
 * shared, which keeps the load on the thing being measured.
 *
 * Authentication throughput is worth measuring — it is just a different test,
 * and auth.js does it on purpose.
 */

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8080';
export const API = `${BASE_URL}/api/v1`;

const SEEDED = {
  email: __ENV.K6_EMAIL || 'user-one@example.com',
  password: __ENV.K6_PASSWORD || 'Password123!',
};

/** Signs in and returns what a virtual user needs to act as that account. */
export function signIn(credentials = SEEDED) {
  const response = http.post(`${API}/auth/login`, JSON.stringify(credentials), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /auth/login' },
  });

  if (response.status !== 200) {
    throw new Error(`Could not sign in as ${credentials.email}: ${response.status} ${response.body}`);
  }

  const body = response.json();
  const cookies = response.cookies;

  return {
    cookie: `sid=${cookies.sid[0].value}; csrf=${cookies.csrf[0].value}`,
    csrfToken: body.csrfToken,
    userId: body.user.id,
  };
}

/** Headers for a read. */
export function headers(session) {
  return {
    Cookie: session.cookie,
    'Content-Type': 'application/json',
  };
}

/** Headers for a write, which the API refuses without the CSRF token. */
export function writeHeaders(session) {
  return {
    ...headers(session),
    'X-CSRF-Token': session.csrfToken,
  };
}

/** A schedule heavy enough that the recurrence engine does real work. */
export function previewBody(limit = 50) {
  return JSON.stringify({
    timeOfDay: '09:00',
    timezone: 'America/Toronto',
    startDate: '2027-01-04',
    endTimeOfDay: '17:00',
    repeatEvery: 15,
    repeatUnit: 'minutes',
    rule: { type: 'weekly', byWeekday: ['MO', 'TU', 'WE', 'TH', 'FR'] },
    limit,
  });
}
