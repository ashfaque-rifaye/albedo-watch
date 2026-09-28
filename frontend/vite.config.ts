import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // MapLibre v6 loads its ES-module worker relative to its own file; pre-bundling breaks that URL.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'iife' },
  server: { port: Number(process.env.PORT) || 5180, proxy: { '/api': 'http://localhost:8010' } },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: { manualChunks: (id: string) => (/maplibre-gl|@deck\.gl|@luma\.gl|@loaders\.gl|@math\.gl/.test(id) ? 'map' : undefined) },
    },
  },
})
