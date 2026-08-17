import { createHash } from "crypto";
import { redisGet, redisSet } from "./redis";
import { isAIEnabled } from "../aiJobAnalyzer";
import { getGroqClient } from "./groqClient";
import { getGroqModel } from "./aiModelConfig";
import { DashboardInsightsResponseSchema, safeParseAiResponse } from "./aiResponseSchemas";

export interface DashboardAiPayload {
  pipelineHealthScore: { score: number; tag: string };
  timeRangeLabel: string;
  applicationsOverTime: Array<{ date: string; value: number }>;
  stageDistribution: Array<{ name: string; count: number }>;
  dropoff: Array<{ name: string; rate: number; count: number }>;
  timeInStage: Array<{ stageName: string; averageDays: number }>;
  jobsNeedingAttention: Array<{
    jobId: number;
    title: string;
    severity: "high" | "medium" | "low";
    reason: string;
  }>;
}

export interface DashboardAiInsights {
  summary: string;
  dropoffExplanation: string;
  jobs: Array<{ jobId: number; nextAction: string }>;
  generatedAt: string;
}

const TTL_SECONDS = 60 * 60 * 24; // 24 hours

function cacheKey(userId: number, payload: DashboardAiPayload) {
  const hash = createHash("sha1")
    .update(JSON.stringify({ timeRangeLabel: payload.timeRangeLabel, jobs: payload.jobsNeedingAttention.map(j => j.jobId) }))
    .digest("hex");
  return `ai:dashboard:${userId}:${hash}`;
}

export async function getDashboardAiInsights(userId: number, payload: DashboardAiPayload): Promise<DashboardAiInsights> {
  if (!isAIEnabled()) {
    throw new Error("AI not enabled");
  }
  const key = cacheKey(userId, payload);
  const cached = await redisGet(key);
  if (cached) {
    return JSON.parse(cached);
  }

  const jobList = payload.jobsNeedingAttention.map(j => `- jobId ${j.jobId}: "${j.title}" (${j.severity}) - ${j.reason}`).join("\n");

  const prompt = `You are helping a recruiter interpret their hiring pipeline. Use ONLY the provided data. Respond with valid JSON only, no markdown.

Data:
- Pipeline health: ${payload.pipelineHealthScore.score}% (${payload.pipelineHealthScore.tag})
- Time range: ${payload.timeRangeLabel}
- Drop-off stages: ${payload.dropoff.map(d => `${d.name}: ${d.rate}%`).join(", ")}
- Time in stage: ${payload.timeInStage.map(t => `${t.stageName}: ${t.averageDays}d`).join(", ")}
- Jobs needing attention:
${jobList}

Return JSON with this exact structure:
{
  "summary": "1-2 sentence pipeline summary",
  "dropoffExplanation": "1-2 sentence drop-off explanation (biggest bottleneck)",
  "jobs": [{"jobId": <number>, "nextAction": "short action max 18 words"}]
}`;

  const client = getGroqClient();
  const model = getGroqModel();
  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You are a concise assistant for recruiter dashboards. Respond with valid JSON only. Do not invent numbers." },
      { role: "user", content: prompt },
    ],
    max_tokens: 600,
    temperature: 0.3,
  });
  const text = resp.choices[0]?.message?.content?.trim() || "";

  // Parse JSON response with Zod validation
  const parsed = safeParseAiResponse(DashboardInsightsResponseSchema, text, 'dashboard-insights');

  const summary = parsed.summary || "AI summary unavailable.";
  const dropoffExplanation = parsed.dropoffExplanation || "AI drop-off explanation unavailable.";
  const jobs = payload.jobsNeedingAttention.map(j => {
    const found = (parsed.jobs ?? []).find(pj => pj.jobId === j.jobId);
    return { jobId: j.jobId, nextAction: found?.nextAction || "" };
  });

  const result: DashboardAiInsights = {
    summary: summary || "AI summary unavailable.",
    dropoffExplanation: dropoffExplanation || "AI drop-off explanation unavailable.",
    jobs,
    generatedAt: new Date().toISOString(),
  };

  await redisSet(key, JSON.stringify(result), TTL_SECONDS);
  return result;
}
