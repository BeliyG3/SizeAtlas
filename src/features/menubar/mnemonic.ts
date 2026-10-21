/**
 * A menu title written with "&" before the letter that opens it with Alt ("&File"): the text
 * without the "&", the index of that letter in it and the letter in lower case (-1 and null when
 * there is none).
 */
export function mnemonic(label: string): { text: string; at: number; key: string | null } {
  const at = label.indexOf("&");
  const text = label.replace("&", "");
  if (at < 0 || at >= text.length) return { text, at: -1, key: null };
  return { text, at, key: text.charAt(at).toLocaleLowerCase() };
}

/**
 * The menu Alt+`key` (`KeyboardEvent.key`, with `code` its physical key) opens: the first whose
 * letter was typed, else the first whose mnemonic is a Latin letter on that physical key, which
 * keeps "(&F)" working on an Arabic, Hebrew, Russian or Thai layout. The typed letter goes first
 * so that on AZERTY or Dvorak a menu's letter is not taken by another menu's physical key.
 */
export function mnemonicMenu<T extends { label: string }>(
  menus: readonly T[],
  key: string,
  code: string,
): T | undefined {
  const typed = key.toLocaleLowerCase();
  const letters = menus.map((m) => mnemonic(m.label).key);
  const at = letters.indexOf(typed);
  if (at >= 0) return menus[at];
  return menus.find((_, i) => {
    const letter = letters[i];
    return letter !== null && /^[a-z]$/.test(letter) && code === `Key${letter.toUpperCase()}`;
  });
}
