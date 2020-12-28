let handsfree

/**
 * Handle messages from background script
 */
chrome.runtime.onMessage.addListener(function(message) {
  switch (message.action) {
    case 'handsfreeData':
      console.log('data', message.data)
    break
  }
})
