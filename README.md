# The Handsfree Browser Extension

> 🚨 This project useable but not officially released yet

This [Handsfree.js](https://handsfree.js.org) powered browser extension is a designed to help you browse the web handsfree through face and/or hand gestures. The aspiration is to develop a "User Script Manager" like [Tampermonkey](https://www.tampermonkey.net/) and [Greasemonkey](https://www.greasespot.net/), but for handsfree-ifying web pages, web games, web apps, and any other type of content found online.

This browser extension also includes handsfree Dev Tools, primarily to assist in handsfree WebXR development. In short, this extension is designed to help you use your entire browser and web totally handsfree!

<br>
<br>
<br>
<hr>
<br>
<br>
<br>

# Handsfree Browsing

By default, each page will get a "Face Pointer" or a set of "Palm Pointers" for you to browse pages handsfree.

![](https://media3.giphy.com/media/Iv2aSMS0QTy2P5JNCX/giphy.gif)
![](https://media3.giphy.com/media/BSkodGjuwBPAEwxjGv/giphy.gif)

However, in addition to the pointers you can add custom handsfree interactions. For example, here's a demonstration of handsfree-ifying Jason Webb's [Reaction Diffusion Playgound](https://jasonwebb.github.io/reaction-diffusion-playground/) where each individual finger pinch does something different:

![](https://media4.giphy.com/media/YB5GHxDKDFti74Jzz9/giphy.gif)

<br>
<br>
<br>
<hr>
<br>
<br>
<br>

# Handsfree WebXR DevTools

This project is a started as a fork of the [Mozilla WebXR Emulator Extension](https://github.com/MozillaReality/WebXR-emulator-extension). This section of the browser extension was initiated from conversations with [Alex Ionkov](http://pages.cs.wisc.edu/~ionkov/).

Currently the DevTools helps you emulate WebXR headsets with basic controller support.

![](https://media1.giphy.com/media/w3JUFtNyXNafLVrh6F/giphy.gif)
![]()

<br>
<br>
<br>
<hr>
<br>
<br>
<br>

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

<br>
<br>
<br>
<hr>
<br>
<br>
<br>

# Acknowledgemetns

- [Alex Ionkov](http://pages.cs.wisc.edu/~ionkov/) for the original handsfree WebXR Emulator vision, research, and our planning and discussions
- [Mozilla WebXR Emulator Extension team](https://github.com/MozillaReality/WebXR-emulator-extension) from which the WebXR Emulator Dev Tools was forked from