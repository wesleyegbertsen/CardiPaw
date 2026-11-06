// The URLs a home screen widget tap opens the app with (WidgetIntents.java builds them).
// MainActivity is exported, so any app can send one: parse strictly and treat it as untrusted.

export const WIDGET_URL_SCHEME = 'cardipaw-widget';
const MAX_ID_LENGTH = 200;

export type WidgetTarget = { kind: 'pet'; petId: string } | { kind: 'home' };

/** The widget tap's target, or null for any other URL. */
export function parseWidgetUrl(url: string): WidgetTarget | null {
  if (url === `${WIDGET_URL_SCHEME}://home`) return { kind: 'home' };
  const match = /^cardipaw-widget:\/\/pet\/([^/?#]+)$/.exec(url);
  if (!match) return null;
  let petId: string;
  try {
    petId = decodeURIComponent(match[1]);
  } catch {
    return null; // malformed %-escape
  }
  return petId.length > 0 && petId.length <= MAX_ID_LENGTH ? { kind: 'pet', petId } : null;
}
