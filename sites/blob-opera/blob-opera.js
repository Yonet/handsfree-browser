/**
 * Direct a choir of blobs in goosebump-inducing harmony
 * - Only works with one pinch at a time
 * 
 * @see https://handsfree.js.org/ref/plugin/pinchers.html#pinch-states-with-pinchstate
 */

// Maps handsfree pincher events to 
const eventMap = {
  start: 'mousedown',
  held: 'mousemove',
  released: 'mouseup'
}

handsfree.use('blobOpera', {
  onFrame: ({hands}) => {
    if (!hands.multiHandLandmarks) return

    hands.pointer.forEach((pointer, hand) => {
      if (pointer.isVisible && hands.pinchState[hand][0]) {
        const event = eventMap[hands.pinchState[hand][0]]
        const $el = document.elementFromPoint(pointer.x, pointer.y)
        if ($el) {
          $el.dispatchEvent(
            new MouseEvent(event, {
              bubbles: true,
              cancelable: true,
              clientX: pointer.x,
              clientY: pointer.y
            })
          )
        }
      }
    })
  }
})