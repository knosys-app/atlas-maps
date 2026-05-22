import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * Vite build config for the v3 plugin.
 *
 * Outputs a single CommonJS `main.js` consumed by the Knosys host
 * plugin loader. React + react-dom remain external (provided by host
 * via the Shared dependencies bundle). MapLibre and other heavy deps
 * are bundled into the plugin.
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
