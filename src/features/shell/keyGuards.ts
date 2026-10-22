/** Typing in these must keep Alt+arrows, Cmd+brackets and the window shortcuts to itself. */
export const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));

/** An open dialog or menu keeps the view where it is. */
export const busy = (target: EventTarget | null) =>
  document.querySelector("dialog[open]") !== null ||
  (target instanceof Element && target.closest('[role="menu"]') !== null);
