import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadSettings } from '../src/core/config.js';
import { createPrismaClient } from '../src/db/client.js';

const base = process.env.SMOKE_API_BASE || 'http://127.0.0.1:8000';
const nonce = randomUUID().replaceAll('-', '');
const prisma = createPrismaClient(loadSettings().databaseUrl);
const identities = [];
const organizations = [];
let summary;

async function send(path, method = 'GET', body, token, cookie) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = response.status === 204 || response.status === 202 ? null : await response.json();
  return { status: response.status, value, setCookie: response.headers.get('set-cookie') };
}

async function call(path, method = 'GET', body, token) {
  const result = await send(path, method, body, token);
  if (result.status < 200 || result.status >= 300)
    throw new Error(`${method} ${path}: ${result.status} ${JSON.stringify(result.value)}`);
  return result.value;
}

async function expectStatus(expected, path, method = 'GET', body, token) {
  const result = await send(path, method, body, token);
  assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(result.value)}`);
  return result.value;
}

async function identity(role, label = role) {
  const email = `smoke+${label}+${nonce}@example.com`;
  const username = `smoke_${label}_${nonce}`;
  const password = `smoke-password-${nonce}`;
  const registration = {
    display_name: `Smoke ${label}`,
    username, email, password, account_type: role,
  };
  const user = await expectStatus(201, '/api/v1/auth/password/register', 'POST', registration);
  identities.push({ id: user.id, email });
  assert.equal(user.account_type, role);
  assert.equal(user.password, undefined);
  assert.equal(user.access_token, undefined);
  const conflict = await expectStatus(409, '/api/v1/auth/password/register', 'POST', registration);
  assert.equal(conflict.error.code, 'conflict');
  const login = await send('/api/v1/auth/password/login', 'POST', { identifier: email, password });
  assert.equal(login.status, 200);
  assert.ok(login.setCookie?.startsWith('outpost_refresh='));
  return { user, token: login.value.access_token, refreshCookie: login.setCookie.split(';', 1)[0], email, password };
}

try {
  const coordinator = await identity('coordinator');
  const student = await identity('student', 'student_a');
  const zeroStudent = await identity('student', 'student_b');
  const outsider = await identity('coordinator', 'outsider');
  await expectStatus(403, '/api/v1/organizations', 'POST', { name: 'Denied College' }, student.token);
  const organizationName = `Smoke College ${nonce.slice(0, 8)}`;
  const organization = await call('/api/v1/organizations', 'POST', { name: organizationName }, coordinator.token);
  organizations.push({ id: organization.id, name: organizationName });
  const outsiderName = `Smoke Other ${nonce.slice(0, 8)}`;
  const otherOrganization = await call('/api/v1/organizations', 'POST', { name: outsiderName }, outsider.token);
  organizations.push({ id: otherOrganization.id, name: outsiderName });
  const roadmap = await call(`/api/v1/organizations/${organization.id}/roadmaps`, 'POST', {
    name: 'Smoke Roadmap', topics: [{ title: 'First topic' }, { title: 'Second topic' }],
  }, coordinator.token);
  await expectStatus(403, `/api/v1/organizations/${organization.id}/roadmaps`, 'GET', undefined, outsider.token);
  await expectStatus(404, `/api/v1/organizations/${otherOrganization.id}/cohorts`, 'POST', {
    name: 'Wrong version', roadmap_version_id: roadmap.version_id,
  }, outsider.token);
  const cohort = await call(`/api/v1/organizations/${organization.id}/cohorts`, 'POST', {
    name: 'Smoke Cohort', roadmap_version_id: roadmap.version_id,
  }, coordinator.token);
  await expectStatus(403, '/api/v1/cohorts/join', 'POST', { invite_code: cohort.invite_code }, coordinator.token);
  await expectStatus(404, `/api/v1/progress/topics/${roadmap.topics[0].id}`, 'PUT', { completed: true }, student.token);
  await call('/api/v1/cohorts/join', 'POST', { invite_code: cohort.invite_code }, student.token);
  await call('/api/v1/cohorts/join', 'POST', { invite_code: cohort.invite_code }, zeroStudent.token);
  await call('/api/v1/cohorts/join', 'POST', { invite_code: cohort.invite_code }, zeroStudent.token);
  const before = await call('/api/v1/progress/me', 'GET', undefined, student.token);
  assert.equal(before[0]?.total, 2);
  assert.equal(before[0]?.completed, 0);
  const review = await call('/api/v1/review/overview', 'GET', undefined, zeroStudent.token);
  assert.equal(review.scenario, 'illustrative');
  const reviewed = await call('/api/v1/review/progress/goals', 'PUT', { completed: true }, zeroStudent.token);
  assert.equal(reviewed.student.completed, 1);
  const zeroLive = await call('/api/v1/progress/me', 'GET', undefined, zeroStudent.token);
  assert.equal(zeroLive[0]?.completed, 0);
  await expectStatus(204, `/api/v1/progress/topics/${roadmap.topics[0].id}`, 'PUT', { completed: true }, student.token);
  const refreshed = await send('/api/v1/auth/refresh', 'POST', undefined, undefined, student.refreshCookie);
  assert.equal(refreshed.status, 200);
  const restored = await call('/api/v1/progress/me', 'GET', undefined, refreshed.value.access_token);
  assert.equal(restored[0]?.completed, 1);
  await expectStatus(204, '/api/v1/auth/logout', 'POST', undefined, refreshed.value.access_token);
  await expectStatus(401, '/api/v1/me', 'GET', undefined, refreshed.value.access_token);
  const freshLogin = await call('/api/v1/auth/password/login', 'POST', {
    identifier: student.email, password: student.password,
  });
  const after = await call('/api/v1/progress/me', 'GET', undefined, freshLogin.access_token);
  const report = await call(`/api/v1/cohorts/${cohort.id}/progress`, 'GET', undefined, coordinator.token);
  assert.equal(after[0]?.completed, 1);
  assert.equal(after[0]?.percent, 50);
  assert.equal(report.students.length, 2);
  assert.equal(report.students.find((row) => row.id === student.user.id)?.percent, 50);
  assert.equal(report.students.find((row) => row.id === zeroStudent.user.id)?.percent, 0);
  assert.equal(report.average_percent, 25);
  await expectStatus(403, `/api/v1/cohorts/${cohort.id}/progress`, 'GET', undefined, zeroStudent.token);
  await expectStatus(403, `/api/v1/cohorts/${cohort.id}/progress`, 'GET', undefined, outsider.token);
  summary = { registration: 201, duplicate: 409, roles: 'denied', tenant: 'denied',
    enrollment: 2, completed: 1, zero_progress: 1, average_percent: 25, review_separate: true,
    refresh_restored_progress: true, reauthenticated_progress: true };
} finally {
  for (const organization of organizations) {
    const saved = await prisma.organization.findUnique({ where: { id: organization.id } });
    if (saved?.name === organization.name) await prisma.organization.delete({ where: { id: organization.id } });
    assert.equal(await prisma.organization.findUnique({ where: { id: organization.id } }), null);
  }
  for (const identity of identities) {
    const user = await prisma.user.findUnique({ where: { id: identity.id } });
    if (user?.primaryEmail === identity.email) await prisma.user.delete({ where: { id: identity.id } });
    assert.equal(await prisma.user.findUnique({ where: { id: identity.id } }), null);
  }
  await prisma.$disconnect();
}
console.log(JSON.stringify(summary));
