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
