import request from 'supertest';
import { loadSettings } from '../src/core/config.js';
import { createPrismaClient } from '../src/db/client.js';
import { createValkeyClient } from '../src/core/valkey.js';
import { createApp } from '../src/app.js';
import { decodeAccessToken } from '../src/modules/auth/tokens.js';

const phone = '+12025550123'; // NANP fictional-number range.
const settings = loadSettings();
const prisma = createPrismaClient(settings.databaseUrl);
const redisClient = createValkeyClient(settings.valkeyUrl);
const outbox = [];
const smsProvider = { send: async (message) => outbox.push(message) };
let newUserId;
let createdChallengeId;
try {
  if (await prisma.otpChallenge.count({ where: { phoneE164: phone } })) {
    throw new Error('Fictional test phone already has a challenge; refusing to alter it');
  }
  if (await prisma.phoneIdentity.findUnique({ where: { phoneE164: phone } })) {
    throw new Error('Fictional test phone already has an identity; refusing to alter it');
  }
  const app = createApp({ prisma, settings, redisClient, smsProvider });
  const requested = await request(app).post('/api/v1/auth/phone/request').send({ phone });
  createdChallengeId = (await prisma.otpChallenge.findFirst({ where: { phoneE164: phone }, orderBy: { createdAt: 'desc' } }))?.id;
  if (requested.status !== 202 || outbox.length !== 1) {
    throw new Error(`phone request: ${requested.status}, messages: ${outbox.length}`);
  }
  const code = outbox[0].text.match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error('Development SMS did not contain a six-digit code');
  const verified = await request(app).post('/api/v1/auth/phone/verify').send({ phone, code });
  if (verified.status !== 200) throw new Error(`phone verify: ${verified.status} ${JSON.stringify(verified.body)}`);
  newUserId = (await decodeAccessToken(settings, verified.body.access_token)).userId;
  const replay = await request(app).post('/api/v1/auth/phone/verify').send({ phone, code });
  if (replay.status !== 401) throw new Error(`phone replay: ${replay.status}`);
  console.log(JSON.stringify({ phoneRequest: 202, phoneVerify: 200, phoneReplay: 401 }));
} finally {
  if (createdChallengeId) await prisma.otpChallenge.delete({ where: { id: createdChallengeId } });
  if (newUserId) {
    const identity = await prisma.phoneIdentity.findUnique({ where: { phoneE164: phone } });
    const user = await prisma.user.findUnique({ where: { id: newUserId } });
    if (identity?.userId === newUserId && user?.displayName === 'Outpost member') {
      await prisma.user.delete({ where: { id: newUserId } });
    }
  }
  await redisClient.close();
  await prisma.$disconnect();
}
