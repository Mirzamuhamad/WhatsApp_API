export class HttpError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFound(message = 'Resource not found') {
  return new HttpError(404, message);
}

export function badRequest(message, details = undefined) {
  return new HttpError(400, message, details);
}

export function unauthorized(message = 'Unauthorized') {
  return new HttpError(401, message);
}

export function forbidden(message = 'Forbidden') {
  return new HttpError(403, message);
}
