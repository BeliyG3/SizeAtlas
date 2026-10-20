import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Disk, Sources } from "../../api/types";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { useStored } from "../../settings/storage";
import { fitWidth, measureColumn } from "../columns/fit";
import { useColumnOrder } from "../columns/useColumnOrder";
import { useColumnWidths } from "../columns/useColumnWidths";
import { isMenuKey } from "../menu/Menu";
import { anchorX } from "../menu/place";
import { savedScan } from "../shell/source";
import { keyTarget } from "../tree/model";
import { driveChoice, type DriveChoice, type DriveRoot } from "./choice";
import { DriveAsk } from "./DriveAsk";
import { DriveMenu } from "./DriveMenu";
import { DriveName } from "./DriveName";
import { DrivesHeader } from "./DrivesHeader";
import { MIN_NAME, drivesWidth, useFittedWidths } from "./fit";
import {
  DRIVE_SORT_KEY,
  parseDriveSort,
  serializeDriveSort,
  sortDisks,
  type DriveColumn,
} from "./sort";
import "./drives.css";

/** Every column can be moved; the drive name takes the width the number columns leave. */
const DEFAULT_ORDER: readonly DriveColumn[] = ["name", "size", "used", "free"];
const DEFAULT_WIDTHS = { size: 84, used: 84, free: 84 };

interface Props {
  sources: Sources | null;
  /** Roots of the folder tree, by canonical path. */
  roots: readonly (DriveRoot & { root: string })[];
  /** Selects the drive if it is open, else opens its saved scan or queues a scan. */
  onOpen: (mount: string) => void;
  /** Queues a scan of the drive. */
  onScan: (mount: string) => void;
  /** Deletes the saved scan of the drive, closing it if it is open. */
  onForget: (mount: string) => void;
  /** The width the table needs to show every column in full, whenever it changes. */
  onWidth?: (width: number) => void;
}

/**
 * The drives with their sizes. A click selects a row, the arrow keys move the selection; a double
 * click or Enter asks whether to scan the drive or open its scan; the context menu (right click,
 * Shift+F10) scans, opens or forgets it.
 */
export function DrivesPanel({ sources, roots, onOpen, onScan, onForget, onWidth }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const [order, move] = useColumnOrder("sizeatlas.drives.columns.order", DEFAULT_ORDER);
  const [sort, setSort] = useStored(DRIVE_SORT_KEY, parseDriveSort, serializeDriveSort);
  const box = useRef<HTMLElement>(null);
  const fitted = useFittedWidths(box);
  const { widths, resize } = useColumnWidths<Exclude<DriveColumn, "name">>(
    "sizeatlas.drives.columns",
    DEFAULT_WIDTHS,
    fitted ?? undefined,
  );
  const disks = useMemo(() => sortDisks(sources?.disks ?? [], sort), [sources, sort]);
  const minWidth = drivesWidth({ ...widths, name: fitted?.name ?? MIN_NAME });
  useEffect(() => onWidth?.(minWidth), [onWidth, minWidth]);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ mount: string; x: number; y: number } | null>(null);
  const [asking, setAsking] = useState<{
    mount: string;
    network: boolean;
    choice: Exclude<DriveChoice, { kind: "select" }>;
  } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const ids = useId();
  const rowId = useCallback((mount: string) => `${ids}-${encodeURIComponent(mount)}`, [ids]);
  const at = disks.findIndex((d) => d.mount === selected);

  const choiceOf = (mount: string) =>
    driveChoice(
      roots.find((r) => r.root === mount),
      savedScan(sources, mount),
    );
  /** Double click or Enter: ask what to do, or just select a root whose scan runs or waits. */
  const activate = (mount: string) => {
    const choice = choiceOf(mount);
    if (choice.kind === "select") onOpen(mount);
    else setAsking({ mount, network: disks.some((d) => d.mount === mount && d.network), choice });
  };
  const menuAt = (mount: string, x: number, y: number) => {
    setSelected(mount);
    setMenu({ mount, x, y });
  };

  useEffect(() => {
    if (selected !== null)
      document.getElementById(rowId(selected))?.scrollIntoView({ block: "nearest" });
  }, [selected, rowId]);

  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    // The header buttons keep their own keys.
    if (e.target !== e.currentTarget) return;
    const current = disks[at];
    if (isMenuKey(e)) {
      const row = current && document.getElementById(rowId(current.mount));
      const rect = row?.getBoundingClientRect();
      if (current && rect) menuAt(current.mount, anchorX(rect, isRtl(lang), 24), rect.bottom);
    } else if (e.key === "Enter") {
      if (current) activate(current.mount);
    } else {
      const to = keyTarget(e.key, at, disks.length);
      if (to === undefined) return;
      if (disks[to]) setSelected(disks[to].mount);
    }
    e.preventDefault();
  };

  const cell = (d: Disk, id: DriveColumn): ReactNode => {
    if (id === "name")
      return <DriveName key="name" disk={d} saved={sources && savedScan(sources, d.mount)} t={t} />;
    if (!d.connected) return <td key={id} data-col={id} className="num" />;
    const text = size({ size: d.total, used: d.total - d.available, free: d.available }[id]);
    return (
      <td key={id} data-col={id} className="num" title={text}>
        {text}
      </td>
    );
  };

  return (
    <section className="drives" aria-label={t("drives.label")} ref={box}>
      <table
        style={{ minWidth }}
        role="grid"
        tabIndex={0}
        aria-label={t("drives.label")}
        aria-activedescendant={at >= 0 ? rowId(disks[at].mount) : undefined}
        onKeyDown={onKey}
        // Entering with Tab selects the first drive, so the keys have something to act on.
        onFocus={(e) => {
          if (at < 0 && e.target === e.currentTarget && e.currentTarget.matches(":focus-visible"))
            setSelected(disks[0]?.mount ?? null);
        }}
        // No native menu anywhere in the list; the rows open their own.
        onContextMenu={(e) => e.preventDefault()}
      >
        <colgroup>
          {order.map((id) => (
            <col key={id} style={id === "name" ? undefined : { width: widths[id] }} />
          ))}
        </colgroup>
        <DrivesHeader
          order={order}
          onMove={move}
          sort={sort}
          onSort={setSort}
          widths={widths}
          onResize={resize}
          onFit={(id) => resize(id, fitWidth(measureColumn(box.current, id)), true)}
        />
        <tbody>
          {disks.map((d) => (
            <tr
              key={d.mount}
              id={rowId(d.mount)}
              aria-selected={d.mount === selected}
              className={
                [d.mount === selected && "selected", !d.connected && "disconnected"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onClick={() => setSelected(d.mount)}
              onDoubleClick={() => activate(d.mount)}
              onContextMenu={(e) => menuAt(d.mount, e.clientX, e.clientY)}
            >
              {order.map((id) => cell(d, id))}
            </tr>
          ))}
        </tbody>
      </table>
      {menu && (
        <DriveMenu
          x={menu.x}
          y={menu.y}
          choice={choiceOf(menu.mount)}
          forgettable={
            savedScan(sources, menu.mount) !== undefined || roots.some((r) => r.root === menu.mount)
          }
          onScan={() => onScan(menu.mount)}
          onOpen={() => onOpen(menu.mount)}
          onForget={() => onForget(menu.mount)}
          onClose={closeMenu}
        />
      )}
      {asking && (
        <DriveAsk {...asking} onOpen={onOpen} onScan={onScan} onClose={() => setAsking(null)} />
      )}
    </section>
  );
}
