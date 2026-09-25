import { z } from 'zod';
import { parseBody, registration, login } from '../../core/validation.js';
import { AppError } from '../../core/errors.js';
import {
  activeSessions, COOKIE_PATH, createRequireUser, issueSession, publicUser,
  REFRESH_COOKIE, registerUser, authenticatePassword, revokeAllSessions,
  revokeCurrentSession, revokeSession, rotateRefresh,
} from './service.js';

const UUID = z.uuid();

function tokenOutput(access) {
  return { access_token: access, token_type: 'bearer', expires_in: 900 };
}

function setRefreshCookie(response, refresh) {
  response.cookie(REFRESH_COOKIE, refresh, {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: COOKIE_PATH, secure: true, httpOnly: true, sameSite: 'strict',
  });
}
function clearRefreshCookie(response) {
  response.clearCookie(REFRESH_COOKIE, {
    path: COOKIE_PATH, secure: true, httpOnly: true, sameSite: 'strict',
  });
}
function noStore(_request, response, next) {
  response.set('Cache-Control', 'no-store');
  next();
}
function tokenHeaders(response) {
  response.set('Pragma', 'no-cache');
}

export function registerAuthRoutes(app, { prisma, settings }) {
  const requireUser = createRequireUser(prisma, settings);
  app.post('/api/v1/auth/password/register', noStore, async (request, response) => {
    const data = parseBody(registration, request.body);
    const user = await registerUser(prisma, data);
    response.status(201).json(publicUser(user));
  });
  app.post('/api/v1/auth/password/login', noStore, async (request, response) => {
    const data = parseBody(login, request.body);
    const user = await authenticatePassword(prisma, data.identifier, data.password);
    const { access, refresh } = await issueSession(prisma, settings, user, 'password', request);
    tokenHeaders(response);
    setRefreshCookie(response, refresh);
    response.json(tokenOutput(access));
  });
  app.post('/api/v1/auth/refresh', noStore, async (request, response) => {
    const refresh = request.cookies[REFRESH_COOKIE];
    if (!refresh) throw new AppError(401, 'unauthorized', 'Invalid or expired refresh credential');
    const next = await rotateRefresh(prisma, settings, refresh, request);
    tokenHeaders(response);
    setRefreshCookie(response, next.refresh);
    response.json(tokenOutput(next.access));
  });
  app.get('/api/v1/me', noStore, requireUser, (request, response) => {
    response.json(request.user);
  });
  app.get('/api/v1/auth/sessions', noStore, requireUser, async (request, response) => {
    response.json(await activeSessions(prisma, request.user.id, request.authSession.id));
  });
  app.delete('/api/v1/auth/sessions/:session_id', noStore, requireUser, async (request, response) => {
    const parsed = UUID.safeParse(request.params.session_id);
    if (!parsed.success) {
      throw new AppError(422, 'validation_error', 'Request validation failed',
        [{ loc: ['path', 'session_id'], type: 'uuid_parsing' }]);
    }
    await revokeSession(prisma, request.user.id, parsed.data, request.authSession.id);
    if (parsed.data === request.authSession.id) clearRefreshCookie(response);
    response.sendStatus(204);
  });
  app.post('/api/v1/auth/logout-all', noStore, requireUser, async (request, response) => {
    await revokeAllSessions(prisma, request.user.id, request.authSession.id);
    clearRefreshCookie(response);
    response.sendStatus(204);
  });
  app.post('/api/v1/auth/logout', noStore, requireUser, async (request, response) => {
    await revokeCurrentSession(prisma, request.user.id, request.authSession.id);
    clearRefreshCookie(response);
    response.sendStatus(204);
  });
  return requireUser;
}
