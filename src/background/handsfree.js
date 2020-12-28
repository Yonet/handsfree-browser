/**
 * Setup Handsfree.js and the message bus
 */
const handsfree = new Handsfree({
  assetsPath: '/public/handsfree/assets',
  weboji: true,
  hands: true
})

handsfree.use('contentScriptBus', {
  onFrame (data) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      for (var i = 0; i < tabs.length; ++i) {
        chrome.tabs.sendMessage(tabs[i].id, {action: 'handsfreeData', data})
      }
    })
  }
})

/**
 * Override requestAnimationFrame, which doesn't work in background script
 */
_requestAnimationFrame = requestAnimationFrame
requestAnimationFrame = newRequestAnimationFrame = function(cb) {
  setTimeout(function() {
    cb()
  }, 1000 / 30)
}

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
chrome.runtime.onMessage.addListener(function(message, sender, respond) {
  switch (message.action) {
    /**
     * Start Handsfree
     */
    case 'handsfreeStart':
      chrome.storage.local.set({isHandsfreeStarted: true}, function() {
        handsfree.start()
        handsfree.enablePlugins('browser')
        chrome.browserAction.setBadgeBackgroundColor({
          color: '#f00'
        })
        chrome.browserAction.setBadgeText({
          text: 'ON'
        })
      })
      return

    /**
     * Stop Handsfree
     */
    case 'handsfreeStop':
      chrome.storage.local.set({isHandsfreeStarted: false}, function() {
        handsfree.stop()
        chrome.browserAction.setBadgeText({
          text: ''
        })
      })
      return

    /**
     * Load a dependency into the current tab
     */
    case 'handsfreeLoadDependency':
      chrome.tabs.executeScript({file: message.file}, function () {
        Promise.resolve('').then(respond)
      })
      return true
  }
})