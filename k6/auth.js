import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { API } from './lib/session.js';

/**
 * Signing in, concurrently, on purpose.
 *
 * Every other script shares one session precisely to avoid this. This one
 * measures it, because it is a real characteristic of the application rather
 * than an accident of the test: passwords are hashed with scrypt, which is
 * memory-hard by design and runs on Node's libuv thread pool - four threads
 * unless told otherwise.
 *
 * So authentication throughput has a ceiling that has nothing to do with the
 * database or the network, and concurrent sign-ins stall unrelated requests by
 * occupying the pool. This was first noticed when the browser suite signed in
 * once per test and the whole application slowed down.
 *
 * Expect this to be slow. The question is where it flattens.
 */

const signIn = new Trend('endpoint_signin', true);

export const options = {
  stages: [
    { duration: '15s', target: 5 },
    { duration: '20s', target: 5 },
    { duration: '15s', target: 20 },
    { duration: '20s', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const response = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: 'user-one@example.com', password: 'Password123!' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login' } },
  );
  signIn.add(response.timings.duration);
  check(response, { 'signed in': (r) => r.status === 200 });
}
