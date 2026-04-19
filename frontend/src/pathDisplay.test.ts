import { describe, expect, it } from 'vitest';

import { basenameFromPath, fitPathToWidth, middleEllipsisPath } from './pathDisplay';

describe('pathDisplay', () => {
  it('extracts basenames from posix and windows-like paths', () => {
    expect(basenameFromPath('/tmp/demo.txt')).toBe('demo.txt');
    expect(basenameFromPath('C:\\tmp\\report.pdf')).toBe('report.pdf');
    expect(basenameFromPath('plain-name')).toBe('plain-name');
  });

  it('keeps short paths unchanged', () => {
    expect(middleEllipsisPath('/work/docs/report.md', 32)).toBe('/work/docs/report.md');
  });

  it('shortens long paths from the middle while preserving the tail', () => {
    expect(
      middleEllipsisPath('/very/long/workspace/frontend/src/components/report-item.tsx', 28),
    ).toBe('/very/.../report-item.tsx');
  });

  it('keeps windows-style separators consistent when truncating', () => {
    const input = 'C:\\very\\long\\workspace\\frontend\\src\\components\\report-item.tsx';
    const value = middleEllipsisPath(input, 28);

    expect(value.includes('/')).toBe(false);
    expect(value.includes('\\')).toBe(true);
  });

  it('truncates long single-segment names without adding separators', () => {
    const value = middleEllipsisPath('super-extraordinarily-long-report-item-name.tsx', 24);

    expect(value.length).toBeLessThanOrEqual(24);
    expect(value.includes('/')).toBe(false);
    expect(value.includes('\\')).toBe(false);
  });

  it('enforces maxLength for small single-segment truncation lengths', () => {
    const input = 'super-extraordinarily-long-report-item-name.tsx';

    for (const maxLength of [4, 5, 6, 7, 8]) {
      const value = middleEllipsisPath(input, maxLength);
      expect(value.length).toBeLessThanOrEqual(maxLength);
    }
  });

  it('enforces maxLength even when basename is very long', () => {
    const value = middleEllipsisPath(
      '/very/long/workspace/frontend/src/components/super-extraordinarily-long-report-item-name.tsx',
      24,
    );

    expect(value.length).toBeLessThanOrEqual(24);
    expect(value.startsWith('/very/')).toBe(true);
    expect(value.includes('.../')).toBe(true);
  });

  it('returns the full path when the measured width is sufficient', () => {
    const path = '/very/long/workspace/frontend/src/components/report-item.tsx';

    expect(fitPathToWidth(path, path.length, (value) => value.length)).toBe(path);
  });

  it('falls back to middle ellipsis when the measured width is too small', () => {
    const path = '/very/long/workspace/frontend/src/components/report-item.tsx';

    expect(fitPathToWidth(path, 28, (value) => value.length)).toBe('/very/.../report-item.tsx');
  });
});
