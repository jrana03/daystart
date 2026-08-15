import React, { useState, useEffect, useRef } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

function ChartSkeleton({ height = 220 }) {
  return (
    <div
      className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-xl"
      style={{ height }}
    />
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-600 dark:text-gray-300 mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: <span className="font-medium">{entry.value}{entry.unit ?? ''}</span>
        </p>
      ))}
    </div>
  )
}

export default function Weather({ latitude, longitude }) {
  const [weatherData, setWeatherData] = useState(null)
  const [locationName, setLocationName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const currentHourRef = useRef(null)
  const scrollContainerRef = useRef(null)

  useEffect(() => {
    if (latitude == null || longitude == null) return

    async function fetchAll() {
      try {
        // Fetch weather data and reverse-geocode the coordinates in parallel
        const weatherParams = new URLSearchParams({
          latitude,
          longitude,
          hourly: 'temperature_2m,precipitation_probability',
          forecast_days: '1',
          timezone: 'auto',
        })

        const [weatherRes, geoRes] = await Promise.all([
          fetch(`${OPEN_METEO_URL}?${weatherParams}`),
          fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
          ),
        ])

        if (!weatherRes.ok) throw new Error(`Weather API returned ${weatherRes.status}`)

        const [weatherJson, geoJson] = await Promise.all([
          weatherRes.json(),
          geoRes.ok ? geoRes.json() : Promise.resolve(null),
        ])

        // Resolve a human-readable city name from the Nominatim response
        if (geoJson?.address) {
          const a = geoJson.address
          setLocationName(
            a.city || a.town || a.suburb || a.village || a.county || a.state || null
          )
        }

        // Build the per-hour data array
        const { time, temperature_2m, precipitation_probability } = weatherJson.hourly
        const parsed = time.map((t, i) => {
          const hour = new Date(t).getHours()
          const label =
            hour === 0 ? '12am' :
            hour < 12 ? `${hour}am` :
            hour === 12 ? '12pm' :
            `${hour - 12}pm`
          return {
            hour: label,
            rawHour: hour,
            temp: Math.round(temperature_2m[i]),
            precip: precipitation_probability[i] ?? 0,
          }
        })

        setWeatherData(parsed)
      } catch (err) {
        console.error('[Weather]', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [latitude, longitude])

  // Centre the current hour inside the table's horizontal scroll area once
  // data is available. We set scrollLeft on the container directly instead of
  // using scrollIntoView, which would also scroll the whole PAGE down to the
  // weather section (jarring on mobile — the page should open at the top).
  // NOTE: this hook must stay above the early returns below — React requires
  // hooks to run in the same order on every render.
  useEffect(() => {
    if (!weatherData) return
    const container = scrollContainerRef.current
    const cell = currentHourRef.current
    if (!container || !cell) return
    container.scrollLeft = cell.offsetLeft - container.clientWidth / 2 + cell.offsetWidth / 2
  }, [weatherData])

  if (loading) {
    return (
      <div className="space-y-4">
        <ChartSkeleton height={200} />
        <ChartSkeleton height={200} />
        <ChartSkeleton height={160} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">
        Weather unavailable: {error}
      </div>
    )
  }

  // Hour to highlight on the chart/table (read at render time)
  const currentHour = new Date().getHours()

  // Bar chart uses every 3 hours to keep columns readable
  const barData = weatherData.filter((d) => d.rawHour % 3 === 0)

  // Min/max temps for highlighting
  const temps = weatherData.map((d) => d.temp)
  const minTemp = Math.min(...temps)
  const maxTemp = Math.max(...temps)

  // Coloured dots on the line chart: yellow = now, red = max, blue = min
  const renderDot = (props) => {
    const { cx, cy, payload, index } = props
    if (payload.rawHour === currentHour)
      return <circle key={index} cx={cx} cy={cy} r={5} fill="#fef08a" stroke="#eab308" strokeWidth={1.5} />
    if (payload.temp === maxTemp)
      return <circle key={index} cx={cx} cy={cy} r={5} fill="#fca5a5" stroke="#ef4444" strokeWidth={1.5} />
    if (payload.temp === minTemp)
      return <circle key={index} cx={cx} cy={cy} r={5} fill="#93c5fd" stroke="#3b82f6" strokeWidth={1.5} />
    return <g key={index} />
  }

  return (
    <div className="space-y-5">
      {/* Location label */}
      {locationName && (
        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
          </svg>
          {locationName}
        </p>
      )}

      {/* ── Chart 1: Vertical bar chart — precipitation only ──── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">
          Precipitation Chance
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} barSize={28} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              dataKey="precip"
              name="Rain %"
              fill="#60a5fa"
              radius={[4, 4, 0, 0]}
              unit="%"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Chart 2: Line graph — 24-hour temperature trend ───── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">
          24-Hour Temperature Trend
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={weatherData} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              interval={3}
            />
            <YAxis
              tickFormatter={(v) => `${v}°C`}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="temp"
              name="Temp"
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={renderDot}
              activeDot={{ r: 5, strokeWidth: 0 }}
              unit="°C"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Table 3: Hourly temperature snapshot ──────────────── */}
      {/* Scrolls horizontally so all 24 hours stay visible in one row */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">
          Hourly Temperature
        </h3>
        <div ref={scrollContainerRef} className="overflow-x-auto scrollbar-hide">
          <table className="min-w-max w-full text-xs border-collapse">
            <thead>
              <tr>
                {weatherData.map((d) => (
                  <th
                    key={d.rawHour}
                    ref={d.rawHour === currentHour ? currentHourRef : null}
                    className={`px-3 py-1.5 text-center font-medium whitespace-nowrap
                               border-b border-gray-100 dark:border-gray-700
                               ${d.rawHour === currentHour
                                 ? 'text-yellow-500 dark:text-yellow-400'
                                 : 'text-gray-400 dark:text-gray-500'}`}
                  >
                    {d.hour}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {weatherData.map((d) => (
                  <td
                    key={d.rawHour}
                    className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${
                      d.temp === maxTemp
                        ? 'bg-red-50 dark:bg-red-950/30 text-red-500 dark:text-red-300'
                        : d.temp === minTemp
                        ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-500 dark:text-blue-300'
                        : 'text-gray-800 dark:text-gray-100'
                    }`}
                  >
                    {d.temp}°C
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
