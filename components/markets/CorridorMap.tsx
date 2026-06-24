/// <reference types="@types/google.maps" />
'use client'

import { useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

declare global {
  interface Window {
    gm_authFailure?: () => void
  }
}

const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d2d44' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#373769' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c3c6e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

type MapState = 'loading' | 'ready' | 'error'

export function CorridorMap({
  originLat,
  originLng,
  destLat,
  destLng,
  corridorName,
  pathPolyline,
}: {
  originLat: number
  originLng: number
  destLat: number
  destLng: number
  corridorName: string
  pathPolyline?: string | null
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [mapState, setMapState] = useState<MapState>('loading')

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
    if (!apiKey || !mapRef.current) {
      setMapState('error')
      return
    }

    let cancelled = false

    // gm_authFailure is called for global script-level auth errors (e.g. invalid key).
    // RefererNotAllowedMapError bypasses it — handled via the tilesloaded timeout below.
    const prevAuthFailure = window.gm_authFailure
    window.gm_authFailure = () => { if (!cancelled) setMapState('error') }

    setOptions({ key: apiKey })

    // If tiles haven't loaded within 5s the key is likely blocked (referrer restriction).
    // The map div stays visibility:hidden the whole time so the Google error overlay
    // is never visible to the user regardless of error type.
    const timer = setTimeout(() => {
      if (!cancelled) setMapState(prev => prev === 'loading' ? 'error' : prev)
    }, 5000)

    Promise.all([
      importLibrary('maps'),
      importLibrary('marker'),
      importLibrary('core'),
      importLibrary('geometry'),
    ]).then(([mapsLib, markerLib, coreLib, geometryLib]) => {
      if (cancelled || !mapRef.current) return

      const { Map, TrafficLayer, Polyline } = mapsLib as google.maps.MapsLibrary
      const { Marker } = markerLib as google.maps.MarkerLibrary
      const { SymbolPath, LatLngBounds } = coreLib as google.maps.CoreLibrary
      const { encoding } = geometryLib as google.maps.GeometryLibrary

      const midLat = (originLat + destLat) / 2
      const midLng = (originLng + destLng) / 2

      const map = new Map(mapRef.current, {
        center: { lat: midLat, lng: midLng },
        zoom: 12,
        gestureHandling: 'none',
        zoomControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        styles: DARK_STYLE,
      })

      // Reveal the map only after tiles confirm successful auth and render
      map.addListener('tilesloaded', () => {
        if (!cancelled) {
          clearTimeout(timer)
          setMapState('ready')
        }
      })

      new TrafficLayer().setMap(map)

      // Origin and destination are plotted as standalone markers. We intentionally
      // don't draw a connecting line: a straight geodesic line misrepresents the
      // actual road route, and the two endpoints are all the corridor needs to convey.
      new Marker({
        position: { lat: originLat, lng: originLng },
        map,
        title: 'Origen',
        icon: {
          path: SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#818cf8',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })

      new Marker({
        position: { lat: destLat, lng: destLng },
        map,
        title: 'Destino',
        icon: {
          path: SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#f43f5e',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })

      // Draw the actual road route when we have its geometry, and frame the map
      // to it. Without a polyline the two endpoint markers convey the corridor.
      if (pathPolyline) {
        const path = encoding.decodePath(pathPolyline)
        new Polyline({
          path,
          map,
          strokeColor: '#f5a623',
          strokeOpacity: 0.9,
          strokeWeight: 4,
        })
        const bounds = new LatLngBounds()
        path.forEach((point) => bounds.extend(point))
        map.fitBounds(bounds, 28)
      }
    }).catch(() => {
      if (!cancelled) setMapState('error')
    })

    return () => {
      cancelled = true
      clearTimeout(timer)
      window.gm_authFailure = prevAuthFailure
    }
  }, [originLat, originLng, destLat, destLng, pathPolyline])

  const mapsUrl = `https://www.google.com/maps/dir/${originLat},${originLng}/${destLat},${destLng}`

  const header = (
    <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2">
      <p className="text-[12px] text-insu-muted">
        <span className="mr-1">📍</span>{corridorName} — tráfico en tiempo real
      </p>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-insu-accent hover:underline"
      >
        Abrir en Google Maps ↗
      </a>
    </div>
  )

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07]">
      {header}
      <div className="relative h-48">
        {/* Map div is always mounted so the SDK can render into it.
            Kept invisible until tilesloaded confirms auth succeeded — this
            prevents Google's error overlay from ever being visible. */}
        <div
          ref={mapRef}
          className="absolute inset-0"
          style={{ visibility: mapState === 'ready' ? 'visible' : 'hidden' }}
        />
        {mapState !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[13px] text-insu-muted">
            {mapState === 'loading' ? 'Cargando mapa…' : (
              <>
                Mapa no disponible —
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-insu-accent hover:underline"
                >
                  ver ruta en Google Maps ↗
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
