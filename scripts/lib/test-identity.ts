import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

/** Local test users authenticate through the same email-code verification endpoint as the app. */
export async function emailSession(admin: SupabaseClient, client: SupabaseClient, email = `${randomUUID()}@example.com`) {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  const signed = await client.auth.verifyOtp({ email, token: link.data.properties.email_otp, type: 'email' });
  if (signed.error) throw signed.error;
  return signed.data.session!;
}

/** An admin client for `emailSession`, from the local stack's secret key. */
export function authAdmin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
