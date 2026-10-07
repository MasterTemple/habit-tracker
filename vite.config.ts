/// <reference types="vitest/config" />
import path from 'node:path'
import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // HTTPS so the phone gets a secure context (service workers, crypto, notifications)
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: { host: true },
  test: {
    environment: 'node',
  },
})
