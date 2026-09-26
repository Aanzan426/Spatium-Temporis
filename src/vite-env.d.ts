/**
 * Ambient declarations for Vite's asset-import suffixes.
 *
 * `import sql from './001_init.sql?raw'` is a Vite feature, not a TypeScript one — the
 * bundler inlines the file as a string. Without this declaration `tsc` has no idea what
 * that specifier resolves to and fails with "cannot find module".
 *
 * Declared here rather than by adding `"types": ["vite/client"]` to tsconfig, because
 * `vite/client` also pulls in `ImportMeta.env` and the whole DOM asset-module surface,
 * most of which this project does not use. One three-line declaration is easier to
 * understand in a year than a types entry whose effects are invisible.
 */

declare module '*.sql?raw' {
  const content: string
  export default content
}

declare module '*?raw' {
  const content: string
  export default content
}

/**
 * Side-effect CSS imports. Vite turns `import './styles.css'` into a style injection;
 * TypeScript needs to be told the specifier resolves to something.
 */
declare module '*.css' {
  const content: string
  export default content
}
