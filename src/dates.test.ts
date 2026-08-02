import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { previousMonthRange, resolveDateRange } from './dates.ts';

describe('previousMonthRange', () => {
  it('returns the first day of last month to the end of the last day of last month', () => {
    const now = new Date('2026-06-15T12:34:56Z');
    const range = previousMonthRange(now);
    assert.equal(range.from.toISOString(), '2026-05-01T00:00:00.000Z');
    assert.equal(range.to.toISOString(), '2026-05-31T23:59:59.999Z');
  });

  it('handles year boundary: January rolls back to December of previous year', () => {
    const now = new Date('2026-01-05T00:00:00Z');
    const range = previousMonthRange(now);
    assert.equal(range.from.toISOString(), '2025-12-01T00:00:00.000Z');
    assert.equal(range.to.toISOString(), '2025-12-31T23:59:59.999Z');
  });

  it('handles leap year February with twenty-nine days', () => {
    const now = new Date('2024-03-15T00:00:00Z');
    const range = previousMonthRange(now);
    assert.equal(range.from.toISOString(), '2024-02-01T00:00:00.000Z');
    assert.equal(range.to.toISOString(), '2024-02-29T23:59:59.999Z');
  });

  it('handles March 1 boundary where February is non-leap', () => {
    const now = new Date('2025-03-01T00:00:00Z');
    const range = previousMonthRange(now);
    assert.equal(range.from.toISOString(), '2025-02-01T00:00:00.000Z');
    assert.equal(range.to.toISOString(), '2025-02-28T23:59:59.999Z');
  });
});

describe('resolveDateRange', () => {
  it('falls back to previous month when inputs are empty', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const range = resolveDateRange('', '', now);
    assert.equal(range.from.toISOString(), '2026-05-01T00:00:00.000Z');
    assert.equal(range.to.toISOString(), '2026-05-31T23:59:59.999Z');
  });

  it('parses explicit from/to inputs and keeps the to date inclusive', () => {
    const range = resolveDateRange('2026-01-01', '2026-01-31');
    assert.equal(range.from.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(range.to.toISOString(), '2026-01-31T23:59:59.999Z');
  });

  it('accepts a single-day range when to equals from', () => {
    const range = resolveDateRange('2026-07-15', '2026-07-15');
    assert.equal(range.from.toISOString(), '2026-07-15T00:00:00.000Z');
    assert.equal(range.to.toISOString(), '2026-07-15T23:59:59.999Z');
  });

  it('rejects malformed inputs', () => {
    assert.throws(() => resolveDateRange('not-a-date', '2026-02-01'), /Invalid date/);
    assert.throws(() => resolveDateRange('2026-13-01', '2026-02-01'), /Invalid date/);
  });

  it('rejects to before from', () => {
    assert.throws(() => resolveDateRange('2026-03-01', '2026-02-01'), /must be on or after/);
  });
});
