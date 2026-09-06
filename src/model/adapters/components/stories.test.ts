import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanStories } from './stories.js';

let dir: string;
let component: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stories-test-'));
  component = join(dir, 'Widget.tsx');
  writeFileSync(component, 'export const Widget = () => null;');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeStories(source: string) {
  writeFileSync(join(dir, 'Widget.stories.tsx'), source);
}

describe('scanStories', () => {
  it('returns nothing when there is no stories file — "can\'t tell", not "nothing documented"', () => {
    expect(scanStories(component, 'Widget')).toEqual({ deprecatedPatterns: [] });
  });

  it('marks a story deprecated by its @deprecated docblock', () => {
    writeStories(`
      /** @deprecated use Primary */
      export const Old = { args: { tone: 'legacy' } };
    `);
    expect(scanStories(component, 'Widget').deprecatedPatterns).toEqual([
      { storyName: 'Old', props: { tone: 'legacy' } },
    ]);
  });

  it('marks a story deprecated by its name alone', () => {
    writeStories(`export const DeprecatedTone = { args: { tone: 'legacy' } };`);
    expect(scanStories(component, 'Widget').deprecatedPatterns[0]?.storyName).toBe('DeprecatedTone');
  });

  it('returns empty data for an unparseable stories file instead of throwing', () => {
    writeStories('this is (((not valid typescript');
    expect(scanStories(component, 'Widget')).toEqual({ deprecatedPatterns: [] });
  });
});
