/**
 * Creates the DevTools page
 */
chrome.devtools.panels.create(
  'WebXR',
  '/assets/favicon.png',
  '/src/devtools/webxr/webxr.html'
)