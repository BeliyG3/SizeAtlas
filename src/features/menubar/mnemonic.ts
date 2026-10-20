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
 * Whether Alt+`key` (`KeyboardEvent.key`, with `code` its physical key) opens the menu titled
 * `label`: the typed letter matches, or the mnemonic is a Latin letter and its physical key was
 * pressed, which keeps "(&F)" working on an Arabic, Hebrew, Russian or Thai layout.
 */
export function mnemonicHit(label: string, key: string, code: string): boolean {
  const letter = mnemonic(label).key;
  if (letter === null) return false;
  if (letter === key.toLocaleLowerCase()) return true;
  return /^[a-z]$/.test(letter) && code === `Key${letter.toUpperCase()}`;
}
