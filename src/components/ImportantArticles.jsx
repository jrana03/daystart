import React, { useState, useEffect, useCallback } from 'react'
import { callFunction, supabaseConfigured } from '../lib/supabase'

// The /important-articles Edge Function scrapes WaPo, NYT and WSJ, then asks
// Claude to group headlines covering the same story. The function caches
// results for a few hours; this browser cache avoids even the round trip
// on quick reloads.
const STORAGE_KEY = 'daystart-important-articles-v1'
const CLIENT_TTL_MS = 60 * 60 * 1000 // 1 hour

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.savedAt > CLIENT_TTL_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeLocal(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), data }))
  } catch { /* storage full or disabled — non-fatal */ }
}

function formatTime(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function SkeletonTopic() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-4" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-3">
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full w-1/4 mb-1.5" />
          <div className="h-3 bg-gray-100 dark:bg-gray-700/60 rounded w-full" />
        </div>
      ))}
    </div>
  )
}

function TopicCard({ topic }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-3 leading-snug">
        <span className="text-amber-600 dark:text-amber-400">Topic:</span> {topic.topic}
      </h3>
      <ul className="space-y-2.5">
        {topic.articles.map((a) => (
          <li key={a.url}>
            <span className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-0.5">
              {a.source}
            </span>
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm leading-snug text-blue-600 dark:text-blue-400 hover:underline"
            >
              {a.headline}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function ImportantArticles() {
  const [data, setData] = useState(() => readLocal())
  const [loading, setLoading] = useState(() => !readLocal())
  const [error, setError] = useState(null)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    if (!supabaseConfigured) {
      setError('Supabase not configured — see SETUP.md')
      setLoading(false)
      return
    }
    try {
      const result = await callFunction('important-articles', { force })
      setData(result)
      if (!result.setupRequired) writeLocal(result)
    } catch (err) {
      console.error('[ImportantArticles]', err)
      // An undeployed function returns a 404 without CORS headers, which the
      // browser reports only as "Failed to fetch".
      const msg = err.message || 'Failed to load important articles'
      setError(
        msg === 'Failed to fetch'
          ? 'Failed to fetch. Is the important-articles function deployed? See SETUP.md → “Important Articles tab”.'
          : msg,
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!readLocal()) load()
  }, [load])

  const topics = data?.topics ?? []
  const failedSources = (data?.sources ?? []).filter((s) => !s.ok)

  return (
    <div>
      {/* ── Status + refresh ──────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 min-h-5 gap-3">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {!loading && data && !data.setupRequired && (
            <>
              {topics.length} shared topic{topics.length !== 1 ? 's' : ''} across WaPo, NYT and WSJ
              {data.generatedAt && ` · updated ${formatTime(data.generatedAt)}`}
            </>
          )}
        </p>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="text-xs text-blue-500 dark:text-blue-400 hover:underline disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── Skipped sources notice ────────────────────────────── */}
      {!loading && failedSources.length > 0 && (
        <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">
          Skipped (could not load): {failedSources.map((s) => s.name).join(', ')}
        </p>
      )}

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonTopic key={i} />)}
        </div>
      )}

      {/* ── Setup needed (no Anthropic key yet) ───────────────── */}
      {!loading && !error && data?.setupRequired && (
        <div className="text-center py-14 px-4 text-sm text-gray-400 dark:text-gray-500 max-w-md mx-auto">
          <p className="mb-1">Important Articles needs an Anthropic API key.</p>
          <p className="text-xs">
            Set the <code className="font-mono">ANTHROPIC_API_KEY</code> secret on the{' '}
            <code className="font-mono">important-articles</code> function. See SETUP.md →
            “Important Articles tab”.
          </p>
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-14 px-4">
          <p className="text-gray-400 dark:text-gray-500 text-sm mb-1">Could not load important articles.</p>
          <p className="text-gray-300 dark:text-gray-600 text-xs mb-4 max-w-sm mx-auto">{error}</p>
          <button
            onClick={() => load(true)}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && data && !data.setupRequired && topics.length === 0 && (
        <div className="text-center py-14 text-gray-400 dark:text-gray-500 text-sm">
          No stories are covered by two or more outlets right now.
        </div>
      )}

      {!loading && !error && topics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {topics.map((t, i) => <TopicCard key={`${t.topic}-${i}`} topic={t} />)}
        </div>
      )}
    </div>
  )
}
