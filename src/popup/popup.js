const $el = {
  start: document.querySelector('#handsfree-start'),
  stop: document.querySelector('#handsfree-stop')
}

/**
 * Start the webcam
 * - If the user hasn't approved permissions yet, then visit the options page first
 */
$start.addEventListener('click', () => {
  chrome.storage.local.get(['hasCapturedStream'], (data) => {
    if (data.hasCapturedStream) {
      chrome.runtime.sendMessage({action: 'handsfreeStart'})
      setHandsfreeState(true)
    } else {
      chrome.tabs.create({url: '/src/options/stream-capture.html'})
    }
    window.close()
  })
})

/**
 * Stop the webcam
 */
$stop.addEventListener('click', () => {
  setHandsfreeState(false)
  chrome.runtime.sendMessage({action: 'stop'})
  window.close()
})

/**
 * Sets the button class
 */
function setHandsfreeState(isStarted) {
  if (isStarted) {
    $start.classList.add('hidden')
    $stop.classList.remove('hidden')
  } else {
    $start.classList.remove('hidden')
    $stop.classList.add('hidden')
  }
}
chrome.storage.local.get(['isHandsfreeStarted'], function(data) {
  setHandsfreeState(data.isHandsfreeStarted)
})
