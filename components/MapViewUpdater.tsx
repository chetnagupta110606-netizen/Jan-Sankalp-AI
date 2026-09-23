import { useEffect } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';

export function MapViewUpdater({
  center,
  zoom
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();

    if (center) {
      map.flyTo(center, zoom, { animate: true, duration: 1.5 });
    }
  }, [center, zoom, map]);

  return null;
}

export interface DistrictMapProps {
  center: [number, number];
  zoom?: number;
  isModalOpen?: boolean;
  onMapReady?: () => void;
}

export function DistrictMap({
  center,
  zoom = 6,
  isModalOpen = false,
  onMapReady
}: DistrictMapProps) {
  useEffect(() => {
    if (isModalOpen) {
      window.dispatchEvent(new Event('resize'));
    }
  }, [isModalOpen]);

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: '100%', width: '100%', minHeight: 420 }}
      scrollWheelZoom={true}
      whenReady={() => {
        onMapReady?.();
      }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapViewUpdater center={center} zoom={zoom} />
    </MapContainer>
  );
}

export default DistrictMap;
