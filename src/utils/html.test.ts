// @vitest-environment jsdom
// jsdom, not happy-dom: DOMPurify relies on a spec-compliant DOM, and under happy-dom it
// lets `javascript:` links and event handlers through, so these tests would prove nothing.
import { describe, expect, it, vi } from 'vitest';
import { richTextToSafeHtml } from './html';

describe('richTextToSafeHtml: rich text', () => {
  it('keeps the tags and attributes the editor produces', () => {
    const html =
      '<p><strong>Bold</strong> <em>it</em> <u>under</u><br>line</p>' +
      '<ul><li>one</li></ul><ol start="3" type="a"><li>three</li></ol>';
    expect(richTextToSafeHtml(html)).toBe(html);
  });

  it.each([
    ['javascript:', '<p><a href="javascript:alert(1)">x</a></p>', '<p><a>x</a></p>'],
    ['mixed-case javascript:', '<p><a href="JaVaScRiPt:alert(1)">x</a></p>', '<p><a>x</a></p>'],
    [
      'entity-encoded javascript:',
      '<p><a href="&#106;avascript:alert(1)">x</a></p>',
      '<p><a>x</a></p>',
    ],
    ['tab-split javascript:', '<p><a href="java\tscript:alert(1)">x</a></p>', '<p><a>x</a></p>'],
    ['space-led javascript:', '<p><a href=" javascript:alert(1)">x</a></p>', '<p><a>x</a></p>'],
    ['data:', '<p><a href="data:text/html,hi">x</a></p>', '<p><a>x</a></p>'],
    ['onerror', '<p><img src="x" onerror="alert(1)">hi</p>', '<p>hi</p>'],
    ['onclick', '<p onclick="alert(1)">hi</p>', '<p>hi</p>'],
    ['script content', '<p>a<script>alert(1)</script>b</p>', '<p>ab</p>'],
    ['style content', '<p>a<style>p{color:red}</style>b</p>', '<p>ab</p>'],
    ['svg content', '<p>a<svg><circle onload="alert(1)"></circle>t</svg>b</p>', '<p>ab</p>'],
  ])('removes %s', (_label, input, expected) => {
    expect(richTextToSafeHtml(input)).toBe(expected);
  });

  it('keeps the text of tags outside the allowlist', () => {
    expect(richTextToSafeHtml('<p><span class="x">kept</span> <code>too</code></p>')).toBe(
      '<p>kept too</p>',
    );
  });

  it('allows start and type only on <ol>, and href only on <a>', () => {
    expect(richTextToSafeHtml('<ul start="2" type="a"><li>x</li></ul>')).toBe(
      '<ul><li>x</li></ul>',
    );
    expect(richTextToSafeHtml('<p href="https://example.com">x</p>')).toBe('<p>x</p>');
    expect(richTextToSafeHtml('<ol start="2"><li>x</li></ol>')).toBe(
      '<ol start="2"><li>x</li></ol>',
    );
  });

  it('opens web links in a new tab without an opener', () => {
    const out = richTextToSafeHtml('<p><a href="https://vet.example">vet</a></p>');
    const link = new DOMParser().parseFromString(out, 'text/html').querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://vet.example');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('hands mailto: and tel: links over without a target', () => {
    expect(richTextToSafeHtml('<p><a href="mailto:vet@example.com">mail</a></p>')).toBe(
      '<p><a href="mailto:vet@example.com">mail</a></p>',
    );
    expect(richTextToSafeHtml('<p><a href="tel:+31201234567">call</a></p>')).toBe(
      '<p><a href="tel:+31201234567">call</a></p>',
    );
  });
});

describe('richTextToSafeHtml: legacy plain text', () => {
  it('escapes HTML and turns newlines into <br>', () => {
    expect(richTextToSafeHtml('a & b\r\n<i>"c"</i>\n\'d\'')).toBe(
      'a &amp; b<br>&lt;i&gt;&quot;c&quot;&lt;/i&gt;<br>&#39;d&#39;',
    );
  });

  it('treats text that merely starts with < as plain text', () => {
    expect(richTextToSafeHtml('<3 after walk')).toBe('&lt;3 after walk');
    expect(richTextToSafeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('returns an empty string for a non-string value', () => {
    expect(richTextToSafeHtml(undefined as unknown as string)).toBe('');
    expect(richTextToSafeHtml(42 as unknown as string)).toBe('');
  });
});

describe('richTextToSafeHtml: unsupported DOMPurify', () => {
  it('fails closed and escapes rich text', async () => {
    vi.resetModules();
    vi.doMock('dompurify', () => ({
      default: () => ({
        isSupported: false,
        setConfig: () => {},
        addHook: () => {},
        sanitize: (html: string) => html,
      }),
    }));
    try {
      const { richTextToSafeHtml: sanitize } = await import('./html');
      expect(sanitize('<p onclick="x()">hi</p>')).toBe(
        '&lt;p onclick=&quot;x()&quot;&gt;hi&lt;/p&gt;',
      );
    } finally {
      // Drop the mocked module graph so later tests import the real DOMPurify.
      vi.doUnmock('dompurify');
      vi.resetModules();
    }
  });
});
