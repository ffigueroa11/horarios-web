/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; repository?: { url?: string } }

// Ruta base del sitio: "/" salvo que se publique en una subcarpeta, con BASE_PATH (ej. "/<repositorio>/").
const base = process.env.BASE_PATH || '/'

// Enlace al código fuente (la licencia AGPL exige ofrecerlo a quien use la app).
const repo = process.env.GITHUB_REPOSITORY
const sourceUrl = process.env.VITE_SOURCE_URL
  || (repo ? `https://github.com/${repo}` : pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, ''))
  || ''

// Lista de lo que el service worker guarda al instalarse (public/sw.js): todo lo que produce el build, incluidos los
// módulos que se cargan bajo demanda (Excel, Firebase) y las fuentes, que index.html no menciona.
const precacheList = (): Plugin => ({
  name: 'horarios-precache',
  apply: 'build',
  generateBundle(_options, bundle) {
    const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html').sort()
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) })
  },
})

// `vite preview` responde con los mismos encabezados que Vercel (vercel.json), incluida la política de seguridad de
// contenido: así las pruebas de navegador, que corren sobre la vista previa, la ponen a prueba.
const vercelHeaders = (): Plugin => {
  const rules = (JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }).headers.map((r) => ({ match: new RegExp(`^${r.source}$`), headers: r.headers }))
  return {
    name: 'horarios-vercel-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://x').pathname.slice(base.length - 1)
        for (const r of rules) if (r.match.test(path)) for (const h of r.headers) res.setHeader(h.key, h.value)
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), precacheList(), vercelHeaders()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(`${pkg.version}-${Date.now().toString(36)}`),
    __SOURCE_URL__: JSON.stringify(sourceUrl),
  },
  build: { chunkSizeWarningLimit: 900 },
  test: { include: ['src/**/*.test.ts'], testTimeout: 30_000 },
})
