// Push helpers for the service worker. A classic script (importScripts) that vitest can also load.
// Only same-origin targets are ever opened from a notification; anything else becomes the home page.
(function (root) {
  function safeNotificationUrl(url, origin) {
    if (typeof url !== 'string' || !url) return '/'
    try {
      var parsed = new URL(url, origin)
      if (parsed.origin !== origin) return '/'
      return parsed.pathname + parsed.search + parsed.hash
    } catch (err) {
      return '/'
    }
  }

  root.safeNotificationUrl = safeNotificationUrl
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { safeNotificationUrl: safeNotificationUrl }
  }
})(typeof self !== 'undefined' ? self : globalThis)
