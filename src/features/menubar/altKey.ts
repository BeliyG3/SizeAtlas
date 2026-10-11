/** The parts of a keydown or keyup event that decide a lone Alt press. */
export interface AltKeyEvent {
  key: string;
  repeat: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Whether Alt is still held "alone" after a key event other than the release of Alt: pressed
 * with no Shift, Ctrl or Meta held (Shift+Alt switches the keyboard layout on Windows) and no
 * other key pressed or released since.
 */
export function loneAlt(alone: boolean, e: AltKeyEvent): boolean {
  if (e.key !== "Alt") return false;
  return e.repeat ? alone : !e.shiftKey && !e.ctrlKey && !e.metaKey;
}
