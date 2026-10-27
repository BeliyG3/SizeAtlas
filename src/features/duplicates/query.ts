/** The search field of the duplicates mode, kept apart from the search of the tree. */
export const DUP_QUERY_KEY = "sizeatlas.duplicates.query";

/** The images at first; a cleared field stays cleared (every type is searched). */
export const parseDupQuery = (raw: string | null): string => raw ?? "type:image";

/** "Include system folders". */
export const DUP_SYSTEM_KEY = "sizeatlas.duplicates.system";

/** Off unless it was turned on (stored with `serializeShown`). */
export const parseDupSystem = (raw: string | null): boolean => raw === "1";

/** "In all open drives": off searches the folder selected in the tree. */
export const DUP_EVERYWHERE_KEY = "sizeatlas.duplicates.everywhere";

/** The selected folder unless every open drive was chosen (stored with `serializeShown`). */
export const parseDupEverywhere = (raw: string | null): boolean => raw === "1";
