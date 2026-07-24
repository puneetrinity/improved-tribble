// @vitest-environment node

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { extractResumeText } from '../lib/resumeExtractor';

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixtures = [
  {
    fileName: 'resume-nikhil.pdf',
    markers: ['Nikhil Reddy', 'nikhil.reddy.ui@gmail.com'],
  },
  {
    fileName: 'resume-pooja.pdf',
    markers: ['Pooja Agarwal', 'pooja.agarwal.web@gmail.com'],
  },
];

async function extractFixture(fixture: (typeof fixtures)[number]) {
  const buffer = await readFile(path.join(fixturesDirectory, fixture.fileName));
  return { fixture, result: await extractResumeText(buffer, { stripPii: false }) };
}

function expectOwnText({ fixture, result }: Awaited<ReturnType<typeof extractFixture>>) {
  expect(result.success).toBe(true);
  for (const marker of fixture.markers) {
    expect(result.text).toContain(marker);
  }
  for (const other of fixtures) {
    if (other.fileName === fixture.fileName) continue;
    for (const marker of other.markers) {
      expect(result.text).not.toContain(marker);
    }
  }
}

describe('PDF resume extraction isolation', () => {
  // Guard the P0: restoring pdf-parse or sharing a parser/document instance
  // can attach one applicant's text to another applicant's resume.
  it('keeps simultaneous extraction results attached to their own PDF', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => fixtures.map(extractFixture)).flat(),
    );

    results.forEach(expectOwnText);
  });

  it('keeps rapid sequential extraction results attached to their own PDF', async () => {
    const results = [];
    for (let round = 0; round < 10; round += 1) {
      for (const fixture of fixtures) {
        results.push(await extractFixture(fixture));
      }
    }

    results.forEach(expectOwnText);
  });
});
