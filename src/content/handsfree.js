handsfree = new Handsfree({
  isClient: true,
  hands: true,
  // weboji: true
})
handsfree.enablePlugins('browser')

/**
 * Pinch Click
 */
handsfree.use('pinchClick', ({hands}) => {
  if (!hands.multiHandLandmarks) return

  hands.pointer.forEach((pointer, hand) => {
    if (pointer.isVisible && hands.pinchState[hand][0] === 'start') {
      const $el = document.elementFromPoint(pointer.x, pointer.y)
      if ($el) {
        $el.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: pointer.x,
            clientY: pointer.y
          })
        )
  
        // Focus
        if (['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes($el.nodeName))
          $el.focus()
      }
    }
  })
})

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
