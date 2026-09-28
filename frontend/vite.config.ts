import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5180, proxy: { '/api': process.env.API_TARGET || 'http://localhost:8012' } },
  // CesiumJS loads its workers/assets from /cesium/ (copied by scripts/copy-cesium.mjs)
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: { manualChunks: (id: string) => (/[\\/]node_modules[\\/]cesium[\\/]|[\\/]@cesium[\\/]/.test(id) ? 'cesium' : undefined) },
    },
  },
})
