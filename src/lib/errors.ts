/**
 * Error whose message is safe to surface directly to the end user. Action
 * builders pass these through unmasked; every other error is replaced with a
 * generic message so internal details never leak to the browser.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
