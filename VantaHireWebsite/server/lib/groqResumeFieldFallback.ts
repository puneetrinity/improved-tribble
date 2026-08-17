import { z } from 'zod';
import { getGroqClient, isGroqConfigured } from './groqClient';
import { getGroqModel } from './aiModelConfig';

const groqNameResponseSchema = z.object({
  name: z.string().min(1).max(100).nullable(),
});

export function isGroqResumeFieldFallbackEnabled(): boolean {
  return process.env.GROQ_RESUME_FIELD_FALLBACK_ENABLED === 'true';
}

export async function inferCandidateNameWithGroq(text: string): Promise<string | null> {
  if (!isGroqResumeFieldFallbackEnabled() || !isGroqConfigured()) {
    return null;
  }

  try {
    const model = getGroqModel();
    const completion = await getGroqClient().chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content: 'Extract only the candidate full name from resume text. Return JSON: {"name": string|null}. Use null when unsure.',
        },
        {
          role: 'user',
          content: text.slice(0, 4000),
        },
      ],
    });

    const content = completion.choices[0]?.message.content || '{}';
    const parsed = groqNameResponseSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return null;
    }

    return parsed.data.name?.trim() || null;
  } catch (error) {
    console.error('[BULK_RESUME_IMPORT] Groq name fallback failed:', error);
    return null;
  }
}
