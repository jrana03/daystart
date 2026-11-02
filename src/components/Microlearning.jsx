import React, { useEffect, useState } from 'react'
import { BOOK_INFO, BOOK_LESSONS } from '../lib/lessons'

const STORAGE_KEY = BOOK_INFO.storageKey

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const validNumbers = new Set(BOOK_LESSONS.map((lesson) => lesson.number))
    return {
      current: validNumbers.has(saved.current) ? saved.current : 1,
      completed: Array.isArray(saved.completed)
        ? saved.completed.filter((number) => validNumbers.has(number))
        : [],
    }
  } catch {
    return { current: 1, completed: [] }
  }
}

export default function Microlearning() {
  const [progress, setProgress] = useState(loadProgress)
  const lesson = BOOK_LESSONS.find((item) => item.number === progress.current) || BOOK_LESSONS[0]
  const completed = new Set(progress.completed)
  const isComplete = completed.has(lesson.number)
  const completedCount = completed.size

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
    } catch {
      // Browsers with storage disabled can still use the lessons this session.
    }
  }, [progress])

  const selectLesson = (number) => setProgress((previous) => ({ ...previous, current: number }))

  const toggleComplete = () => setProgress((previous) => ({
    ...previous,
    completed: previous.completed.includes(lesson.number)
      ? previous.completed.filter((number) => number !== lesson.number)
      : [...previous.completed, lesson.number],
  }))

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-indigo-100 dark:border-indigo-900/50 bg-gradient-to-br from-indigo-50 via-white to-sky-50 dark:from-indigo-950/50 dark:via-gray-800 dark:to-sky-950/30 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 mb-2">A book in small lessons</p>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">{BOOK_INFO.title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{BOOK_INFO.subtitle} · {BOOK_INFO.author}</p>
          </div>
          <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">
            {completedCount} of {BOOK_LESSONS.length} completed
          </p>
        </div>
        <div
          className="mt-5 h-2.5 rounded-full bg-indigo-100 dark:bg-indigo-950 overflow-hidden"
          role="progressbar"
          aria-label="Sections completed"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={BOOK_LESSONS.length}
        >
          <div
            className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400 transition-all duration-300"
            style={{ width: `${(completedCount / BOOK_LESSONS.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-5">
        <div className="lg:hidden mb-4">
          <label htmlFor="lesson-select" className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Choose a section</label>
          <select
            id="lesson-select"
            value={lesson.number}
            onChange={(event) => selectLesson(Number(event.target.value))}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"
          >
            {BOOK_LESSONS.map((item) => (
              <option key={item.number} value={item.number}>
                {completed.has(item.number) ? '✓ ' : ''}{item.label}: {item.title}
              </option>
            ))}
          </select>
        </div>

        <nav aria-label="Book sections" className="hidden lg:block rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 shadow-sm self-start max-h-[610px] overflow-y-auto">
          {BOOK_LESSONS.map((item) => (
            <button
              key={item.number}
              type="button"
              onClick={() => selectLesson(item.number)}
              aria-current={item.number === lesson.number ? 'step' : undefined}
              className={`w-full flex items-start gap-2.5 text-left rounded-xl px-3 py-2.5 transition-colors ${
                item.number === lesson.number
                  ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/70'
              }`}
            >
              <span className={`shrink-0 flex items-center justify-center rounded-full w-6 h-6 text-[11px] font-bold ${
                completed.has(item.number)
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              }`}>{completed.has(item.number) ? '✓' : item.number}</span>
              <span className="text-xs leading-snug font-medium pt-1"><span className="block text-[10px] uppercase tracking-wide opacity-70 mb-0.5">{item.label}</span>{item.title}</span>
            </button>
          ))}
        </nav>

        <article aria-live="polite" className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 sm:p-7 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
              {lesson.part} · {lesson.label}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">PDF page {lesson.page}</span>
          </div>
          <h4 className="text-xl sm:text-2xl font-bold leading-tight text-gray-900 dark:text-white">{lesson.title}</h4>
          <div className="mt-4 space-y-3">
            {lesson.summary.map((paragraph) => (
              <p key={paragraph} className="text-sm sm:text-base leading-relaxed text-gray-600 dark:text-gray-300">{paragraph}</p>
            ))}
          </div>

          <div className="mt-7 border-t border-gray-100 dark:border-gray-700 pt-6">
            <h5 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Key points to remember</h5>
            <ul className="space-y-3">
              {lesson.points.map((point) => (
                <li key={point} className="flex gap-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  <span aria-hidden="true" className="mt-[7px] w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-7 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1">Reflect</p>
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{lesson.prompt}</p>
          </div>

          <div className="mt-7 pt-5 border-t border-gray-100 dark:border-gray-700 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleComplete}
              aria-pressed={isComplete}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                isComplete
                  ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-200 dark:hover:bg-green-900/60'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {isComplete ? '✓ Completed' : 'Mark complete'}
            </button>
            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={() => selectLesson(lesson.number - 1)}
                disabled={lesson.number === 1}
                className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={() => selectLesson(lesson.number + 1)}
                disabled={lesson.number === BOOK_LESSONS.length}
                className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        </article>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        Original study notes based on the book. Your progress is saved in this browser.
      </p>
    </div>
  )
}
