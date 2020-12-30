const connections = {};
let portMap = {}

chrome.runtime.onConnect.addListener(port => {
  // @TODO: release connection when disconnected

  port.onMessage.addListener((message, sender, reply) => {
    const tabId = message.tabId !== undefined ? message.tabId : sender.sender.tab.id;

    if (connections[tabId] === undefined) {
      connections[tabId] = {};
    }

    portMap = connections[tabId];

    portMap[port.name] = port;

    // transfer message between panel and webxrContentScript of the same tab

    if (port.name === 'webxrDevTools') {
      if (portMap.webxrContentScript) {
        portMap.webxrContentScript.postMessage(message);
      }
    }
    if (port.name === 'webxrContentScript') {
      if (portMap.panel) {
        portMap.panel.postMessage(message);
      }
    }
  });
});