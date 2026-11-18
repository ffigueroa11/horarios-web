// Service worker de Horarios Web: permite abrir la app y generar horarios sin conexión.
// La versión llega en la URL de registro (sw.js?v=...): cada versión usa su propio caché y borra los anteriores.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `horarios-web-${VERSION}`;
const ENGINE = ['engine/fet-cl.js', 'engine/fet-cl.wasm', 'engine/fet-worker.js', 'engine/fet_es.qm'];

const fresh = (u) => new Request(u, { cache: 'no-cache' });

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(fresh('./'));
      if (!res.ok) throw new Error(`página: ${res.status}`);
      const html = await res.clone().text();
      // Todo lo que produjo el build (lista generada por vite.config.ts) y el motor. Si falta algo, la instalación
      // falla y sigue la versión anterior: mejor eso que descubrir sin conexión que no se puede generar o abrir un Excel.
      const list = await fetch(fresh('precache.json'));
      if (!list.ok) throw new Error(`precache.json: ${list.status}`);
      await cache.addAll([...new Set([...(await list.json()), ...ENGINE])].map(fresh));
      // Lo que index.html enlaza desde public/ (íconos, manifiesto): prescindible.
      const linked = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
        .filter((u) => !/^(https?:|data:|#)/.test(u));
      await Promise.all(linked.map((u) => cache.add(fresh(u)).catch(() => undefined)));
      await cache.put('./', res);
    } catch (e) {
      await caches.delete(CACHE);
      throw e;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('horarios-web-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// La app pide activar la versión nueva cuando el usuario acepta actualizar.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  if (req.mode === 'navigate') {
    // Página: primero la red (para ver avisos de versión nueva); sin conexión, la guardada.
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put('./', res.clone());
        return res;
      } catch {
        return (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }
  // Archivos: lo guardado (el caché es por versión) y, si falta, la red. ignoreVary: lo guardado al instalar se pidió
  // sin el encabezado Origin que llevan los módulos y estilos de la página; con "Vary: Origin" no coincidiría.
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: url.pathname.endsWith('sw.js') ? false : true, ignoreVary: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone());
    return res;
  })());
});
