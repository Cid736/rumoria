import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// Every test starts with no server: a test that needs answers sets its own fetch.
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  try { localStorage.clear(); } catch { /* none */ }
});
afterEach(() => cleanup());
