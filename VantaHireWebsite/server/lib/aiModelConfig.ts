export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

export const RETIRED_GROQ_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
]);

export function getGroqModel(env: NodeJS.ProcessEnv = process.env): string {
  const configuredModel = env.GROQ_MODEL?.trim();

  if (!configuredModel) {
    if (env.NODE_ENV === 'production') {
      throw new Error('GROQ_MODEL must be explicitly configured in production');
    }
    return DEFAULT_GROQ_MODEL;
  }

  if (RETIRED_GROQ_MODELS.has(configuredModel)) {
    throw new Error(`GROQ_MODEL points to retired model: ${configuredModel}`);
  }

  return configuredModel;
}

export function assertGroqModelConfigured(): void {
  void getGroqModel();
}
