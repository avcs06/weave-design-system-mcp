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
    expect(scanStories(component, 'Widget')).toEqual({ deprecatedPatterns: [], storyPropShapes: [] });
  });

  it('reads a CSF3 args story', () => {
    writeStories(`export const Primary = { args: { tone: 'brand', size: 'lg' } };`);
    expect(scanStories(component, 'Widget').storyPropShapes).toEqual([['size', 'tone']]);
  });

  it('reads every usage inside a render function, not just the first', () => {
    writeStories(`
      export const Overview = {
        render: () => (
          <div>
            <Widget tone="brand" />
            <Widget tone="brand" size="lg" />
            <NotTheWidget colour="red" />
          </div>
        ),
      };
    `);
    expect(scanStories(component, 'Widget').storyPropShapes).toEqual([['tone'], ['size', 'tone']]);
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

  it('records a non-literal prop as present rather than dropping it from the shape', () => {
    writeStories(`export const Handled = { render: () => <Widget onSelect={fn} tone="brand" /> };`);
    expect(scanStories(component, 'Widget').storyPropShapes).toEqual([['onSelect', 'tone']]);
  });

  it('returns empty data for an unparseable stories file instead of throwing', () => {
    writeStories('this is (((not valid typescript');
    expect(scanStories(component, 'Widget')).toEqual({ deprecatedPatterns: [], storyPropShapes: [] });
  });
});
