/**
 * Globals
 */
ports = {
  // @see /src/devtools/webxr/handsfree.js
  webxrDevTools: [],
  // @see /src/content/webxr.js
  webxrContentScript: []
}

/**
 * Setup Handsfree.js and the message bus
 */
const handsfree = new Handsfree({
  assetsPath: '/assets/js/handsfree/assets',
  showDebug: true,
  hands: true
})

/**
 * Stream the canvases
 */
handsfree.use('updateCanvas', {
  onFrame () {
    // const data = {
    //   $canvas: {
    //     hands: {
    //       data: handsfree.debug.context.hands.getImageData(0, 0, handsfree.debug.$canvas.hands.width, handsfree.debug.$canvas.hands.height),
    //       width: handsfree.debug.$canvas.hands.width,
    //       height: handsfree.debug.$canvas.hands.height
    //     }
    //   }
    // }

    // // Send data to content
    // chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    //   for (var i = 0; i < tabs.length; ++i) {
    //     chrome.tabs.sendMessage(tabs[i].id, {action: 'handsfree-debug', data})
    //   }
    // })
  }
})

/**
 * Send data to content scripts
 */
handsfree.use('contentScriptBus', {
  onFrame (data) {
    // Send data to content
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      for (var i = 0; i < tabs.length; ++i) {
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
      handsfree.on('data', () => {
        handsfree.debug.$video.requestPictureInPicture()
      }, {once: true})
      
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
