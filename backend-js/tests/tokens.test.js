import { describe, expect, it } from 'vitest';
import { decodeAccessToken, issueAccessToken } from '../src/modules/auth/tokens.js';

const settings = { authSigningKey: 'migration-test-signing-key-which-is-at-least-32-bytes' };
const userId = '3908207e-2570-4d95-b4eb-28cdaaf013b4';
const sessionId = 'c1ca10bc-afd6-4cd0-adeb-8f6beeb306e0';

describe('access-token compatibility', () => {
  it('issues a 15-minute Outpost JWT and accepts its verified claims', async () => {
    const token = await issueAccessToken(settings, userId, sessionId);
    const claims = await decodeAccessToken(settings, token);
    expect(claims).toEqual({ userId, sessionId });
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload).toMatchObject({ iss: 'outpost', aud: 'outpost-api', type: 'access', sub: userId, sid: sessionId });
    expect(payload.exp - payload.iat).toBe(900);
  });

  it('rejects a token signed by another key', async () => {
    const token = await issueAccessToken(settings, userId, sessionId);
    await expect(decodeAccessToken({ authSigningKey: 'another-signing-key-which-is-at-least-32-bytes' }, token))
      .rejects.toMatchObject({ status: 401 });
  });
});
