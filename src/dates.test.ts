import { describe, expect, it } from 'vitest';
import { previousMonthRange, resolveDateRange } from './dates.ts';

describe('previousMonthRange', () => {
  it('returns the first day of last month to the first day of this month', () => {
    const now = new Date('2026-06-15T12:34:56Z');
    const range = previousMonthRange(now);
    expect(range.from.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('handles year boundary: January rolls back to December of previous year', () => {
    const now = new Date('2026-01-05T00:00:00Z');
    const range = previousMonthRange(now);
    expect(range.from.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('handles leap year February with thirty days of January', () => {
    const now = new Date('2024-03-15T00:00:00Z');
    const range = previousMonthRange(now);
    expect(range.from.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2024-03-01T00:00:00.000Z');
  });

  it('handles March 1 boundary where February is non-leap', () => {
    const now = new Date('2025-03-01T00:00:00Z');
    const range = previousMonthRange(now);
    expect(range.from.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2025-03-01T00:00:00.000Z');
  });
});

describe('resolveDateRange', () => {
  it('falls back to previous month when inputs are empty', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const range = resolveDateRange('', '', now);
    expect(range.from.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('parses explicit from/to inputs', () => {
    const range = resolveDateRange('2026-01-01', '2026-02-01');
    expect(range.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('rejects malformed inputs', () => {
    expect(() => resolveDateRange('not-a-date', '2026-02-01')).toThrow(/Invalid date/);
    expect(() => resolveDateRange('2026-13-01', '2026-02-01')).toThrow(/Invalid date/);
  });

  it('rejects to <= from', () => {
    expect(() => resolveDateRange('2026-02-01', '2026-02-01')).toThrow(/must be after/);
    expect(() => resolveDateRange('2026-03-01', '2026-02-01')).toThrow(/must be after/);
  });
});