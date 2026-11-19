// Which caching rule applies to a request. A classic script so the service worker can importScripts() it,
// and CommonJS-compatible so vitest can load the very same file. Keep it free of anything else.
//
// Signed-in pages, live prices and anything that changes data must always come from the network, so those
// are 'network-only' and the worker does not touch them at all.
(function (root) {
  var NEVER = ['/admin', '/order', '/orders', '/account', '/auth', '/api']
  var STATIC = ['/_next/static/', '/brand/', '/icons/']
  var FONT = /\.(woff2?|ttf|otf)$/i

  function under(path, prefix) {
    return path === prefix || path.indexOf(prefix + '/') === 0
  }

  function cacheStrategyFor(url, method) {
    if (String(method).toUpperCase() !== 'GET') return 'network-only'
    var path = url.pathname
    for (var i = 0; i < NEVER.length; i++) if (under(path, NEVER[i])) return 'network-only'
    for (var j = 0; j < STATIC.length; j++) if (path.indexOf(STATIC[j]) === 0) return 'cache-first'
    if (FONT.test(path)) return 'cache-first'
    return 'network-first'
  }

  root.cacheStrategyFor = cacheStrategyFor
  if (typeof module !== 'undefined' && module.exports) module.exports = { cacheStrategyFor: cacheStrategyFor }
})(typeof self !== 'undefined' ? self : globalThis)
