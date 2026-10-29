// Registro del service worker (uso sin conexión) y aviso cuando hay una versión nueva.
import { create } from 'zustand';

interface SwState {
  updateReady: boolean;
  apply: () => void;
}

export const useSw = create<SwState>()(() => ({ updateReady: false, apply: () => location.reload() }));

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const url = `${import.meta.env.BASE_URL}sw.js?v=${encodeURIComponent(__BUILD_ID__)}`;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL });
      const offer = (w: ServiceWorker) => useSw.setState({
        updateReady: true,
        apply: () => {
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
          w.postMessage('skipWaiting');
        },
      });
      // Solo se ofrece actualizar si ya había una versión controlando la página (no en la primera visita).
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      // Revisa si hay versión nueva cada hora mientras la app está abierta.
      setInterval(() => { reg.update().catch(() => undefined); }, 3600_000);
    } catch {
      // Sin service worker la app funciona igual, solo que no sin conexión.
    }
  });
}
