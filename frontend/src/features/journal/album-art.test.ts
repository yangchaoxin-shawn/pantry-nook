import { describe, expect, it } from 'vitest';
import { chapterArt, pageIndex, printLine } from './album-art';

describe('相册的手记元素', () => {
  it('章节插画与短句只由年月决定，相邻月份不重复插画', () => {
    expect(chapterArt('2026-10')).toEqual(chapterArt('2026-10'));
    expect(chapterArt('2026-10').scene).not.toBe(chapterArt('2026-11').scene);
    expect(chapterArt('2026-12').scene).not.toBe(chapterArt('2027-01').scene);
  });
  it('照片短句首张固定，编号两位', () => {
    expect(printLine(0)).toBe('这一顿，记住了。');
    expect(printLine(1)).not.toBe(printLine(0));
    expect(pageIndex(3)).toBe('03');
    expect(pageIndex(128)).toBe('128');
  });
});
