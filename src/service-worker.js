/// <reference lib="webworker" />
// offline shell with honest updates, the house rules on the kit manifest:
//   - navigations go network first, the cached shell is the offline fallback
//   - only ok responses are cached, precache = kit's build + static files + prerendered
//   - the version manifest goes NETWORK FIRST, always
import { build, files, prerendered, version } from '$service-worker'

const CACHE = `quarry-${version}`
const PRECACHE = [...build, ...files, ...prerendered]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return

  // kit's version manifest is how the app learns a new deploy exists. serving it
  // cache-first pins the client to the version it booted with, so the update check can
  // never see a new deploy. this was the pilot's round-3 scar; do not make it again.
  if (new URL(req.url).pathname.endsWith('/_app/version.json')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)))
    return
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then(hit => hit || caches.match('.'))),
    )
    return
  }

  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); event.waitUntil(caches.open(CACHE).then(c => c.put(req, copy))) }
      return res
    })),
  )
})
