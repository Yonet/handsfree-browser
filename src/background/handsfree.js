/**
 * Globals
 */
ports = {
  webxrDevTools: []
}

/**
 * Setup Handsfree.js and the message bus
 */
const handsfree = new Handsfree({
  assetsPath: '/assets/js/handsfree/assets',
  // weboji: true,
  hands: true
})

/**
 * Send data to content scripts
 */
handsfree.use('contentScriptBus', {
  onFrame (data) {
    // Send data to content
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      for (var i = 0; i < tabs.length; ++i) {
        console.log('background')
        chrome.tabs.sendMessage(tabs[i].id, {action: 'handsfree-data', data})
      }
    })

    // Send data to active ports
    ports.webxrDevTools.forEach(port => {
      port.postMessage({
        action: 'handsfree-data',
        data
      })
    })
  }
})

/**
 * Handle ports to send data to
 */
chrome.runtime.onConnect.addListener(port => {
  ports[port.name].push(port)

  // Remove the port
  port.onDisconnect.addListener(() => {
    const i = ports[port.name].indexOf(port)
    if (i !== -1) ports[port.name].slice(i, 1)
  })
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
