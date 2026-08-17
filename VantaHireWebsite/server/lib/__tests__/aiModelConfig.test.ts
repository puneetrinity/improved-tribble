import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROQ_MODEL,
  RETIRED_GROQ_MODELS,
  getGroqModel,
} from '../aiModelConfig';

describe('Flow Groq model configuration', () => {
  it('uses the supported default outside production', () => {
    expect(getGroqModel({ NODE_ENV: 'test' })).toBe(DEFAULT_GROQ_MODEL);
  });

  it('requires an explicit production model', () => {
    expect(() => getGroqModel({ NODE_ENV: 'production' })).toThrow(
      'GROQ_MODEL must be explicitly configured in production',
    );
    expect(() => getGroqModel({ NODE_ENV: 'production', GROQ_MODEL: '   ' })).toThrow(
      'GROQ_MODEL must be explicitly configured in production',
    );
  });

  it.each([...RETIRED_GROQ_MODELS])('rejects retired model %s', (model) => {
    expect(() => getGroqModel({ NODE_ENV: 'production', GROQ_MODEL: model })).toThrow(
      `GROQ_MODEL points to retired model: ${model}`,
    );
  });

  it('returns the trimmed configured model', () => {
    expect(getGroqModel({
      NODE_ENV: 'production',
      GROQ_MODEL: '  openai/gpt-oss-120b  ',
    })).toBe('openai/gpt-oss-120b');
  });
});
