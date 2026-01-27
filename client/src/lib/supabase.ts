import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Debug: Log config values (remove in production)
console.log('[Supabase Config]', {
  url: config.supabaseUrl,
  keyLength: config.supabaseAnonKey?.length || 0,
  keyPreview: config.supabaseAnonKey?.substring(0, 20) + '...',
});

if (!config.supabaseUrl || !config.supabaseAnonKey) {
  console.error('[Supabase] Missing URL or anon key! Check your .env file.');
}

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});