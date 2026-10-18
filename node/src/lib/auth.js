// HTTP errors with their own status (401 sign in again, 403 invalid request, 413 too large, …).
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
