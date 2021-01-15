handsfree = new Handsfree({
  isClient: true,
  hands: true,
  weboji: true
})
handsfree.enablePlugins('browser')

/**
 * Handle messages from background script
 */
chrome.runtime.onMessage.addListener(function(message) {
  switch (message.action) {
    case 'handsfree-data':
      handsfree.runPlugins(message.data)
    break

    case 'handsfree-debug':
      console.log(message.data)
    break
  }
})
