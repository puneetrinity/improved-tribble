import { COUNTRY_CODES } from "@shared/candidate-profile";

const display = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
export const countryName = (code: string) => { try { return display?.of(code) ?? code; } catch { return code; } };
/** Exactly the codes the server accepts, named in English and sorted by name. */
export const COUNTRIES = Array.from(COUNTRY_CODES).map(code => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));
