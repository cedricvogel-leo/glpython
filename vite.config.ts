import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Cross-origin isolation headers are required so the Pyodide worker can use
// SharedArrayBuffer, which powers the input() dialog bridge.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project from /glpython/, so assets and the
  // Pyodide worker need to be requested under that base path in production.
  base: command === 'build' ? '/glpython/' : '/',
  plugins: [react()],
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
}))
