import { createPortal } from "react-dom";
import type { DragView } from "./useColumnDrag";
import "./columns.css";

/**
 * While a header is dragged: a see-through copy of it that follows the pointer along the header,
 * and the line where it would drop. Drawn over everything, invisible to the pointer and to
 * screen readers.
 */
export function DragGhost({ view }: { view: DragView | null }) {
  if (!view) return null;
  const { ghost, line } = view;
  return createPortal(
    <>
      <div
        className="col-ghost"
        aria-hidden="true"
        style={{
          ...ghost,
          font: view.font,
          padding: view.padding,
          justifyContent: view.alignRight ? "flex-end" : undefined,
        }}
      >
        {view.label}
      </div>
      <div className="col-drop" aria-hidden="true" style={line} />
    </>,
    document.body,
  );
}
