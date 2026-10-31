// HTTP errors with their own status (400 bad input, 401 sign in again, 403 not allowed, 404, 409 conflict, 429 slow down).
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
