'use strict';

/**
 * Save specific files to local cache.
 * @param {Event} event
 * @return {void}
 */
function saveCache(event)
{
    event.waitUntil(
        caches.open('app-v1').then(function (cache) {
            return cache.addAll([
                // '/assets/css/app.css',
                '/assets/vendor/nipplejs/0.8.5/nipplejs.min.js',
                // '/assets/js/app.js',
            ]);
        })
    );
}


// Install
self.addEventListener('install', function (event) {
    saveCache(event);
});


// Refresh
self.addEventListener('refreshOffline', saveCache);


// If any fetch fails, try to load from cache
self.addEventListener('fetch', function (event) {
    event.respondWith(
        fetch(event.request).catch(function () {
            return caches.match(event.request);
        })
    );
});
