import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const nginxConf = readFileSync(new URL('../../nginx.conf', import.meta.url), 'utf8');

describe('Permissions-Policy', () => {
  const header = nginxConf.match(/add_header Permissions-Policy "([^"]+)" always;/)?.[1];
  it('is sent on every response', () => {
    expect(header).toBeDefined();
  });
  it('lets the site itself use the camera and nothing else', () => {
    const features = Object.fromEntries(header!.split(', ').map((f) => f.split('=')));
    expect(features).toEqual({
      camera: '(self)',
      microphone: '()',
      geolocation: '()',
      payment: '()',
      usb: '()',
    });
  });
});
