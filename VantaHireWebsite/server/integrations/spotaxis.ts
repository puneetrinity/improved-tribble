import type { Job } from "@shared/schema";

// Basic HTML tag stripper to keep UI readable when SpotAxis returns rich text
function stripHtml(html?: string | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function getBaseUrl(): string {
  const base = process.env.SPOTAXIS_BASE_URL || "";
  return base.replace(/\/$/, "");
}

export function isEnabled(): boolean {
  return Boolean(process.env.SPOTAXIS_BASE_URL);
}

function buildUrl(path: string, params?: Record<string, string | number | undefined | null>): string {
  const base = getBaseUrl();
  const url = new URL(base + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && String(v).length > 0) {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

type MappedJob = Job & { externalApplyUrl?: string; externalJobUrl?: string };

function mapVacancyToJob(vacancy: any): MappedJob {
  // SpotAxis Vacancy model exposes many fields; we pick and normalize what the UI needs.
  const title = vacancy.employment || vacancy.title || "Untitled";
  const city = vacancy.city || "";
  const state = vacancy.state || "";
  const location = vacancy.location || [city, state].filter(Boolean).join(", ");
  const skills = typeof vacancy.skills === "string"
    ? vacancy.skills.split(",").map((s: string) => s.trim()).filter(Boolean)
    : Array.isArray(vacancy.skills) ? vacancy.skills : [];

  // Choose reasonable date fields
  const createdAt = vacancy.pub_date || vacancy.add_date || new Date().toISOString();
  const deadline = vacancy.unpub_date || vacancy.end_date || null;

  // Job type is a foreign key on SpotAxis; if not present as a label, default to full-time for display
  const type = typeof vacancy.employmentType === "string" ? vacancy.employmentType : "full-time";

  const description = stripHtml(vacancy.description);

  const externalApplyUrl = vacancy.application_url || (vacancy.vacancy?.application_url);
  const externalJobUrl = vacancy.absolute_url || (vacancy.vacancy?.absolute_url);

  // "postedBy" is required by the Job type but not meaningful here; set to 0
  return {
    id: Number(vacancy.id),
    title,
    location: location || "",
    type,
    description,
    skills,
    deadline: deadline ? new Date(deadline) : null,
    postedBy: 0,
    createdAt: new Date(createdAt),
    isActive: true,
    status: "approved",
    reviewComments: null,
    expiresAt: null,
    reviewedBy: null,
    reviewedAt: null,
    externalApplyUrl,
    externalJobUrl,
  } as MappedJob;
}

export async function fetchJobs(opts: {
  page?: number;
  limit?: number;
  search?: string;
  // location/type/skills are best-effort mapped
  location?: string;
  type?: string;
  skills?: string[];
}): Promise<{ jobs: MappedJob[]; total: number; totalPages: number; page: number; limit: number; }> {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 10;

  // Map filters to SpotAxis vacancy search
  // Supported: search (title contains). We pass page & page_size for DRF pagination.
  const url = buildUrl("/api/vacancy/search/", {
    page,
    page_size: limit,
    search: opts.search || "",
  });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SpotAxis search failed: ${res.status}`);
  }
  const data = await res.json();

  // DRF pagination response: { count, next, previous, results }
  // Our view packs payload inside results: { vacancies: [...], total_vacancies, current_filters }
  const resultsPayload = data?.results || data;
  const vacancies = resultsPayload?.vacancies || [];
  const total = Number(data?.count ?? resultsPayload?.total_vacancies ?? vacancies.length) || 0;

  const jobs = vacancies.map(mapVacancyToJob);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { jobs, total, totalPages, page, limit };
}

export async function fetchJobById(id: number): Promise<MappedJob | null> {
  const url = buildUrl(`/api/vacancy/${id}/`);
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SpotAxis job fetch failed: ${res.status}`);
  const data = await res.json();

  // The details API returns an object with 'vacancy' plus other fields
  const vacancy = data?.vacancy || data;
  const job = mapVacancyToJob({ ...vacancy, application_url: vacancy?.application_url });
  return job;
}
