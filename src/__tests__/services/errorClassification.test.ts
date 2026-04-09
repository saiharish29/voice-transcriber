/**
 * Tests for classifyError()
 *
 * Error classification determines whether the app retries or shows the user
 * an actionable message.  A wrong classification either wastes API quota
 * (retrying a quota-exceeded error) or gives up too early on a transient error.
 */

import { describe, it, expect } from 'vitest';
import { classifyError } from '@/services/transcription/gemini';

// ── Helper: create error objects that mimic SDK responses ────────────────────

function httpErr(status: number, msg: string) {
  return Object.assign(new Error(msg), { status });
}

function msgErr(msg: string) {
  return new Error(msg);
}

// ── 429 — Rate limit / quota ─────────────────────────────────────────────────

describe('classifyError — 429 rate limit (RPM)', () => {
  it('is retryable', () => {
    expect(classifyError(httpErr(429, 'RESOURCE_EXHAUSTED rate limit'))).toMatchObject({ retryable: true });
  });

  it('sets a 65-second wait', () => {
    const r = classifyError(httpErr(429, 'RESOURCE_EXHAUSTED rpm limit'));
    expect(r.waitMs).toBe(65_000);
  });

  it('contains user-friendly message about rate limit', () => {
    const r = classifyError(httpErr(429, 'RESOURCE_EXHAUSTED rpm limit'));
    expect(r.message).toMatch(/rate limit/i);
  });
});

describe('classifyError — 429 quota exhausted (RPD)', () => {
  it('is NOT retryable — retrying wastes quota', () => {
    expect(classifyError(httpErr(429, 'RESOURCE_EXHAUSTED daily quota exhausted'))).toMatchObject({ retryable: false });
  });

  it('tells user about midnight reset', () => {
    const r = classifyError(httpErr(429, 'RESOURCE_EXHAUSTED daily quota exhausted'));
    expect(r.message).toMatch(/midnight|reset/i);
  });

  it('also catches "exhausted" keyword without status code', () => {
    const r = classifyError(msgErr('RESOURCE_EXHAUSTED: quota exhausted for today'));
    expect(r.retryable).toBe(false);
  });
});

// ── 403 — Permission denied ───────────────────────────────────────────────────

describe('classifyError — 403 permission denied', () => {
  it('is NOT retryable', () => {
    expect(classifyError(httpErr(403, 'PERMISSION_DENIED'))).toMatchObject({ retryable: false });
  });

  it('tells user to check their API key', () => {
    const r = classifyError(httpErr(403, 'PERMISSION_DENIED invalid key'));
    expect(r.message).toMatch(/API key|invalid|Settings/i);
  });
});

// ── 400 — Billing / precondition ─────────────────────────────────────────────

describe('classifyError — 400 billing required', () => {
  it('is NOT retryable', () => {
    const r = classifyError(httpErr(400, 'FAILED_PRECONDITION billing not enabled'));
    expect(r.retryable).toBe(false);
  });

  it('mentions billing in the message', () => {
    const r = classifyError(httpErr(400, 'FAILED_PRECONDITION billing not enabled'));
    expect(r.message).toMatch(/billing/i);
  });
});

// ── 400 — Invalid argument ────────────────────────────────────────────────────

describe('classifyError — 400 invalid argument', () => {
  it('is NOT retryable', () => {
    expect(classifyError(httpErr(400, 'INVALID_ARGUMENT bad mime type'))).toMatchObject({ retryable: false });
  });
});

// ── 503 — Service unavailable ────────────────────────────────────────────────

describe('classifyError — 503 unavailable', () => {
  it('is retryable', () => {
    expect(classifyError(httpErr(503, 'UNAVAILABLE overloaded'))).toMatchObject({ retryable: true });
  });

  it('sets a 10-second wait (shorter than rate limit)', () => {
    const r = classifyError(httpErr(503, 'UNAVAILABLE'));
    expect(r.waitMs).toBe(10_000);
  });
});

// ── 500 — Internal error ─────────────────────────────────────────────────────

describe('classifyError — 500 internal error', () => {
  it('is retryable', () => {
    expect(classifyError(httpErr(500, 'INTERNAL server error'))).toMatchObject({ retryable: true });
  });
});

// ── Unknown error ─────────────────────────────────────────────────────────────

describe('classifyError — unknown / generic error', () => {
  it('is retryable by default (conservative — let retry logic decide)', () => {
    expect(classifyError(new Error('something unexpected happened'))).toMatchObject({ retryable: true });
  });

  it('passes through the original message', () => {
    const r = classifyError(new Error('network failure XYZ'));
    expect(r.message).toContain('network failure XYZ');
  });

  it('handles non-Error objects gracefully', () => {
    expect(() => classifyError('a plain string error')).not.toThrow();
    expect(() => classifyError(null)).not.toThrow();
    expect(() => classifyError(undefined)).not.toThrow();
    expect(() => classifyError({ code: 42 })).not.toThrow();
  });
});

// ── SDK-style messages with status embedded in brackets ──────────────────────

describe('classifyError — SDK-style bracket messages', () => {
  it('parses [429 RESOURCE_EXHAUSTED] prefix correctly', () => {
    const r = classifyError(new Error('[429 RESOURCE_EXHAUSTED] rpm limit'));
    expect(r.retryable).toBe(true);
    expect(r.waitMs).toBe(65_000);
  });

  it('parses [403 PERMISSION_DENIED] prefix correctly', () => {
    const r = classifyError(new Error('[403 PERMISSION_DENIED] api key invalid'));
    expect(r.retryable).toBe(false);
  });
});
