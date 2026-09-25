import { z } from 'zod';
import { AppError } from './errors.js';

export function parseBody(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError(422, 'validation_error', 'Request validation failed',
    result.error.issues.map((issue) => ({ loc: ['body', ...issue.path], type: issue.code })));
}

export const email = z.email().max(320).transform((value) => value.trim().toLowerCase());
export const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,64}$/);
export const password = z.string().min(12).max(1024);
export const registration = z.strictObject({
  display_name: z.string().trim().min(1).max(200),
  username,
  email,
  password,
  account_type: z.enum(['student', 'coordinator']).default('student'),
});
export const login = z.strictObject({
  identifier: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
});
export const emailInput = z.strictObject({ email });
export const tokenInput = z.strictObject({ token: z.string().min(43).max(512) });
export const passwordReset = tokenInput.extend({ password });
