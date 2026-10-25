import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import nl from './locales/nl.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import ja from './locales/ja.json';

// check-locale covers matching keys; this covers what a translator can break inside a
// message: a renamed or missing {placeholder}, or a lost plural branch.

type Messages = { [key: string]: string | Messages };

function flatten(obj: Messages, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [[`${prefix}${k}`, v] as [string, string]]
      : flatten(v, `${prefix}${k}.`),
  );
}

const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*(\w+)\s*\}/g)].map((m) => m[1]))].sort();
const branches = (message: string) => message.split('|').length;

const base = new Map(flatten(en));
const locales = { nl, de, fr, ja } as Record<string, Messages>;

describe.each(Object.entries(locales))('%s messages', (code, messages) => {
  const entries = flatten(messages).filter(([key]) => base.has(key));

  it('use the same placeholders as English', () => {
    const mismatches = entries
      .filter(([key, msg]) => placeholders(msg).join() !== placeholders(base.get(key)!).join())
      .map(([key, msg]) => `${key}: ${JSON.stringify(msg)}`);
    expect(mismatches).toEqual([]);
  });

  it('keep the English plural branches', () => {
    // Japanese has no grammatical plural, so a single form is fine there.
    const mismatches = entries
      .filter(([key, msg]) => {
        const count = branches(msg);
        return count !== branches(base.get(key)!) && !(code === 'ja' && count === 1);
      })
      .map(([key, msg]) => `${key}: ${JSON.stringify(msg)}`);
    expect(mismatches).toEqual([]);
  });
});
