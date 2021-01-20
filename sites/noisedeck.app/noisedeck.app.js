const $ = {
  hueRange2: {
    el: document.querySelector('#hueRange2'),
    start: 0
  }
}
handsfree.disablePlugins('browser')

handsfree.use('noisedeck.app', {
  onFrame ({hands}) {
    if (!hands?.multiHandLandmarks) return

    // Loop through every visible hand
    hands.pointer.forEach((pointer, n) => {
      if (!pointer.isVisible || n > 1) return

      // hueRange2
      if (hands.pinchState[n][0] === 'start') {
        $.hueRange2.start = $.hueRange2.el.value
      } else if (hands.pinchState[n][0] === 'held') {
        $.hueRange2.el.value = handsfree.normalize($.hueRange2.start - hands.curPinch[n][0].x, .1, 1)
        console.log($.hueRange2.start, hands.curPinch[n][0].x)
      }
    })
  }
})