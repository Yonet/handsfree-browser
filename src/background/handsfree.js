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