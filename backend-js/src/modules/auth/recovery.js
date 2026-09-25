import { createHash, randomBytes, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { AppError } from '../../core/errors.js';
import { emailInput, parseBody, passwordReset, tokenInput } from '../../core/validation.js';
import { hashPassword } from './passwords.js';
import { COOKIE_PATH, REFRESH_COOKIE } from './service.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const inHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000);

function linkWithToken(base, token) {
  const url = new URL(base);
  url.searchParams.set('token', token);
  return url.toString();
}

export function createEmailProvider(settings) {
  if (settings.emailProvider !== 'smtp') return { send: async () => {} };
  const transport = nodemailer.createTransport({
    host: settings.emailSmtpHost,
    port: settings.emailSmtpPort,
    secure: false,
    requireTLS: settings.emailSmtpStarttls,
    auth: settings.emailSmtpUsername
      ? { user: settings.emailSmtpUsername, pass: settings.emailSmtpPassword }
      : undefined,
  });
  return {
    send: async ({ to, subject, text }) => transport.sendMail({
      from: settings.emailFromAddress, to, subject, text,
    }),
  };
}

async function sendQuietly(provider, message) {
  try {
    await provider.send(message);
  } catch {
    console.error('auth.email_delivery_failed');
  }
}

export function registerRecoveryRoutes(app, { prisma, settings, emailProvider = createEmailProvider(settings) }) {
  app.post('/api/v1/auth/email-verification/request', async (request, response) => {
    const { email } = parseBody(emailInput, request.body);
    const user = await prisma.user.findFirst({ where: { primaryEmail: { equals: email, mode: 'insensitive' } } });
    if (user && user.status === 'active' && !user.emailVerifiedAt && user.primaryEmail) {
      const token = newToken();
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
        await tx.emailVerificationToken.updateMany({
          where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() },
        });
        await tx.emailVerificationToken.create({
          data: {
            id: randomUUID(), userId: user.id, email: user.primaryEmail,
            tokenHash: digest(token), expiresAt: inHours(24),
          },
        });
      });
      await sendQuietly(emailProvider, {
        to: user.primaryEmail,
        subject: 'Verify your Outpost email',
        text: `Verify your Outpost email by opening this link:\n${linkWithToken(settings.emailVerificationUrl, token)}\n\nThis link expires in 24 hours and can be used once.`,
      });
    }
    response.set('Cache-Control', 'no-store').status(202).end();
  });

  app.post('/api/v1/auth/email-verification/confirm', async (request, response) => {
    const { token } = parseBody(tokenInput, request.body);
    await prisma.$transaction(async (tx) => {
      const record = await tx.emailVerificationToken.findUnique({ where: { tokenHash: digest(token) } });
      if (!record) throw new AppError(400, 'bad_request', 'Invalid or expired email verification token');
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${record.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: record.userId } });
      const latest = await tx.emailVerificationToken.findUnique({ where: { id: record.id } });
      if (!user || !latest || latest.consumedAt || latest.expiresAt <= new Date() ||
          user.status !== 'active' || user.emailVerifiedAt || user.primaryEmail !== latest.email) {
        throw new AppError(400, 'bad_request', 'Invalid or expired email verification token');
      }
      const now = new Date();
      await tx.emailVerificationToken.update({ where: { id: latest.id }, data: { consumedAt: now } });
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
      await tx.securityEvent.create({
        data: {
          userId: user.id, eventType: 'authentication.email_verified',
          eventMetadata: { method: 'email_link' },
        },
      });
    });
    response.set('Cache-Control', 'no-store').sendStatus(204);
  });

  app.post('/api/v1/auth/password/forgot', async (request, response) => {
    const { email } = parseBody(emailInput, request.body);
    const user = await prisma.user.findFirst({
      where: { primaryEmail: { equals: email, mode: 'insensitive' } },
      include: { passwordCredential: true },
    });
    if (user && user.status === 'active' && user.primaryEmail && user.passwordCredential) {
      const token = newToken();
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: { id: randomUUID(), userId: user.id, tokenHash: digest(token), expiresAt: inHours(1) },
        });
      });
      await sendQuietly(emailProvider, {
        to: user.primaryEmail,
        subject: 'Reset your Outpost password',
        text: `Reset your Outpost password by opening this link:\n${linkWithToken(settings.passwordResetUrl, token)}\n\nThis link expires in 1 hour and can be used once.`,
      });
    }
    response.set('Cache-Control', 'no-store').status(202).end();
  });

  app.post('/api/v1/auth/password/reset', async (request, response) => {
    const { token, password } = parseBody(passwordReset, request.body);
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const record = await tx.passwordResetToken.findUnique({ where: { tokenHash: digest(token) } });
      if (!record) throw new AppError(400, 'bad_request', 'Invalid or expired password reset token');
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${record.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: record.userId } });
      const latest = await tx.passwordResetToken.findUnique({ where: { id: record.id } });
      const credential = await tx.passwordCredential.findUnique({ where: { userId: record.userId } });
      if (!user || !latest || !credential || latest.consumedAt ||
          latest.expiresAt <= new Date() || user.status !== 'active') {
        throw new AppError(400, 'bad_request', 'Invalid or expired password reset token');
      }
      const now = new Date();
      const changed = await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null }, data: { revokedAt: now },
      });
      await tx.passwordCredential.update({
        where: { userId: user.id }, data: { passwordHash, passwordChangedAt: now },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null }, data: { consumedAt: now },
      });
      await tx.securityEvent.create({
        data: {
          userId: user.id, eventType: 'authentication.password_reset',
          eventMetadata: { revoked_session_count: changed.count },
        },
      });
    });
    response.clearCookie(REFRESH_COOKIE, {
      path: COOKIE_PATH, secure: true, httpOnly: true, sameSite: 'strict',
    });
    response.set('Cache-Control', 'no-store').sendStatus(204);
  });
}
