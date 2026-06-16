/// <reference types="@types/google.maps" />
'use client'

import { useEffect, useRef } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

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

export function CorridorMap({
  originLat,
  originLng,
  destLat,
  destLng,
  corridorName,
}: {
  originLat: number
  originLng: number
  destLat: number
  destLng: number
  corridorName: string
}) {
  const mapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
    if (!apiKey || !mapRef.current) return

    let cancelled = false

    // v2 API: setOptions configures the loader (key/v, not apiKey/version)
    setOptions({ key: apiKey, v: 'weekly' })

    Promise.all([
      importLibrary('maps'),
      importLibrary('marker'),
      importLibrary('core'),
    ]).then(([mapsLib, markerLib, coreLib]) => {
      if (cancelled || !mapRef.current) return

      const { Map, Polyline, TrafficLayer } = mapsLib as google.maps.MapsLibrary
      const { Marker } = markerLib as google.maps.MarkerLibrary
      const { SymbolPath } = coreLib as google.maps.CoreLibrary

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

      new TrafficLayer().setMap(map)

      new Polyline({
        path: [
          { lat: originLat, lng: originLng },
          { lat: destLat, lng: destLng },
        ],
        geodesic: true,
        strokeColor: '#818cf8',
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map,
      })

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
    }).catch(() => {})  // map failures (CSP, invalid key) should not crash the page

    return () => { cancelled = true }
  }, [originLat, originLng, destLat, destLng])

  const mapsUrl = `https://www.google.com/maps/dir/${originLat},${originLng}/${destLat},${destLng}`

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2">
        <p className="text-[11px] text-insu-muted">
          <span className="mr-1">📍</span>{corridorName} — tráfico en tiempo real
        </p>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-insu-accent hover:underline"
        >
          Abrir en Google Maps ↗
        </a>
      </div>
      <div ref={mapRef} className="h-48 w-full" />
    </div>
  )
}
