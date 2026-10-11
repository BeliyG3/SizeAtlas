/** Running full scans block refresh/child scans; running jobs and a trash block trash. */
export function scanActions(fullScan: boolean, busy: boolean, trashing: boolean) {
  return { refresh: !fullScan, scanFolder: !fullScan, trash: !busy && !trashing };
}
