import { createHash, randomBytes } from 'node:crypto';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { notReady, unauthorized } from '../../core/errors.js';
import { issueSession } from './service.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DISCOVERY_ENDPOINT = 'https://accounts.google.com/.well-known/openid-configuration';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const INVALID = 'Invalid Google authentication response';
const stateKey = (state) => `outpost:oauth-state:v1:${state}`;
const secret = () => randomBytes(32).toString('base64url');

async function getJson(fetchImpl, url, options) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(10000), ...options });
    if (!response.ok) throw Error('Google HTTP request failed');
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Google JSON');
    return value;
  } catch {
    throw notReady('Google authentication is unavailable');
  }
}

async function verifiedPrincipal(settings, code, nonce, codeVerifier, fetchImpl) {
  const discovery = await getJson(fetchImpl, DISCOVERY_ENDPOINT, { headers: { Accept: 'application/json' } });
  if (discovery.issuer !== 'https://accounts.google.com' ||
      discovery.token_endpoint !== TOKEN_ENDPOINT || discovery.jwks_uri !== JWKS_ENDPOINT) {
    throw unauthorized(INVALID);
  }
  const form = new URLSearchParams({
    grant_type: 'authorization_code', code,
    client_id: settings.googleClientId, client_secret: settings.googleClientSecret,
    redirect_uri: settings.googleRedirectUri, code_verifier: codeVerifier,
  });
  const tokens = await getJson(fetchImpl, TOKEN_ENDPOINT, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (typeof tokens.id_token !== 'string') throw unauthorized(INVALID);
  const jwks = await getJson(fetchImpl, JWKS_ENDPOINT, { headers: { Accept: 'application/json' } });
  try {
    const header = decodeProtectedHeader(tokens.id_token);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !Array.isArray(jwks.keys)) throw Error('Header/JWKS');
    const matching = jwks.keys.filter((key) => key.kid === header.kid);
    if (matching.length !== 1) throw Error('Signing key');
    const key = await importJWK(matching[0], 'RS256');
    const { payload } = await jwtVerify(tokens.id_token, key, {
      algorithms: ['RS256'],
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
      audience: settings.googleClientId,
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'nonce', 'email'],
    });
    if (payload.nonce !== nonce || payload.email_verified !== true ||
        (payload.azp && payload.azp !== settings.googleClientId)) throw Error('Claims');
    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== settings.googleClientId) throw Error('AZP');
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw Error('Subject');
    if (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw Error('Email');
    return {
      subject: payload.sub,
      email: payload.email.toLowerCase(),
      name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 200) : null,
    };
  } catch {
    throw unauthorized(INVALID);
  }
}

async function resolveGoogleUser(tx, principal) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'google:' + principal.subject}, 0))`;
  const identity = await tx.oauthIdentity.findUnique({
    where: { provider_providerSubject: { provider: 'google', providerSubject: principal.subject } },
  });
  if (identity) {
    const user = await tx.user.findUnique({ where: { id: identity.userId } });
    if (!user || user.status !== 'active') throw unauthorized(INVALID);
    await tx.oauthIdentity.update({ where: { id: identity.id }, data: { providerEmail: principal.email } });
    return user;
  }
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'email:' + principal.email}, 0))`;
  const owner = await tx.user.findFirst({
    where: { primaryEmail: { equals: principal.email, mode: 'insensitive' } },
  });
  const user = await tx.user.create({
    data: {
      displayName: principal.name || 'Outpost member',
      primaryEmail: owner ? null : principal.email,
      emailVerifiedAt: owner ? null : new Date(),
    },
  });
  await tx.oauthIdentity.create({
    data: {
      userId: user.id, provider: 'google',
      providerSubject: principal.subject, providerEmail: principal.email,
    },
  });
  return user;
}

export function registerGoogleRoutes(app, {
  prisma, settings, redisClient, fetchImpl = fetch,
}) {
  app.get('/api/v1/auth/google/authorize', async (_request, response) => {
    if (!settings.googleClientId || !settings.googleRedirectUri) {
      throw notReady('Google authentication is not configured');
    }
    if (!redisClient) throw notReady('Google authentication is unavailable');
    let state, nonce, codeVerifier;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      state = secret();
      nonce = secret();
      codeVerifier = secret();
      let stored;
      try {
        stored = await redisClient.set(stateKey(state), JSON.stringify({ nonce, codeVerifier }), { EX: 600, NX: true });
      } catch {
        throw notReady('Google authentication is unavailable');
      }
      if (stored) break;
      state = null;
    }
    if (!state) throw notReady('Google authentication is unavailable');
    const url = new URL(AUTH_ENDPOINT);
    for (const [key, value] of Object.entries({
      client_id: settings.googleClientId,
      redirect_uri: settings.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
    })) url.searchParams.set(key, value);
    response.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).redirect(302, url.toString());
  });

  app.get('/api/v1/auth/google/callback', async (request, response) => {
    if (!settings.googleClientId || !settings.googleClientSecret ||
        !settings.googleRedirectUri || !settings.authSigningKey) {
      throw notReady('Google authentication is not configured');
    }
    if (!redisClient) throw notReady('Google authentication is unavailable');
    const { state = '', code = '', iss = '' } = request.query;
    if (typeof state !== 'string' || state.length > 512 ||
        typeof code !== 'string' || code.length > 4096 ||
        typeof iss !== 'string' || iss.length > 256) throw unauthorized(INVALID);
    let raw;
    try { raw = await redisClient.getDel(stateKey(state)); }
    catch { throw notReady('Google authentication is unavailable'); }
    if (!raw || !code || !['accounts.google.com', 'https://accounts.google.com'].includes(iss)) {
      throw unauthorized(INVALID);
    }
    let correlation;
    try { correlation = JSON.parse(raw); }
    catch { throw unauthorized(INVALID); }
    if (typeof correlation.nonce !== 'string' || typeof correlation.codeVerifier !== 'string') {
      throw unauthorized(INVALID);
    }
    const principal = await verifiedPrincipal(settings, code, correlation.nonce, correlation.codeVerifier, fetchImpl);
    const credentials = await prisma.$transaction(async (tx) => {
      const user = await resolveGoogleUser(tx, principal);
      return issueSession({
        authSession: tx.authSession, securityEvent: tx.securityEvent,
        $transaction: async (callback) => callback(tx),
      }, settings, user, 'google_oidc', request);
    });
    response.cookie('outpost_refresh', credentials.refresh, {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth', secure: true, httpOnly: true, sameSite: 'strict',
    });
    response.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    response.json({ access_token: credentials.access, token_type: 'bearer', expires_in: 900 });
  });
}
