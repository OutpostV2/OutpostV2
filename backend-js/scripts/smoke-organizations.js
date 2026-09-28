import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadSettings } from '../src/core/config.js';
import { createPrismaClient } from '../src/db/client.js';

const base = process.env.SMOKE_API_BASE || 'http://127.0.0.1:8000';
const nonce = randomUUID().replaceAll('-', '');
const prisma = createPrismaClient(loadSettings().databaseUrl);
const users = [];
const organizations = [];
let summary;

async function send(path, method = 'GET', body, token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = response.status === 204 ? null : await response.json();
  return { status: response.status, value };
}
async function expectStatus(status, path, method = 'GET', body, token) {
  const result = await send(path, method, body, token);
  assert.equal(result.status, status, `${method} ${path}: expected ${status}, got ${result.status}`);
  return result.value;
}
async function coordinator(label) {
  const email = `phase12+${label}+${nonce}@example.edu`;
  const password = `smoke-${nonce}`;
  const user = await expectStatus(201, '/api/v1/auth/password/register', 'POST', {
    display_name: `Phase 12 ${label}`, username: `phase12_${label}_${nonce}`,
    email, password, account_type: 'coordinator',
  });
  users.push({ id: user.id, email });
  const login = await expectStatus(200, '/api/v1/auth/password/login', 'POST', { identifier: email, password });
  return { ...user, email, token: login.access_token };
}

try {
  const owner = await coordinator('owner');
  const staff = await coordinator('staff');
  const outsider = await coordinator('outsider');
  await prisma.user.update({ where: { id: staff.id }, data: { emailVerifiedAt: new Date() } });
  const firstName = `Phase 12 Campus ${nonce.slice(0, 8)}`;
  const otherName = `Phase 12 Other ${nonce.slice(0, 8)}`;
  const first = await expectStatus(201, '/api/v1/organizations', 'POST', { name: firstName }, owner.token);
  const other = await expectStatus(201, '/api/v1/organizations', 'POST', { name: otherName }, outsider.token);
  organizations.push({ id: first.id, name: firstName }, { id: other.id, name: otherName });
  const path = `/api/v1/organizations/${first.id}`;
  await expectStatus(403, `${path}/members`, 'GET', undefined, staff.token);
  const invite = await expectStatus(201, `${path}/invitations`, 'POST', { email: staff.email, role: 'mentor' }, owner.token);
  assert.ok(invite.code.length >= 40);
  const listed = await expectStatus(200, `${path}/invitations`, 'GET', undefined, owner.token);
  assert.equal(listed[0].code, undefined);
  await expectStatus(403, '/api/v1/organization-invitations/accept', 'POST', { code: invite.code }, outsider.token);
  await expectStatus(200, '/api/v1/organization-invitations/accept', 'POST', { code: invite.code }, staff.token);
  await expectStatus(404, '/api/v1/organization-invitations/accept', 'POST', { code: invite.code }, staff.token);
  const member = (await expectStatus(200, `${path}/members`, 'GET', undefined, owner.token))
    .find((row) => row.user_id === staff.id);
  assert.equal(member.role, 'mentor');
  await expectStatus(404, `/api/v1/organizations/${other.id}/members/${member.id}`, 'PATCH', { status: 'inactive' }, outsider.token);
  await expectStatus(200, `${path}/members/${member.id}`, 'PATCH', { status: 'inactive' }, owner.token);
  assert.equal((await expectStatus(200, '/api/v1/organizations', 'GET', undefined, staff.token)).some((row) => row.id === first.id), false);
  await expectStatus(409, `${path}/ownership-transfer`, 'POST', { membership_id: member.id }, owner.token);
  await expectStatus(200, `${path}/members/${member.id}`, 'PATCH', { status: 'active' }, owner.token);
  await expectStatus(200, `${path}/ownership-transfer`, 'POST', { membership_id: member.id }, owner.token);
  await expectStatus(403, `${path}/members`, 'GET', undefined, owner.token);
  await expectStatus(200, `${path}/members`, 'GET', undefined, staff.token);
  summary = { invitation: 'single-use', tenant: 'denied', inactive: 'denied', transfer: 'verified' };
} finally {
  for (const organization of organizations) {
    const row = await prisma.organization.findUnique({ where: { id: organization.id } });
    if (row?.name === organization.name) await prisma.organization.delete({ where: { id: organization.id } });
  }
  for (const identity of users) {
    const row = await prisma.user.findUnique({ where: { id: identity.id } });
    if (row?.primaryEmail === identity.email) await prisma.user.delete({ where: { id: identity.id } });
  }
  await prisma.$disconnect();
}
console.log(JSON.stringify(summary));
