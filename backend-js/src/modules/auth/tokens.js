import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { notReady, unauthorized } from '../../core/errors.js';

const ISSUER = 'outpost';
const AUDIENCE = 'outpost-api';
const ACCESS_SECONDS = 900;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signingKey(settings) {
  if (!settings.authSigningKey) throw notReady('Authentication is not configured');
  return new TextEncoder().encode(settings.authSigningKey);
}

export async function issueAccessToken(settings, userId, sessionId) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: String(sessionId), type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setJti(randomUUID())
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_SECONDS)
    .sign(signingKey(settings));
}

export async function decodeAccessToken(settings, token) {
  try {
    const { payload } = await jwtVerify(token, signingKey(settings), {
      algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
      requiredClaims: ['exp', 'iat', 'nbf', 'iss', 'aud', 'sub', 'sid', 'jti', 'type'],
    });
    if (payload.type !== 'access' || !uuidPattern.test(payload.sub) || !uuidPattern.test(payload.sid)) throw Error('Invalid token claims');
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.nbf) || !Number.isInteger(payload.exp)) throw Error('Invalid token timestamps');
    if (payload.exp - payload.iat <= 0 || payload.exp - payload.iat > ACCESS_SECONDS) throw Error('Invalid token lifetime');
    return { userId: payload.sub, sessionId: payload.sid };
  } catch (error) {
    if (error?.code === 'not_ready') throw error;
    throw unauthorized('Invalid or expired access credential');
  }
}
