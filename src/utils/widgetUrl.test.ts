import { describe, expect, it } from 'vitest';
import { parseWidgetUrl, WIDGET_URL_SCHEME } from './widgetUrl';

describe('parseWidgetUrl', () => {
  it('reads a pet tap', () => {
    expect(parseWidgetUrl('cardipaw-widget://pet/pet-1')).toEqual({ kind: 'pet', petId: 'pet-1' });
  });

  it('decodes an id that Java percent-encoded', () => {
    expect(parseWidgetUrl('cardipaw-widget://pet/a%2Fb')).toEqual({ kind: 'pet', petId: 'a/b' });
    expect(parseWidgetUrl('cardipaw-widget://pet/M%C3%BCsli%20%231')).toEqual({
      kind: 'pet',
      petId: 'Müsli #1',
    });
  });

  it('reads a tap that opens home', () => {
    expect(parseWidgetUrl(`${WIDGET_URL_SCHEME}://home`)).toEqual({ kind: 'home' });
  });

  it('does not trim the id', () => {
    // Java encodes a space as %20, so only another app sends one raw: no pet is found, and the
    // tap goes home.
    expect(parseWidgetUrl('cardipaw-widget://pet/x ')).toEqual({ kind: 'pet', petId: 'x ' });
  });

  it('takes an id of up to 200 characters', () => {
    const id = 'x'.repeat(200);
    expect(parseWidgetUrl(`cardipaw-widget://pet/${id}`)).toEqual({ kind: 'pet', petId: id });
    expect(parseWidgetUrl(`cardipaw-widget://pet/${id}x`)).toBeNull();
  });

  it.each([
    ['an app URL', 'https://localhost/#/pets/x'],
    ['another scheme', 'other://pet/p1'],
    ['a path below the pet', 'cardipaw-widget://pet/a/b'],
    ['a query', 'cardipaw-widget://pet/a?x=1'],
    ['a fragment', 'cardipaw-widget://pet/a#f'],
    ['an empty id', 'cardipaw-widget://pet/'],
    ['a malformed escape', 'cardipaw-widget://pet/%E0%A4%A'],
    ['another case', 'cardipaw-widget://PET/x'],
    ['another host', 'cardipaw-widget://homes'],
    ['a leading space', ' cardipaw-widget://pet/x'],
    ['a trailing space after home', 'cardipaw-widget://home '],
  ])('ignores %s', (_label, url) => {
    expect(parseWidgetUrl(url)).toBeNull();
  });
});
