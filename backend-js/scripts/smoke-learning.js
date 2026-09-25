import { randomUUID } from 'node:crypto';
import { loadSettings } from '../src/core/config.js';
import { createPrismaClient } from '../src/db/client.js';

const base = process.env.SMOKE_API_BASE || 'http://127.0.0.1:8000';
const nonce = randomUUID().replaceAll('-', '');
const prisma = createPrismaClient(loadSettings().databaseUrl);
const identities = [];
let organizationId;
const organizationName = `Smoke College ${nonce.slice(0, 8)}`;

async function call(path, method = 'GET', body, token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = response.status === 204 || response.status === 202 ? null : await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}

async function identity(role) {
  const email = `smoke+${role}+${nonce}@example.com`;
  const username = `smoke_${role}_${nonce}`;
  const password = `smoke-password-${nonce}`;
  const user = await call('/api/v1/auth/password/register', 'POST', {
    display_name: role === 'student' ? 'Smoke Student' : 'Smoke Coordinator',
    username, email, password, account_type: role,
  });
  identities.push({ id: user.id, email });
  const login = await call('/api/v1/auth/password/login', 'POST', { identifier: email, password });
  return { user, token: login.access_token };
}

try {
  const coordinator = await identity('coordinator');
  const student = await identity('student');
  const organization = await call('/api/v1/organizations', 'POST', { name: organizationName }, coordinator.token);
  organizationId = organization.id;
  const roadmap = await call(`/api/v1/organizations/${organizationId}/roadmaps`, 'POST', {
    name: 'Smoke Roadmap', topics: [{ title: 'First topic' }, { title: 'Second topic' }],
  }, coordinator.token);
  const cohort = await call(`/api/v1/organizations/${organizationId}/cohorts`, 'POST', {
    name: 'Smoke Cohort', roadmap_version_id: roadmap.version_id,
  }, coordinator.token);
  await call('/api/v1/cohorts/join', 'POST', { invite_code: cohort.invite_code }, student.token);
  const before = await call('/api/v1/progress/me', 'GET', undefined, student.token);
  if (before[0]?.total !== 2 || before[0]?.completed !== 0) throw new Error('Initial progress differs');
  await call(`/api/v1/progress/topics/${roadmap.topics[0].id}`, 'PUT', { completed: true }, student.token);
  const after = await call('/api/v1/progress/me', 'GET', undefined, student.token);
  const report = await call(`/api/v1/cohorts/${cohort.id}/progress`, 'GET', undefined, coordinator.token);
  if (after[0]?.completed !== 1 || after[0]?.percent !== 50 || report.students[0]?.percent !== 50) {
    throw new Error('Progress report differs');
  }
  console.log(JSON.stringify({ organization: 201, roadmap: 201, cohort: 201, joined: 200, progress: 50, report: 50 }));
} finally {
  if (organizationId) {
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (organization?.name === organizationName) await prisma.organization.delete({ where: { id: organizationId } });
  }
  for (const identity of identities) {
    const user = await prisma.user.findUnique({ where: { id: identity.id } });
    if (user?.primaryEmail === identity.email) await prisma.user.delete({ where: { id: identity.id } });
  }
  await prisma.$disconnect();
}
