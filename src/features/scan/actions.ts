/** Mutating item actions stay unavailable while their root has a scan or refresh queued. */
export function scanActions(busy: boolean, trashing: boolean) {
  return { refresh: !busy, scanFolder: !busy, trash: !busy && !trashing };
}
