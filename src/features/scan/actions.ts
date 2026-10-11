/** First scans block refresh/child scans; running jobs and a trash block trash. */
export function scanActions(firstScan: boolean, busy: boolean, trashing: boolean) {
  return { refresh: !firstScan, scanFolder: !firstScan, trash: !busy && !trashing };
}
