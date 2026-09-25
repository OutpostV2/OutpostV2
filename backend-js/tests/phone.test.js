import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/core/errors.js';
import { registerPhoneRoutes } from '../src/modules/auth/phone.js';

const settings = {
  authSigningKey: 'test-signing-key-with-at-least-thirty-two-bytes',
  otpHmacKey: 'test-otp-key-with-at-least-thirty-two-bytes',
  smsProvider: 'development',
};
const phone = '+14155552671';

function fixture() {
  const challenges = [];
  const identities = [];
  const users = [];
  const sessions = [];
  const messages = [];
  const prisma = {
    $transaction: async (callback) => callback(prisma),
    $queryRaw: async () => [],
    otpChallenge: {
      findFirst: async () => challenges.at(-1) ?? null,
      updateMany: async ({ data }) => { for (const row of challenges) if (!row.consumedAt) Object.assign(row, data); },
      create: async ({ data }) => { const row = { id: randomUUID(), attemptCount: 0, consumedAt: null, ...data }; challenges.push(row); return row; },
      update: async ({ where, data }) => Object.assign(challenges.find((row) => row.id === where.id), data),
    },
    phoneIdentity: {
      findUnique: async () => identities[0] ?? null,
      create: async ({ data }) => { identities.push({ id: randomUUID(), ...data }); },
    },
    user: {
      create: async ({ data }) => { const row = { id: randomUUID(), status: 'active', ...data }; users.push(row); return row; },
      findUnique: async ({ where }) => users.find((row) => row.id === where.id) ?? null,
    },
    authSession: {
      create: async ({ data }) => { sessions.push(data); return data; },
    },
    securityEvent: { create: async () => {} },
  };
  const redisClient = { eval: async () => 1 };
  const smsProvider = { send: async (message) => messages.push(message) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.requestId = randomUUID(); next(); });
  registerPhoneRoutes(app, { prisma, settings, redisClient, smsProvider });
  app.use(errorHandler);
  return { app, challenges, identities, users, sessions, messages };
}

describe('phone OTP login', () => {
  it('issues a bounded challenge and exchanges its one-time code for a session', async () => {
    const f = fixture();
    const sent = await request(f.app).post('/api/v1/auth/phone/request').send({ phone });
    expect(sent.status).toBe(202);
    expect(sent.text).toBe('');
    expect(f.messages).toHaveLength(1);
    const code = f.messages[0].text.match(/\b\d{6}\b/)[0];
    const verified = await request(f.app).post('/api/v1/auth/phone/verify').send({ phone, code });
    expect(verified.status).toBe(200);
    expect(verified.body.access_token).toBeTruthy();
    expect(f.challenges[0].consumedAt).toBeTruthy();
    expect(f.identities).toHaveLength(1);
    expect(f.users).toHaveLength(1);
    expect(f.sessions).toHaveLength(1);
    const replay = await request(f.app).post('/api/v1/auth/phone/verify').send({ phone, code });
    expect(replay.status).toBe(401);
  });

  it('counts incorrect attempts without issuing a user or session', async () => {
    const f = fixture();
    await request(f.app).post('/api/v1/auth/phone/request').send({ phone });
    const bad = await request(f.app).post('/api/v1/auth/phone/verify').send({ phone, code: '000000' });
    expect(bad.status).toBe(401);
    expect(f.challenges[0].attemptCount).toBe(1);
    expect(f.users).toHaveLength(0);
    expect(f.sessions).toHaveLength(0);
  });
});
