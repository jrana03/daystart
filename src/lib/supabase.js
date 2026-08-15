import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!supabaseConfigured) {
  console.warn(
    '[DayStart] Missing Supabase env vars. Copy .env.example → .env.local and fill in your project credentials.'
  )
}

// Used for Supabase Auth / Realtime if needed in future.
// Edge Function calls bypass this client and use raw fetch() instead —
// that way CORS errors show the real HTTP status code rather than a generic message.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
)

/**
 * Call a Supabase Edge Function directly via fetch().
 * This bypasses the Supabase JS client so that any gateway errors (401, 404, 500)
 * surface as real HTTP status codes instead of opaque "CORS error" messages.
 *
 * @param {string} fnName  - Function name (e.g. 'quote', 'scrape')
 * @param {object} [body]  - JSON body for POST requests; omit for GET
 * @returns {Promise<any>} - Parsed JSON response
 */
export async function callFunction(fnName, body) {
  if (!supabaseConfigured) {
    throw new Error('Supabase not configured — copy .env.example → .env.local')
  }

  const url = `${supabaseUrl}/functions/v1/${fnName}`
  const isPost = body !== undefined

  const res = await fetch(url, {
    method: isPost ? 'POST' : 'GET',
    headers: {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
      ...(isPost && { 'Content-Type': 'application/json' }),
    },
    ...(isPost && { body: JSON.stringify(body) }),
  })

  if (!res.ok) {
    // Read the body so we can surface the real error message
    const text = await res.text().catch(() => '')
    let msg
    try {
      msg = JSON.parse(text)?.error || text || `HTTP ${res.status}`
    } catch {
      msg = text || `HTTP ${res.status}`
    }
    throw new Error(`[${res.status}] ${msg}`)
  }

  return res.json()
}
