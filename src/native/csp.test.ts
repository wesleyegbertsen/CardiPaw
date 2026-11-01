import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LATEST_RELEASE_API } from '../utils/version';
import { nativeCsp } from './csp';

const nginxConf = readFileSync(new URL('../../nginx.conf', import.meta.url), 'utf8');
const conf = (policy: string) => `add_header Content-Security-Policy "${policy}" always;`;

describe('nativeCsp', () => {
  it("turns the website's policy into the app's", () => {
    expect(nativeCsp(nginxConf)).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self' data:; " +
        "connect-src 'self' https://api.github.com/repos/wesleyegbertsen/CardiPaw/releases/latest; " +
        "worker-src 'self'; manifest-src 'self'; " +
        "object-src 'none'; base-uri 'none'; form-action 'none'",
    );
  });

  it("drops the directives a meta tag can't carry", () => {
    expect(
      nativeCsp(conf("frame-ancestors 'none'; connect-src 'self'; report-uri /r; sandbox")),
    ).toBe("connect-src 'self' https://api.github.com/repos/wesleyegbertsen/CardiPaw/releases/latest");
  });

  it('lets the app fetch only the release URL the update check asks, not all of api.github.com', () => {
    const connect = nativeCsp(nginxConf)
      .split('; ')
      .find((directive) => directive.startsWith('connect-src '))!
      .split(' ');
    expect(connect).toContain(LATEST_RELEASE_API);
    expect(connect).not.toContain('https://api.github.com');
    expect(connect).not.toContain('https://api.github.com/');
  });

  it('throws without a policy or without connect-src', () => {
    expect(() => nativeCsp('server {}')).toThrow('No Content-Security-Policy in nginx.conf');
    expect(() => nativeCsp(conf("default-src 'self'"))).toThrow('No connect-src in nginx.conf');
  });
});
