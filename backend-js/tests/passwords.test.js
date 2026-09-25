import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/modules/auth/passwords.js';

const legacyHash = '$argon2id$v=19$m=65536,t=3,p=4$9xrTO/fJjQKdlhYOzNfEZQ$pWVoi0CajoPrYMKGDTkogHJsLj9J1kjJelWVnIUBKww';

describe('password hash compatibility', () => {
  it('authenticates an existing Python Argon2id hash', async () => {
    expect(await verifyPassword(legacyHash, 'migration-test-password-2026')).toBe(true);
    expect(await verifyPassword(legacyHash, 'incorrect-password')).toBe(false);
  });

  it('creates Argon2id hashes for new accounts', async () => {
    const hash = await hashPassword('a-new-test-password');
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(await verifyPassword(hash, 'a-new-test-password')).toBe(true);
  });
});
