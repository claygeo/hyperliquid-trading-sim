import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { boundedNavigatorLock } from './authLock';
import { createFetchWithTimeout } from './fetchWithTimeout';

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // auth-js requests an unlimited Web Locks wait for session mutations.
    // Bound it so a stale tab cannot freeze login/logout indefinitely.
    lock: boundedNavigatorLock,
  },
  global: {
    // Ensure a lost network response cannot hold the auth/logout barrier forever.
    fetch: createFetchWithTimeout(globalThis.fetch.bind(globalThis)),
  },
});
