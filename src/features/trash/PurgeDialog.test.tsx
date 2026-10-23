import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrashPreview } from "../../api/types";
import { ConfirmDialog } from "../dialog/ConfirmDialog";
import { PurgeDialog } from "./PurgeDialog";

// A minimal hook runtime: state and refs survive explicit renders, layout effects run when their
// dependencies change, without a DOM.
const rt = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[] };
  const state = { slots: [] as Slot[], at: 0, queue: [] as (() => void)[] };
  const slot = (): Slot => (state.slots[state.at++] ??= {});
  const changed = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
  return {
    state,
    hooks: {
      useState: (initial: unknown) => {
        const s = slot();
        if (!("value" in s)) s.value = typeof initial === "function" ? initial() : initial;
        return [s.value, (next: unknown) => (s.value = next)];
      },
      useRef: (initial: unknown) => {
        const s = slot();
        if (!("value" in s)) s.value = { current: initial };
        return s.value;
      },
      useId: () => "id",
      useLayoutEffect: (run: () => void, deps?: readonly unknown[]) => {
        const s = slot();
        if (!changed(s.deps, deps)) return;
        s.deps = deps;
        state.queue.push(run);
      },
    },
  };
});
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...rt.hooks,
}));
vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));
vi.mock("../../settings/react", () => ({ useSize: () => (bytes: number) => `${bytes} B` }));

type Dialog = ReactElement<Parameters<typeof ConfirmDialog>[0]>;
type Button = ReactElement<{
  onClick: () => void;
  className?: string;
  children: ReactNode;
  ref?: unknown;
}>;

const preview: TrashPreview = {
  count: 2,
  size: 300,
  scannedAt: 1,
  paths: ["/c/a", "/c/b"],
  binFree: null,
};
const onConfirm = vi.fn();
const onClose = vi.fn();
const focus = vi.fn();

/** The elements of `node` that `match`, depth first. */
function find(node: ReactNode, match: (e: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => find(n, match));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(match(node) ? [node] : []), ...find(node.props.children, match)];
}

/** Renders the purge dialog and the dialog box it shows, then runs their layout effects. */
function render() {
  rt.state.at = 0;
  const dialog = PurgeDialog({ preview, onConfirm, onClose }) as Dialog;
  const shown = ConfirmDialog(dialog.props) as ReactElement;
  // What the effects reach: an open dialog box and the Cancel button.
  const [box] = find(shown, (e) => e.type === "dialog");
  (box.props as { ref: { current: unknown } }).ref.current = {
    open: true,
    isConnected: true,
    showModal: () => {},
  };
  const buttons = find(shown, (e) => e.type === "button") as Button[];
  const cancel = buttons.at(-1)!;
  (cancel.props as { ref: { current: unknown } }).ref.current = { focus };
  for (const run of rt.state.queue.splice(0)) run();
  return { dialog, box, main: buttons[0], cancel };
}

const click = (button: Button) => button.props.onClick();
/** Escape: the browser closes the dialog box, which says so. */
const escape = (box: ReactElement) => (box.props as { onClose: () => void }).onClose();

beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null });
  rt.state.slots = [];
  onConfirm.mockReset();
  onClose.mockReset();
  focus.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("PurgeDialog", () => {
  it("asks first with the paths, the total and that it cannot be undone, in red", () => {
    const { dialog, main } = render();
    const lines = String(dialog.props.message).split("\n");
    expect(lines[0]).toBe("purge.ask");
    expect(lines).toContain("/c/a");
    expect(lines.at(-1)).toBe("purge.cannotUndo");
    expect(main.props.children).toBe("purge.confirm");
    expect(main.props.className).toBe("danger");
  });

  it("deletes nothing until the second question is answered with its own red button", () => {
    click(render().main);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const { dialog, main } = render();
    expect(String(dialog.props.message)).toBe(
      'purge.askAgain {"count":2,"items":"2","size":"300 B"}',
    );
    expect(main.props.children).toBe("purge.confirmAgain");
    expect(main.props.className).toBe("danger");
    click(main);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("deletes nothing on Cancel or Escape at either question", () => {
    click(render().cancel);
    escape(render().box);
    click(render().main);
    click(render().cancel);
    escape(render().box);
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("puts the focus on Cancel at both questions", () => {
    const first = render();
    expect(first.dialog.props.focusCancel).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    click(first.main);
    const second = render();
    expect(second.dialog.props.focusCancel).toBe(true);
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("lets no key held down from the first question press a button of the second", () => {
    click(render().main);
    const { box, main } = render();
    const onKeyDown = (box.props as { onKeyDown?: (e: object) => void }).onKeyDown;
    /** As `fireEvent.keyDown` answers: false when the default action (the press) was prevented. */
    const press = (key: string, repeat: boolean) => {
      const event = { key, repeat, target: main, preventDefault: vi.fn() };
      onKeyDown?.(event);
      return event.preventDefault.mock.calls.length === 0;
    };
    expect(press("Enter", true)).toBe(false);
    expect(press(" ", true)).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    // A new press is the user's answer; other keys are left alone.
    expect(press("Enter", false)).toBe(true);
    expect(press("Tab", true)).toBe(true);
  });
});
