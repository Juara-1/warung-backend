import { createClient, SupabaseClient } from '@supabase/supabase-js';
import config from '@/config';

export default async (): Promise<SupabaseClient> => {
  const supabase = createClient(config.supabase.url, config.supabase.anonKey, {
    auth: {
      autoRefreshToken: false, // Backend doesn't need token refresh
      persistSession: false, // Backend doesn't need session persistence
      detectSessionInUrl: false, // Backend doesn't need URL detection
    },
    db: {
      schema: 'public',
    },
  });

  return supabase;
};
