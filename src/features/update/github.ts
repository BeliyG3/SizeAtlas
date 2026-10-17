import { parseVersion } from "../menubar/version";

/** The project page; the only site the app opens. */
export const REPOSITORY = "https://github.com/BeliyG3/SizeAtlas";
/** The newest published release: GitHub leaves drafts and prereleases out. */
const LATEST = "https://api.github.com/repos/BeliyG3/SizeAtlas/releases/latest";
const TIMEOUT_MS = 15_000;

export interface Release {
  /** As shown, from the tag without its "v": `2026.11` or `2026.11.1`. */
  version: string;
  /** The release page on GitHub. */
  url: string;
}

/** Why a check gave no answer. */
export type FailReason = "offline" | "limited" | "missing" | "unexpected";

export type CheckResult = { ok: true; release: Release } | { ok: false; reason: FailReason };

/** The release in an answer of the GitHub API; null for a draft, a prerelease or an unknown tag. */
export function readRelease(data: unknown): Release | null {
  if (typeof data !== "object" || data === null) return null;
  const { tag_name: tag, html_url: url, draft, prerelease } = data as Record<string, unknown>;
  if (draft === true || prerelease === true) return null;
  if (typeof tag !== "string" || !tag.startsWith("v")) return null;
  const version = tag.slice(1);
  if (parseVersion(version) === null) return null;
  const page =
    typeof url === "string" && url.startsWith(`${REPOSITORY}/`) ? url : `${REPOSITORY}/releases`;
  return { version, url: page };
}

/** Asks GitHub for the latest release; nothing but the request itself is sent. */
export async function fetchLatest(): Promise<CheckResult> {
  let response: Response;
  try {
    response = await fetch(LATEST, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "offline" };
  }
  if (response.status === 403 || response.status === 429) return { ok: false, reason: "limited" };
  if (response.status === 404) return { ok: false, reason: "missing" };
  if (!response.ok) return { ok: false, reason: "unexpected" };
  try {
    const release = readRelease(await response.json());
    return release ? { ok: true, release } : { ok: false, reason: "unexpected" };
  } catch {
    return { ok: false, reason: "unexpected" };
  }
}
