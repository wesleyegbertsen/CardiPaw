import { describe, expect, it } from 'vitest';
import { shareEntryHref, shareLinkUrl, shareRouteFromUrl } from './shareLink';

const origin = 'https://cardipaw.com/';

describe('shareLinkUrl', () => {
  it('puts the payload in the fragment of /share/', () => {
    expect(shareLinkUrl('abc_-', origin)).toBe('https://cardipaw.com/share/#d=abc_-');
    expect(shareLinkUrl('x', 'http://localhost:8080/pets/1')).toBe('http://localhost:8080/share/#d=x');
  });
  it('has no query string', () => {
    expect(new URL(shareLinkUrl('x', origin)).search).toBe('');
  });
});

describe('shareRouteFromUrl', () => {
  const route = (d: string) => ({ name: 'share', query: { d } });
  it('reads the new format, with or without the trailing slash', () => {
    expect(shareRouteFromUrl('https://cardipaw.com/share/#d=abc', { origin })).toEqual(route('abc'));
    expect(shareRouteFromUrl('https://cardipaw.com/share#d=abc', { origin })).toEqual(route('abc'));
  });
  it('reads the legacy hash-route format', () => {
    expect(shareRouteFromUrl('https://cardipaw.com/#/share?d=abc', { origin })).toEqual(route('abc'));
  });
  it('gives the share view an empty d when there is none', () => {
    expect(shareRouteFromUrl('https://cardipaw.com/share', { origin })).toEqual(route(''));
    expect(shareRouteFromUrl('https://cardipaw.com/share#d=', { origin })).toEqual(route(''));
  });
  it('copies only d', () => {
    expect(shareRouteFromUrl('https://cardipaw.com/share#d=x&next=/settings', { origin })).toEqual(route('x'));
    expect(shareRouteFromUrl('https://cardipaw.com/#/share?d=x&path=/settings', { origin })).toEqual(route('x'));
  });
  it.each([
    'https://evil.example/share#d=x',
    'http://cardipaw.com/share#d=x',
    'https://cardipaw.com.evil.example/share#d=x',
    'https://cardipaw.com/shared#d=x',
    'https://cardipaw.com/share/x#d=x',
    'https://cardipaw.com/share//#d=x',
    'https://cardipaw.com/',
    'https://cardipaw.com/#/settings',
    'https://cardipaw.com/#/shared?d=x',
    'not a url',
    '',
  ])('ignores %s', (url) => {
    expect(shareRouteFromUrl(url, { origin })).toBeNull();
  });
});

describe('shareEntryHref', () => {
  it('rewrites /share#d= to the hash route', () => {
    expect(shareEntryHref({ pathname: '/share', hash: '#d=x' })).toBe('/#/share?d=x');
    expect(shareEntryHref({ pathname: '/share', hash: '#d=a%2Bb' })).toBe('/#/share?d=a%2Bb');
  });
  it('rewrites /share/#d= and /share#d= alike', () => {
    expect(shareEntryHref({ pathname: '/share/', hash: '#d=x' })).toBe('/#/share?d=x');
    expect(shareEntryHref({ pathname: '/share/', hash: '' })).toBe('/#/share');
  });
  it('rewrites a bare /share', () => {
    expect(shareEntryHref({ pathname: '/share', hash: '' })).toBe('/#/share');
  });
  it.each([
    ['/', ''],
    ['/', '#/share?d=x'],
    ['/', '#/settings'],
    ['/shared', '#d=x'],
  ])('leaves %s%s alone', (pathname, hash) => {
    expect(shareEntryHref({ pathname, hash })).toBeNull();
  });
});
