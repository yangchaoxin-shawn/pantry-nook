import { afterEach, expect, it, vi } from 'vitest';
import { createUploadId } from './uploadId';

afterEach(() => vi.unstubAllGlobals());

it('局域网 HTTP 没有 randomUUID 时保留 UUID v4 格式与安全随机来源', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => {
    bytes.fill(255);
    return bytes;
  });
  vi.stubGlobal('crypto', { getRandomValues });
  expect(createUploadId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(getRandomValues).toHaveBeenCalledOnce();
});

it('安全上下文优先使用原生 randomUUID', () => {
  const randomUUID = vi.fn(() => '12345678-1234-4234-8234-123456789abc');
  vi.stubGlobal('crypto', { randomUUID });
  expect(createUploadId()).toBe('12345678-1234-4234-8234-123456789abc');
  expect(randomUUID).toHaveBeenCalledOnce();
});
