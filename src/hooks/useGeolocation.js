import { useState, useEffect } from 'react'

// Default coordinates (New York City) used when permission is denied or unavailable
const DEFAULT_LOCATION = { latitude: 40.7128, longitude: -74.006 }

/**
 * Returns the user's current geographic coordinates via the browser Geolocation API.
 * Falls back to DEFAULT_LOCATION if the user denies permission or the browser
 * doesn't support geolocation.
 *
 * @returns {{ location: {latitude, longitude} | null, error: string | null, loading: boolean }}
 */
export function useGeolocation() {
  const [location, setLocation] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser')
      setLocation(DEFAULT_LOCATION)
      setLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setLoading(false)
      },
      (err) => {
        // Permission denied or unavailable — use default silently
        setError(err.message)
        setLocation(DEFAULT_LOCATION)
        setLoading(false)
      },
      {
        timeout: 10_000,
        maximumAge: 600_000, // accept a cached position up to 10 minutes old
      }
    )
  }, [])

  return { location, error, loading }
}
