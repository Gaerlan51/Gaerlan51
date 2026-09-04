import { describe, it, expect } from 'vitest';
import { isPublicRoute, isSupabaseConfigured } from '@/domain/routes';

describe('public route matching', () => {
  it('lets the marketing pages and sign-in through', () => {
    for (const path of ['/', '/services', '/branches', '/about', '/contact', '/login']) {
      expect(isPublicRoute(path)).toBe(true);
    }
  });

  it('lets the cron endpoint through, which carries its own bearer secret', () => {
    expect(isPublicRoute('/api/cron')).toBe(true);
    expect(isPublicRoute('/api/cron/reminders')).toBe(true);
  });

  it('does NOT treat "/" as a prefix — the whole app would otherwise be public', () => {
    for (const path of [
      '/dashboard', '/patients', '/patients/abc-123', '/schedule', '/followups',
      '/reminders', '/audit', '/api/export/patients', '/api/documents/abc/pdf',
    ]) {
      expect(isPublicRoute(path)).toBe(false);
    }
  });

  it('does not let a lookalike path through', () => {
    expect(isPublicRoute('/loginx')).toBe(false);
    expect(isPublicRoute('/contact/patients')).toBe(false);
    expect(isPublicRoute('/api/cronjobs')).toBe(false);
  });
});

describe('deployment configuration check', () => {
  it('accepts a real project URL and key', () => {
    expect(isSupabaseConfigured('https://abcdefgh.supabase.co', 'eyJhbGciOi.real.key')).toBe(true);
  });

  it('rejects missing values', () => {
    expect(isSupabaseConfigured(undefined, undefined)).toBe(false);
    expect(isSupabaseConfigured('https://abcdefgh.supabase.co', '')).toBe(false);
  });

  it('rejects the placeholders from .env.example, so a fresh deploy says so', () => {
    expect(isSupabaseConfigured('https://placeholder.supabase.co', 'placeholder')).toBe(false);
  });

  it('rejects a non-https URL', () => {
    expect(isSupabaseConfigured('http://abcdefgh.supabase.co', 'key')).toBe(false);
  });
});
