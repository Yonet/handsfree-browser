/**
 * Globals
 */
tabId = chrome.devtools.inspectedWindow.tabId
port = chrome.runtime.connect({name: 'webxrDevTools'})

/**
 * Cache elements and settings
 */
const $handsfree = {
  $rotMult: document.querySelector('#handfree-head-rotation-multiplier'),
  $transMult: document.querySelector('#handfree-head-translation-multiplier'),
  isFeedVisible: false
}

/**
 * Setup Handsfree.js
 * @see https://handsfree.js.org/ref/prop/config
 */
handsfree = new Handsfree({
  isClient: true,
  hands: true,
  // weboji: true
})
handsfree.enablePlugins('browser')

/**
 * Communicate with backend
 */
handsfree.use('threeUpdater', {
  // Custom prop to store tween values between frames
  tween: {
    head: {
      pitch: 0,
      yaw: 0,
      roll: 0,
      x: 0,
      y: 0,
      z: 0
    },
    hand: {
      right: {
        x: 0,
        y: 0
      },
      left: {
        x: 0,
        y: 0
      },
    }
  },
  
  /**
   * This gets called on every active frame
   * - Let's tween the values here
   */
  onFrame ({weboji, hands}) {
    // Other valid assetNodes are: DEVICE.CONTROLLER, DEVICE.RIGHT_CONTROLLER, DEVICE.LEFT_CONTROLLER
    // @see /src/app/panel.js
    // Update head
    if (weboji?.isDetected && assetNodes[DEVICE.HEADSET]) {
      // Tween rotation
      TweenMax.to(this.tween.head, 1, {
        pitch: -weboji.rotation[0],
        yaw: -weboji.rotation[1],
        roll: weboji.rotation[2],
        x: weboji.translation[0],
        y: weboji.translation[1],
        z: weboji.translation[2]
      })
  
      assetNodes[DEVICE.HEADSET].rotation.x = this.tween.head.pitch * $handsfree.$rotMult.value
      assetNodes[DEVICE.HEADSET].rotation.y = this.tween.head.yaw * $handsfree.$rotMult.value
      assetNodes[DEVICE.HEADSET].rotation.z = this.tween.head.roll * $handsfree.$rotMult.value
  
      assetNodes[DEVICE.HEADSET].position.x = this.tween.head.x * 2 * $handsfree.$transMult.value
      assetNodes[DEVICE.HEADSET].position.y = this.tween.head.y * 2 * $handsfree.$transMult.value
      assetNodes[DEVICE.HEADSET].position.z = this.tween.head.z * -3 * $handsfree.$transMult.value
    }

    // Update controller
    if (hands?.multiHandLandmarks) {
      if (assetNodes[DEVICE.LEFT_CONTROLLER]) {
        // Tween rotation
        TweenMax.to(this.tween.hand.left, 1, {
          x: -hands.pointer[1].x / window.outerWidth,
          y: -hands.pointer[1].y / window.outerHeight
        })
  
        assetNodes[DEVICE.LEFT_CONTROLLER].position.x = this.tween.hand.left.x * 4 * $handsfree.$transMult.value + 2
        assetNodes[DEVICE.LEFT_CONTROLLER].position.y = this.tween.hand.left.y * 4 * $handsfree.$transMult.value + 4
      }

      if (assetNodes[DEVICE.RIGHT_CONTROLLER]) {
        // Tween rotation
        TweenMax.to(this.tween.hand.right, 1, {
          x: -hands.pointer[0].x / window.outerWidth,
          y: -hands.pointer[0].y / window.outerHeight
        })
    
        assetNodes[DEVICE.RIGHT_CONTROLLER].position.x = this.tween.hand.right.x * 4 * $handsfree.$transMult.value + 2
        assetNodes[DEVICE.RIGHT_CONTROLLER].position.y = this.tween.hand.right.y * 4 * $handsfree.$transMult.value + 4
      }
    }

    // Update everything. The Polyfill will handle the rest
    updateHeadsetPropertyComponent()
    notifyPoses()
    render()
  }
})

/**
 * Listeners
 */
port.onMessage.addListener(message => {
  switch (message.action) {
    case 'handsfree-data':
      handsfree.runPlugins(message.data)
      break
  }
})