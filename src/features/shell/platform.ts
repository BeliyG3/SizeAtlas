export type Platform = "windows" | "mac" | "other";

/** The operating system the webview runs on. */
export function platform(): Platform {
  const agent = navigator.userAgent;
  if (/Windows/i.test(agent)) return "windows";
  if (/Mac/i.test(agent)) return "mac";
  return "other";
}
