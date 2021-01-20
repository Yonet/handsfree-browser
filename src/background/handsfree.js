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
  // weboji: true,
  hands: true
})

/**
 * Stream the canvases
 */
// This will receive the layers and stream
const $pipCanvas = document.createElement('CANVAS')
document.body.appendChild($pipCanvas)
const pipContext = $pipCanvas.getContext('2d')

// This will be the video we pip
const $videoPip = document.createElement('VIDEO')
document.body.appendChild($videoPip)

handsfree.use('canvasUpdater', {
  onFrame () {
    // Merge all active models into a single layer
    pipContext.drawImage(handsfree.debug.$video, 0, 0)
    Object.keys(handsfree.model).forEach(name => {
      if (handsfree.model[name].enabled) {
        pipContext.drawImage(handsfree.debug.$canvas[name], 0, 0)
      }
    })
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
     * - Starts picture in picture
     */
    case 'handsfreeStart':
      // Setup the picture in picture
      handsfree.on('data', () => {
        $pipCanvas.width = $videoPip.width = handsfree.debug.$video.width
        $pipCanvas.height = $videoPip.height = handsfree.debug.$video.height
        $videoPip.srcObject = $pipCanvas.captureStream()
        $videoPip.onloadedmetadata = () => {
          $videoPip.play()
        }
        $videoPip.onplay = () => {
          $videoPip.requestPictureInPicture()
        }
      }, {once: true})
      
      // Start Handsfree and set the badge
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
      chrome.storage.local.set({isHandsfreeStarted: false}, () => {
        handsfree.stop()
        chrome.browserAction.setBadgeText({text: ''})
      })
      return

    /**
     * Load a dependency into the current tab
     */
    case 'handsfreeLoadDependency':
      chrome.tabs.executeScript({file: message.file}, () => {
        Promise.resolve('').then(respond)
      })
      return true
  }
})

/**
 * Open the Options Page to prompt to capture the webcam feed
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['hasCapturedStream'], (data) => {
    chrome.storage.local.set({isHandsfreeStarted: false}, () => {
      if (!data.hasCapturedStream) {
        chrome.runtime.openOptionsPage()
      }
    })
  })
})
