import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// MapLibre GL is BUNDLED into the plugin (was external in v2.0.0). The
// goal of v2.1.0 is to let the desktop app drop maplibre-gl from its
// own dependency tree; bundling it here means the plugin runs without
// any host-side MapLibre presence.
export default defineConfig({
  plugins: [react()],
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
      // React is still provided by the host. Everything else is bundled.
      external: ['react', 'react-dom'],
      output: {
        globals: { react: 'React', 'react-dom': 'ReactDOM' },
      },
    },
    cssCodeSplit: false,
    outDir: '.',
    emptyOutDir: false,
  },
})
