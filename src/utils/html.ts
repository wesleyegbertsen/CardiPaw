import createDOMPurify, { type DOMPurify } from 'dompurify';

/**
 * Tags the rich text editor (TipTap StarterKit) can produce. Anything else is
 * removed; the text inside a removed tag is kept, except for elements such as
 * `script` and `style`, whose content DOMPurify drops entirely.
 */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a'];

/** `href` for links; `start` and `type` for numbered lists. */
const ALLOWED_ATTR = ['href', 'start', 'type'];

/** Only web, mail and phone links survive; `javascript:`, `data:` etc. are dropped. */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|tel:)/i;

/**
 * TipTap's getHTML() always starts with one of these block tags. Anything else is
 * legacy plain text, even if it happens to start with `<` (e.g. "<3 after walk").
 */
const RICH_TEXT_START = /^<(?:p|ul|ol)[\s/>]/i;

let purifier: DOMPurify | null = null;

/** A private, lazily created instance so its config and hook don't affect other DOMPurify users. */
function getPurifier(): DOMPurify {
  if (purifier) return purifier;
  purifier = createDOMPurify(window);
  purifier.setConfig({
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // Otherwise DOMPurify checks `start="3"` / `type="a"` against ALLOWED_URI_REGEXP and drops them.
    ADD_URI_SAFE_ATTR: ['start', 'type'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  purifier.addHook('afterSanitizeAttributes', node => {
    // `href` belongs on links and `start`/`type` on numbered lists; drop them anywhere else.
    if (node.tagName !== 'A') node.removeAttribute('href');
    if (node.tagName !== 'OL') {
      node.removeAttribute('start');
      node.removeAttribute('type');
    }
    // Web links open outside the app; mailto:/tel: are handed to the OS as-is.
    if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  return purifier;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

/**
 * Turns a stored note or reading note into HTML that is safe for `v-html`.
 * Rich text (TipTap HTML) is sanitized against the allowlist above; legacy plain
 * text is HTML-escaped and its newlines become `<br>`.
 */
export function richTextToSafeHtml(raw: string): string {
  // Stored records aren't guaranteed to match their types (e.g. a hand-edited backup).
  if (typeof raw !== 'string') return '';
  if (!RICH_TEXT_START.test(raw.trimStart())) return plainTextToHtml(raw);

  const dompurify = getPurifier();
  // DOMPurify returns its input unchanged when it can't run; fail closed instead.
  if (!dompurify.isSupported) return plainTextToHtml(raw);

  return dompurify.sanitize(raw);
}
