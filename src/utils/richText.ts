// Kept free of imports so the lazily loaded PDF code can use it without pulling in DOMPurify.

/**
 * TipTap's getHTML() always starts with one of these block tags. Anything else is
 * legacy plain text, even if it happens to start with `<` (e.g. "<3 after walk").
 */
export const RICH_TEXT_START = /^<(?:p|ul|ol)[\s/>]/i;

/** Whether a stored note is editor HTML (as opposed to legacy plain text). */
export const isRichText = (raw: string) => RICH_TEXT_START.test(raw.trimStart());
