/**
 * Clamp a number within the values of a scroller
 */
function normalize (num, $el) {
  return num <= $el.min ? $el.min : num >= $el.max ? $el.max : num
}

const $ = {
  hueRotation2: {
    el: document.querySelector('#hueRotation2'),
    start: 0
  },
  hueRange2: {
    el: document.querySelector('#hueRange2'),
    start: 0
  }
}
handsfree.disablePlugins('browser')

handsfree.use('noisedeck.app', {
  onFrame ({hands}) {
    if (!hands?.multiHandLandmarks) return

    // Right Pointer
    if (hands.pointer[1].isVisible) {
      if (hands.pinchState[1][0] === 'start') {
        $.hueRange2.start = $.hueRange2.el.value
        $.hueRotation2.start = $.hueRotation2.el.value
      } else if (hands.pinchState[1][0] === 'held') {
        $.hueRange2.el.value = normalize(
          $.hueRange2.start - (hands.origPinch[1][0].x - hands.curPinch[1][0].x),
          $.hueRange2.el.max,
          $.hueRange2.el.min
        )
        $.hueRotation2.el.value = normalize(
          $.hueRotation2.start - (hands.curPinch[1][0].y - hands.origPinch[1][0].y),
          $.hueRotation2.el.max,
          $.hueRotation2.el.min
        )
      }
    }
    
    // Loop through every visible hand
    // if (!pointer.isVisible || n > 1) return

    // // Right Pointer > Hue Ranges
    // if (hands.pinchState[n][0] === 'start') {
    // } else if (hands.pinchState[n][0] === 'held') {
    //   // $.hueRange1.el.value = clampToRange(handsfree.normalize(hands.pointer[n][0].x - hands.origPinch[n][0].x, 1, -1), $.hueRange1.el)
    // }
  }
})