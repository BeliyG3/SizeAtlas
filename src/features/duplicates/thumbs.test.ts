import { describe, expect, it } from "vitest";
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
