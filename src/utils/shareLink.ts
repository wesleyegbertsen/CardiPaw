/**
 * Share link format: `<origin>/share#d=<payload>`. The payload sits in the fragment so it is
 * never sent to a web server (no access logs, no request-line length limit). The path `/share`
 * is what the Android app claims as an App Link; legacy links (`<origin>/#/share?d=…`) still
 * open in the browser.
 */

export interface ShareRoute {
  name: 'share';
  query: { d: string };
}

/** `<origin>/share#d=<encoded>`; `origin` may be a bare origin or any URL on it. */
export function shareLinkUrl(encoded: string, origin: string): string {
  const url = new URL('/share', origin);
  url.hash = new URLSearchParams({ d: encoded }).toString();
  return url.href;
}

/**
 * The share route a URL stands for, or null when it is not a share link on `origin`.
 * Only `d` is copied out of the URL: nothing else from it ever reaches the router.
 */
export function shareRouteFromUrl(url: string, { origin }: { origin: string }): ShareRoute | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== new URL(origin).origin) return null;
  let d: string | null;
  if (u.pathname === '/share') {
    d = new URLSearchParams(u.hash.slice(1)).get('d');
  } else if (u.pathname === '/' && u.hash.startsWith('#/share')) {
    // Legacy hash-route link. Resolve it as a URL so `/share?d=…` parses like a query.
    const legacy = new URL(u.hash.slice(1), 'https://legacy.invalid');
    if (legacy.pathname !== '/share') return null;
    d = legacy.searchParams.get('d');
  } else {
    return null;
  }
  return { name: 'share', query: { d: d ?? '' } };
}

/**
 * Where the website should rewrite a page loaded at `/share#d=…` to, so the hash router (which
 * uses the page's path as its base) starts from `/`. Null when there is nothing to rewrite.
 */
export function shareEntryHref(location: { pathname: string; hash: string }): string | null {
  if (location.pathname !== '/share') return null;
  const d = new URLSearchParams(location.hash.slice(1)).get('d');
  return d ? `/#/share?d=${encodeURIComponent(d)}` : '/#/share';
}
