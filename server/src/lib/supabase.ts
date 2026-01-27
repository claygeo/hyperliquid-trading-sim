import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    if (!config.supabase.url || !config.supabase.serviceKey) {
      throw new Error('Supabase credentials not configured');
    }
    
    supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabase;
}

export { supabase };
