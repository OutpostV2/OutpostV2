import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { conflict, notFound, notReady, unauthorized } from '../../core/errors.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './passwords.js';
import { decodeAccessToken, issueAccessToken } from './tokens.js';

const REFRESH_SECONDS = 30 * 24 * 60 * 60;
export const REFRESH_COOKIE = 'outpost_refresh';
export const COOKIE_PATH = '/api/v1/auth';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const newRefresh = () => randomBytes(32).toString('base64url');
const expiry = (now) => new Date(now.getTime() + REFRESH_SECONDS * 1000);
const eventData = (request) => ({
  userAgent: request.get('user-agent')?.slice(0, 512) || null,
  ipAddress: null,
});

export function publicUser(user) {
  return {
    id: user.id,
    display_name: user.displayName,
    username: user.username,
    primary_email: user.primaryEmail,
    email_verified_at: user.emailVerifiedAt?.toISOString() ?? null,
    account_type: user.accountType,
  };
}

export async function registerUser(prisma, data) {
  const passwordHash = await hashPassword(data.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          displayName: data.display_name,
          username: data.username,
          primaryEmail: data.email,
          accountType: data.account_type,
        },
      });
      await tx.passwordCredential.create({ data: { userId: user.id, passwordHash } });
      return user;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('Registration cannot be completed with these identifiers');
    }
    throw error;
  }
}

export async function authenticatePassword(prisma, identifier, password) {
  const candidate = identifier.trim().toLowerCase();
  const isEmail = candidate.includes('@');
  const normalized = isEmail
    ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : '')
    : (/^[a-z0-9_]{3,64}$/.test(candidate) ? candidate : '');
  const user = normalized ? await prisma.user.findFirst({
    where: isEmail
      ? { primaryEmail: { equals: normalized, mode: 'insensitive' } }
      : { username: { equals: normalized, mode: 'insensitive' } },
    include: { passwordCredential: true },
  }) : null;
  const encoded = user?.passwordCredential?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const valid = await verifyPassword(encoded, password.length <= 1024 ? password : '');
  if (!valid || !user?.passwordCredential || user.status !== 'active') {
    throw unauthorized('Invalid credentials');
  }
  return user;
}

export async function issueSession(prisma, settings, user, method, request) {
  if (!settings.authSigningKey) throw notReady('Authentication is not configured');
  if (user.status !== 'active') throw unauthorized('Authentication failed');
  const now = new Date();
  const refresh = newRefresh();
  const metadata = eventData(request);
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.authSession.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        tokenFamilyId: randomUUID(),
        refreshTokenHash: digest(refresh),
        createdAt: now,
        lastUsedAt: now,
        expiresAt: expiry(now),
        ...metadata,
      },
    });
    await tx.securityEvent.create({
      data: {
        userId: user.id,
        sessionId: created.id,
        eventType: 'authentication.succeeded',
        eventMetadata: { method },
        ...metadata,
      },
    });
    return created;
  });
  const access = await issueAccessToken(settings, user.id, session.id);
  return { access, refresh };
}

export async function rotateRefresh(prisma, settings, refreshToken, request) {
  const hash = digest(refreshToken);
  const metadata = eventData(request);
  const outcome = await prisma.$transaction(async (tx) => {
    const source = await tx.authSession.findUnique({ where: { refreshTokenHash: hash } });
    if (!source) throw unauthorized('Invalid or expired refresh credential');
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${source.userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: source.userId } });
    const current = await tx.authSession.findUnique({ where: { id: source.id } });
    if (!user || !current) throw unauthorized('Invalid or expired refresh credential');
    const now = new Date();
    if (current.replacedBySessionId) {
      await tx.authSession.updateMany({
        where: { tokenFamilyId: current.tokenFamilyId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.securityEvent.create({
        data: {
          userId: current.userId,
          sessionId: current.id,
          eventType: 'authentication.refresh_replay_detected',
          eventMetadata: { token_family_id: current.tokenFamilyId },
          ...metadata,
        },
      });
      return { replay: true };
    }
    if (current.revokedAt || current.expiresAt <= now || user.status !== 'active') {
      throw unauthorized('Invalid or expired refresh credential');
    }
    const nextRefresh = newRefresh();
    const next = await tx.authSession.create({
      data: {
        id: randomUUID(),
        userId: current.userId,
        tokenFamilyId: current.tokenFamilyId,
        refreshTokenHash: digest(nextRefresh),
        createdAt: now,
        lastUsedAt: now,
        expiresAt: expiry(now),
        ...metadata,
      },
    });
    await tx.authSession.update({
      where: { id: current.id },
      data: { lastUsedAt: now, revokedAt: now, replacedBySessionId: next.id },
    });
    await tx.securityEvent.create({
      data: {
        userId: current.userId,
        sessionId: next.id,
        eventType: 'authentication.refresh_rotated',
        eventMetadata: { previous_session_id: current.id },
        ...metadata,
      },
    });
    return { userId: user.id, sessionId: next.id, refresh: nextRefresh };
  });
  if (outcome.replay) throw unauthorized('Invalid or expired refresh credential');
  return { access: await issueAccessToken(settings, outcome.userId, outcome.sessionId), refresh: outcome.refresh };
}

export function createRequireUser(prisma, settings) {
  return async (request, _response, next) => {
    try {
      const authorization = request.get('authorization');
      if (!authorization?.startsWith('Bearer ')) throw unauthorized();
      const { userId, sessionId } = await decodeAccessToken(settings, authorization.slice(7));
      const [user, session] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.authSession.findUnique({ where: { id: sessionId } }),
      ]);
      if (!user || !session || session.userId !== user.id ||
          session.revokedAt || session.expiresAt <= new Date() || user.status !== 'active') {
        throw unauthorized('Invalid or expired access credential');
      }
      request.user = publicUser(user);
      request.authSession = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function activeSessions(prisma, userId, currentId) {
  const rows = await prisma.authSession.findMany({
    where: { userId, revokedAt: null, replacedBySessionId: null, expiresAt: { gt: new Date() } },
    orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map((row) => ({
    id: row.id,
    created_at: row.createdAt.toISOString(),
    last_used_at: row.lastUsedAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    user_agent: row.userAgent,
    ip_address: row.ipAddress,
    is_current: row.id === currentId,
  }));
}

export async function revokeSession(prisma, userId, targetId, currentId) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const target = await tx.authSession.findFirst({ where: { id: targetId, userId } });
    if (!target) throw notFound('Session not found');
    const changed = await tx.authSession.updateMany({
      where: { tokenFamilyId: target.tokenFamilyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (changed.count) {
      await tx.securityEvent.create({
        data: {
          userId,
          sessionId: target.id,
          eventType: 'authentication.session_revoked',
          eventMetadata: { current: targetId === currentId, token_family_id: target.tokenFamilyId },
        },
      });
    }
  });
}

export async function revokeAllSessions(prisma, userId, currentId) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const changed = await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (changed.count) {
      await tx.securityEvent.create({
        data: {
          userId,
          sessionId: currentId,
          eventType: 'authentication.logout_all',
          eventMetadata: { revoked_count: changed.count },
        },
      });
    }
  });
}

export async function revokeCurrentSession(prisma, userId, currentId) {
  const session = await prisma.authSession.findUnique({ where: { id: currentId } });
  if (!session || session.userId !== userId) throw unauthorized('Invalid or expired access credential');
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const changed = await tx.authSession.updateMany({
      where: { tokenFamilyId: session.tokenFamilyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (changed.count) {
      await tx.securityEvent.create({
        data: { userId, sessionId: currentId, eventType: 'authentication.logout', eventMetadata: {} },
      });
    }
  });
}
