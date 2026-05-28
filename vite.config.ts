import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * Vite build config for the v3 plugin.
 *
 * Outputs a single CommonJS `main.js` consumed by the Knosys host
 * plugin loader.
 *
 * Externals:
 *   - `react` — provided by the host's pluginRequire shim
 *     (resolves to `Shared.React`).
 *   - `react-dom` — NOT externalised. The host's shim explicitly
 *     throws on `require('react-dom')` to catch plugins that pull
 *     it in by accident. We have transitive consumers
 *     (@dnd-kit/core uses createPortal for the drag overlay) so
 *     react-dom MUST bundle into main.js — externalising it would
 *     make activate() unreachable when the module's top-level
 *     `require('react-dom')` throws inside the host shim.
 *
 * MapLibre, pmtiles, protomaps, dnd-kit, and zustand all bundle in.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: ['react'],
      output: {
        globals: { react: 'React' },
      },
    },
    cssCodeSplit: false,
    outDir: '.',
    emptyOutDir: false,
  },
})
