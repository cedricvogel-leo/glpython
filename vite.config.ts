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
  // glpython-editor's Pyodide worker is loaded via
  // `new Worker(new URL('./pyodide-worker.js', import.meta.url))`, resolved
  // relative to the editor package's own dist/index.js. In dev, Vite's
  // dependency pre-bundler would otherwise copy that file into
  // node_modules/.vite/deps/ (flattening away its sibling dist/assets/
  // folder and breaking the relative worker reference), so it's excluded
  // from pre-bundling and served directly out of node_modules instead,
  // where the worker asset actually lives next to it.
  optimizeDeps: {
    exclude: ['glpython-editor'],
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
}))
