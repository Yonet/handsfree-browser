const $ = {
  canvas: {
    el: document.querySelector('canvas:not([class^=handsfree])')
  }
}

handsfree.use('blobOpera', {
  onFrame: ({hands}) => {
    if (!hands.multiHandLandmarks) return

    hands.pointer.forEach((pointer, hand) => {
      // Click
      if (pointer.isVisible && hands.pinchState[hand][0] === 'start') {
        const $el = document.elementFromPoint(pointer.x, pointer.y)
        if ($el) {
          $el.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              clientX: pointer.x,
              clientY: pointer.y
            })
          )
        }
      }

      // Unclick
      if (pointer.isVisible && hands.pinchState[hand][0] === 'released') {
        const $el = document.elementFromPoint(pointer.x, pointer.y)
        if ($el) {
          $el.dispatchEvent(
            new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              clientX: pointer.x,
              clientY: pointer.y
            })
          )
        }
      }

      // Held
      if (pointer.isVisible && hands.pinchState[hand][0] === 'held') {
        const $el = document.elementFromPoint(pointer.x, pointer.y)
        if ($el) {
          $el.dispatchEvent(
            new MouseEvent('mousemove', {
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