import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { useRestartElevated } from "./elevation";

const state = vi.hoisted(() => ({ busy: false }));

// One hook instance: state survives, effects run at once.
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => void) => void effect(),
  useState: (initial: unknown) => [
    state.busy || initial,
    (next: boolean) => {
      state.busy = next;
    },
  ],
}));
vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../api/client", () => ({
  api: { restartElevated: vi.fn(), isElevated: vi.fn() },
  isCmdError: (e: unknown) => typeof e === "object" && e !== null && "code" in e,
}));

const push = vi.fn();
const errorText = (e: unknown) => `error ${JSON.stringify(e)}`;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  state.busy = false;
  push.mockReset();
  vi.mocked(api.restartElevated).mockReset();
});

describe("restart as administrator", () => {
  it("restarts the root, with the button off meanwhile", () => {
    vi.mocked(api.restartElevated).mockReturnValue(new Promise(() => {}));
    useRestartElevated("C:\\", push, errorText).run();
    expect(api.restartElevated).toHaveBeenCalledWith(["C:\\"]);
    expect(state.busy).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it("says that nothing was restarted when the user refuses the prompt", async () => {
    vi.mocked(api.restartElevated).mockRejectedValue({ code: "Cancelled" });
    useRestartElevated("C:\\", push, errorText).run();
    await flush();
    expect(push).toHaveBeenCalledWith("banner.restartCancelled");
    expect(state.busy).toBe(false);
  });

  it("gives the message of the system alone for a failure", async () => {
    vi.mocked(api.restartElevated).mockRejectedValue({
      code: "Io",
      path: "x",
      osMessage: "denied",
    });
    useRestartElevated("C:\\", push, errorText).run();
    await flush();
    expect(push).toHaveBeenCalledWith('banner.restartFailed {"message":"denied"}');
  });

  it("names other failures with the app's own error text", async () => {
    vi.mocked(api.restartElevated).mockRejectedValue({ code: "Busy" });
    useRestartElevated("C:\\", push, errorText).run();
    await flush();
    expect(push).toHaveBeenCalledWith(
      'banner.restartFailed {"message":"error {\\"code\\":\\"Busy\\"}"}',
    );
  });
});
