import type { Lang } from "../../i18n";

/** The short code on the language button: the base subtag in capitals ("pt-BR" is "PT"). */
export const languageCode = (lang: Lang): string => lang.split("-")[0].toUpperCase();
