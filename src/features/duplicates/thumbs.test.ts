import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThumbQueue, mimeOf } from "./thumbs";

/** A request that ends when the test says. */
function pending() {
  let done: (bytes: ArrayBuffer) => void = () => {};
  const promise = new Promise<ArrayBuffer>((resolve) => (done = resolve));
  return { promise, done };
}

describe("createThumbQueue", () => {
  it("runs two at a time, drops waiting ones out of view, starts the next when one ends", async () => {
    const queue = createThumbQueue();
    const started: string[] = [];
    const runs = new Map<string, ReturnType<typeof pending>>();
    const asked = ["1", "2", "3", "4", "5"].map((key) => {
      const run = pending();
      runs.set(key, run);
      const answer = queue.request(key, () => {
        started.push(key);
        return run.promise;
      });
      return answer.then(
        () => "done",
        (e: Error) => e.message,
      );
    });
    expect(started).toEqual(["1", "2"]);
    queue.keep(new Set(["5"]));
    expect(await asked[2]).toBe("cancelled");
    expect(await asked[3]).toBe("cancelled");
    runs.get("1")!.done(new ArrayBuffer(1));
    expect(await asked[0]).toBe("done");
    expect(started).toEqual(["1", "2", "5"]);
  });

  it("asks once for a key that is already asked for", () => {
    const queue = createThumbQueue();
    let calls = 0;
    const run = () => {
      calls++;
      return new Promise<ArrayBuffer>(() => {});
    };
    expect(queue.request("a", run)).toBe(queue.request("a", run));
    expect(calls).toBe(1);
  });

  it("goes on after a request that fails", async () => {
    const queue = createThumbQueue(1);
    const failed = queue.request("a", () => Promise.reject(new Error("gone")));
    const next = queue.request("b", () => Promise.resolve(new ArrayBuffer(2)));
    await expect(failed).rejects.toThrow("gone");
    expect((await next).byteLength).toBe(2);
  });
});

describe("the picture URLs", () => {
  const file = "k|image/png|C:\\|1|2";
  const bytes = (n: number) => () => Promise.resolve(new ArrayBuffer(n));
  beforeEach(() => {
    let made = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:${++made}`),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("one_url_for_every_holder", async () => {
    const queue = createThumbQueue();
    const run = vi.fn(bytes(3));
    const first = queue.acquire(file, "image/png", run);
    const second = queue.acquire(file, "image/png", run);
    expect(await first).toBe("blob:1");
    expect(await second).toBe("blob:1");
    expect(run).toHaveBeenCalledTimes(1);
    expect((vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).type).toBe("image/png");
    queue.release(file);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    queue.release(file);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
  });

  it("no_url_for_empty_bytes", async () => {
    const queue = createThumbQueue();
    const run = vi.fn(bytes(0));
    expect(await queue.acquire(file, "image/png", run)).toBeNull();
    expect(await queue.acquire(file, "image/png", run)).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("a_release_before_the_load_revokes_it_when_it_comes", async () => {
    const queue = createThumbQueue();
    const load = pending();
    const url = queue.acquire(file, "image/png", () => load.promise);
    queue.release(file);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    load.done(new ArrayBuffer(3));
    expect(await url).toBe("blob:1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
  });

  it("goes through the queue by the group key, and asks again after a failure", async () => {
    const queue = createThumbQueue(1);
    const busy = pending();
    queue.request("busy", () => busy.promise);
    const kept = queue.acquire(file, "image/png", bytes(3));
    queue.keep(new Set(["k"]));
    busy.done(new ArrayBuffer(1));
    expect(await kept).toBe("blob:1");
    queue.request("busy", () => new Promise<ArrayBuffer>(() => {}));
    const dropped = queue.acquire("d|image/png|C:\\|1|3", "image/png", bytes(3));
    queue.keep(new Set(["k"]));
    await expect(dropped).rejects.toThrow("cancelled");
    const other = createThumbQueue();
    const failing = () => Promise.reject(new Error("gone"));
    await expect(other.acquire(file, "image/png", failing)).rejects.toThrow("gone");
    expect(await other.acquire(file, "image/png", bytes(3))).toBe("blob:2");
  });
});

describe("mimeOf", () => {
  it("knows the image types the webview shows, by the name, in any case", () => {
    expect(mimeOf("a.SVG")).toBe("image/svg+xml");
    expect(mimeOf("b.jpeg")).toBe("image/jpeg");
    expect(mimeOf("c.JPG")).toBe("image/jpeg");
    expect(mimeOf("d.ico")).toBe("image/x-icon");
    expect(mimeOf("e.webp")).toBe("image/webp");
    expect(mimeOf("a.heic")).toBeNull();
    expect(mimeOf("png")).toBeNull();
  });
});
