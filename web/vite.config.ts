import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// docker compose 에서는 VITE_PROXY_TARGET=http://backend:8000
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // 오프라인 큐·정밀 캐시 전략은 src/sw/ 에 injectManifest 로 옮길 예정. Phase 0 은 최소 설정.
      manifest: {
        name: '송월타월 QR 공정관리',
        short_name: 'SongWol QR',
        lang: 'ko',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        background_color: '#ffffff',
        theme_color: '#0f172a',
        icons: [],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/health$/],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: proxyTarget, changeOrigin: true },
      '/ws': { target: proxyTarget, ws: true, changeOrigin: true },
      '/health': { target: proxyTarget, changeOrigin: true },
    },
  },
})
