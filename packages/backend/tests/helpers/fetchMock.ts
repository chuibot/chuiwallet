type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const handlers: Array<{ match: (url: string) => boolean; handler: FetchHandler }> = [];
const calls: Array<{ url: string; init?: RequestInit }> = [];

let originalFetch: typeof fetch | undefined;

export function installFetchMock(): void {
  if (!originalFetch) originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    calls.push({ url: u, init });
    for (const { match, handler } of handlers) {
      if (match(u)) {
        return Promise.resolve(handler(u, init));
      }
    }
    return Promise.reject(new Error(`Unhandled fetch: ${u}`));
  }) as typeof fetch;
}

export function restoreFetch(): void {
  if (originalFetch) globalThis.fetch = originalFetch;
}

export function resetFetchMock(): void {
  handlers.length = 0;
  calls.length = 0;
}

export function mockFetch(match: ((u: string) => boolean) | string | RegExp, handler: FetchHandler): void {
  const matcher =
    typeof match === 'string'
      ? (u: string) => u.includes(match)
      : match instanceof RegExp
        ? (u: string) => match.test(u)
        : match;
  handlers.push({ match: matcher, handler });
}

export function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function getFetchCalls(): ReadonlyArray<{ url: string; init?: RequestInit }> {
  return calls;
}
