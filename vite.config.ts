import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.VITE_BASE ?? '/hyderabad-police-ptt/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      mqtt: new URL('./node_modules/mqtt/dist/mqtt.esm.js', import.meta.url).pathname,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 8731,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/health': 'http://127.0.0.1:8080',
      '/api': 'http://127.0.0.1:8080',
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
  preview: { host: '127.0.0.1', port: 8731, strictPort: true, allowedHosts: true },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  build: { target: 'esnext' },
})
