import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { errorHandler } from '../src/core/errors.js';
import { registerGoogleRoutes } from '../src/modules/auth/google.js';

const baseSettings = {
  env: 'test',
  googleClientId: 'test-client.apps.googleusercontent.com',
  googleClientSecret: 'test-only-secret',
  googleRedirectUri: 'https://api.example.com/api/v1/auth/google/callback',
  authSigningKey: 'test-signing-key-with-at-least-thirty-two-bytes',
};
const discovery = {
  issuer: 'https://accounts.google.com',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
};
let privateKey;
let publicJwk;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
});

function fakeRedis() {
  const values = new Map();
  return {
    values,
    async set(key, value, options) {
      if (options.NX && values.has(key)) return null;
      values.set(key, { value, options });
      return 'OK';
    },
    async getDel(key) {
      const entry = values.get(key);
      values.delete(key);
      return entry?.value ?? null;
    },
  };
}

function fakePrisma() {
  const users = [];
  const identities = [];
  const sessions = [];
  const events = [];
  const prisma = {
    user: {
      async findUnique({ where }) { return users.find((user) => user.id === where.id) ?? null; },
      async findFirst({ where }) {
        return users.find((user) => user.primaryEmail?.toLowerCase() === where.primaryEmail.equals.toLowerCase()) ?? null;
      },
      async create({ data }) {
        const user = { id: randomUUID(), status: 'active', accountType: 'student', username: null, ...data };
        users.push(user);
        return user;
      },
    },
    oauthIdentity: {
      async findUnique({ where }) {
        const key = where.provider_providerSubject;
        return identities.find((row) => row.provider === key.provider && row.providerSubject === key.providerSubject) ?? null;
      },
      async create({ data }) {
        const row = { id: randomUUID(), ...data };
        identities.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = identities.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    authSession: {
      async create({ data }) {
        const row = { ...data, revokedAt: null, replacedBySessionId: null };
        sessions.push(row);
        return row;
      },
    },
    securityEvent: { async create({ data }) { events.push(data); } },
    async $queryRaw() { return []; },
    async $transaction(callback) { return callback(prisma); },
  };
  return { prisma, users, identities, sessions, events };
}

async function signedToken(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: baseSettings.googleClientId,
    sub: 'stable-google-subject',
    nonce: 'expected-nonce',
    email: 'Person@Example.com',
    email_verified: true,
    name: 'Google Person',
    iat: now,
    exp: now + 300,
    ...claims,
  };
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
}

function fakeGoogle(idToken) {
  const calls = [];
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      if (url === 'https://accounts.google.com/.well-known/openid-configuration') return Response.json(discovery);
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ id_token: idToken });
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [publicJwk] });
      throw new Error('unexpected URL ' + url);
    },
  };
}

function appFor({ prisma, settings = baseSettings, redisClient, fetchImpl } = {}) {
  const app = express();
  app.use((_request, _response, next) => { _request.requestId = randomUUID(); next(); });
  registerGoogleRoutes(app, { prisma, settings, redisClient, fetchImpl });
  app.use(errorHandler);
  return app;
}

describe('Google OAuth/OIDC routes', () => {
  it('starts a no-store authorization with single-use Valkey state, nonce, and S256 PKCE', async () => {
    const redis = fakeRedis();
    const response = await request(appFor({ redisClient: redis })).get('/api/v1/auth/google/authorize');
    expect(response.status).toBe(302);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    const url = new URL(response.headers.location);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(baseSettings.googleClientId);
    expect(url.searchParams.get('redirect_uri')).toBe(baseSettings.googleRedirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const state = url.searchParams.get('state');
    const nonce = url.searchParams.get('nonce');
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(nonce.length).toBeGreaterThanOrEqual(43);
    expect(state).not.toBe(nonce);
    const entry = redis.values.get('outpost:oauth-state:v1:' + state);
    expect(entry.options).toEqual({ EX: 600, NX: true });
    const stored = JSON.parse(entry.value);
    expect(stored.nonce).toBe(nonce);
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(stored.codeVerifier).digest('base64url'),
    );
  });

  it('fails safely without Google credentials or Valkey', async () => {
    const missingCredentials = await request(appFor({ settings: {}, redisClient: fakeRedis() }))
      .get('/api/v1/auth/google/authorize');
    expect(missingCredentials.status).toBe(503);
    expect(missingCredentials.body.error.message).toBe('Google authentication is not configured');
    const missingValkey = await request(appFor()).get('/api/v1/auth/google/authorize');
    expect(missingValkey.status).toBe(503);
  });

  it('verifies a signed callback, creates one identity, issues a session, and rejects replay', async () => {
    const db = fakePrisma();
    const redis = fakeRedis();
    const google = fakeGoogle(await signedToken());
    const app = appFor({ prisma: db.prisma, redisClient: redis, fetchImpl: google.fetch });
    const state = 'callback-state';
    await redis.set('outpost:oauth-state:v1:' + state,
      JSON.stringify({ nonce: 'expected-nonce', codeVerifier: 'test-verifier-123456789012345678901234567890123' }),
      { EX: 600, NX: true });
    const callback = '/api/v1/auth/google/callback?state=' + state + '&code=one-time-code&iss=https%3A%2F%2Faccounts.google.com';
    const response = await request(app).get(callback);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ token_type: 'bearer', expires_in: 900 });
    expect(response.body.access_token).toBeTruthy();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie'][0]).toContain('outpost_refresh=');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(db.users).toHaveLength(1);
    expect(db.users[0].primaryEmail).toBe('person@example.com');
    expect(db.identities[0]).toMatchObject({
      userId: db.users[0].id, provider: 'google', providerSubject: 'stable-google-subject',
      providerEmail: 'person@example.com',
    });
    expect(db.sessions).toHaveLength(1);
    expect(db.events[0].eventMetadata.method).toBe('google_oidc');
    const tokenCall = google.calls.find(({ url }) => url === 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(tokenCall.options.body);
    expect(form.get('code_verifier')).toBe('test-verifier-123456789012345678901234567890123');
    expect(form.get('code')).toBe('one-time-code');
    const replay = await request(app).get(callback);
    expect(replay.status).toBe(401);
    expect(replay.body.error.message).toBe('Invalid Google authentication response');
    expect(db.sessions).toHaveLength(1);
  });

  it.each([
    ['wrong callback issuer', { iss: 'https://evil.example' }],
    ['wrong token audience', { claims: { aud: 'other-client' } }],
    ['wrong token nonce', { claims: { nonce: 'different' } }],
    ['unverified email', { claims: { email_verified: false } }],
    ['unauthorized party', { claims: { azp: 'other-client' } }],
  ])('rejects %s without a session', async (_name, override) => {
    const db = fakePrisma();
    const redis = fakeRedis();
    await redis.set('outpost:oauth-state:v1:state', JSON.stringify({
      nonce: 'expected-nonce', codeVerifier: 'test-verifier-123456789012345678901234567890123',
    }), { EX: 600, NX: true });
    const google = fakeGoogle(await signedToken(override.claims));
    const app = appFor({ prisma: db.prisma, redisClient: redis, fetchImpl: google.fetch });
    const iss = encodeURIComponent(override.iss ?? 'https://accounts.google.com');
    const response = await request(app).get('/api/v1/auth/google/callback?state=state&code=code&iss=' + iss);
    expect(response.status).toBe(401);
    expect(db.users).toHaveLength(0);
    expect(db.sessions).toHaveLength(0);
    expect(redis.values.size).toBe(0);
  });

  it('keeps a colliding email separate and reuses only the linked Google subject', async () => {
    const db = fakePrisma();
    const original = await db.prisma.user.create({ data: {
      displayName: 'Password User', primaryEmail: 'person@example.com', emailVerifiedAt: new Date(),
    } });
    const redis = fakeRedis();
    const google = fakeGoogle(await signedToken());
    const app = appFor({ prisma: db.prisma, redisClient: redis, fetchImpl: google.fetch });
    for (const state of ['first', 'second']) {
      await redis.set('outpost:oauth-state:v1:' + state, JSON.stringify({
        nonce: 'expected-nonce', codeVerifier: 'test-verifier-123456789012345678901234567890123',
      }), { EX: 600, NX: true });
      const response = await request(app).get(
        '/api/v1/auth/google/callback?state=' + state + '&code=code&iss=https%3A%2F%2Faccounts.google.com',
      );
      expect(response.status).toBe(200);
    }
    expect(db.users).toHaveLength(2);
    expect(db.identities).toHaveLength(1);
    expect(db.identities[0].userId).not.toBe(original.id);
    expect(db.users.find((user) => user.id === db.identities[0].userId).primaryEmail).toBeNull();
    expect(db.sessions).toHaveLength(2);
  });

  it('rejects a suspended linked user without creating a session', async () => {
    const db = fakePrisma();
    const suspended = await db.prisma.user.create({ data: {
      displayName: 'Suspended', primaryEmail: null, status: 'suspended',
    } });
    await db.prisma.oauthIdentity.create({ data: {
      userId: suspended.id, provider: 'google', providerSubject: 'stable-google-subject',
      providerEmail: 'person@example.com',
    } });
    const redis = fakeRedis();
    await redis.set('outpost:oauth-state:v1:state', JSON.stringify({
      nonce: 'expected-nonce', codeVerifier: 'test-verifier-123456789012345678901234567890123',
    }), { EX: 600, NX: true });
    const google = fakeGoogle(await signedToken());
    const response = await request(appFor({ prisma: db.prisma, redisClient: redis, fetchImpl: google.fetch }))
      .get('/api/v1/auth/google/callback?state=state&code=code&iss=https%3A%2F%2Faccounts.google.com');
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(db.sessions).toHaveLength(0);
  });
});
