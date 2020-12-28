/**
 * Open the Options Page to prompt to capture the webcam feed
 */
chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.local.get(['hasCapturedStream'], (data) => {
    if (!data.hasCapturedStream) {
      chrome.runtime.openOptionsPage()
    }
  })
})

/**
 * Handle Handsfree events
 */
chrome.runtime.onMessage.addListener(function(message) {
  switch (message.action) {
    /**
     * Start Handsfree
     */
    case 'handsfree-start':
      chrome.storage.local.set({isHandsfreeStarted: true}, function() {
        chrome.tabs.query({}, function(tabs) {
          for (var i = 0; i < tabs.length; ++i) {
            chrome.tabs.sendMessage(tabs[i].id, {action: 'handsfree-start'})
          }
        })
      })
    break
  }
})