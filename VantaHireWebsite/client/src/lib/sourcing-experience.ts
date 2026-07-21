// Total years of experience from a Crustdata profile, deduped by company.
//
// Crustdata lists one entry per TITLE, and each entry carries the FULL company
// tenure in `years_at_company_raw`. Naively summing across entries therefore
// multiplies a person's experience by the number of titles they held at each
// company — someone with 6 years at one company but promoted twice (3 title
// entries) shows 18 years. Group by company and count each company's tenure
// once (keeping the longest, since entries at the same company should agree).
export function computeTotalExperienceYears(crustdata: any): number | null {
  const roles = [
    ...(crustdata?.experience?.employment_details?.current || []),
    ...(crustdata?.experience?.employment_details?.past || []),
  ];
  if (!roles.length) return null;

  const tenureByCompany = new Map<string, number>();
  roles.forEach((r: any, idx: number) => {
    const years = typeof r?.years_at_company_raw === "number" ? r.years_at_company_raw : 0;
    if (years <= 0) return;
    // Prefer a stable company id; fall back to company name. Only if neither
    // exists do we treat the entry as its own company (rare) so it still counts.
    const companyKey = String(
      r?.crustdata_company_id ?? r?.company_name ?? r?.name ?? `__role_${idx}`
    );
    tenureByCompany.set(companyKey, Math.max(tenureByCompany.get(companyKey) ?? 0, years));
  });

  if (tenureByCompany.size === 0) return null;
  const total = Array.from(tenureByCompany.values()).reduce((a, b) => a + b, 0);
  return Math.round(total * 10) / 10;
}
