/**
 * Safe API JSON parser & resilient fetch helper.
 * Prevents raw `Unexpected token '<', "<!doctype "... is not valid JSON` crashes
 * when a proxy, gateway timeout, or restarting dev server temporarily returns HTML.
 */

export async function parseApiJson<T = any>(
  res: Response,
  fallbackError = 'The server returned an unexpected response. Please retry.'
): Promise<T> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();
  const trimmed = rawText.trim();

  const looksLikeHtml =
    trimmed.startsWith('<!') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML') ||
    contentType.includes('text/html');

  if (looksLikeHtml) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('Server is temporarily busy or timed out. Please click Retry in a moment.');
    }
    throw new Error(
      'API returned an HTML page instead of JSON (server may have just restarted). Please click Retry.'
    );
  }

  let parsed: any = {};
  if (trimmed.length > 0) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(fallbackError);
    }
  }

  if (!res.ok) {
    throw new Error(parsed?.error || parsed?.message || fallbackError);
  }

  return parsed as T;
}

export async function fetchApiJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallbackError = 'Request failed. Please retry.'
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(input, init);
      const contentType = (res.headers.get('content-type') || '').toLowerCase();

      // If proxy/dev server temporarily returned HTML or 502/503/504 on first attempt, retry once smoothly
      const isTransientGateway =
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504 ||
        contentType.includes('text/html');

      if (attempt === 0 && isTransientGateway) {
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }

      return await parseApiJson<T>(res, fallbackError);
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && err instanceof TypeError) {
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(fallbackError);
}
