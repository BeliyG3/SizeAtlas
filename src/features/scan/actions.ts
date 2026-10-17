/** Running full scans block refresh and child scans (the trash has its own rule: `trashRule`). */
export function scanActions(fullScan: boolean) {
  return { refresh: !fullScan, scanFolder: !fullScan };
}
