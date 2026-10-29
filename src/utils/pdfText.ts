import type { Reading } from '../types';
import { localDayKey, localMonthKey } from './date';
import { calendarAge } from './age';
import { isRichText } from './richText';

// The calls PDF text makes on vue-i18n's `t`. Spelled out because `t`'s own type is
// tied to one instance's locale, so the app's and the tests' translators wouldn't mix.
export interface Translator {
  (key: string): string;
  (key: string, plural: number): string;
  (key: string, named: Record<string, unknown>): string;
}

/** One point per local day of `monthKey` ("YYYY-MM"): the day's rounded average rate. */
export function aggregateByDay(
  readings: Reading[],
  monthKey: string,
): { date: string; rate: number }[] {
  const inMonth = readings.filter((r) => localMonthKey(r.date) === monthKey);
  const groups = new Map<string, number[]>();
  for (const r of inMonth) {
    const day = localDayKey(r.date);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(r.rate);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, rates]) => ({
      date: `${day}T12:00:00`,
      rate: Math.round(rates.reduce((s, r) => s + r, 0) / rates.length),
    }));
}

/** The pet's age for the PDF header, e.g. "11 months", "2 years" or "2y 3mo". */
export function formatPdfAge(birthdate: string, t: Translator, now = new Date()): string {
  const { years, months, totalMonths } = calendarAge(birthdate, now);
  if (totalMonths < 12) return t('pdf.ageMonths', totalMonths);
  if (months === 0) return t('pdf.ageYears', years);
  return t('pdf.ageYearMonth', { y: years, m: months });
}

/** Turns a stored note (editor HTML or legacy plain text) into text for jsPDF. */
export function htmlToPlainText(html: string): string {
  // Legacy plain-text notes would lose text like "<39 and >38" to the tag stripper.
  if (!isRichText(html)) return html.trim();
  return html
    .replace(/(<p>\s*<\/p>)+$/gi, '') // strip trailing empty paragraphs
    .replace(/<li[^>]*>\s*<p[^>]*>/gi, '- ') // tiptap: <li><p> → dash prefix
    .replace(/<\/p>\s*<\/li>/gi, '\n') // tiptap: </p></li> → newline
    .replace(/<li[^>]*>/gi, '- ') // fallback bare <li>
    .replace(/<\/li>/gi, '\n') // fallback bare </li>
    .replace(/<\/p>/gi, '\n') // </p> → newline
    .replace(/<\/h[1-6]>/gi, '\n') // headings
    .replace(/<br\s*\/?>/gi, '\n') // line breaks
    .replace(/<[^>]+>/g, '') // strip remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&') // last, so "&amp;lt;" stays the literal "&lt;"
    .replace(/\n{3,}/g, '\n\n') // collapse excess blank lines
    .trim();
}
