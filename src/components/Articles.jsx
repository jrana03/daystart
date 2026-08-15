import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Fuse from 'fuse.js'
import { callFunction, supabaseConfigured } from '../lib/supabase'
import { SOURCES } from '../lib/sources'

// ── Skeleton card shown while a source is loading ───────────────
function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full w-1/4" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full w-1/6" />
      </div>
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2" />
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-4/5 mb-4" />
      <div className="h-3 bg-gray-100 dark:bg-gray-700/60 rounded w-full mb-1" />
      <div className="h-3 bg-gray-100 dark:bg-gray-700/60 rounded w-5/6" />
    </div>
  )
}

// ── Individual article card ──────────────────────────────────────
function ArticleCard({ article, sourceName }) {
  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm
                 hover:shadow-md transition-all duration-200
                 border border-transparent hover:border-blue-100 dark:hover:border-blue-900/60"
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400
                         bg-blue-50 dark:bg-blue-900/40 px-2 py-0.5 rounded-full truncate">
          {sourceName}
        </span>
        {article.date && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
            {article.date}
          </span>
        )}
      </div>

      <h3 className="font-semibold text-sm leading-snug text-gray-900 dark:text-gray-100
                     group-hover:text-blue-600 dark:group-hover:text-blue-400
                     transition-colors mb-2 flex-1">
        {article.title}
      </h3>

      {article.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed mb-3">
          {article.description}
        </p>
      )}

      <span className="inline-flex items-center gap-1 mt-auto text-xs font-medium
                       text-blue-500 dark:text-blue-400">
        Read more
        <svg
          className="w-3 h-3 transition-transform group-hover:translate-x-0.5"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
      </span>
    </a>
  )
}

// Fuse.js config — threshold 0.4 catches minor typos without too many false positives
const FUSE_OPTIONS = {
  keys: [
    { name: 'title', weight: 2 },
    { name: 'description', weight: 1 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 2,
}

// ── Source summary banner (text from summarySelector) ────────────
function SourceSummary({ html }) {
  // Render plain text only. The scraped element contains structural divs
  // (some with inline heights/padding) that bloat the box far beyond the
  // actual content — stripping to text makes the box hug the words.
  // Strip to plain text, then peel off a leading "Market Summary" heading
  // (with any trailing punctuation/colon) so we can render it bold.
  const { heading, body } = useMemo(() => {
    if (!html) return { heading: null, body: '' }
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const raw = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
    const m = raw.match(/^(market summary)\s*[:\-–—]?\s*(.*)$/i)
    return m ? { heading: m[1], body: m[2] } : { heading: null, body: raw }
  }, [html])

  if (!heading && !body) return null

  return (
    <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm
                    border border-gray-100 dark:border-gray-700 px-4 py-2.5
                    text-sm text-gray-600 dark:text-gray-400 leading-snug">
      {heading && (
        <strong className="block text-gray-800 dark:text-gray-100 mb-1">{heading}</strong>
      )}
      {body}
    </div>
  )
}

// ── Main Articles component ──────────────────────────────────────
export default function Articles() {
  const [activeId, setActiveId] = useState(SOURCES[0]?.id)
  const [articlesBySource, setArticlesBySource] = useState({})
  const [summaryBySource, setSummaryBySource] = useState({})
  const [loadingBySource, setLoadingBySource] = useState({})
  const [errorBySource, setErrorBySource] = useState({})
  const [searchQuery, setSearchQuery] = useState('')

  // Clear search when switching tabs
  const handleTabChange = (id) => {
    setActiveId(id)
    setSearchQuery('')
  }

  const fetchSource = useCallback(async (source) => {
    setLoadingBySource((prev) => ({ ...prev, [source.id]: true }))
    setErrorBySource((prev) => ({ ...prev, [source.id]: null }))

    if (!supabaseConfigured) {
      setErrorBySource((prev) => ({ ...prev, [source.id]: 'Supabase not configured — see SETUP.md' }))
      setLoadingBySource((prev) => ({ ...prev, [source.id]: false }))
      return
    }

    try {
      const result = await callFunction('scrape', {
        sourceUrl: source.url,
        summarySelector: source.summarySelector ?? null,
        filterCriteria: source.filterCriteria,
      })
      // Normalise: result is { articles, summary } — guard against legacy array shape.
      const articles = Array.isArray(result) ? result : (result?.articles ?? [])
      const summary = Array.isArray(result) ? null : (result?.summary ?? null)
      setArticlesBySource((prev) => ({ ...prev, [source.id]: articles }))
      setSummaryBySource((prev) => ({ ...prev, [source.id]: summary }))
    } catch (err) {
      console.error(`[Articles] ${source.id}:`, err)
      setErrorBySource((prev) => ({
        ...prev,
        [source.id]: err.message || 'Failed to load articles',
      }))
    } finally {
      setLoadingBySource((prev) => ({ ...prev, [source.id]: false }))
    }
  }, [])

  useEffect(() => {
    SOURCES.forEach((source) => fetchSource(source))
  }, [fetchSource])

  const currentSource = SOURCES.find((s) => s.id === activeId)
  const articles = articlesBySource[activeId] ?? []
  const summary = summaryBySource[activeId] ?? null
  const loading = loadingBySource[activeId] ?? true
  const error = errorBySource[activeId]

  // Fuzzy-search the current source's articles with Fuse.js.
  // Returns the full list when the query is empty.
  const displayedArticles = useMemo(() => {
    const q = searchQuery.trim()
    if (!q || articles.length === 0) return articles
    const fuse = new Fuse(articles, FUSE_OPTIONS)
    return fuse.search(q).map((r) => r.item)
  }, [articles, searchQuery])

  const isFiltered = searchQuery.trim().length > 0

  return (
    <div>
      {/* ── Source tab buttons ─────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {SOURCES.map((source) => (
          <button
            key={source.id}
            onClick={() => handleTabChange(source.id)}
            className={`relative px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeId === source.id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
            }`}
          >
            {source.name}
            {loadingBySource[source.id] && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Search bar ────────────────────────────────────────── */}
      <div className="relative mb-4">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`Search ${currentSource?.name ?? 'articles'}…`}
          className="w-full pl-9 pr-8 py-2 text-sm rounded-lg
                     bg-white dark:bg-gray-800
                     border border-gray-200 dark:border-gray-700
                     text-gray-800 dark:text-gray-100
                     placeholder:text-gray-400 dark:placeholder:text-gray-500
                     focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-600
                     focus:border-transparent transition"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400
                       hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Clear search"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Count + refresh ───────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 h-5">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {!loading && !error && articles.length > 0 && (
            isFiltered
              ? `${displayedArticles.length} of ${articles.length} articles`
              : `${articles.length} article${articles.length !== 1 ? 's' : ''}`
          )}
        </p>
        <button
          onClick={() => currentSource && fetchSource(currentSource)}
          disabled={loading}
          className="text-xs text-blue-500 dark:text-blue-400 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── Source summary banner (e.g. market overview) ────────── */}
      {!loading && !error && summary && <SourceSummary html={summary} />}

      {/* ── Loading skeletons ─────────────────────────────────── */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────── */}
      {!loading && error && (
        <div className="text-center py-14 px-4">
          <p className="text-gray-400 dark:text-gray-500 text-sm mb-1">
            Could not load articles from {currentSource?.name}.
          </p>
          <p className="text-gray-300 dark:text-gray-600 text-xs mb-4 max-w-sm mx-auto">
            {error}
          </p>
          <button
            onClick={() => currentSource && fetchSource(currentSource)}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Empty state (no articles loaded) ─────────────────── */}
      {!loading && !error && articles.length === 0 && (
        <div className="text-center py-14 text-gray-400 dark:text-gray-500 text-sm max-w-sm mx-auto">
          <p>No articles found.</p>
          <p className="text-xs mt-1">
            The site may block automated access, or try a more specific
            listing/section page URL in{' '}
            <code className="font-mono">src/lib/sources.js</code>.
          </p>
        </div>
      )}

      {/* ── No search results ─────────────────────────────────── */}
      {!loading && !error && articles.length > 0 && displayedArticles.length === 0 && (
        <div className="text-center py-14 text-gray-400 dark:text-gray-500 text-sm">
          <p>No articles matched <span className="font-medium text-gray-600 dark:text-gray-300">"{searchQuery}"</span>.</p>
          <button
            onClick={() => setSearchQuery('')}
            className="mt-2 text-xs text-blue-500 dark:text-blue-400 hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {/* ── Article grid ──────────────────────────────────────── */}
      {!loading && !error && displayedArticles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedArticles.map((article, i) => (
            <ArticleCard
              key={`${article.link}-${i}`}
              article={article}
              sourceName={currentSource?.name ?? ''}
            />
          ))}
        </div>
      )}
    </div>
  )
}
