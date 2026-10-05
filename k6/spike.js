import http from 'k6/http';
import { check } from 'k6';
import { API, headers, signIn } from './lib/session.js';

/**
 * Quiet, then suddenly not.
 *
 * Models what happens on the hour, when every open tab polls at once. The
 * question is not whether it is slow during the spike - it will be - but
 * whether it recovers afterwards, or stays degraded because a queue built up
 * that it never drains.
 */

export const options = {
  stages: [
    { duration: '20s', target: 5 },
    { duration: '5s', target: 100 },
    { duration: '20s', target: 100 },
    { duration: '5s', target: 5 },
    { duration: '40s', target: 5 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.1'],
  },
};

export function setup() {
  return { session: signIn() };
}

export default function (data) {
  const response = http.get(`${API}/me/upcoming?withinMinutes=60`, {
    headers: headers(data.session),
    tags: { name: 'GET /me/upcoming' },
  });
  check(response, { 'upcoming answered': (r) => r.status === 200 });
}
