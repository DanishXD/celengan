/** Typed API error shared by the live and static clients: an HTTP-like
 * status plus the server-rendered reason (policy rejections surface this
 * verbatim in the UI). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
