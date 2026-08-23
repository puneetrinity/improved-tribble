import type { Express, NextFunction, Request, Response } from "express";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    delete: mocks.delete,
  },
}));
vi.mock("../../auth", () => ({
  requireVerifiedCandidate: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ) => next(),
}));
vi.mock("../../candidate-privacy/decision", () => ({
  CandidatePrivacyRestrictedError: class CandidatePrivacyRestrictedError extends Error {},
  requireCandidatePrivacyAllowed: vi.fn(async () => undefined),
}));

let canCandidateApplyToJob: typeof import("../../candidatePortal.routes").canCandidateApplyToJob;
let registerCandidatePortalRoutes: typeof import("../../candidatePortal.routes").registerCandidatePortalRoutes;

beforeAll(async () => {
  ({
    canCandidateApplyToJob,
    registerCandidatePortalRoutes,
  } = await import("../../candidatePortal.routes"));
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("candidate saved-job availability", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");

  it("allows an active approved job with future closing dates", () => {
    expect(canCandidateApplyToJob({
      isActive: true,
      status: "approved",
      deadline: "2026-08-15",
      expiresAt: new Date("2026-08-15T12:00:00.000Z"),
    }, now)).toBe(true);
  });

  it.each([
    { isActive: false, status: "approved" },
    { isActive: true, status: "pending" },
    { isActive: true, status: "declined" },
  ])("does not allow a non-public job: %o", ({ isActive, status }) => {
    expect(canCandidateApplyToJob({
      isActive,
      status,
      deadline: null,
      expiresAt: null,
    }, now)).toBe(false);
  });

  it("keeps a saved job visible but marks a passed deadline unavailable", () => {
    expect(canCandidateApplyToJob({
      isActive: true,
      status: "approved",
      deadline: "2026-07-28",
      expiresAt: null,
    }, now)).toBe(false);
  });

  it("marks an expired job unavailable even if it remains active", () => {
    expect(canCandidateApplyToJob({
      isActive: true,
      status: "approved",
      deadline: null,
      expiresAt: new Date("2026-07-29T11:59:59.000Z"),
    }, now)).toBe(false);
  });
});

type RouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => unknown;

function buildRouteHarness() {
  const routes = new Map<string, RouteHandler[]>();
  const app = {
    get: (path: string, ...handlers: RouteHandler[]) => {
      routes.set(`GET ${path}`, handlers);
    },
    post: (path: string, ...handlers: RouteHandler[]) => {
      routes.set(`POST ${path}`, handlers);
    },
    delete: (path: string, ...handlers: RouteHandler[]) => {
      routes.set(`DELETE ${path}`, handlers);
    },
  } as unknown as Express;

  const csrf = vi.fn((_req: Request, _res: Response, next: NextFunction) => next());
  registerCandidatePortalRoutes(app, csrf);

  const handler = (method: string, path: string): RouteHandler => {
    const handlers = routes.get(`${method} ${path}`);
    if (!handlers?.length) {
      throw new Error(`Route not registered: ${method} ${path}`);
    }
    return handlers[handlers.length - 1]!;
  };

  return { handler };
}

function buildResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

function buildSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(result);
  chain.limit.mockResolvedValue(result);
  return chain;
}

describe("candidate saved-job route contract", () => {
  it("returns closed saved jobs instead of filtering them out", async () => {
    const createdAt = new Date("2026-07-20T10:00:00.000Z");
    mocks.select.mockReturnValue(buildSelectChain([{
      id: 7,
      createdAt,
      job: {
        id: 11,
        title: "Backend Engineer",
        location: "Bengaluru",
        type: "full-time",
        description: "Build backend systems",
        skills: ["Python"],
        deadline: null,
        createdAt,
        isActive: false,
        status: "approved",
        expiresAt: null,
        slug: "backend-engineer",
        updatedAt: createdAt,
        salaryMin: null,
        salaryMax: null,
        salaryPeriod: null,
        goodToHaveSkills: [],
        educationRequirement: null,
        experienceYears: null,
        experienceYearsMax: null,
      },
    }]));

    const { handler } = buildRouteHarness();
    const res = buildResponse();
    const next = vi.fn();
    await handler("GET", "/api/candidate/saved-jobs")(
      { user: { id: 42 } } as Request,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      savedJobs: [
        expect.objectContaining({
          id: 7,
          createdAt,
          canApply: false,
          job: expect.objectContaining({ id: 11, title: "Backend Engineer" }),
        }),
      ],
    });
  });

  it("uses the authenticated candidate and an on-conflict insert for an idempotent save", async () => {
    mocks.select.mockReturnValue(buildSelectChain([{
      id: 11,
      deadline: null,
      expiresAt: null,
      isActive: true,
      status: "approved",
    }]));
    const insertChain = {
      values: vi.fn(),
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    };
    insertChain.values.mockReturnValue(insertChain);
    mocks.insert.mockReturnValue(insertChain);

    const { handler } = buildRouteHarness();
    const res = buildResponse();
    await handler("POST", "/api/candidate/saved-jobs/:jobId")(
      {
        params: { jobId: "11" },
        body: { candidateId: 999 },
        user: { id: 42 },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(insertChain.values).toHaveBeenCalledWith({
      candidateId: 42,
      jobId: 11,
    });
    expect(insertChain.onConflictDoNothing).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({ saved: true, jobId: 11 });
  });

  it("rejects saving a closed job before writing", async () => {
    mocks.select.mockReturnValue(buildSelectChain([{
      id: 11,
      deadline: null,
      expiresAt: null,
      isActive: false,
      status: "approved",
    }]));

    const { handler } = buildRouteHarness();
    const res = buildResponse();
    await handler("POST", "/api/candidate/saved-jobs/:jobId")(
      { params: { jobId: "11" }, user: { id: 42 } } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: "JOB_NOT_AVAILABLE",
    }));
  });
});
