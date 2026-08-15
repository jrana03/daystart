// ─────────────────────────────────────────────────────────────────
// /scrape  —  RSS feed GENERATOR for any URL
// ─────────────────────────────────────────────────────────────────
//
// Works like rss.app: point it at ANY web page and it builds a feed.
// For each source URL it does:
//
//   1. If the URL is already an RSS / Atom / RDF feed, parse it directly.
//   2. Otherwise, fetch the HTML and GENERATE a feed by heuristically
//      extracting article-like content — headline links, summaries and
//      dates — without needing any per-site CSS selectors.
//
// Every path returns the same normalised shape:
//   { title, link, description, date }
//
import { parse as parseHTML } from 'https://esm.sh/node-html-parser@6.1.13'
import { XMLParser } from 'https://esm.sh/fast-xml-parser@4.4.0'

// CORS headers must be on EVERY response — including errors and the OPTIONS preflight.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

interface FilterCriteria {
  keywords?: string[]
  excludeKeywords?: string[]
  minLength?: number
}

interface RequestBody {
  sourceUrl: string
  summarySelector?: string
  filterCriteria?: FilterCriteria
}

interface Article {
  title: string
  link: string
  description: string | null
  date: string | null
}

interface FeedResult {
  articles: Article[]
  summary: string | null   // innerHTML of summarySelector element, if any
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  Accept:
    'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

// ── Small text helpers ───────────────────────────────────────────
const clean = (s: string | null | undefined): string | null => {
  if (!s) return null
  const out = s.replace(/\s+/g, ' ').trim()
  return out || null
}

// Feed/HTML descriptions frequently contain markup — strip it to plain text.
const stripHtml = (s: string | null): string | null => {
  if (!s) return null
  return clean(s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' '))
}

const truncate = (s: string | null, max = 300): string | null => {
  if (!s) return null
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length

const absUrl = (href: string | null | undefined, base: string): string | null => {
  if (!href) return null
  const h = href.trim()
  if (!h || h.startsWith('#') || h.startsWith('javascript:') || h.startsWith('mailto:')) return null
  try {
    return h.startsWith('http') ? h : new URL(h, base).href
  } catch {
    return null
  }
}

// Normalise RFC-822 (RSS) or ISO-8601 (Atom) dates to a short readable label.
const formatDate = (raw: string | null): string | null => {
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return clean(raw)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// fast-xml-parser values can be strings, objects with #text/CDATA, or arrays.
const textOf = (v: unknown): string | null => {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return textOf(v[0])
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return textOf(o['#text'] ?? o['__cdata'] ?? null)
  }
  return null
}

const asArray = <T,>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v]

// ── Detect whether fetched content is already a feed ─────────────
function looksLikeFeed(text: string, contentType: string): boolean {
  const ct = contentType.toLowerCase()
  if (ct.includes('xml') || ct.includes('rss') || ct.includes('atom')) return true
  const head = text.slice(0, 1500).toLowerCase()
  return (
    head.includes('<rss') ||
    head.includes('<feed') ||
    head.includes('<rdf:rdf') ||
    head.includes('<?xml')
  )
}

// ── Parse an existing RSS 2.0 / RDF / Atom feed ──────────────────
function parseFeed(xml: string, baseUrl: string): Article[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    cdataPropName: '__cdata',
    trimValues: true,
  })

  let doc: Record<string, any>
  try {
    doc = parser.parse(xml)
  } catch {
    return []
  }

  const articles: Article[] = []

  // RSS 2.0       →  rss > channel > item[]
  // RDF / RSS 1.0 →  rdf:RDF > item[]
  const channel = doc?.rss?.channel ?? doc?.['rdf:RDF']
  const rssItems = asArray<any>(channel?.item)

  if (rssItems.length) {
    for (const it of rssItems) {
      const title = clean(textOf(it.title))
      const rawLink =
        clean(textOf(it.link)) ??
        clean(textOf(it.guid)) ??
        (typeof it['@_rdf:about'] === 'string' ? it['@_rdf:about'] : null)
      const description = truncate(
        stripHtml(textOf(it.description) ?? textOf(it['content:encoded'])),
      )
      const date = textOf(it.pubDate) ?? textOf(it['dc:date'])
      articles.push({
        title: title ?? '',
        link: absUrl(rawLink, baseUrl) ?? '',
        description,
        date: formatDate(date),
      })
    }
    return articles
  }

  // Atom 1.0  →  feed > entry[]
  const entries = asArray<any>(doc?.feed?.entry)
  for (const e of entries) {
    const title = clean(textOf(e.title))
    let rawLink: string | null = null
    const links = asArray<any>(e.link)
    if (links.length) {
      const alt = links.find((l) => (l?.['@_rel'] ?? 'alternate') === 'alternate') ?? links[0]
      rawLink = typeof alt === 'string' ? alt : (alt?.['@_href'] ?? null)
    }
    const description = truncate(stripHtml(textOf(e.summary) ?? textOf(e.content)))
    const date = textOf(e.updated) ?? textOf(e.published)
    articles.push({
      title: title ?? '',
      link: absUrl(rawLink, baseUrl) ?? '',
      description,
      date: formatDate(date),
    })
  }
  return articles
}

// ─────────────────────────────────────────────────────────────────
// FEED GENERATOR — build a feed from an arbitrary HTML page
// ─────────────────────────────────────────────────────────────────

// Boilerplate link text that is never a real headline.
const JUNK_TITLE =
  /^(sign ?in|log ?in|sign ?up|register|subscribe|menu|home|more|read more|view all|see all|watch|listen|live|video|audio|advertisement|share|comments?|newsletter|contact|about|privacy|terms|cookies?|search|skip to|follow|donate|next|previous|back to top|load more)\b/i

function isLikelyHeadline(title: string | null): title is string {
  if (!title) return false
  if (title.length < 25) return false // real headlines are rarely this short
  if (wordCount(title) < 4) return false
  if (JUNK_TITLE.test(title)) return false
  return true
}

// Walk up a few ancestors from `el`, looking for the first decent <p> summary.
function nearbyDescription(el: any, title: string): string | null {
  let node: any = el
  for (let depth = 0; depth < 4 && node && node.tagName?.toLowerCase() !== 'body'; depth++) {
    const paragraphs = node.querySelectorAll?.('p') ?? []
    for (const p of paragraphs) {
      const txt = clean(p.text)
      if (txt && txt.length >= 40 && txt !== title) return truncate(txt)
    }
    node = node.parentNode
  }
  return null
}

// Walk up a few ancestors looking for a <time> element.
function nearbyDate(el: any): string | null {
  let node: any = el
  for (let depth = 0; depth < 4 && node && node.tagName?.toLowerCase() !== 'body'; depth++) {
    const t = node.querySelector?.('time')
    if (t) return clean(t.getAttribute('datetime') ?? t.text)
    node = node.parentNode
  }
  return null
}

function generateFeed(html: string, baseUrl: string): Article[] {
  const root = parseHTML(html)
  const articles: Article[] = []
  const seenLinks = new Set<string>()
  const seenTitles = new Set<string>()

  const collect = (el: any, title: string, href: string | null) => {
    const link = absUrl(href, baseUrl)
    if (!link || seenLinks.has(link)) return
    const titleKey = title.toLowerCase()
    if (seenTitles.has(titleKey)) return
    seenLinks.add(link)
    seenTitles.add(titleKey)
    articles.push({
      title,
      link,
      description: nearbyDescription(el, title),
      date: formatDate(nearbyDate(el)),
    })
  }

  // PRIMARY: headlines almost always live in <h1>–<h4>. For each heading,
  // the article link is either an <a> inside it or an <a> wrapping it.
  const headings = root.querySelectorAll('h1, h2, h3, h4')
  for (const h of headings) {
    const title = clean(h.text)
    if (!isLikelyHeadline(title)) continue
    const inner = h.querySelector('a')?.getAttribute('href')
    const outer = (h as any).closest?.('a')?.getAttribute('href')
    collect(h, title, inner ?? outer ?? null)
  }

  // FALLBACK: some sites don't wrap headlines in headings. If we found
  // very little, scan anchors directly for long, headline-like link text.
  if (articles.length < 5) {
    const anchors = root.querySelectorAll('a')
    for (const a of anchors) {
      const title = clean(a.text)
      if (!isLikelyHeadline(title)) continue
      collect(a, title, a.getAttribute('href'))
    }
  }

  return articles
}

// ── Apply keyword / length filters + dedupe + cap ────────────────
function refine(articles: Article[], filter?: FilterCriteria, max = 30): Article[] {
  const seen = new Set<string>()
  const out: Article[] = []

  for (const a of articles) {
    if (!a.title || !a.link) continue
    if (filter?.minLength && a.title.length < filter.minLength) continue

    const lower = a.title.toLowerCase()
    if (filter?.keywords?.filter(Boolean).length) {
      if (!filter.keywords.some((kw) => kw && lower.includes(kw.toLowerCase()))) continue
    }
    if (filter?.excludeKeywords?.length) {
      if (filter.excludeKeywords.some((kw) => kw && lower.includes(kw.toLowerCase()))) continue
    }

    if (seen.has(a.link)) continue
    seen.add(a.link)
    out.push(a)
    if (out.length >= max) break
  }
  return out
}

// ── Fetch with timeout + browser headers ─────────────────────────
async function fetchText(url: string): Promise<{ text: string; contentType: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS })
    if (!res.ok) throw new Error(`Target site returned HTTP ${res.status}`)
    const contentType = res.headers.get('content-type') ?? ''
    const text = await res.text()
    return { text, contentType }
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Request body must be valid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { sourceUrl, summarySelector, filterCriteria } = body

  if (!sourceUrl?.trim()) {
    return new Response(JSON.stringify({ error: 'sourceUrl is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(sourceUrl.trim())
    if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('bad protocol')
  } catch {
    return new Response(JSON.stringify({ error: 'sourceUrl must be a valid http/https URL' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { text, contentType } = await fetchText(baseUrl.href)
    const isFeed = looksLikeFeed(text, contentType)

    // If the URL is already a feed, parse it; otherwise GENERATE one.
    const articles = isFeed
      ? parseFeed(text, baseUrl.origin)
      : generateFeed(text, baseUrl.origin)

    // Extract the optional summary element (only meaningful for HTML pages).
    let summary: string | null = null
    if (summarySelector && !isFeed) {
      try {
        const root = parseHTML(text)
        const el = root.querySelector(summarySelector)
        summary = el ? (clean(el.innerHTML) ?? null) : null
      } catch { /* non-fatal — missing element just means no summary */ }
    }

    const result: FeedResult = { articles: refine(articles, filterCriteria), summary }
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    console.error(
      `[scrape] ${isTimeout ? 'Timeout' : 'Error'} for ${sourceUrl}:`,
      err instanceof Error ? err.message : err,
    )
    return new Response(
      JSON.stringify({
        error: isTimeout
          ? 'Request timed out after 10 seconds'
          : 'Failed to generate feed. The site may be unavailable or blocking automated access.',
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
