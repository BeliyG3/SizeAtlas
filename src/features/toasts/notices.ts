import { createContext } from "react";

/** What a part of the UI needs to tell the user something: a toast and the words of an error. */
export interface Notices {
  push: (text: string) => void;
  errorText: (e: unknown) => string;
}

/** Offered by the App (see `useToasts`); without it nothing is shown. */
export const NoticeContext = createContext<Notices>({ push: () => {}, errorText: String });
