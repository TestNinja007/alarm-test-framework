import http from 'k6/http';
import { check, group } from 'k6';
import { Trend } from 'k6/metrics';
import { API, headers, previewBody, signIn, writeHeaders } from './lib/session.js';

/**
 * Normal load.
 *
 * What a working day looks like if a modest number of people have the
 * application open: every tab polls for what is coming up every thirty
 * seconds, and some of them are building a schedule and watching the preview
 * recalculate.
 *
 * The endpoints are chosen because they compute rather than fetch. Listing
 * alarms reads rows; previewing a schedule runs the recurrence engine, and the
 * conflicts endpoint compares every enabled alarm in a group against every
 * other across ninety days.
 */

const preview = new Trend('endpoint_preview', true);
const upcoming = new Trend('endpoint_upcoming', true);
const conflicts = new Trend('endpoint_conflicts', true);
const list = new Trend('endpoint_list', true);

export const options = {
  stages: [
    { duration: '20s', target: 20 },
    { duration: '1m', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    // Under normal load nothing should be failing at all.
    http_req_failed: ['rate<0.01'],
    // Separated by endpoint, because one slow computation hiding inside an
    // aggregate is exactly what a load test is supposed to surface.
    endpoint_preview: ['p(95)<400'],
    endpoint_upcoming: ['p(95)<400'],
    endpoint_conflicts: ['p(95)<800'],
    endpoint_list: ['p(95)<300'],
  },
};

export function setup() {
  const session = signIn();
  const response = http.get(`${API}/folders`, { headers: headers(session) });
  const groups = response.json().items;
  return { session, groupId: groups.length > 0 ? groups[0].id : null };
}

export default function (data) {
  const { session, groupId } = data;
  const read = { headers: headers(session) };

  group('poll for what is due', () => {
    const response = http.get(`${API}/me/upcoming?withinMinutes=60`, {
      ...read,
      tags: { name: 'GET /me/upcoming' },
    });
    upcoming.add(response.timings.duration);
    check(response, { 'upcoming answered': (r) => r.status === 200 });
  });

  group('preview a schedule', () => {
    // Preview is a POST, so the CSRF guard applies even though it changes nothing.
    const response = http.post(`${API}/alarms/preview`, previewBody(50), {
      headers: writeHeaders(session),
      tags: { name: 'POST /alarms/preview' },
    });
    preview.add(response.timings.duration);
    check(response, {
      'preview answered': (r) => r.status === 200,
      'preview returned occurrences': (r) => r.json().items.length > 0,
    });
  });

  group('list alarms', () => {
    const response = http.get(`${API}/alarms?pageSize=25`, {
      ...read,
      tags: { name: 'GET /alarms' },
    });
    list.add(response.timings.duration);
    check(response, { 'list answered': (r) => r.status === 200 });
  });

  if (groupId) {
    group('check for collisions', () => {
      const response = http.get(`${API}/folders/${groupId}/conflicts`, {
        ...read,
        tags: { name: 'GET /folders/{id}/conflicts' },
      });
      conflicts.add(response.timings.duration);
      check(response, { 'conflicts answered': (r) => r.status === 200 });
    });
  }
}
