/// <reference types="vitest/config" />
import path from 'node:path'
import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; set by the deploy workflow.
  base: process.env.BASE_PATH ?? '/',
  // HTTPS so the phone gets a secure context (service workers, crypto, notifications)
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: true,
    // In development, /api goes to a local sync server (cd server && cargo run -p habit-api),
    // so the app and the phone on the same Wi-Fi reach it without CORS or mixed content.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  test: {
    environment: 'node',
  },
})
