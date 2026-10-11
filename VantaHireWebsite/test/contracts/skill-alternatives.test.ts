import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSkillName, acceptedSkillsShape, duplicateSkillNames } from '../../shared/skill-alternatives';
import { skillUnicodeData, SKILL_UNICODE_VERSION } from '../../shared/skill-unicode-data';
import fixtures from '../fixtures/approved-skills-v1.json';

describe('pinned Unicode, not a skill synonym list', () => {
  it.each(fixtures.normalization)('normalizes $input', ({input,expected}) => {
    expect(normalizeSkillName(input)).toBe(expected);
  });
  it('SQL carries the same complete pinned data as the editor', () => {
    const sql=readFileSync(new URL('../../server/schema-migrations/0017_approved_skill_alternatives.sql',import.meta.url),'utf8');
    const embedded=sql.match(/\$unicode\$([\s\S]*?)\$unicode\$/);
    expect(embedded).not.toBeNull();
    expect(JSON.parse(embedded![1])).toEqual(skillUnicodeData);
    expect(SKILL_UNICODE_VERSION).toBe('16.0.0');
  });
  it('handles new characters even on a runtime with older ICU', () => {
    expect(duplicateSkillNames({kind:'accepted_skills',primary:'\u{1ccd6}',alternatives:['A']})).toBe(true);
    expect(acceptedSkillsShape.safeParse({kind:'accepted_skills',primary:'AWS\u200b',alternatives:[]}).success).toBe(false);
  });
});

