// Build-time only: vite.config.ts turns nginx.conf's policy into the app's meta tag.
import { LATEST_RELEASE_API } from '../utils/version';

// A meta tag can't carry these; the WebView never frames the app anyway.
const HEADER_ONLY_DIRECTIVES = ['frame-ancestors', 'report-uri', 'sandbox'];

/**
 * What the app, but not the website, may fetch: the one URL of the opt-in update check
 * (useUpdateCheck). A source with a path and no trailing slash matches only that exact path,
 * so the page can't reach the rest of api.github.com.
 */
export const NATIVE_CONNECT_SRC = [LATEST_RELEASE_API];

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
