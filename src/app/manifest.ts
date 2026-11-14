import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pit Stop 2.0 – Comande',
    short_name: 'Comande',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf6ef',
    theme_color: '#a51d2d',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
