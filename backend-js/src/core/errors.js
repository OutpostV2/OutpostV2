export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message) => new AppError(400, 'bad_request', message);
export const unauthorized = (message = 'Authentication is required') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Access denied') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not Found') => new AppError(404, 'not_found', message);
export const conflict = (message) => new AppError(409, 'conflict', message);
export const notReady = (message) => new AppError(503, 'not_ready', message);

export function errorHandler(error, request, response, _next) {
  const expected = error instanceof AppError;
  if (!expected) console.error('request.failed', { requestId: request.requestId, error });
  const payload = {
    code: expected ? error.code : 'internal_error',
    message: expected ? error.message : 'Internal server error',
    request_id: request.requestId,
  };
  if (expected && error.details) payload.details = error.details;
  response.status(expected ? error.status : 500).json({ error: payload });
}
