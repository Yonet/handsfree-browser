let handsfree

/**
 * Handle messages from background script
 */
chrome.runtime.onMessage.addListener(function(message) {
  switch (message.action) {
    case 'handsfreeStart':
      if (!handsfree) {
        handsfree = new Handsfree({
          assetsPath: '/public/handsfree/assets',
          weboji: true
        })
      }
      overrideHandsfree()
      handsfree.start()
    break
  }
})

/**
 * Overrides various handsfree methods to work in an extension
 */
function overrideHandsfree () {
  Object.keys(handsfree.model).forEach((name) => {
    handsfree.model[name].loadDependency = function (file, callback) {
      chrome.runtime.sendMessage({action: 'handsfreeLoadDependency', file}, function () {
        callback()
      })
    }
  })

  /**
   * Fetch polyfill
   */
  const _oldFetch = fetch
  fetch = function (url) {
    url = chrome.extension.getURL(url)
    return _oldFetch(url)
  }
}