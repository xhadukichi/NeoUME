const CACHE_NAME = 'ume-neo-app-v1';
const APP_ROOT = new URL('./', self.registration.scope);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add(APP_ROOT.href))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('ume-neo-app-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if(request.method !== 'GET' || requestUrl.origin !== APP_ROOT.origin || !requestUrl.href.startsWith(APP_ROOT.href)) return;

  if(request.mode === 'navigate'){
    event.respondWith((async ()=>{
      try{
        const response = await fetch(request);
        if(response.ok){
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch{
        return (await caches.match(request)) || (await caches.match(APP_ROOT.href));
      }
    })());
    return;
  }

  event.respondWith((async ()=>{
    const cached = await caches.match(request);
    if(cached) return cached;
    try{
      const response = await fetch(request);
      if(response.ok && response.type === 'basic'){
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch{
      return (await caches.match(request)) || Response.error();
    }
  })());
});
