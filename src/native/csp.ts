// Build-time only: vite.config.ts turns nginx.conf's policy into the app's meta tag.

// A meta tag can't carry these; the WebView never frames the app anyway.
const HEADER_ONLY_DIRECTIVES = ['frame-ancestors', 'report-uri', 'sandbox'];

/** Hosts the app, but not the website, may fetch: the opt-in update check (useUpdateCheck). */
export const NATIVE_CONNECT_SRC = ['https://api.github.com'];

const name = (directive: string) => directive.split(' ')[0];

/**
 * nginx.conf's Content-Security-Policy for the app, which no server sends it. The website's
 * policy is the one source; the app only adds NATIVE_CONNECT_SRC to connect-src.
 */
export function nativeCsp(nginxConf: string): string {
  const policy = /add_header Content-Security-Policy "([^"]+)"/.exec(nginxConf)?.[1];
  if (!policy) {
    throw new Error(
      'No Content-Security-Policy in nginx.conf: update nativeCsp in src/native/csp.ts',
    );
  }
  const directives = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive && !HEADER_ONLY_DIRECTIVES.includes(name(directive)));
  const connect = directives.findIndex((directive) => name(directive) === 'connect-src');
  if (connect === -1) {
    throw new Error('No connect-src in nginx.conf: update nativeCsp in src/native/csp.ts');
  }
  directives[connect] = [directives[connect], ...NATIVE_CONNECT_SRC].join(' ');
  return directives.join('; ');
}
