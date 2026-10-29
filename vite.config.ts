/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; repository?: { url?: string } }

// Ruta base del sitio: "/" en un dominio propio (Cloudflare Pages, Vercel) o "/<repositorio>/" en GitHub Pages.
// Se define con BASE_PATH; el flujo de GitHub Pages la calcula a partir del nombre del repositorio.
const base = process.env.BASE_PATH || '/'

// Enlace al código fuente (la licencia AGPL exige ofrecerlo a quien use la app).
const repo = process.env.GITHUB_REPOSITORY
const sourceUrl = process.env.VITE_SOURCE_URL
  || (repo ? `https://github.com/${repo}` : pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, ''))
  || ''

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(`${pkg.version}-${Date.now().toString(36)}`),
    __SOURCE_URL__: JSON.stringify(sourceUrl),
  },
  build: { chunkSizeWarningLimit: 900 },
  test: { include: ['src/**/*.test.ts'], testTimeout: 30_000 },
})
