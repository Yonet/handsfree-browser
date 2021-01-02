# handsfree-browser

> 🚨 This project useable but not officially released yet
>
> 🚨 This is currently only tested in Chrome and Edge (by accident 😅) but will support Firefox very soon

A browser extension for using and developing the web handsfree 🖐👀🖐, powered by [Handsfree.js.org](https://handsfree.js.org/) and the [Mozilla WebXR Emulator Extension](https://github.com/MozillaReality/WebXR-emulator-extension)

This project is a started as a fork of the Mozilla WebXR Emulator Extension. Since the webcam will already be on to help you develop and test your WebXR experiences handsfree and without devices, I thought I would just go ahead and make the dang browser handsfree too!

Currently this extension helps you:

- Scroll websites with a pinch gesture 👌
- Emulate WebXR headsets through the Mozilla WebXR DevTools

Eventually it will:

- Have a user script manager (like GreaseMonkey/TamperMonkey) so that you can script Handsfree.js on a per-site or even per-page basis
- Support basic controller emulation
- Real WebXR hand tracking

![](https://media3.giphy.com/media/BSkodGjuwBPAEwxjGv/giphy.gif)
![](https://media1.giphy.com/media/w3JUFtNyXNafLVrh6F/giphy.gif)

# Development Guide

## Folder structure

Each of the files are located in their respective context folders in `/src/`. Handsfree.js specific scripts are named `handsfree.js` and the Mozilla WebXR specific ones are labeled `webxr.js`. Other than organizing the files the WebXR code is mostly untouched.

## How it works

![](https://i.imgur.com/VKFeZpB.jpg)

- When you first install the extension, `/src/background/handsfree.js` checks if you've approved the webcam. If not, then it'll open the options page in `src/options/stream-capture.html`
- The popup panel has a "Start/Stop Webcam" button that communicates with the background script to start the webcam: `/src/popup/index.html`
- The background page is where the models are stored and run. This keeps everything isolated and only asks for webcam permission once (vs on every domain): `/src/background/handsfree.js`
- The background page also uses the "Picture in Picture" API to "pop the webcam" out of the browser. It renders the webcam feed and debug canvases into a single canvas, and uses that as the `srcObject` to a separate video element which is the PiP'ed

## How to install

- Chrome: Install as an unpacked chrome extension. Visit `chrome://extensions` and enable <kbd>Developer Mode</kbd> on the top right, then click <kbd>Load unpacked</kbd> and select this project's root folder

![](https://i.imgur.com/jXmhYnb.png)

- Firefox: Coming soon, I switched computers and didn't realize I continued developing on Chrome 😆