import React, { useState, useEffect } from 'react'
import { callFunction, supabaseConfigured } from '../lib/supabase'

// The "quote day" rolls over at 4am LOCAL time (not midnight), so the quote
// changes each morning. Returns an integer that increments by exactly 1 per
// day — used both as the cache key and the value sent to the Edge Function.
function quoteDayNumber(now = new Date()) {
  const shifted = new Date(now.getTime() - 4 * 60 * 60 * 1000) // 4am cutoff
  // Convert to local wall-clock ms, then floor to whole local days.
  const localMs = shifted.getTime() - shifted.getTimezoneOffset() * 60_000
  return Math.floor(localMs / 86_400_000)
}

// Milliseconds from now until the next 4am local — used to auto-refresh a
// page that's been left open overnight.
function msUntilNext4am(now = new Date()) {
  const next = new Date(now)
  next.setHours(4, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

export default function Quote() {
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadQuote() {
      const day = quoteDayNumber()
      const cacheKey = `daily-quote-${day}`

      // Use the cached quote if we already fetched one for this quote-day.
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          if (!cancelled) {
            setQuote(JSON.parse(cached))
            setLoading(false)
          }
          return
        } catch {
          localStorage.removeItem(cacheKey)
        }
      }

      if (!supabaseConfigured) {
        if (!cancelled) {
          setError('Supabase not configured — see SETUP.md')
          setLoading(false)
        }
        return
      }

      try {
        const data = await callFunction(`quote?day=${day}`)
        if (cancelled) return
        setQuote(data)
        setError(null)
        localStorage.setItem(cacheKey, JSON.stringify(data))
      } catch (err) {
        console.error('[Quote]', err)
        if (!cancelled) setError(err.message || 'Failed to load quote')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadQuote()

    // Re-load when the 4am boundary passes so a long-open page updates itself.
    const timer = setTimeout(loadQuote, msUntilNext4am() + 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-5 bg-blue-200 dark:bg-blue-800 rounded w-3/4" />
        <div className="h-5 bg-blue-200 dark:bg-blue-800 rounded w-5/6" />
        <div className="h-4 bg-blue-100 dark:bg-blue-900 rounded w-1/3 mt-4" />
      </div>
    )
  }

  if (error || !quote) {
    return (
      <p className="text-blue-400 italic text-sm">
        Could not load today's quote. Check that the Edge Function is deployed and quotes.txt is in Supabase Storage.
      </p>
    )
  }

  return (
    <blockquote>
      <p className="text-lg md:text-xl font-light italic text-gray-700 dark:text-gray-200 leading-relaxed">
        {quote.text}
      </p>

      {quote.author && (
        <footer className="mt-4 text-sm font-semibold text-blue-600 dark:text-blue-400 tracking-wide">
          &mdash;&nbsp;{quote.author}
        </footer>
      )}
    </blockquote>
  )
}
