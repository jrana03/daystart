import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS headers must be present on EVERY response — including errors.
// Without them the browser blocks the response before the frontend can read it,
// which shows up as a generic "CORS error" even when the function itself ran fine.
// Access-Control-Allow-Methods is required for the browser's OPTIONS preflight to pass.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

Deno.serve(async (req: Request) => {
  // Every cross-origin request is preceded by an OPTIONS preflight.
  // We must respond 204 (no content) with the CORS headers or the browser
  // will refuse to send the real request.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('assets')
      .download('quotes.txt')

    if (downloadError || !fileData) {
      console.error('[quote] Storage download failed:', downloadError?.message)
      return new Response(
        JSON.stringify({ error: 'quotes.txt not found in Supabase Storage bucket "assets"' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const rawText = await fileData.text()
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))

    if (lines.length === 0) {
      return new Response(
        JSON.stringify({ error: 'quotes.txt is empty' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // The client passes a ?day=N number (local day, rolls over at 4am) so the
    // quote is consistent with the user's timezone. Fall back to the server's
    // UTC day if it's absent. Either way the value increments by exactly 1 per
    // day — which means using it as an index directly would just walk the file
    // in order. Run it through a hash first so consecutive days look random.
    const dayParam = new URL(req.url).searchParams.get('day')
    const parsedDay = dayParam !== null ? Number(dayParam) : NaN
    const day = Number.isFinite(parsedDay)
      ? Math.trunc(parsedDay)
      : Math.floor(Date.now() / 86_400_000)

    // MurmurHash3 bit-mixer — scrambles sequential ints into well-distributed
    // unsigned 32-bit ints so consecutive days produce unrelated indices.
    const hashDay = (n: number): number => {
      // Math.imul preserves 32-bit integer multiplication semantics in JS.
      let h = n | 0
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
      h = h ^ (h >>> 16)
      return h >>> 0 // force unsigned
    }
    const index = hashDay(day) % lines.length

    const parts = lines[index].split('|')
    const text = parts[0].trim()
    const author = parts.length > 1 ? parts[1].trim() : null

    return new Response(
      JSON.stringify({ text, author }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('[quote] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
