/** The first character of a pet's name for avatar placeholders; `?` when the name is blank. */
export const petInitial = (name: string): string =>
  Array.from(name.trim())[0]?.toUpperCase() ?? '?';
