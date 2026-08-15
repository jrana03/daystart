import React, { useState, useEffect } from 'react'
import Quote from './components/Quote'
import Weather from './components/Weather'
import Articles from './components/Articles'
import { useGeolocation } from './hooks/useGeolocation'


function SectionHeading({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 tracking-tight">
        {children}
      </h2>
      {right && <div className="text-xs text-gray-400 dark:text-gray-500">{right}</div>}
    </div>
  )
}

export default function App() {
  const { location, error: geoError, loading: geoLoading } = useGeolocation()
  const [openedAt] = useState(() => new Date())

  const timeLabel = openedAt.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  const dateLabel = openedAt.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-16">

        {/* ── Header ──────────────────────────────────────────── */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white leading-none">
                DayStart
              </h1>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{dateLabel}</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Opened at
            </p>
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">{timeLabel}</p>
          </div>
        </header>

        {/* ── Quote ───────────────────────────────────────────── */}
        <section className="mb-10">
          <div
            className="bg-gradient-to-br from-blue-50 to-sky-50
                       dark:from-blue-950/60 dark:to-sky-950/40
                       rounded-2xl p-6 md:p-8
                       border border-blue-100 dark:border-blue-900/50"
          >
            <p className="text-[11px] font-bold text-blue-400 dark:text-blue-500 uppercase tracking-widest mb-5">
              Today&rsquo;s Thought
            </p>
            <Quote />
          </div>
        </section>

        {/* ── Weather ─────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionHeading>Weather</SectionHeading>

          {/* Show skeleton until geolocation resolves */}
          {!location ? (
            <div className="space-y-4">
              <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-xl h-[260px]" />
              <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-xl h-[200px]" />
            </div>
          ) : (
            <Weather latitude={location.latitude} longitude={location.longitude} />
          )}
        </section>

        {/* ── Articles ────────────────────────────────────────── */}
        <section>
          <SectionHeading>Curated Reads</SectionHeading>
          <Articles />
        </section>

      </div>
    </div>
  )
}
