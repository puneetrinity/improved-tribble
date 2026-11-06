import type { ZodError } from "zod";
import type { Errors } from "./fields";

const COPY: Record<string, string> = {
  invalid_length: "This is too long or empty.",
  invalid_unicode: "This contains characters we can't save.",
  duplicate_skill: "Remove the duplicate skill.",
  duplicate_role: "Remove the duplicate role.",
  duplicate_seniority: "Remove the duplicate entry.",
  duplicate_choice: "Each option can be chosen once.",
  duplicate_row: "This entry is duplicated.",
  invalid_dates: "End must be after start, and a current role has no end date.",
  invalid_date: "Use a real date: YYYY, YYYY-MM or YYYY-MM-DD.",
  unsupported_country: "Choose a country from the list.",
  unsupported_currency: "Choose a currency from the list.",
  invalid_compensation_range: "Minimum must not exceed maximum, and your floor must not exceed the maximum.",
  remote_regions_required: "Choose where you can work remotely.",
};

/** Zod issue → { "a.0.b": message }. The first issue per path wins. */
export function toErrors(error: ZodError | undefined | null): Errors {
  const out: Errors = {};
  for (const issue of error?.issues ?? []) {
    const key = issue.path.join(".") || "_form";
    if (out[key]) continue;
    const custom = COPY[issue.message];
    if (custom) out[key] = custom;
    else if (issue.code === "too_small" && (issue as any).type === "array") out[key] = "Add at least one.";
    else if (issue.code === "too_big") out[key] = "Too many entries.";
    else if (issue.code === "invalid_string" || issue.message === "Invalid") out[key] = "Check this value.";
    else if (key.endsWith("linkedinUrl")) out[key] = "Use a LinkedIn profile link like https://linkedin.com/in/your-name.";
    else out[key] = "Check this value.";
  }
  return out;
}
