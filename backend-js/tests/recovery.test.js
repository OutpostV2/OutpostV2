import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const settings = {
  emailProvider: 'disabled',
  emailVerificationUrl: 'http://localhost:5173/verify-email',
  passwordResetUrl: 'http://localhost:5173/reset-password',
};

describe('recovery API privacy', () => {
  it('returns the same accepted response for unknown verification and reset addresses', async () => {
    const prisma = { user: { findFirst: vi.fn(async () => null) } };
    const provider = { send: vi.fn() };
    const app = createApp({ prisma, settings, emailProvider: provider });
    const verification = await request(app).post('/api/v1/auth/email-verification/request')
      .send({ email: 'unknown@example.com' });
    const forgot = await request(app).post('/api/v1/auth/password/forgot')
      .send({ email: 'unknown@example.com' });
    expect(verification.status).toBe(202);
    expect(forgot.status).toBe(202);
    expect(verification.text).toBe('');
    expect(forgot.text).toBe('');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('rejects invalid reset tokens without revealing an account', async () => {
    const prisma = {
      passwordResetToken: { findUnique: async () => null },
      $transaction: async (callback) => callback(prisma),
    };
    const app = createApp({ prisma, settings });
    const response = await request(app).post('/api/v1/auth/password/reset')
      .send({ token: 'x'.repeat(43), password: 'new-password-valid-2026' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Invalid or expired password reset token');
  }, 15000);
});
