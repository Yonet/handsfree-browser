let handsfree

/**
 * Handle messages from background script
 */
chrome.runtime.onMessage.addListener(function(message) {
  switch (message.action) {
    case 'handsfree-start':
      if (!handsfree) {
        handsfree = new Handsfree({
          assetsPath: chrome.runtime.getURL('/public/handsfree/assets'),
          weboji: true
        })
      }
      handsfree.start()
    break
  }
})