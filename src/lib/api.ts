export class ApiError extends Error {
  constructor(
    public status: number,
    public data: Record<string, any>,
  ) {
    super(
      status === 401
        ? 'Your session expired. Lock and unlock to sign in again.'
        : status === 429
          ? 'Too many sign-in attempts. Wait a minute and try again.'
          : String(data.error || `Server returned ${status}.`),
    );
  }
}
export class Api {
  sessionStartedAt = 0;
  constructor(
    public base = '',
    public token = '',
  ) {}
  async request(
    path: string,
    init: RequestInit = {},
    binary = false,
  ): Promise<any> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body && typeof init.body === 'string')
      headers.set('Content-Type', 'application/json');
    const response = await fetch(this.base + path, {
      ...init,
      headers,
      credentials: this.base ? 'omit' : 'same-origin',
      signal: init.signal || AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new ApiError(
        response.status,
        await response.json().catch(() => ({ error: response.statusText })),
      );
    if (response.status === 204) return null;
    return binary
      ? new Uint8Array(await response.arrayBuffer())
      : response.json();
  }
  async login(password: string): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await this.request('/api/auth/password/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      this.token = result.token;
      this.sessionStartedAt = startedAt;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        error.message = 'Incorrect sync password.';
      throw error;
    }
  }
}
