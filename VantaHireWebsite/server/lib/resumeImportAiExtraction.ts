import { z } from 'zod';
import { getGroqClient, isGroqConfigured } from './groqClient';
import { getGroqModel } from './aiModelConfig';
import { normalizePhone } from './resumeImportFieldExtraction';

const groqStructuredResponseSchema = z.object({
  name: z.string().min(1).max(100).nullable(),
  email: z.string().email().max(255).nullable(),
  phone: z.string().min(7).max(40).nullable(),
});

export interface AiExtractedResumeFields {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export function isGroqAdvancedExtractionEnabled(): boolean {
  return process.env.GROQ_RESUME_FIELD_FALLBACK_ENABLED === 'true';
}

export async function extractStructuredResumeFieldsWithGroq(text: string): Promise<AiExtractedResumeFields | null> {
  if (!isGroqAdvancedExtractionEnabled() || !isGroqConfigured()) {
    return null;
  }

  try {
    const model = getGroqModel();
    const completion = await getGroqClient().chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 180,
      messages: [
        {
          role: 'system',
          content: [
            'Extract structured contact fields from resume text.',
            'Return strict JSON only: {"name": string|null, "email": string|null, "phone": string|null}.',
            'Use null when a field is missing or uncertain.',
            'Do not invent values.',
            'Name must be the candidate full name, not a city, heading, role, or section title.',
            'Email must be a single valid email address.',
            'Phone must be the primary candidate phone number exactly as it appears in the text.',
          ].join(' '),
        },
        {
          role: 'user',
          content: text.slice(0, 6000),
        },
      ],
    });

    const content = completion.choices[0]?.message.content || '{}';
    const parsed = groqStructuredResponseSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return null;
    }

    return {
      name: parsed.data.name?.trim() || null,
      email: parsed.data.email?.trim().toLowerCase() || null,
      phone: normalizePhone(parsed.data.phone) ?? null,
    };
  } catch (error) {
    console.error('[BULK_RESUME_IMPORT] Groq structured extraction failed:', error);
    return null;
  }
}
