import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';

const envFile = resolve(process.cwd(), '.env');
const legacyEnvFile = resolve(process.cwd(), '../backend/.env');
if (existsSync(envFile)) loadEnvFile(envFile);
else if (existsSync(legacyEnvFile)) loadEnvFile(legacyEnvFile);

const schema = z.object({
  OUTPOST_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  OUTPOST_DATABASE_URL: z.string().min(1),
  OUTPOST_AUTH_SIGNING_KEY: z.string().min(32).optional(),
  OUTPOST_VALKEY_URL: z.string().default('redis://127.0.0.1:6379/0'),
  OUTPOST_EMAIL_PROVIDER: z.enum(['disabled', 'development', 'smtp']).default('disabled'),
  OUTPOST_SMS_PROVIDER: z.enum(['disabled', 'development']).default('disabled'),
});

export function loadSettings(environment = process.env) {
  const parsed = schema.parse(environment);
  const databaseUrl = parsed.OUTPOST_DATABASE_URL.replace(/^postgresql\+psycopg:\/\//, 'postgresql://');
  const settings = {
    env: parsed.OUTPOST_ENV,
    databaseUrl,
    authSigningKey: parsed.OUTPOST_AUTH_SIGNING_KEY,
    valkeyUrl: parsed.OUTPOST_VALKEY_URL,
    emailProvider: parsed.OUTPOST_EMAIL_PROVIDER,
    smsProvider: parsed.OUTPOST_SMS_PROVIDER,
    otpHmacKey: environment.OUTPOST_OTP_HMAC_KEY,
    googleClientId: environment.OUTPOST_GOOGLE_CLIENT_ID,
    googleClientSecret: environment.OUTPOST_GOOGLE_CLIENT_SECRET,
    googleRedirectUri: environment.OUTPOST_GOOGLE_REDIRECT_URI,
    emailFromAddress: environment.OUTPOST_EMAIL_FROM_ADDRESS || 'no-reply@outpost.example',
    emailVerificationUrl: environment.OUTPOST_EMAIL_VERIFICATION_URL || 'http://localhost:5173/verify-email',
    passwordResetUrl: environment.OUTPOST_PASSWORD_RESET_URL || 'http://localhost:5173/reset-password',
    emailSmtpHost: environment.OUTPOST_EMAIL_SMTP_HOST || '127.0.0.1',
    emailSmtpPort: Number(environment.OUTPOST_EMAIL_SMTP_PORT || 1025),
    emailSmtpStarttls: environment.OUTPOST_EMAIL_SMTP_STARTTLS === 'true',
    emailSmtpUsername: environment.OUTPOST_EMAIL_SMTP_USERNAME,
    emailSmtpPassword: environment.OUTPOST_EMAIL_SMTP_PASSWORD,
  };
  if (settings.env !== 'development' && settings.env !== 'test') {
    if (settings.smsProvider === 'development' || settings.emailProvider === 'development') {
      throw new Error('Development outbound providers cannot run outside development/test');
    }
  }
  return settings;
}
