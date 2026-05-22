/// <reference types="vite/client" />

/** Vite's `?inline` query loads a CSS file as a UTF-8 string at build
 *  time. Used by `src/index.tsx` to inject MapLibre's stylesheet. */
declare module '*.css?inline' {
  const content: string
  export default content
}
