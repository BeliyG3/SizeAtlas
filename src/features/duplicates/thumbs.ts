/** The image types the backend gives thumbnails of (`image_size::THUMB_EXTS`). */
const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  avif: "image/avif",
};

/** The media type of a thumbnail of the file `name`; null when it gets none (no request). */
export function mimeOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return TYPES[name.slice(dot + 1).toLowerCase()] ?? null;
}

export interface ThumbQueue {
  /** `run` once its turn comes; the same key asked again meanwhile shares that request. */
  request(key: string, run: () => Promise<ArrayBuffer>): Promise<ArrayBuffer>;
  /** Requests still waiting whose key is not in `keys` fail with "cancelled" (out of view). */
  keep(keys: ReadonlySet<string>): void;
}

interface Waiting {
  key: string;
  run: () => Promise<ArrayBuffer>;
  resolve: (buf: ArrayBuffer) => void;
  reject: (e: Error) => void;
}

/**
 * Thumbnail requests, at most `limit` at a time: each one reads a file, and scrolling past rows
 * must not queue reads of all of them. A request that runs is not stopped.
 */
export function createThumbQueue(limit = 2): ThumbQueue {
  const waiting: Waiting[] = [];
  const asked = new Map<string, Promise<ArrayBuffer>>();
  let running = 0;
  const next = () => {
    while (running < limit && waiting.length > 0) {
      const job = waiting.shift()!;
      running++;
      // A `run` that throws fails its request, as a rejected one does.
      new Promise<ArrayBuffer>((resolve) => resolve(job.run()))
        .then(job.resolve, job.reject)
        .finally(() => {
          running--;
          next();
        });
    }
  };
  return {
    request(key, run) {
      const known = asked.get(key);
      if (known) return known;
      const answer = new Promise<ArrayBuffer>((resolve, reject) =>
        waiting.push({ key, run, resolve, reject }),
      );
      asked.set(key, answer);
      const forget = () => {
        if (asked.get(key) === answer) asked.delete(key);
      };
      answer.then(forget, forget);
      next();
      return answer;
    },
    keep(keys) {
      for (let i = waiting.length - 1; i >= 0; i--) {
        if (keys.has(waiting[i].key)) continue;
        const [job] = waiting.splice(i, 1);
        job.reject(new Error("cancelled"));
      }
    },
  };
}
