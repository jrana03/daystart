// ─────────────────────────────────────────────────────────────────
// /important-articles  —  cross-source "same story" grouping
// ─────────────────────────────────────────────────────────────────
//
// 1. Collects headlines + links from five news pages (WaPo front page,
//    WaPo Business, NYT front page, NYT Business, WSJ front page).
//    Each page is scraped first. When a page blocks bots or yields too few
//    headlines, the source's official RSS feed is used instead. A source
//    that fails both ways is skipped and reported back to the UI.
// 2. Sends the combined list to Claude (Anthropic Messages API) with a
//    JSON schema, asking it to group headlines that cover the same issue.
//    Only topics covered by at least two different sources are kept.
// 3. Caches the result (Supabase Storage + warm-instance memory) so the
//    LLM is not called on every page load.
//
// The Anthropic key is read from the ANTHROPIC_API_KEY secret and never
// leaves the server. See SETUP.md → "Important Articles tab".
//
import { parse as parseHTML } from 'https://esm.sh/node-html-parser@6.1.13'
import { XMLParser } from 'https://esm.sh/fast-xml-parser@4.4.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// ── Configuration ────────────────────────────────────────────────
const MODEL = 'claude-sonnet-5-5'
const CACHE_TTL_MS = 3 * 60 * 60 * 1000      // reuse a result for 3 hours
const FORCE_MIN_AGE_MS = 10 * 60 * 1000      // "Refresh" can't re-run more often than every 10 min
const CACHE_BUCKET = 'assets'                // same bucket the /quote function uses
const CACHE_PATH = 'cache/important-articles.json'
const MAX_PER_SOURCE = 40
const MIN_PAGE_HEADLINES = 5                 // fewer than this → fall back to RSS

interface Source {
  id: string
  name: string
  pageUrl: string
  feedUrl: string
  // Links on the page that look like actual articles (not section fronts).
  articlePattern: RegExp
}

const SOURCES: Source[] = [
  {
    id: 'wapo',
    name: 'Washington Post',
    pageUrl: 'https://www.washingtonpost.com/',
    feedUrl: 'https://feeds.washingtonpost.com/rss/national',
    articlePattern: /washingtonpost\.com\/.+\/20\d\d\/\d\d\/\d\d\//,
  },
  {
    id: 'wapo-business',
    name: 'Washington Post Business',
    pageUrl: 'https://www.washingtonpost.com/business/',
    feedUrl: 'https://feeds.washingtonpost.com/rss/business',
    articlePattern: /washingtonpost\.com\/.+\/20\d\d\/\d\d\/\d\d\//,
  },
  {
    id: 'nyt',
    name: 'New York Times',
    pageUrl: 'https://www.nytimes.com/',
    feedUrl: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    articlePattern: /nytimes\.com\/(live\/)?20\d\d\/\d\d\/\d\d\//,
  },
  {
    id: 'nyt-business',
    name: 'New York Times Business',
    pageUrl: 'https://www.nytimes.com/section/business',
    feedUrl: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
    articlePattern: /nytimes\.com\/(live\/)?20\d\d\/\d\d\/\d\d\//,
  },
  {
    id: 'wsj',
    name: 'Wall Street Journal',
    pageUrl: 'https://www.wsj.com/',
    feedUrl: 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews',
    articlePattern: /wsj\.com\/[a-z-]+\/.*-[0-9a-f]{8}(\?|$)/,
  },
]

interface Headline {
  source: string
  headline: string
  url: string
}

interface SourceStatus {
  name: string
  ok: boolean
  via: 'page' | 'feed' | null
  count: number
  error: string | null
}

interface Topic {
  topic: string
  articles: Headline[]
}

interface Result {
  topics: Topic[]
  sources: SourceStatus[]
  generatedAt: string
  model: string
  cached?: boolean
  setupRequired?: boolean
  error?: string
}

// ── Fetch helpers ────────────────────────────────────────────────
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function fetchText(url: string, timeoutMs = 10_000): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('timed out')
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

const clean = (s: string | null | undefined): string =>
  (s ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

const JUNK_TITLE =
  /^(sign ?in|log ?in|subscribe|menu|home|more|read more|view all|see all|watch|listen|live|video|audio|advertisement|share|comments?|newsletter|opinion|skip to)\b/i

const isLikelyHeadline = (t: string) =>
  t.length >= 25 && t.split(' ').length >= 4 && !JUNK_TITLE.test(t)

// Strip tracking query strings so the same article from page + feed dedupes.
const normaliseUrl = (u: string) => {
  try {
    const url = new URL(u)
    url.hash = ''
    url.search = ''
    return url.href
  } catch {
    return u
  }
}

// ── Page scraping: article-shaped links + their visible text ─────
function headlinesFromPage(html: string, source: Source): Headline[] {
  const root = parseHTML(html)
  const out: Headline[] = []
  const seen = new Set<string>()

  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href')
    if (!href) continue
    let url: string
    try {
      url = normaliseUrl(new URL(href, source.pageUrl).href)
    } catch {
      continue
    }
    if (!source.articlePattern.test(url) || seen.has(url)) continue

    // Prefer a heading inside the link; otherwise the link's own text.
    const heading = a.querySelector('h1, h2, h3, h4, p')
    const text = clean(heading?.text || a.text)
    if (!isLikelyHeadline(text)) continue

    seen.add(url)
    out.push({ source: source.name, headline: text, url })
    if (out.length >= MAX_PER_SOURCE) break
  }
  return out
}

// ── RSS fallback ─────────────────────────────────────────────────
function headlinesFromFeed(xml: string, source: Source): Headline[] {
  const parser = new XMLParser({ ignoreAttributes: true, cdataPropName: '__cdata' })
  const text = (v: any): string =>
    typeof v === 'string' ? v : v?.__cdata ?? v?.['#text'] ?? ''
  const doc = parser.parse(xml)
  const raw = doc?.rss?.channel?.item ?? []
  const items: any[] = Array.isArray(raw) ? raw : [raw]
  const out: Headline[] = []
  const seen = new Set<string>()
  for (const it of items) {
    const headline = clean(text(it.title))
    const link = clean(text(it.link))
    if (!headline || !link.startsWith('http')) continue
    const url = normaliseUrl(link)
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ source: source.name, headline, url })
    if (out.length >= MAX_PER_SOURCE) break
  }
  return out
}

async function collect(source: Source): Promise<{ headlines: Headline[]; status: SourceStatus }> {
  let pageError: string | null = null
  try {
    const html = await fetchText(source.pageUrl)
    const headlines = headlinesFromPage(html, source)
    if (headlines.length >= MIN_PAGE_HEADLINES) {
      return { headlines, status: { name: source.name, ok: true, via: 'page', count: headlines.length, error: null } }
    }
    pageError = `page had only ${headlines.length} headlines`
  } catch (err) {
    pageError = `page ${err instanceof Error ? err.message : 'failed'}`
  }

  try {
    const xml = await fetchText(source.feedUrl)
    const headlines = headlinesFromFeed(xml, source)
    if (headlines.length > 0) {
      return { headlines, status: { name: source.name, ok: true, via: 'feed', count: headlines.length, error: null } }
    }
    throw new Error('feed was empty')
  } catch (err) {
    const feedError = `feed ${err instanceof Error ? err.message : 'failed'}`
    console.warn(`[important-articles] ${source.name}: ${pageError}; ${feedError}`)
    return {
      headlines: [],
      status: { name: source.name, ok: false, via: null, count: 0, error: `${pageError}; ${feedError}` },
    }
  }
}

// ── Claude: group headlines into shared topics ───────────────────
const TOPIC_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          articles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string' },
                headline: { type: 'string' },
                url: { type: 'string' },
              },
              required: ['source', 'headline', 'url'],
              additionalProperties: false,
            },
          },
        },
        required: ['topic', 'articles'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `You group news headlines from several outlets by the story they cover.

You get a list of headlines. Each has an outlet name, the headline, and its URL.
Find the news stories, issues, or events that more than one outlet is covering, and group those headlines under one topic.

Rules:
- Group headlines only when they are about the same specific story or issue (for example, the same court ruling, the same company's earnings, the same policy fight). A shared broad theme such as "the economy" or "politics" is not enough.
- A topic must include headlines from at least two different outlets. "Washington Post" and "Washington Post Business" count as one outlet, and so do "New York Times" and "New York Times Business". Leave out stories covered by only one outlet.
- Copy each source, headline, and url exactly as given. Never invent or change a URL.
- Name each topic in a short, neutral phrase of 3 to 8 words.
- Order topics from most widely covered to least.`

const OUTLET = (name: string) => name.replace(/ Business$/, '')

async function groupTopics(apiKey: string, headlines: Headline[]): Promise<Topic[]> {
  const client = new Anthropic({ apiKey })
  const list = headlines
    .map((h) => `- [${h.source}] ${h.headline} | ${h.url}`)
    .join('\n')

  // Server-side fallback ("default") re-runs the request on a fallback
  // model if Claude declines it, instead of returning an empty result.
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: TOPIC_SCHEMA },
    },
    messages: [{ role: 'user', content: `Headlines:\n${list}` }],
  } as any)

  if (response.stop_reason === 'refusal') throw new Error('The model declined the request')
  if (response.stop_reason === 'max_tokens') throw new Error('The model response was cut off')

  const textBlock = response.content.find((b: any) => b.type === 'text') as any
  if (!textBlock?.text) throw new Error('The model returned no text')
  const parsed = JSON.parse(textBlock.text) as { topics: Topic[] }

  // Trust only URLs we actually scraped; restore source/headline from our data.
  const byUrl = new Map(headlines.map((h) => [normaliseUrl(h.url), h]))
  const topics: Topic[] = []
  for (const t of parsed.topics ?? []) {
    const seen = new Set<string>()
    const articles: Headline[] = []
    for (const a of t.articles ?? []) {
      const known = byUrl.get(normaliseUrl(a.url ?? ''))
      if (!known || seen.has(known.url)) continue
      seen.add(known.url)
      articles.push(known)
    }
    const outlets = new Set(articles.map((a) => OUTLET(a.source)))
    if (t.topic && outlets.size >= 2) topics.push({ topic: t.topic.trim(), articles })
  }
  return topics
}

// ── Cache: warm-instance memory + Supabase Storage ───────────────
let memoryCache: Result | null = null

const storage = () => {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  return url && key ? createClient(url, key).storage.from(CACHE_BUCKET) : null
}

async function readCache(): Promise<Result | null> {
  if (memoryCache) return memoryCache
  try {
    const { data, error } = (await storage()?.download(CACHE_PATH)) ?? {}
    if (error || !data) return null
    memoryCache = JSON.parse(await data.text())
    return memoryCache
  } catch {
    return null
  }
}

async function writeCache(result: Result) {
  memoryCache = result
  try {
    const blob = new Blob([JSON.stringify(result)], { type: 'application/json' })
    const res = await storage()?.upload(CACHE_PATH, blob, { upsert: true, contentType: 'application/json' })
    if (res?.error) console.warn('[important-articles] cache write failed:', res.error.message)
  } catch (err) {
    console.warn('[important-articles] cache write failed:', err)
  }
}

const ageMs = (r: Result) => Date.now() - new Date(r.generatedAt).getTime()

// ── Handler ──────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

  let force = false
  if (req.method === 'POST') {
    try {
      force = Boolean((await req.json())?.force)
    } catch { /* empty body is fine */ }
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey || apiKey === 'your-anthropic-api-key-here') {
    return json({
      topics: [],
      sources: [],
      generatedAt: new Date().toISOString(),
      model: MODEL,
      setupRequired: true,
      error: 'ANTHROPIC_API_KEY is not set for this function. See SETUP.md → "Important Articles tab".',
    } satisfies Result)
  }

  const cached = await readCache()
  if (cached) {
    const age = ageMs(cached)
    if (age < CACHE_TTL_MS && (!force || age < FORCE_MIN_AGE_MS)) {
      return json({ ...cached, cached: true })
    }
  }

  try {
    const collected = await Promise.all(SOURCES.map(collect))
    const headlines = collected.flatMap((c) => c.headlines)
    const sources = collected.map((c) => c.status)
    const okOutlets = new Set(sources.filter((s) => s.ok).map((s) => OUTLET(s.name)))

    if (okOutlets.size < 2) {
      // Not enough outlets to compare. Serve the last good result if we have one.
      if (cached) return json({ ...cached, cached: true })
      return json({ error: 'Fewer than two outlets could be loaded', sources }, 502)
    }

    const topics = await groupTopics(apiKey, headlines)
    const result: Result = { topics, sources, generatedAt: new Date().toISOString(), model: MODEL }
    await writeCache(result)
    return json(result)
  } catch (err) {
    console.error('[important-articles] failed:', err)
    // Prefer a stale result over an error screen.
    if (cached) return json({ ...cached, cached: true })
    const message =
      err instanceof Anthropic.AuthenticationError
        ? 'Anthropic rejected the API key. Check the ANTHROPIC_API_KEY secret.'
        : err instanceof Anthropic.RateLimitError
          ? 'Anthropic rate limit hit. Try again in a minute.'
          : err instanceof Error
            ? err.message
            : 'Failed to build topics'
    return json({ error: message }, 502)
  }
})
