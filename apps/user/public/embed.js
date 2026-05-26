/**
 * Sunbnb reservation widget loader.
 *
 * A venue drops one line on their own site:
 *   <script src="https://<app>/embed.js" data-restaurant="RESTAURANT_ID" async></script>
 *
 * It injects a responsive iframe pointing at /embed/<restaurantId> and resizes
 * it to the widget's content height via postMessage. The actual booking runs
 * same-origin inside the iframe against the public availability + /book APIs.
 */
(function () {
  var current =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName('script')
      return s[s.length - 1]
    })()
  if (!current) return

  var restaurantId = current.getAttribute('data-restaurant')
  if (!restaurantId) {
    if (window.console) console.error('[sunbnb-embed] missing data-restaurant attribute')
    return
  }

  // Widget origin: explicit data-base-url, else the origin embed.js was served from.
  var base
  try {
    base = current.getAttribute('data-base-url') || new URL(current.src).origin
  } catch (e) {
    if (window.console) console.error('[sunbnb-embed] could not resolve base URL', e)
    return
  }
  var widgetOrigin = new URL(base, window.location.href).origin

  var iframe = document.createElement('iframe')
  iframe.src = widgetOrigin + '/embed/' + encodeURIComponent(restaurantId)
  iframe.title = 'Reservations'
  iframe.setAttribute('loading', 'lazy')
  iframe.style.width = '100%'
  iframe.style.border = '0'
  iframe.style.minHeight = '520px'
  iframe.style.overflow = 'hidden'

  current.parentNode.insertBefore(iframe, current.nextSibling)

  window.addEventListener('message', function (event) {
    if (event.origin !== widgetOrigin) return
    var data = event.data
    if (data && data.type === 'sunbnb-embed-resize' && typeof data.height === 'number') {
      iframe.style.height = data.height + 'px'
    }
  })
})()
