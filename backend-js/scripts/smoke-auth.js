import { randomUUID } from 'node:crypto';
import { loadSettings } from '../src/core/config.js';
import { createPrismaClient } from '../src/db/client.js';

const base = process.env.SMOKE_API_BASE || 'http://127.0.0.1:8000';
const identifier = randomUUID().replaceAll('-', '');
const email = `smoke+${identifier}@example.com`;
const username = `smoke_${identifier}`;
const password = `smoke-password-${identifier}`;
const prisma = createPrismaClient(loadSettings().databaseUrl);
let createdId;

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = response.status === 204 || response.status === 202 ? null : await response.json();
  return { response, body };
}

try {
  const registered = await call('/api/v1/auth/password/register', {
    method: 'POST',
    body: JSON.stringify({ display_name: 'Smoke Test', username, email, password, account_type: 'student' }),
  });
  if (registered.response.status !== 201) throw new Error(`registration: ${registered.response.status} ${JSON.stringify(registered.body)}`);
  createdId = registered.body.id;
  const duplicate = await call('/api/v1/auth/password/register', {
    method: 'POST', body: JSON.stringify({ display_name: 'Smoke Test', username, email, password, account_type: 'student' }),
  });
  if (duplicate.response.status !== 409) throw new Error('duplicate registration: ' + duplicate.response.status);
  const loggedIn = await call('/api/v1/auth/password/login', {
    method: 'POST', body: JSON.stringify({ identifier: email, password }),
  });
  if (loggedIn.response.status !== 200) throw new Error(`login: ${loggedIn.response.status} ${JSON.stringify(loggedIn.body)}`);
  const access = loggedIn.body.access_token;
  const cookie = loggedIn.response.headers.get('set-cookie')?.split(';')[0];
  const me = await call('/api/v1/me', { headers: { Authorization: `Bearer ${access}` } });
  if (me.response.status !== 200 || me.body.id !== createdId) throw new Error(`me: ${me.response.status}`);
  const sessions = await call('/api/v1/auth/sessions', { headers: { Authorization: `Bearer ${access}` } });
  if (sessions.response.status !== 200 || sessions.body.length !== 1) throw new Error(`sessions: ${sessions.response.status}`);
  const refresh = await call('/api/v1/auth/refresh', { method: 'POST', headers: { Cookie: cookie } });
  if (refresh.response.status !== 200) throw new Error(`refresh: ${refresh.response.status} ${JSON.stringify(refresh.body)}`);
  const replay = await call('/api/v1/auth/refresh', { method: 'POST', headers: { Cookie: cookie } });
  if (replay.response.status !== 401) throw new Error(`replay: ${replay.response.status}`);
  const afterReplay = await call('/api/v1/me', { headers: { Authorization: `Bearer ${refresh.body.access_token}` } });
  if (afterReplay.response.status !== 401) throw new Error(`revocation: ${afterReplay.response.status}`);
  console.log(JSON.stringify({ register: 201, duplicate: 409, login: 200, me: 200, sessions: 200, refresh: 200, replay: 401, revokedAfterReplay: 401 }));
} finally {
  if (createdId) {
    const user = await prisma.user.findUnique({ where: { id: createdId } });
    if (user?.primaryEmail === email) await prisma.user.delete({ where: { id: createdId } });
  }
  await prisma.$disconnect();
}
