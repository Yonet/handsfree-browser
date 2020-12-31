(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.Handsfree = factory());
}(this, (function () { 'use strict';

  class BaseModel {
    constructor (handsfree, config) {
      this.handsfree = handsfree;
      this.config = config;
      this.data = {};
      
      // Whether we've loaded dependencies or not
      this.dependenciesLoaded = false;

      // Whether the model is enabled or not
      this.enabled = config.enabled;

      // Collection of plugins
      this.plugins = [];

      setTimeout(() => {
        const getData = this.getData;
        
        this.getData = async () => {
          const data = await getData.apply(this, arguments);
          this.runPlugins();
          return data
        };
      }, 0);
    }

    // Implement in the model class
    loadDependencies (callback) {}
    updateData () {}

    /**
     * Enable model
     * @param {*} handleLoad If true then it'll also attempt to load,
     *    otherwise you'll need to handle it yourself. This is mostly used internally
     *    to prevent the .update() method from double loading
     */
    enable (handleLoad = true) {
      this.handsfree.config[this.name] = this.config;
      this.handsfree.config[this.name].enabled = this.enabled = true;
      document.body.classList.add(`handsfree-model-${this.name}`);

      if (handleLoad && !this.dependenciesLoaded) {
        this.loadDependencies();
      }

      // Weboji uses a webgl context
      if (this.name === 'weboji') {
        this.handsfree.debug.$canvas.weboji.style.display = 'block';
      }
    }

    disable () {
      this.handsfree.config[this.name] = this.config;
      this.handsfree.config[this.name].enabled = this.enabled = false;
      document.body.classList.remove(`handsfree-model-${this.name}`);
      
      setTimeout(() => {
        // Weboji uses a webgl context so let's just hide it
        if (this.name === 'weboji') {
          this.handsfree.debug.$canvas.weboji.style.display = 'none';
        } else {
          this.handsfree.debug.context[this.name].clearRect(0, 0, this.handsfree.debug.$canvas[this.name].width, this.handsfree.debug.$canvas[this.name].height);
        }
      }, 0);
    }

    /**
     * Loads a script and runs a callback
     * @param {string} src The absolute path of the source file
     * @param {*} callback The callback to call after the file is loaded
     */
    loadDependency (src, callback) {
      const $script = document.createElement('script');
      $script.async = true;

      $script.onload = () => {
        callback && callback();
      };
      $script.onerror = () => {
        this.handsfree.emit('modelError', `Error loading ${src}`);
      };

      $script.src = src;
      document.body.appendChild($script);
    }

    /**
     * Run all the plugins attached to this model
     */
    runPlugins () {
      // Exit if no data
      if (!this.data || (this.name === 'handpose' && !this.data.annotations)) {
        return
      }
      
      if (Object.keys(this.data).length) {
        this.plugins.forEach(name => {
          this.handsfree.plugin[name].enabled && this.handsfree.plugin[name]?.onFrame(this.handsfree.data);
        });
      }
    }
  }

  class WebojiModel extends BaseModel {
    constructor (handsfree, config) {
      super(handsfree, config);
      this.name = 'weboji';
    }

    loadDependencies (callback) {
      // Just load utils on client
      if (this.handsfree.config.isClient) {
        this.onReady(callback);
        return
      }

      // Load weboji
      this.loadDependency(`${this.handsfree.config.assetsPath}/jeeliz/jeelizFaceTransfer.js`, () => {
        const url = this.handsfree.config.assetsPath + '/jeeliz/jeelizFaceTransferNNC.json';
        this.api = window.JEEFACETRANSFERAPI;

        fetch(url)
          .then(model => model.json())
          // Next, let's initialize the weboji tracker API
          .then(model => {
            this.api.init({
              canvasId: `handsfree-canvas-weboji-${this.handsfree.id}`,
              NNC: JSON.stringify(model),
              videoSettings: this.handsfree.config.weboji.videoSettings,
              callbackReady: () => this.onReady(callback)
            });
          })
          .catch((ev) => {
            console.log(ev);
            console.error(`Couldn't load weboji tracking model at ${url}`);
            this.handsfree.emit('modelError', ev);
          });
      });
    }

    onReady (callback) {
      this.dependenciesLoaded = true;
      this.handsfree.emit('modelReady', this);
      this.handsfree.emit('webojiModelReady', this);
      document.body.classList.add('handsfree-model-weboji');
      callback && callback(this);
    }
    
    getData () {
      // Core
      this.data.rotation = this.api.get_rotationStabilized();
      this.data.translation = this.api.get_positionScale();
      this.data.morphs = this.api.get_morphTargetInfluencesStabilized();
      
      // Helpers
      this.data.state = this.getStates();
      this.data.degree = this.getDegrees();
      this.data.isDetected = this.api.is_detected();

      this.handsfree.data.weboji = this.data;

      return this.data
    }

    /**
     * Helpers for getting degrees
     */
    getDegrees () {
      return [
        this.data.rotation[0] * 180 / Math.PI,
        this.data.rotation[1] * 180 / Math.PI,
        this.data.rotation[2] * 180 / Math.PI
      ]
    }
    
    /**
     * Sets some stateful helpers
     */
    getStates() {
      /**
       * Handles extra calculations for weboji morphs
       */
      const morphs = this.data.morphs;
      const state = this.data.state || {};

      // Smiles
      state.smileRight =
        morphs[0] > this.handsfree.config.weboji.morphs.threshold.smileRight;
      state.smileLeft =
        morphs[1] > this.handsfree.config.weboji.morphs.threshold.smileLeft;
      state.smile = state.smileRight && state.smileLeft;
      state.smirk =
        (state.smileRight && !state.smileLeft) ||
        (!state.smileRight && state.smileLeft);
      state.pursed =
        morphs[7] > this.handsfree.config.weboji.morphs.threshold.mouthRound;

      // Eyebrows
      state.browLeftUp =
        morphs[4] > this.handsfree.config.weboji.morphs.threshold.browLeftUp;
      state.browRightUp =
        morphs[5] > this.handsfree.config.weboji.morphs.threshold.browRightUp;
      state.browsUp =
        morphs[4] > this.handsfree.config.weboji.morphs.threshold.browLeftUp &&
        morphs[5] > this.handsfree.config.weboji.morphs.threshold.browLeftUp;

      state.browLeftDown =
        morphs[2] > this.handsfree.config.weboji.morphs.threshold.browLeftDown;
      state.browRightDown =
        morphs[3] > this.handsfree.config.weboji.morphs.threshold.browRightDown;
      state.browsDown =
        morphs[2] > this.handsfree.config.weboji.morphs.threshold.browLeftDown &&
        morphs[3] > this.handsfree.config.weboji.morphs.threshold.browLeftDown;

      state.browsUpDown =
        (state.browLeftDown && state.browRightUp) ||
        (state.browRightDown && state.browLeftUp);

      // Eyes
      state.eyeLeftClosed =
        morphs[8] > this.handsfree.config.weboji.morphs.threshold.eyeLeftClosed;
      state.eyeRightClosed =
        morphs[9] > this.handsfree.config.weboji.morphs.threshold.eyeRightClosed;
      state.eyesClosed = state.eyeLeftClosed && state.eyeRightClosed;

      // Mouth
      state.mouthClosed = morphs[6] === 0;
      state.mouthOpen =
        morphs[6] > this.handsfree.config.weboji.morphs.threshold.mouthOpen;

      return state
    }
  }

  class HandsModel extends BaseModel {
    constructor (handsfree, config) {
      super(handsfree, config);
      this.name = 'hands';

      this.palmPoints = [0, 1, 2, 5, 9, 13, 17];
    }

    loadDependencies (callback) {
      // Just load utils on client
      if (this.handsfree.config.isClient) {
        this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/drawing_utils/node_modules/@mediapipe/drawing_utils/drawing_utils.js`, () => {
          this.onWarmUp(callback);
        });

        return
      }

      // Load hands
      this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/hands/node_modules/@mediapipe/hands/hands.js`, () => {
        // Configure model
        this.api = new window.Hands({locateFile: file => {
          return `${this.handsfree.config.assetsPath}/@mediapipe/hands/node_modules/@mediapipe/hands/${file}`
        }});
        this.api.setOptions(this.handsfree.config.hands);
        this.api.onResults(results => this.dataReceived(results));

        // Load the media stream
        this.handsfree.getUserMedia(() => {
          // Warm up before using in loop
          if (!this.handsfree.mediapipeWarmups.isWarmingUp) {
            this.warmUp(callback);
          } else {
            this.handsfree.on('mediapipeWarmedUp', () => {
              if (!this.handsfree.mediapipeWarmups.isWarmingUp && !this.handsfree.mediapipeWarmups[this.name]) {
                this.warmUp(callback);
              }
            });
          }
        });

        // Load the hands camera module
        this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/drawing_utils/node_modules/@mediapipe/drawing_utils/drawing_utils.js`);
      });
    }

    /**
     * Warms up the model
     */
    warmUp (callback) {
      this.handsfree.mediapipeWarmups[this.name] = true;
      this.handsfree.mediapipeWarmups.isWarmingUp = true;
      this.api.send({image: this.handsfree.debug.$video}).then(() => {
        this.handsfree.mediapipeWarmups.isWarmingUp = false;
          this.onWarmUp(callback);
      });
    }

    /**
     * Called after the model has been warmed up
     * - If we don't do this there will be too many initial hits and cause an error
     */
    onWarmUp (callback) {
      this.dependenciesLoaded = true;
      document.body.classList.add('handsfree-model-hands');                    
      this.handsfree.emit('modelReady', this);
      this.handsfree.emit('handsModelReady', this);
      this.handsfree.emit('mediapipeWarmedUp', this);
      callback && callback(this);
    }

    /**
     * Get data
     */
    async getData () {
      this.dependenciesLoaded && await this.api.send({image: this.handsfree.debug.$video});
    }
    // Called through this.api.onResults
    dataReceived (results) {
      this.data = results;
      this.handsfree.data.hands = results;
      if (this.handsfree.isDebugging) {
        this.debug(results);
      }
    }

    /**
     * Debugs the hands model
     */
    debug (results) {
      // Bail if drawing helpers haven't loaded
      if (typeof drawConnectors === 'undefined') return
      
      // Clear the canvas
      this.handsfree.debug.context.hands.clearRect(0, 0, this.handsfree.debug.$canvas.hands.width, this.handsfree.debug.$canvas.hands.height);
      
      // Draw skeletons
      if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
          drawConnectors(this.handsfree.debug.context.hands, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 5});
          drawLandmarks(this.handsfree.debug.context.hands, landmarks, {color: '#FF0000', lineWidth: 2});
        }
      }
    }
  }

  class FacemeshModel extends BaseModel {
    constructor (handsfree, config) {
      super(handsfree, config);
      this.name = 'facemesh';
      this.isWarmedUp = false;
    }

    loadDependencies (callback) {
      // Just load utils on client
      if (this.handsfree.config.isClient) {
        this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/drawing_utils/node_modules/@mediapipe/drawing_utils/drawing_utils.js`, () => {
          this.onWarmUp(callback);
        });

        return
      }
      
      // Load facemesh
      this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/face_mesh/node_modules/@mediapipe/face_mesh/face_mesh.js`, () => {
        // Configure model
        this.api = new window.FaceMesh({locateFile: file => {
          return `${this.handsfree.config.assetsPath}/@mediapipe/face_mesh/node_modules/@mediapipe/face_mesh/${file}`
        }});
        this.api.setOptions(this.handsfree.config.facemesh);
        this.api.onResults(results => this.dataReceived(results));

        // Load the media stream
        this.handsfree.getUserMedia(() => {
          // Warm up before using in loop
          if (!this.handsfree.mediapipeWarmups.isWarmingUp) {
            this.warmUp(callback);
          } else {
            this.handsfree.on('mediapipeWarmedUp', () => {
              if (!this.handsfree.mediapipeWarmups.isWarmingUp && !this.handsfree.mediapipeWarmups[this.name]) {
                this.warmUp(callback);
              }
            });
          }
        });

        // Load the hands camera module
        this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/drawing_utils/node_modules/@mediapipe/drawing_utils/drawing_utils.js`);
      });
    }

    /**
     * Warms up the model
     */
    warmUp (callback) {
      this.handsfree.mediapipeWarmups[this.name] = true;
      this.handsfree.mediapipeWarmups.isWarmingUp = true;
      this.api.send({image: this.handsfree.debug.$video}).then(() => {
        this.handsfree.mediapipeWarmups.isWarmingUp = false;
          this.onWarmUp(callback);
      });
    }

    /**
     * Called after the model has been warmed up
     * - If we don't do this there will be too many initial hits and cause an error
     */
    onWarmUp (callback) {
      this.dependenciesLoaded = true;
      document.body.classList.add('handsfree-model-facemesh');                    
      this.handsfree.emit('modelReady', this);
      this.handsfree.emit('facemeshModelReady', this);
      this.handsfree.emit('mediapipeWarmedUp', this);
      callback && callback(this);
    }
    
    /**
     * Get data
     */
    async getData () {
      this.dependenciesLoaded && await this.api.send({image: this.handsfree.debug.$video});
    }
    // Called through this.api.onResults
    dataReceived (results) {
      this.data = results;
      this.handsfree.data.facemesh = results;
      if (this.handsfree.isDebugging) {
        this.debug(results);
      }
    }

    /**
     * Debugs the facemesh model
     */
    debug (results) {
      // Bail if drawing helpers haven't loaded
      if (typeof drawConnectors === 'undefined') return
      
      this.handsfree.debug.context.facemesh.clearRect(0, 0, this.handsfree.debug.$canvas.facemesh.width, this.handsfree.debug.$canvas.facemesh.height);

      if (results.multiFaceLandmarks) {
        for (const landmarks of results.multiFaceLandmarks) {
          drawConnectors(this.handsfree.debug.context.facemesh, landmarks, FACEMESH_TESSELATION, {color: '#C0C0C070', lineWidth: 1});
          drawConnectors(this.handsfree.debug.context.facemesh, landmarks, FACEMESH_RIGHT_EYE, {color: '#FF3030'});
          drawConnectors(this.handsfree.debug.context.facemesh, landmarks, FACEMESH_RIGHT_EYEBROW, {color: '#FF3030'});
          drawConnectors(this.handsfree.debug.context.facemesh, landmarks, FACEMESH_LEFT_EYE, {color: '#30FF30'});
          drawConnectors(this.handsfree.debug.context.facemesh, landmarks, FACEMESH_LEFT_EYEBROW, {color: '#30FF30'});
          drawConnectors(this.handsfree.debug.context.facemesh, landmarks, FACEMESH_FACE_OVAL, {color: '#E0E0E0'});
          drawConnectors(this.handsfree.debug.context.facemesh, landmarks, FACEMESH_LIPS, {color: '#E0E0E0'});
        }
      }
    }
  }

  class PoseModel extends BaseModel {
    constructor (handsfree, config) {
      super(handsfree, config);
      this.name = 'pose';

      // Without this the loading event will happen before the first frame
      this.hasLoadedAndRun = false;

      this.palmPoints = [0, 1, 2, 5, 9, 13, 17];
    }

    loadDependencies (callback) {
      // Just load utils on client
      if (this.handsfree.config.isClient) {
        this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/drawing_utils/node_modules/@mediapipe/drawing_utils/drawing_utils.js`, () => {
          this.onWarmUp(callback);
        });

        return
      }

      // Load pose
      this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/pose/node_modules/@mediapipe/pose/pose.js`, () => {
        this.api = new window.Pose({locateFile: file => {
          return `${this.handsfree.config.assetsPath}/@mediapipe/pose/node_modules/@mediapipe/pose/${file}`
        }});
        this.api.setOptions(this.handsfree.config.pose);
        this.api.onResults(results => this.dataReceived(results));

        // Load the media stream
        this.handsfree.getUserMedia(() => {
          // Warm up before using in loop
          if (!this.handsfree.mediapipeWarmups.isWarmingUp) {
            this.warmUp(callback);
          } else {
            this.handsfree.on('mediapipeWarmedUp', () => {
              if (!this.handsfree.mediapipeWarmups.isWarmingUp && !this.handsfree.mediapipeWarmups[this.name]) {
                this.warmUp(callback);
              }
            });
          }
        });

        // Load the hands camera module
        this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/drawing_utils/node_modules/@mediapipe/drawing_utils/drawing_utils.js`);
      });
    }

    /**
     * Warms up the model
     */
    warmUp (callback) {
      this.handsfree.mediapipeWarmups[this.name] = true;
      this.handsfree.mediapipeWarmups.isWarmingUp = true;
      this.api.send({image: this.handsfree.debug.$video}).then(() => {
        this.handsfree.mediapipeWarmups.isWarmingUp = false;
          this.onWarmUp(callback);
      });
    }

    /**
     * Called after the model has been warmed up
     * - If we don't do this there will be too many initial hits and cause an error
     */
    onWarmUp (callback) {
      this.dependenciesLoaded = true;
      document.body.classList.add('handsfree-model-pose');                    
      this.handsfree.emit('modelReady', this);
      this.handsfree.emit('poseModelReady', this);
      this.handsfree.emit('mediapipeWarmedUp', this);
      callback && callback(this);
    }
    
    /**
     * Get data
     */
    async getData () {
      this.dependenciesLoaded && await this.api.send({image: this.handsfree.debug.$video});
    }
    // Called through this.api.onResults
    dataReceived (results) {
      this.data = results;
      this.handsfree.data.pose = results;
      if (this.handsfree.isDebugging) {
        this.debug(results);
      }
    }


    /**
     * Debugs the pose model
     */
    debug (results) {
      this.handsfree.debug.context.pose.clearRect(0, 0, this.handsfree.debug.$canvas.pose.width, this.handsfree.debug.$canvas.pose.height);

      if (results.poseLandmarks) {
        drawConnectors(this.handsfree.debug.context.pose, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 4});
        drawLandmarks(this.handsfree.debug.context.pose, results.poseLandmarks, {color: '#FF0000', lineWidth: 2});
      }
    }
  }

  class HolisticModel extends BaseModel {
    constructor (handsfree, config) {
      super(handsfree, config);
      this.name = 'holistic';

      // Without this the loading event will happen before the first frame
      this.hasLoadedAndRun = false;

      this.palmPoints = [0, 1, 2, 5, 9, 13, 17];
    }

    loadDependencies (callback) {
      // Just load utils on client
      if (this.handsfree.config.isClient) {
        this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/drawing_utils/node_modules/@mediapipe/drawing_utils/drawing_utils.js`, () => {
          this.onWarmUp(callback);
        });

        return
      }

      // Load holistic
      this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/holistic/node_modules/@mediapipe/holistic/holistic.js`, () => {
        this.api = new window.Holistic({locateFile: file => {
          return `${this.handsfree.config.assetsPath}/@mediapipe/holistic/node_modules/@mediapipe/holistic/${file}`
        }});
        this.api.setOptions(this.handsfree.config.holistic);
        this.api.onResults(results => this.dataReceived(results));

        // Load the media stream
        this.handsfree.getUserMedia(() => {
          // Warm up before using in loop
          if (!this.handsfree.mediapipeWarmups.isWarmingUp) {
            this.warmUp(callback);
          } else {
            this.handsfree.on('mediapipeWarmedUp', () => {
              if (!this.handsfree.mediapipeWarmups.isWarmingUp && !this.handsfree.mediapipeWarmups[this.name]) {
                this.warmUp(callback);
              }
            });
          }
        });

        // Load the hands camera module
        this.loadDependency(`${this.handsfree.config.assetsPath}/@mediapipe/drawing_utils/node_modules/@mediapipe/drawing_utils/drawing_utils.js`);
      });
    }

    /**
     * Warms up the model
     */
    warmUp (callback) {
      this.handsfree.mediapipeWarmups[this.name] = true;
      this.handsfree.mediapipeWarmups.isWarmingUp = true;
      this.api.send({image: this.handsfree.debug.$video}).then(() => {
        this.handsfree.mediapipeWarmups.isWarmingUp = false;
          this.onWarmUp(callback);
      });
    }

    /**
     * Called after the model has been warmed up
     * - If we don't do this there will be too many initial hits and cause an error
     */
    onWarmUp (callback) {
      this.dependenciesLoaded = true;
      document.body.classList.add('handsfree-model-holistic');                    
      this.handsfree.emit('modelReady', this);
      this.handsfree.emit('holisticModelReady', this);
      this.handsfree.emit('mediapipeWarmedUp', this);
      callback && callback(this);
    }
    
    /**
     * Get data
     */
    async getData () {
      this.dependenciesLoaded && await this.api.send({image: this.handsfree.debug.$video});
    }
    // Called through this.api.onResults
    dataReceived (results) {
      this.data = results;
      this.handsfree.data.holistic = results;
      if (this.handsfree.isDebugging) {
        this.debug(results);
      }
    }

    /**
     * Debugs the holistic model
     */
    debug (results) {
      this.handsfree.debug.context.holistic.clearRect(0, 0, this.handsfree.debug.$canvas.holistic.width, this.handsfree.debug.$canvas.holistic.height);

      drawConnectors(this.handsfree.debug.context.holistic, results.poseLandmarks, POSE_CONNECTIONS, {
        color: '#0f0',
        lineWidth: 4
      });
      
      drawLandmarks(this.handsfree.debug.context.holistic, results.poseLandmarks, {
        color: '#f00',
        lineWidth: 2
      });
      
      drawConnectors(this.handsfree.debug.context.holistic, results.faceLandmarks, FACEMESH_TESSELATION, {
        color: '#f0f',
        lineWidth: 1
      });
      
      drawConnectors(this.handsfree.debug.context.holistic, results.leftHandLandmarks, HAND_CONNECTIONS, {
        color: '#0f0',
        lineWidth: 5
      });
      
      drawLandmarks(this.handsfree.debug.context.holistic, results.leftHandLandmarks, {
        color: '#f0f',
        lineWidth: 2
      });
      
      drawConnectors(this.handsfree.debug.context.holistic, results.rightHandLandmarks, HAND_CONNECTIONS, {
        color: '#0f0',
        lineWidth: 5
      });

      drawLandmarks(this.handsfree.debug.context.holistic, results.rightHandLandmarks, {
        color: '#f0f',
        lineWidth: 2
      });    
    }
  }

  /**
   * Removes all key-value entries from the list cache.
   *
   * @private
   * @name clear
   * @memberOf ListCache
   */
  function listCacheClear() {
    this.__data__ = [];
    this.size = 0;
  }

  var _listCacheClear = listCacheClear;

  /**
   * Performs a
   * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
   * comparison between two values to determine if they are equivalent.
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to compare.
   * @param {*} other The other value to compare.
   * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
   * @example
   *
   * var object = { 'a': 1 };
   * var other = { 'a': 1 };
   *
   * _.eq(object, object);
   * // => true
   *
   * _.eq(object, other);
   * // => false
   *
   * _.eq('a', 'a');
   * // => true
   *
   * _.eq('a', Object('a'));
   * // => false
   *
   * _.eq(NaN, NaN);
   * // => true
   */
  function eq(value, other) {
    return value === other || (value !== value && other !== other);
  }

  var eq_1 = eq;

  /**
   * Gets the index at which the `key` is found in `array` of key-value pairs.
   *
   * @private
   * @param {Array} array The array to inspect.
   * @param {*} key The key to search for.
   * @returns {number} Returns the index of the matched value, else `-1`.
   */
  function assocIndexOf(array, key) {
    var length = array.length;
    while (length--) {
      if (eq_1(array[length][0], key)) {
        return length;
      }
    }
    return -1;
  }

  var _assocIndexOf = assocIndexOf;

  /** Used for built-in method references. */
  var arrayProto = Array.prototype;

  /** Built-in value references. */
  var splice = arrayProto.splice;

  /**
   * Removes `key` and its value from the list cache.
   *
   * @private
   * @name delete
   * @memberOf ListCache
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function listCacheDelete(key) {
    var data = this.__data__,
        index = _assocIndexOf(data, key);

    if (index < 0) {
      return false;
    }
    var lastIndex = data.length - 1;
    if (index == lastIndex) {
      data.pop();
    } else {
      splice.call(data, index, 1);
    }
    --this.size;
    return true;
  }

  var _listCacheDelete = listCacheDelete;

  /**
   * Gets the list cache value for `key`.
   *
   * @private
   * @name get
   * @memberOf ListCache
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function listCacheGet(key) {
    var data = this.__data__,
        index = _assocIndexOf(data, key);

    return index < 0 ? undefined : data[index][1];
  }

  var _listCacheGet = listCacheGet;

  /**
   * Checks if a list cache value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf ListCache
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function listCacheHas(key) {
    return _assocIndexOf(this.__data__, key) > -1;
  }

  var _listCacheHas = listCacheHas;

  /**
   * Sets the list cache `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf ListCache
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the list cache instance.
   */
  function listCacheSet(key, value) {
    var data = this.__data__,
        index = _assocIndexOf(data, key);

    if (index < 0) {
      ++this.size;
      data.push([key, value]);
    } else {
      data[index][1] = value;
    }
    return this;
  }

  var _listCacheSet = listCacheSet;

  /**
   * Creates an list cache object.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function ListCache(entries) {
    var index = -1,
        length = entries == null ? 0 : entries.length;

    this.clear();
    while (++index < length) {
      var entry = entries[index];
      this.set(entry[0], entry[1]);
    }
  }

  // Add methods to `ListCache`.
  ListCache.prototype.clear = _listCacheClear;
  ListCache.prototype['delete'] = _listCacheDelete;
  ListCache.prototype.get = _listCacheGet;
  ListCache.prototype.has = _listCacheHas;
  ListCache.prototype.set = _listCacheSet;

  var _ListCache = ListCache;

  /**
   * Removes all key-value entries from the stack.
   *
   * @private
   * @name clear
   * @memberOf Stack
   */
  function stackClear() {
    this.__data__ = new _ListCache;
    this.size = 0;
  }

  var _stackClear = stackClear;

  /**
   * Removes `key` and its value from the stack.
   *
   * @private
   * @name delete
   * @memberOf Stack
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function stackDelete(key) {
    var data = this.__data__,
        result = data['delete'](key);

    this.size = data.size;
    return result;
  }

  var _stackDelete = stackDelete;

  /**
   * Gets the stack value for `key`.
   *
   * @private
   * @name get
   * @memberOf Stack
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function stackGet(key) {
    return this.__data__.get(key);
  }

  var _stackGet = stackGet;

  /**
   * Checks if a stack value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf Stack
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function stackHas(key) {
    return this.__data__.has(key);
  }

  var _stackHas = stackHas;

  var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

  function createCommonjsModule(fn, basedir, module) {
  	return module = {
  		path: basedir,
  		exports: {},
  		require: function (path, base) {
  			return commonjsRequire(path, (base === undefined || base === null) ? module.path : base);
  		}
  	}, fn(module, module.exports), module.exports;
  }

  function commonjsRequire () {
  	throw new Error('Dynamic requires are not currently supported by @rollup/plugin-commonjs');
  }

  /** Detect free variable `global` from Node.js. */
  var freeGlobal = typeof commonjsGlobal == 'object' && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;

  var _freeGlobal = freeGlobal;

  /** Detect free variable `self`. */
  var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

  /** Used as a reference to the global object. */
  var root = _freeGlobal || freeSelf || Function('return this')();

  var _root = root;

  /** Built-in value references. */
  var Symbol = _root.Symbol;

  var _Symbol = Symbol;

  /** Used for built-in method references. */
  var objectProto = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty = objectProto.hasOwnProperty;

  /**
   * Used to resolve the
   * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
   * of values.
   */
  var nativeObjectToString = objectProto.toString;

  /** Built-in value references. */
  var symToStringTag = _Symbol ? _Symbol.toStringTag : undefined;

  /**
   * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
   *
   * @private
   * @param {*} value The value to query.
   * @returns {string} Returns the raw `toStringTag`.
   */
  function getRawTag(value) {
    var isOwn = hasOwnProperty.call(value, symToStringTag),
        tag = value[symToStringTag];

    try {
      value[symToStringTag] = undefined;
      var unmasked = true;
    } catch (e) {}

    var result = nativeObjectToString.call(value);
    if (unmasked) {
      if (isOwn) {
        value[symToStringTag] = tag;
      } else {
        delete value[symToStringTag];
      }
    }
    return result;
  }

  var _getRawTag = getRawTag;

  /** Used for built-in method references. */
  var objectProto$1 = Object.prototype;

  /**
   * Used to resolve the
   * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
   * of values.
   */
  var nativeObjectToString$1 = objectProto$1.toString;

  /**
   * Converts `value` to a string using `Object.prototype.toString`.
   *
   * @private
   * @param {*} value The value to convert.
   * @returns {string} Returns the converted string.
   */
  function objectToString(value) {
    return nativeObjectToString$1.call(value);
  }

  var _objectToString = objectToString;

  /** `Object#toString` result references. */
  var nullTag = '[object Null]',
      undefinedTag = '[object Undefined]';

  /** Built-in value references. */
  var symToStringTag$1 = _Symbol ? _Symbol.toStringTag : undefined;

  /**
   * The base implementation of `getTag` without fallbacks for buggy environments.
   *
   * @private
   * @param {*} value The value to query.
   * @returns {string} Returns the `toStringTag`.
   */
  function baseGetTag(value) {
    if (value == null) {
      return value === undefined ? undefinedTag : nullTag;
    }
    return (symToStringTag$1 && symToStringTag$1 in Object(value))
      ? _getRawTag(value)
      : _objectToString(value);
  }

  var _baseGetTag = baseGetTag;

  /**
   * Checks if `value` is the
   * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
   * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an object, else `false`.
   * @example
   *
   * _.isObject({});
   * // => true
   *
   * _.isObject([1, 2, 3]);
   * // => true
   *
   * _.isObject(_.noop);
   * // => true
   *
   * _.isObject(null);
   * // => false
   */
  function isObject(value) {
    var type = typeof value;
    return value != null && (type == 'object' || type == 'function');
  }

  var isObject_1 = isObject;

  /** `Object#toString` result references. */
  var asyncTag = '[object AsyncFunction]',
      funcTag = '[object Function]',
      genTag = '[object GeneratorFunction]',
      proxyTag = '[object Proxy]';

  /**
   * Checks if `value` is classified as a `Function` object.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a function, else `false`.
   * @example
   *
   * _.isFunction(_);
   * // => true
   *
   * _.isFunction(/abc/);
   * // => false
   */
  function isFunction(value) {
    if (!isObject_1(value)) {
      return false;
    }
    // The use of `Object#toString` avoids issues with the `typeof` operator
    // in Safari 9 which returns 'object' for typed arrays and other constructors.
    var tag = _baseGetTag(value);
    return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
  }

  var isFunction_1 = isFunction;

  /** Used to detect overreaching core-js shims. */
  var coreJsData = _root['__core-js_shared__'];

  var _coreJsData = coreJsData;

  /** Used to detect methods masquerading as native. */
  var maskSrcKey = (function() {
    var uid = /[^.]+$/.exec(_coreJsData && _coreJsData.keys && _coreJsData.keys.IE_PROTO || '');
    return uid ? ('Symbol(src)_1.' + uid) : '';
  }());

  /**
   * Checks if `func` has its source masked.
   *
   * @private
   * @param {Function} func The function to check.
   * @returns {boolean} Returns `true` if `func` is masked, else `false`.
   */
  function isMasked(func) {
    return !!maskSrcKey && (maskSrcKey in func);
  }

  var _isMasked = isMasked;

  /** Used for built-in method references. */
  var funcProto = Function.prototype;

  /** Used to resolve the decompiled source of functions. */
  var funcToString = funcProto.toString;

  /**
   * Converts `func` to its source code.
   *
   * @private
   * @param {Function} func The function to convert.
   * @returns {string} Returns the source code.
   */
  function toSource(func) {
    if (func != null) {
      try {
        return funcToString.call(func);
      } catch (e) {}
      try {
        return (func + '');
      } catch (e) {}
    }
    return '';
  }

  var _toSource = toSource;

  /**
   * Used to match `RegExp`
   * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
   */
  var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

  /** Used to detect host constructors (Safari). */
  var reIsHostCtor = /^\[object .+?Constructor\]$/;

  /** Used for built-in method references. */
  var funcProto$1 = Function.prototype,
      objectProto$2 = Object.prototype;

  /** Used to resolve the decompiled source of functions. */
  var funcToString$1 = funcProto$1.toString;

  /** Used to check objects for own properties. */
  var hasOwnProperty$1 = objectProto$2.hasOwnProperty;

  /** Used to detect if a method is native. */
  var reIsNative = RegExp('^' +
    funcToString$1.call(hasOwnProperty$1).replace(reRegExpChar, '\\$&')
    .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
  );

  /**
   * The base implementation of `_.isNative` without bad shim checks.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a native function,
   *  else `false`.
   */
  function baseIsNative(value) {
    if (!isObject_1(value) || _isMasked(value)) {
      return false;
    }
    var pattern = isFunction_1(value) ? reIsNative : reIsHostCtor;
    return pattern.test(_toSource(value));
  }

  var _baseIsNative = baseIsNative;

  /**
   * Gets the value at `key` of `object`.
   *
   * @private
   * @param {Object} [object] The object to query.
   * @param {string} key The key of the property to get.
   * @returns {*} Returns the property value.
   */
  function getValue(object, key) {
    return object == null ? undefined : object[key];
  }

  var _getValue = getValue;

  /**
   * Gets the native function at `key` of `object`.
   *
   * @private
   * @param {Object} object The object to query.
   * @param {string} key The key of the method to get.
   * @returns {*} Returns the function if it's native, else `undefined`.
   */
  function getNative(object, key) {
    var value = _getValue(object, key);
    return _baseIsNative(value) ? value : undefined;
  }

  var _getNative = getNative;

  /* Built-in method references that are verified to be native. */
  var Map = _getNative(_root, 'Map');

  var _Map = Map;

  /* Built-in method references that are verified to be native. */
  var nativeCreate = _getNative(Object, 'create');

  var _nativeCreate = nativeCreate;

  /**
   * Removes all key-value entries from the hash.
   *
   * @private
   * @name clear
   * @memberOf Hash
   */
  function hashClear() {
    this.__data__ = _nativeCreate ? _nativeCreate(null) : {};
    this.size = 0;
  }

  var _hashClear = hashClear;

  /**
   * Removes `key` and its value from the hash.
   *
   * @private
   * @name delete
   * @memberOf Hash
   * @param {Object} hash The hash to modify.
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function hashDelete(key) {
    var result = this.has(key) && delete this.__data__[key];
    this.size -= result ? 1 : 0;
    return result;
  }

  var _hashDelete = hashDelete;

  /** Used to stand-in for `undefined` hash values. */
  var HASH_UNDEFINED = '__lodash_hash_undefined__';

  /** Used for built-in method references. */
  var objectProto$3 = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty$2 = objectProto$3.hasOwnProperty;

  /**
   * Gets the hash value for `key`.
   *
   * @private
   * @name get
   * @memberOf Hash
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function hashGet(key) {
    var data = this.__data__;
    if (_nativeCreate) {
      var result = data[key];
      return result === HASH_UNDEFINED ? undefined : result;
    }
    return hasOwnProperty$2.call(data, key) ? data[key] : undefined;
  }

  var _hashGet = hashGet;

  /** Used for built-in method references. */
  var objectProto$4 = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty$3 = objectProto$4.hasOwnProperty;

  /**
   * Checks if a hash value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf Hash
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function hashHas(key) {
    var data = this.__data__;
    return _nativeCreate ? (data[key] !== undefined) : hasOwnProperty$3.call(data, key);
  }

  var _hashHas = hashHas;

  /** Used to stand-in for `undefined` hash values. */
  var HASH_UNDEFINED$1 = '__lodash_hash_undefined__';

  /**
   * Sets the hash `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf Hash
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the hash instance.
   */
  function hashSet(key, value) {
    var data = this.__data__;
    this.size += this.has(key) ? 0 : 1;
    data[key] = (_nativeCreate && value === undefined) ? HASH_UNDEFINED$1 : value;
    return this;
  }

  var _hashSet = hashSet;

  /**
   * Creates a hash object.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function Hash(entries) {
    var index = -1,
        length = entries == null ? 0 : entries.length;

    this.clear();
    while (++index < length) {
      var entry = entries[index];
      this.set(entry[0], entry[1]);
    }
  }

  // Add methods to `Hash`.
  Hash.prototype.clear = _hashClear;
  Hash.prototype['delete'] = _hashDelete;
  Hash.prototype.get = _hashGet;
  Hash.prototype.has = _hashHas;
  Hash.prototype.set = _hashSet;

  var _Hash = Hash;

  /**
   * Removes all key-value entries from the map.
   *
   * @private
   * @name clear
   * @memberOf MapCache
   */
  function mapCacheClear() {
    this.size = 0;
    this.__data__ = {
      'hash': new _Hash,
      'map': new (_Map || _ListCache),
      'string': new _Hash
    };
  }

  var _mapCacheClear = mapCacheClear;

  /**
   * Checks if `value` is suitable for use as unique object key.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
   */
  function isKeyable(value) {
    var type = typeof value;
    return (type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean')
      ? (value !== '__proto__')
      : (value === null);
  }

  var _isKeyable = isKeyable;

  /**
   * Gets the data for `map`.
   *
   * @private
   * @param {Object} map The map to query.
   * @param {string} key The reference key.
   * @returns {*} Returns the map data.
   */
  function getMapData(map, key) {
    var data = map.__data__;
    return _isKeyable(key)
      ? data[typeof key == 'string' ? 'string' : 'hash']
      : data.map;
  }

  var _getMapData = getMapData;

  /**
   * Removes `key` and its value from the map.
   *
   * @private
   * @name delete
   * @memberOf MapCache
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function mapCacheDelete(key) {
    var result = _getMapData(this, key)['delete'](key);
    this.size -= result ? 1 : 0;
    return result;
  }

  var _mapCacheDelete = mapCacheDelete;

  /**
   * Gets the map value for `key`.
   *
   * @private
   * @name get
   * @memberOf MapCache
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function mapCacheGet(key) {
    return _getMapData(this, key).get(key);
  }

  var _mapCacheGet = mapCacheGet;

  /**
   * Checks if a map value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf MapCache
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function mapCacheHas(key) {
    return _getMapData(this, key).has(key);
  }

  var _mapCacheHas = mapCacheHas;

  /**
   * Sets the map `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf MapCache
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the map cache instance.
   */
  function mapCacheSet(key, value) {
    var data = _getMapData(this, key),
        size = data.size;

    data.set(key, value);
    this.size += data.size == size ? 0 : 1;
    return this;
  }

  var _mapCacheSet = mapCacheSet;

  /**
   * Creates a map cache object to store key-value pairs.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function MapCache(entries) {
    var index = -1,
        length = entries == null ? 0 : entries.length;

    this.clear();
    while (++index < length) {
      var entry = entries[index];
      this.set(entry[0], entry[1]);
    }
  }

  // Add methods to `MapCache`.
  MapCache.prototype.clear = _mapCacheClear;
  MapCache.prototype['delete'] = _mapCacheDelete;
  MapCache.prototype.get = _mapCacheGet;
  MapCache.prototype.has = _mapCacheHas;
  MapCache.prototype.set = _mapCacheSet;

  var _MapCache = MapCache;

  /** Used as the size to enable large array optimizations. */
  var LARGE_ARRAY_SIZE = 200;

  /**
   * Sets the stack `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf Stack
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the stack cache instance.
   */
  function stackSet(key, value) {
    var data = this.__data__;
    if (data instanceof _ListCache) {
      var pairs = data.__data__;
      if (!_Map || (pairs.length < LARGE_ARRAY_SIZE - 1)) {
        pairs.push([key, value]);
        this.size = ++data.size;
        return this;
      }
      data = this.__data__ = new _MapCache(pairs);
    }
    data.set(key, value);
    this.size = data.size;
    return this;
  }

  var _stackSet = stackSet;

  /**
   * Creates a stack cache object to store key-value pairs.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function Stack(entries) {
    var data = this.__data__ = new _ListCache(entries);
    this.size = data.size;
  }

  // Add methods to `Stack`.
  Stack.prototype.clear = _stackClear;
  Stack.prototype['delete'] = _stackDelete;
  Stack.prototype.get = _stackGet;
  Stack.prototype.has = _stackHas;
  Stack.prototype.set = _stackSet;

  var _Stack = Stack;

  var defineProperty = (function() {
    try {
      var func = _getNative(Object, 'defineProperty');
      func({}, '', {});
      return func;
    } catch (e) {}
  }());

  var _defineProperty = defineProperty;

  /**
   * The base implementation of `assignValue` and `assignMergeValue` without
   * value checks.
   *
   * @private
   * @param {Object} object The object to modify.
   * @param {string} key The key of the property to assign.
   * @param {*} value The value to assign.
   */
  function baseAssignValue(object, key, value) {
    if (key == '__proto__' && _defineProperty) {
      _defineProperty(object, key, {
        'configurable': true,
        'enumerable': true,
        'value': value,
        'writable': true
      });
    } else {
      object[key] = value;
    }
  }

  var _baseAssignValue = baseAssignValue;

  /**
   * This function is like `assignValue` except that it doesn't assign
   * `undefined` values.
   *
   * @private
   * @param {Object} object The object to modify.
   * @param {string} key The key of the property to assign.
   * @param {*} value The value to assign.
   */
  function assignMergeValue(object, key, value) {
    if ((value !== undefined && !eq_1(object[key], value)) ||
        (value === undefined && !(key in object))) {
      _baseAssignValue(object, key, value);
    }
  }

  var _assignMergeValue = assignMergeValue;

  /**
   * Creates a base function for methods like `_.forIn` and `_.forOwn`.
   *
   * @private
   * @param {boolean} [fromRight] Specify iterating from right to left.
   * @returns {Function} Returns the new base function.
   */
  function createBaseFor(fromRight) {
    return function(object, iteratee, keysFunc) {
      var index = -1,
          iterable = Object(object),
          props = keysFunc(object),
          length = props.length;

      while (length--) {
        var key = props[fromRight ? length : ++index];
        if (iteratee(iterable[key], key, iterable) === false) {
          break;
        }
      }
      return object;
    };
  }

  var _createBaseFor = createBaseFor;

  /**
   * The base implementation of `baseForOwn` which iterates over `object`
   * properties returned by `keysFunc` and invokes `iteratee` for each property.
   * Iteratee functions may exit iteration early by explicitly returning `false`.
   *
   * @private
   * @param {Object} object The object to iterate over.
   * @param {Function} iteratee The function invoked per iteration.
   * @param {Function} keysFunc The function to get the keys of `object`.
   * @returns {Object} Returns `object`.
   */
  var baseFor = _createBaseFor();

  var _baseFor = baseFor;

  var _cloneBuffer = createCommonjsModule(function (module, exports) {
  /** Detect free variable `exports`. */
  var freeExports =  exports && !exports.nodeType && exports;

  /** Detect free variable `module`. */
  var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

  /** Detect the popular CommonJS extension `module.exports`. */
  var moduleExports = freeModule && freeModule.exports === freeExports;

  /** Built-in value references. */
  var Buffer = moduleExports ? _root.Buffer : undefined,
      allocUnsafe = Buffer ? Buffer.allocUnsafe : undefined;

  /**
   * Creates a clone of  `buffer`.
   *
   * @private
   * @param {Buffer} buffer The buffer to clone.
   * @param {boolean} [isDeep] Specify a deep clone.
   * @returns {Buffer} Returns the cloned buffer.
   */
  function cloneBuffer(buffer, isDeep) {
    if (isDeep) {
      return buffer.slice();
    }
    var length = buffer.length,
        result = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);

    buffer.copy(result);
    return result;
  }

  module.exports = cloneBuffer;
  });

  /** Built-in value references. */
  var Uint8Array = _root.Uint8Array;

  var _Uint8Array = Uint8Array;

  /**
   * Creates a clone of `arrayBuffer`.
   *
   * @private
   * @param {ArrayBuffer} arrayBuffer The array buffer to clone.
   * @returns {ArrayBuffer} Returns the cloned array buffer.
   */
  function cloneArrayBuffer(arrayBuffer) {
    var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
    new _Uint8Array(result).set(new _Uint8Array(arrayBuffer));
    return result;
  }

  var _cloneArrayBuffer = cloneArrayBuffer;

  /**
   * Creates a clone of `typedArray`.
   *
   * @private
   * @param {Object} typedArray The typed array to clone.
   * @param {boolean} [isDeep] Specify a deep clone.
   * @returns {Object} Returns the cloned typed array.
   */
  function cloneTypedArray(typedArray, isDeep) {
    var buffer = isDeep ? _cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
    return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
  }

  var _cloneTypedArray = cloneTypedArray;

  /**
   * Copies the values of `source` to `array`.
   *
   * @private
   * @param {Array} source The array to copy values from.
   * @param {Array} [array=[]] The array to copy values to.
   * @returns {Array} Returns `array`.
   */
  function copyArray(source, array) {
    var index = -1,
        length = source.length;

    array || (array = Array(length));
    while (++index < length) {
      array[index] = source[index];
    }
    return array;
  }

  var _copyArray = copyArray;

  /** Built-in value references. */
  var objectCreate = Object.create;

  /**
   * The base implementation of `_.create` without support for assigning
   * properties to the created object.
   *
   * @private
   * @param {Object} proto The object to inherit from.
   * @returns {Object} Returns the new object.
   */
  var baseCreate = (function() {
    function object() {}
    return function(proto) {
      if (!isObject_1(proto)) {
        return {};
      }
      if (objectCreate) {
        return objectCreate(proto);
      }
      object.prototype = proto;
      var result = new object;
      object.prototype = undefined;
      return result;
    };
  }());

  var _baseCreate = baseCreate;

  /**
   * Creates a unary function that invokes `func` with its argument transformed.
   *
   * @private
   * @param {Function} func The function to wrap.
   * @param {Function} transform The argument transform.
   * @returns {Function} Returns the new function.
   */
  function overArg(func, transform) {
    return function(arg) {
      return func(transform(arg));
    };
  }

  var _overArg = overArg;

  /** Built-in value references. */
  var getPrototype = _overArg(Object.getPrototypeOf, Object);

  var _getPrototype = getPrototype;

  /** Used for built-in method references. */
  var objectProto$5 = Object.prototype;

  /**
   * Checks if `value` is likely a prototype object.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
   */
  function isPrototype(value) {
    var Ctor = value && value.constructor,
        proto = (typeof Ctor == 'function' && Ctor.prototype) || objectProto$5;

    return value === proto;
  }

  var _isPrototype = isPrototype;

  /**
   * Initializes an object clone.
   *
   * @private
   * @param {Object} object The object to clone.
   * @returns {Object} Returns the initialized clone.
   */
  function initCloneObject(object) {
    return (typeof object.constructor == 'function' && !_isPrototype(object))
      ? _baseCreate(_getPrototype(object))
      : {};
  }

  var _initCloneObject = initCloneObject;

  /**
   * Checks if `value` is object-like. A value is object-like if it's not `null`
   * and has a `typeof` result of "object".
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
   * @example
   *
   * _.isObjectLike({});
   * // => true
   *
   * _.isObjectLike([1, 2, 3]);
   * // => true
   *
   * _.isObjectLike(_.noop);
   * // => false
   *
   * _.isObjectLike(null);
   * // => false
   */
  function isObjectLike(value) {
    return value != null && typeof value == 'object';
  }

  var isObjectLike_1 = isObjectLike;

  /** `Object#toString` result references. */
  var argsTag = '[object Arguments]';

  /**
   * The base implementation of `_.isArguments`.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an `arguments` object,
   */
  function baseIsArguments(value) {
    return isObjectLike_1(value) && _baseGetTag(value) == argsTag;
  }

  var _baseIsArguments = baseIsArguments;

  /** Used for built-in method references. */
  var objectProto$6 = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty$4 = objectProto$6.hasOwnProperty;

  /** Built-in value references. */
  var propertyIsEnumerable = objectProto$6.propertyIsEnumerable;

  /**
   * Checks if `value` is likely an `arguments` object.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an `arguments` object,
   *  else `false`.
   * @example
   *
   * _.isArguments(function() { return arguments; }());
   * // => true
   *
   * _.isArguments([1, 2, 3]);
   * // => false
   */
  var isArguments = _baseIsArguments(function() { return arguments; }()) ? _baseIsArguments : function(value) {
    return isObjectLike_1(value) && hasOwnProperty$4.call(value, 'callee') &&
      !propertyIsEnumerable.call(value, 'callee');
  };

  var isArguments_1 = isArguments;

  /**
   * Checks if `value` is classified as an `Array` object.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an array, else `false`.
   * @example
   *
   * _.isArray([1, 2, 3]);
   * // => true
   *
   * _.isArray(document.body.children);
   * // => false
   *
   * _.isArray('abc');
   * // => false
   *
   * _.isArray(_.noop);
   * // => false
   */
  var isArray = Array.isArray;

  var isArray_1 = isArray;

  /** Used as references for various `Number` constants. */
  var MAX_SAFE_INTEGER = 9007199254740991;

  /**
   * Checks if `value` is a valid array-like length.
   *
   * **Note:** This method is loosely based on
   * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
   * @example
   *
   * _.isLength(3);
   * // => true
   *
   * _.isLength(Number.MIN_VALUE);
   * // => false
   *
   * _.isLength(Infinity);
   * // => false
   *
   * _.isLength('3');
   * // => false
   */
  function isLength(value) {
    return typeof value == 'number' &&
      value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
  }

  var isLength_1 = isLength;

  /**
   * Checks if `value` is array-like. A value is considered array-like if it's
   * not a function and has a `value.length` that's an integer greater than or
   * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
   * @example
   *
   * _.isArrayLike([1, 2, 3]);
   * // => true
   *
   * _.isArrayLike(document.body.children);
   * // => true
   *
   * _.isArrayLike('abc');
   * // => true
   *
   * _.isArrayLike(_.noop);
   * // => false
   */
  function isArrayLike(value) {
    return value != null && isLength_1(value.length) && !isFunction_1(value);
  }

  var isArrayLike_1 = isArrayLike;

  /**
   * This method is like `_.isArrayLike` except that it also checks if `value`
   * is an object.
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an array-like object,
   *  else `false`.
   * @example
   *
   * _.isArrayLikeObject([1, 2, 3]);
   * // => true
   *
   * _.isArrayLikeObject(document.body.children);
   * // => true
   *
   * _.isArrayLikeObject('abc');
   * // => false
   *
   * _.isArrayLikeObject(_.noop);
   * // => false
   */
  function isArrayLikeObject(value) {
    return isObjectLike_1(value) && isArrayLike_1(value);
  }

  var isArrayLikeObject_1 = isArrayLikeObject;

  /**
   * This method returns `false`.
   *
   * @static
   * @memberOf _
   * @since 4.13.0
   * @category Util
   * @returns {boolean} Returns `false`.
   * @example
   *
   * _.times(2, _.stubFalse);
   * // => [false, false]
   */
  function stubFalse() {
    return false;
  }

  var stubFalse_1 = stubFalse;

  var isBuffer_1 = createCommonjsModule(function (module, exports) {
  /** Detect free variable `exports`. */
  var freeExports =  exports && !exports.nodeType && exports;

  /** Detect free variable `module`. */
  var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

  /** Detect the popular CommonJS extension `module.exports`. */
  var moduleExports = freeModule && freeModule.exports === freeExports;

  /** Built-in value references. */
  var Buffer = moduleExports ? _root.Buffer : undefined;

  /* Built-in method references for those with the same name as other `lodash` methods. */
  var nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined;

  /**
   * Checks if `value` is a buffer.
   *
   * @static
   * @memberOf _
   * @since 4.3.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
   * @example
   *
   * _.isBuffer(new Buffer(2));
   * // => true
   *
   * _.isBuffer(new Uint8Array(2));
   * // => false
   */
  var isBuffer = nativeIsBuffer || stubFalse_1;

  module.exports = isBuffer;
  });

  /** `Object#toString` result references. */
  var objectTag = '[object Object]';

  /** Used for built-in method references. */
  var funcProto$2 = Function.prototype,
      objectProto$7 = Object.prototype;

  /** Used to resolve the decompiled source of functions. */
  var funcToString$2 = funcProto$2.toString;

  /** Used to check objects for own properties. */
  var hasOwnProperty$5 = objectProto$7.hasOwnProperty;

  /** Used to infer the `Object` constructor. */
  var objectCtorString = funcToString$2.call(Object);

  /**
   * Checks if `value` is a plain object, that is, an object created by the
   * `Object` constructor or one with a `[[Prototype]]` of `null`.
   *
   * @static
   * @memberOf _
   * @since 0.8.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a plain object, else `false`.
   * @example
   *
   * function Foo() {
   *   this.a = 1;
   * }
   *
   * _.isPlainObject(new Foo);
   * // => false
   *
   * _.isPlainObject([1, 2, 3]);
   * // => false
   *
   * _.isPlainObject({ 'x': 0, 'y': 0 });
   * // => true
   *
   * _.isPlainObject(Object.create(null));
   * // => true
   */
  function isPlainObject(value) {
    if (!isObjectLike_1(value) || _baseGetTag(value) != objectTag) {
      return false;
    }
    var proto = _getPrototype(value);
    if (proto === null) {
      return true;
    }
    var Ctor = hasOwnProperty$5.call(proto, 'constructor') && proto.constructor;
    return typeof Ctor == 'function' && Ctor instanceof Ctor &&
      funcToString$2.call(Ctor) == objectCtorString;
  }

  var isPlainObject_1 = isPlainObject;

  /** `Object#toString` result references. */
  var argsTag$1 = '[object Arguments]',
      arrayTag = '[object Array]',
      boolTag = '[object Boolean]',
      dateTag = '[object Date]',
      errorTag = '[object Error]',
      funcTag$1 = '[object Function]',
      mapTag = '[object Map]',
      numberTag = '[object Number]',
      objectTag$1 = '[object Object]',
      regexpTag = '[object RegExp]',
      setTag = '[object Set]',
      stringTag = '[object String]',
      weakMapTag = '[object WeakMap]';

  var arrayBufferTag = '[object ArrayBuffer]',
      dataViewTag = '[object DataView]',
      float32Tag = '[object Float32Array]',
      float64Tag = '[object Float64Array]',
      int8Tag = '[object Int8Array]',
      int16Tag = '[object Int16Array]',
      int32Tag = '[object Int32Array]',
      uint8Tag = '[object Uint8Array]',
      uint8ClampedTag = '[object Uint8ClampedArray]',
      uint16Tag = '[object Uint16Array]',
      uint32Tag = '[object Uint32Array]';

  /** Used to identify `toStringTag` values of typed arrays. */
  var typedArrayTags = {};
  typedArrayTags[float32Tag] = typedArrayTags[float64Tag] =
  typedArrayTags[int8Tag] = typedArrayTags[int16Tag] =
  typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] =
  typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] =
  typedArrayTags[uint32Tag] = true;
  typedArrayTags[argsTag$1] = typedArrayTags[arrayTag] =
  typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] =
  typedArrayTags[dataViewTag] = typedArrayTags[dateTag] =
  typedArrayTags[errorTag] = typedArrayTags[funcTag$1] =
  typedArrayTags[mapTag] = typedArrayTags[numberTag] =
  typedArrayTags[objectTag$1] = typedArrayTags[regexpTag] =
  typedArrayTags[setTag] = typedArrayTags[stringTag] =
  typedArrayTags[weakMapTag] = false;

  /**
   * The base implementation of `_.isTypedArray` without Node.js optimizations.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
   */
  function baseIsTypedArray(value) {
    return isObjectLike_1(value) &&
      isLength_1(value.length) && !!typedArrayTags[_baseGetTag(value)];
  }

  var _baseIsTypedArray = baseIsTypedArray;

  /**
   * The base implementation of `_.unary` without support for storing metadata.
   *
   * @private
   * @param {Function} func The function to cap arguments for.
   * @returns {Function} Returns the new capped function.
   */
  function baseUnary(func) {
    return function(value) {
      return func(value);
    };
  }

  var _baseUnary = baseUnary;

  var _nodeUtil = createCommonjsModule(function (module, exports) {
  /** Detect free variable `exports`. */
  var freeExports =  exports && !exports.nodeType && exports;

  /** Detect free variable `module`. */
  var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

  /** Detect the popular CommonJS extension `module.exports`. */
  var moduleExports = freeModule && freeModule.exports === freeExports;

  /** Detect free variable `process` from Node.js. */
  var freeProcess = moduleExports && _freeGlobal.process;

  /** Used to access faster Node.js helpers. */
  var nodeUtil = (function() {
    try {
      // Use `util.types` for Node.js 10+.
      var types = freeModule && freeModule.require && freeModule.require('util').types;

      if (types) {
        return types;
      }

      // Legacy `process.binding('util')` for Node.js < 10.
      return freeProcess && freeProcess.binding && freeProcess.binding('util');
    } catch (e) {}
  }());

  module.exports = nodeUtil;
  });

  /* Node.js helper references. */
  var nodeIsTypedArray = _nodeUtil && _nodeUtil.isTypedArray;

  /**
   * Checks if `value` is classified as a typed array.
   *
   * @static
   * @memberOf _
   * @since 3.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
   * @example
   *
   * _.isTypedArray(new Uint8Array);
   * // => true
   *
   * _.isTypedArray([]);
   * // => false
   */
  var isTypedArray = nodeIsTypedArray ? _baseUnary(nodeIsTypedArray) : _baseIsTypedArray;

  var isTypedArray_1 = isTypedArray;

  /**
   * Gets the value at `key`, unless `key` is "__proto__" or "constructor".
   *
   * @private
   * @param {Object} object The object to query.
   * @param {string} key The key of the property to get.
   * @returns {*} Returns the property value.
   */
  function safeGet(object, key) {
    if (key === 'constructor' && typeof object[key] === 'function') {
      return;
    }

    if (key == '__proto__') {
      return;
    }

    return object[key];
  }

  var _safeGet = safeGet;

  /** Used for built-in method references. */
  var objectProto$8 = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty$6 = objectProto$8.hasOwnProperty;

  /**
   * Assigns `value` to `key` of `object` if the existing value is not equivalent
   * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
   * for equality comparisons.
   *
   * @private
   * @param {Object} object The object to modify.
   * @param {string} key The key of the property to assign.
   * @param {*} value The value to assign.
   */
  function assignValue(object, key, value) {
    var objValue = object[key];
    if (!(hasOwnProperty$6.call(object, key) && eq_1(objValue, value)) ||
        (value === undefined && !(key in object))) {
      _baseAssignValue(object, key, value);
    }
  }

  var _assignValue = assignValue;

  /**
   * Copies properties of `source` to `object`.
   *
   * @private
   * @param {Object} source The object to copy properties from.
   * @param {Array} props The property identifiers to copy.
   * @param {Object} [object={}] The object to copy properties to.
   * @param {Function} [customizer] The function to customize copied values.
   * @returns {Object} Returns `object`.
   */
  function copyObject(source, props, object, customizer) {
    var isNew = !object;
    object || (object = {});

    var index = -1,
        length = props.length;

    while (++index < length) {
      var key = props[index];

      var newValue = customizer
        ? customizer(object[key], source[key], key, object, source)
        : undefined;

      if (newValue === undefined) {
        newValue = source[key];
      }
      if (isNew) {
        _baseAssignValue(object, key, newValue);
      } else {
        _assignValue(object, key, newValue);
      }
    }
    return object;
  }

  var _copyObject = copyObject;

  /**
   * The base implementation of `_.times` without support for iteratee shorthands
   * or max array length checks.
   *
   * @private
   * @param {number} n The number of times to invoke `iteratee`.
   * @param {Function} iteratee The function invoked per iteration.
   * @returns {Array} Returns the array of results.
   */
  function baseTimes(n, iteratee) {
    var index = -1,
        result = Array(n);

    while (++index < n) {
      result[index] = iteratee(index);
    }
    return result;
  }

  var _baseTimes = baseTimes;

  /** Used as references for various `Number` constants. */
  var MAX_SAFE_INTEGER$1 = 9007199254740991;

  /** Used to detect unsigned integer values. */
  var reIsUint = /^(?:0|[1-9]\d*)$/;

  /**
   * Checks if `value` is a valid array-like index.
   *
   * @private
   * @param {*} value The value to check.
   * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
   * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
   */
  function isIndex(value, length) {
    var type = typeof value;
    length = length == null ? MAX_SAFE_INTEGER$1 : length;

    return !!length &&
      (type == 'number' ||
        (type != 'symbol' && reIsUint.test(value))) &&
          (value > -1 && value % 1 == 0 && value < length);
  }

  var _isIndex = isIndex;

  /** Used for built-in method references. */
  var objectProto$9 = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty$7 = objectProto$9.hasOwnProperty;

  /**
   * Creates an array of the enumerable property names of the array-like `value`.
   *
   * @private
   * @param {*} value The value to query.
   * @param {boolean} inherited Specify returning inherited property names.
   * @returns {Array} Returns the array of property names.
   */
  function arrayLikeKeys(value, inherited) {
    var isArr = isArray_1(value),
        isArg = !isArr && isArguments_1(value),
        isBuff = !isArr && !isArg && isBuffer_1(value),
        isType = !isArr && !isArg && !isBuff && isTypedArray_1(value),
        skipIndexes = isArr || isArg || isBuff || isType,
        result = skipIndexes ? _baseTimes(value.length, String) : [],
        length = result.length;

    for (var key in value) {
      if ((inherited || hasOwnProperty$7.call(value, key)) &&
          !(skipIndexes && (
             // Safari 9 has enumerable `arguments.length` in strict mode.
             key == 'length' ||
             // Node.js 0.10 has enumerable non-index properties on buffers.
             (isBuff && (key == 'offset' || key == 'parent')) ||
             // PhantomJS 2 has enumerable non-index properties on typed arrays.
             (isType && (key == 'buffer' || key == 'byteLength' || key == 'byteOffset')) ||
             // Skip index properties.
             _isIndex(key, length)
          ))) {
        result.push(key);
      }
    }
    return result;
  }

  var _arrayLikeKeys = arrayLikeKeys;

  /**
   * This function is like
   * [`Object.keys`](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
   * except that it includes inherited enumerable properties.
   *
   * @private
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names.
   */
  function nativeKeysIn(object) {
    var result = [];
    if (object != null) {
      for (var key in Object(object)) {
        result.push(key);
      }
    }
    return result;
  }

  var _nativeKeysIn = nativeKeysIn;

  /** Used for built-in method references. */
  var objectProto$a = Object.prototype;

  /** Used to check objects for own properties. */
  var hasOwnProperty$8 = objectProto$a.hasOwnProperty;

  /**
   * The base implementation of `_.keysIn` which doesn't treat sparse arrays as dense.
   *
   * @private
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names.
   */
  function baseKeysIn(object) {
    if (!isObject_1(object)) {
      return _nativeKeysIn(object);
    }
    var isProto = _isPrototype(object),
        result = [];

    for (var key in object) {
      if (!(key == 'constructor' && (isProto || !hasOwnProperty$8.call(object, key)))) {
        result.push(key);
      }
    }
    return result;
  }

  var _baseKeysIn = baseKeysIn;

  /**
   * Creates an array of the own and inherited enumerable property names of `object`.
   *
   * **Note:** Non-object values are coerced to objects.
   *
   * @static
   * @memberOf _
   * @since 3.0.0
   * @category Object
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names.
   * @example
   *
   * function Foo() {
   *   this.a = 1;
   *   this.b = 2;
   * }
   *
   * Foo.prototype.c = 3;
   *
   * _.keysIn(new Foo);
   * // => ['a', 'b', 'c'] (iteration order is not guaranteed)
   */
  function keysIn(object) {
    return isArrayLike_1(object) ? _arrayLikeKeys(object, true) : _baseKeysIn(object);
  }

  var keysIn_1 = keysIn;

  /**
   * Converts `value` to a plain object flattening inherited enumerable string
   * keyed properties of `value` to own properties of the plain object.
   *
   * @static
   * @memberOf _
   * @since 3.0.0
   * @category Lang
   * @param {*} value The value to convert.
   * @returns {Object} Returns the converted plain object.
   * @example
   *
   * function Foo() {
   *   this.b = 2;
   * }
   *
   * Foo.prototype.c = 3;
   *
   * _.assign({ 'a': 1 }, new Foo);
   * // => { 'a': 1, 'b': 2 }
   *
   * _.assign({ 'a': 1 }, _.toPlainObject(new Foo));
   * // => { 'a': 1, 'b': 2, 'c': 3 }
   */
  function toPlainObject(value) {
    return _copyObject(value, keysIn_1(value));
  }

  var toPlainObject_1 = toPlainObject;

  /**
   * A specialized version of `baseMerge` for arrays and objects which performs
   * deep merges and tracks traversed objects enabling objects with circular
   * references to be merged.
   *
   * @private
   * @param {Object} object The destination object.
   * @param {Object} source The source object.
   * @param {string} key The key of the value to merge.
   * @param {number} srcIndex The index of `source`.
   * @param {Function} mergeFunc The function to merge values.
   * @param {Function} [customizer] The function to customize assigned values.
   * @param {Object} [stack] Tracks traversed source values and their merged
   *  counterparts.
   */
  function baseMergeDeep(object, source, key, srcIndex, mergeFunc, customizer, stack) {
    var objValue = _safeGet(object, key),
        srcValue = _safeGet(source, key),
        stacked = stack.get(srcValue);

    if (stacked) {
      _assignMergeValue(object, key, stacked);
      return;
    }
    var newValue = customizer
      ? customizer(objValue, srcValue, (key + ''), object, source, stack)
      : undefined;

    var isCommon = newValue === undefined;

    if (isCommon) {
      var isArr = isArray_1(srcValue),
          isBuff = !isArr && isBuffer_1(srcValue),
          isTyped = !isArr && !isBuff && isTypedArray_1(srcValue);

      newValue = srcValue;
      if (isArr || isBuff || isTyped) {
        if (isArray_1(objValue)) {
          newValue = objValue;
        }
        else if (isArrayLikeObject_1(objValue)) {
          newValue = _copyArray(objValue);
        }
        else if (isBuff) {
          isCommon = false;
          newValue = _cloneBuffer(srcValue, true);
        }
        else if (isTyped) {
          isCommon = false;
          newValue = _cloneTypedArray(srcValue, true);
        }
        else {
          newValue = [];
        }
      }
      else if (isPlainObject_1(srcValue) || isArguments_1(srcValue)) {
        newValue = objValue;
        if (isArguments_1(objValue)) {
          newValue = toPlainObject_1(objValue);
        }
        else if (!isObject_1(objValue) || isFunction_1(objValue)) {
          newValue = _initCloneObject(srcValue);
        }
      }
      else {
        isCommon = false;
      }
    }
    if (isCommon) {
      // Recursively merge objects and arrays (susceptible to call stack limits).
      stack.set(srcValue, newValue);
      mergeFunc(newValue, srcValue, srcIndex, customizer, stack);
      stack['delete'](srcValue);
    }
    _assignMergeValue(object, key, newValue);
  }

  var _baseMergeDeep = baseMergeDeep;

  /**
   * The base implementation of `_.merge` without support for multiple sources.
   *
   * @private
   * @param {Object} object The destination object.
   * @param {Object} source The source object.
   * @param {number} srcIndex The index of `source`.
   * @param {Function} [customizer] The function to customize merged values.
   * @param {Object} [stack] Tracks traversed source values and their merged
   *  counterparts.
   */
  function baseMerge(object, source, srcIndex, customizer, stack) {
    if (object === source) {
      return;
    }
    _baseFor(source, function(srcValue, key) {
      stack || (stack = new _Stack);
      if (isObject_1(srcValue)) {
        _baseMergeDeep(object, source, key, srcIndex, baseMerge, customizer, stack);
      }
      else {
        var newValue = customizer
          ? customizer(_safeGet(object, key), srcValue, (key + ''), object, source, stack)
          : undefined;

        if (newValue === undefined) {
          newValue = srcValue;
        }
        _assignMergeValue(object, key, newValue);
      }
    }, keysIn_1);
  }

  var _baseMerge = baseMerge;

  /**
   * This method returns the first argument it receives.
   *
   * @static
   * @since 0.1.0
   * @memberOf _
   * @category Util
   * @param {*} value Any value.
   * @returns {*} Returns `value`.
   * @example
   *
   * var object = { 'a': 1 };
   *
   * console.log(_.identity(object) === object);
   * // => true
   */
  function identity(value) {
    return value;
  }

  var identity_1 = identity;

  /**
   * A faster alternative to `Function#apply`, this function invokes `func`
   * with the `this` binding of `thisArg` and the arguments of `args`.
   *
   * @private
   * @param {Function} func The function to invoke.
   * @param {*} thisArg The `this` binding of `func`.
   * @param {Array} args The arguments to invoke `func` with.
   * @returns {*} Returns the result of `func`.
   */
  function apply(func, thisArg, args) {
    switch (args.length) {
      case 0: return func.call(thisArg);
      case 1: return func.call(thisArg, args[0]);
      case 2: return func.call(thisArg, args[0], args[1]);
      case 3: return func.call(thisArg, args[0], args[1], args[2]);
    }
    return func.apply(thisArg, args);
  }

  var _apply = apply;

  /* Built-in method references for those with the same name as other `lodash` methods. */
  var nativeMax = Math.max;

  /**
   * A specialized version of `baseRest` which transforms the rest array.
   *
   * @private
   * @param {Function} func The function to apply a rest parameter to.
   * @param {number} [start=func.length-1] The start position of the rest parameter.
   * @param {Function} transform The rest array transform.
   * @returns {Function} Returns the new function.
   */
  function overRest(func, start, transform) {
    start = nativeMax(start === undefined ? (func.length - 1) : start, 0);
    return function() {
      var args = arguments,
          index = -1,
          length = nativeMax(args.length - start, 0),
          array = Array(length);

      while (++index < length) {
        array[index] = args[start + index];
      }
      index = -1;
      var otherArgs = Array(start + 1);
      while (++index < start) {
        otherArgs[index] = args[index];
      }
      otherArgs[start] = transform(array);
      return _apply(func, this, otherArgs);
    };
  }

  var _overRest = overRest;

  /**
   * Creates a function that returns `value`.
   *
   * @static
   * @memberOf _
   * @since 2.4.0
   * @category Util
   * @param {*} value The value to return from the new function.
   * @returns {Function} Returns the new constant function.
   * @example
   *
   * var objects = _.times(2, _.constant({ 'a': 1 }));
   *
   * console.log(objects);
   * // => [{ 'a': 1 }, { 'a': 1 }]
   *
   * console.log(objects[0] === objects[1]);
   * // => true
   */
  function constant(value) {
    return function() {
      return value;
    };
  }

  var constant_1 = constant;

  /**
   * The base implementation of `setToString` without support for hot loop shorting.
   *
   * @private
   * @param {Function} func The function to modify.
   * @param {Function} string The `toString` result.
   * @returns {Function} Returns `func`.
   */
  var baseSetToString = !_defineProperty ? identity_1 : function(func, string) {
    return _defineProperty(func, 'toString', {
      'configurable': true,
      'enumerable': false,
      'value': constant_1(string),
      'writable': true
    });
  };

  var _baseSetToString = baseSetToString;

  /** Used to detect hot functions by number of calls within a span of milliseconds. */
  var HOT_COUNT = 800,
      HOT_SPAN = 16;

  /* Built-in method references for those with the same name as other `lodash` methods. */
  var nativeNow = Date.now;

  /**
   * Creates a function that'll short out and invoke `identity` instead
   * of `func` when it's called `HOT_COUNT` or more times in `HOT_SPAN`
   * milliseconds.
   *
   * @private
   * @param {Function} func The function to restrict.
   * @returns {Function} Returns the new shortable function.
   */
  function shortOut(func) {
    var count = 0,
        lastCalled = 0;

    return function() {
      var stamp = nativeNow(),
          remaining = HOT_SPAN - (stamp - lastCalled);

      lastCalled = stamp;
      if (remaining > 0) {
        if (++count >= HOT_COUNT) {
          return arguments[0];
        }
      } else {
        count = 0;
      }
      return func.apply(undefined, arguments);
    };
  }

  var _shortOut = shortOut;

  /**
   * Sets the `toString` method of `func` to return `string`.
   *
   * @private
   * @param {Function} func The function to modify.
   * @param {Function} string The `toString` result.
   * @returns {Function} Returns `func`.
   */
  var setToString = _shortOut(_baseSetToString);

  var _setToString = setToString;

  /**
   * The base implementation of `_.rest` which doesn't validate or coerce arguments.
   *
   * @private
   * @param {Function} func The function to apply a rest parameter to.
   * @param {number} [start=func.length-1] The start position of the rest parameter.
   * @returns {Function} Returns the new function.
   */
  function baseRest(func, start) {
    return _setToString(_overRest(func, start, identity_1), func + '');
  }

  var _baseRest = baseRest;

  /**
   * Checks if the given arguments are from an iteratee call.
   *
   * @private
   * @param {*} value The potential iteratee value argument.
   * @param {*} index The potential iteratee index or key argument.
   * @param {*} object The potential iteratee object argument.
   * @returns {boolean} Returns `true` if the arguments are from an iteratee call,
   *  else `false`.
   */
  function isIterateeCall(value, index, object) {
    if (!isObject_1(object)) {
      return false;
    }
    var type = typeof index;
    if (type == 'number'
          ? (isArrayLike_1(object) && _isIndex(index, object.length))
          : (type == 'string' && index in object)
        ) {
      return eq_1(object[index], value);
    }
    return false;
  }

  var _isIterateeCall = isIterateeCall;

  /**
   * Creates a function like `_.assign`.
   *
   * @private
   * @param {Function} assigner The function to assign values.
   * @returns {Function} Returns the new assigner function.
   */
  function createAssigner(assigner) {
    return _baseRest(function(object, sources) {
      var index = -1,
          length = sources.length,
          customizer = length > 1 ? sources[length - 1] : undefined,
          guard = length > 2 ? sources[2] : undefined;

      customizer = (assigner.length > 3 && typeof customizer == 'function')
        ? (length--, customizer)
        : undefined;

      if (guard && _isIterateeCall(sources[0], sources[1], guard)) {
        customizer = length < 3 ? undefined : customizer;
        length = 1;
      }
      object = Object(object);
      while (++index < length) {
        var source = sources[index];
        if (source) {
          assigner(object, source, index, customizer);
        }
      }
      return object;
    });
  }

  var _createAssigner = createAssigner;

  /**
   * This method is like `_.assign` except that it recursively merges own and
   * inherited enumerable string keyed properties of source objects into the
   * destination object. Source properties that resolve to `undefined` are
   * skipped if a destination value exists. Array and plain object properties
   * are merged recursively. Other objects and value types are overridden by
   * assignment. Source objects are applied from left to right. Subsequent
   * sources overwrite property assignments of previous sources.
   *
   * **Note:** This method mutates `object`.
   *
   * @static
   * @memberOf _
   * @since 0.5.0
   * @category Object
   * @param {Object} object The destination object.
   * @param {...Object} [sources] The source objects.
   * @returns {Object} Returns `object`.
   * @example
   *
   * var object = {
   *   'a': [{ 'b': 2 }, { 'd': 4 }]
   * };
   *
   * var other = {
   *   'a': [{ 'c': 3 }, { 'e': 5 }]
   * };
   *
   * _.merge(object, other);
   * // => { 'a': [{ 'b': 2, 'c': 3 }, { 'd': 4, 'e': 5 }] }
   */
  var merge = _createAssigner(function(object, source, srcIndex) {
    _baseMerge(object, source, srcIndex);
  });

  var merge_1 = merge;

  /**
   * The base plugin class
   * - When you do `handsfree.use()` it actually extends this class
   */
  class Plugin {
    constructor(plugin, handsfree) {
      // Props
      this.plugin = plugin;
      this.handsfree = handsfree;

      // Copy properties and methods from plugin into class
      Object.keys(plugin).forEach((prop) => {
        this[prop] = plugin[prop];
      });

      // handsfree.config.plugin[name] overwrites plugin.config
      let handsfreePluginConfig = handsfree.config?.plugin?.[plugin.name];
      if (typeof handsfreePluginConfig === 'boolean') {
        handsfreePluginConfig = { enabled: handsfreePluginConfig };
      }

      // Disable plugins via new Handsfree(config)
      if (typeof handsfreePluginConfig === 'object') {
        merge_1(this.config, handsfreePluginConfig);
        if (typeof handsfreePluginConfig.enabled === 'boolean') {
          this.enabled = handsfreePluginConfig.enabled;
        }
      }
    }

    /**
     * Toggle plugins
     */
    enable () {
      !this.enabled && this.onEnable && this.onEnable(this.handsfree);
      this.enabled = true;
    }
    disable () {
      this.enabled && this.onDisable && this.onDisable(this.handsfree);
      this.enabled = false;
    }
  }

  /**
   * Gets the timestamp of the number of milliseconds that have elapsed since
   * the Unix epoch (1 January 1970 00:00:00 UTC).
   *
   * @static
   * @memberOf _
   * @since 2.4.0
   * @category Date
   * @returns {number} Returns the timestamp.
   * @example
   *
   * _.defer(function(stamp) {
   *   console.log(_.now() - stamp);
   * }, _.now());
   * // => Logs the number of milliseconds it took for the deferred invocation.
   */
  var now = function() {
    return _root.Date.now();
  };

  var now_1 = now;

  /** `Object#toString` result references. */
  var symbolTag = '[object Symbol]';

  /**
   * Checks if `value` is classified as a `Symbol` primitive or object.
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a symbol, else `false`.
   * @example
   *
   * _.isSymbol(Symbol.iterator);
   * // => true
   *
   * _.isSymbol('abc');
   * // => false
   */
  function isSymbol(value) {
    return typeof value == 'symbol' ||
      (isObjectLike_1(value) && _baseGetTag(value) == symbolTag);
  }

  var isSymbol_1 = isSymbol;

  /** Used as references for various `Number` constants. */
  var NAN = 0 / 0;

  /** Used to match leading and trailing whitespace. */
  var reTrim = /^\s+|\s+$/g;

  /** Used to detect bad signed hexadecimal string values. */
  var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;

  /** Used to detect binary string values. */
  var reIsBinary = /^0b[01]+$/i;

  /** Used to detect octal string values. */
  var reIsOctal = /^0o[0-7]+$/i;

  /** Built-in method references without a dependency on `root`. */
  var freeParseInt = parseInt;

  /**
   * Converts `value` to a number.
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to process.
   * @returns {number} Returns the number.
   * @example
   *
   * _.toNumber(3.2);
   * // => 3.2
   *
   * _.toNumber(Number.MIN_VALUE);
   * // => 5e-324
   *
   * _.toNumber(Infinity);
   * // => Infinity
   *
   * _.toNumber('3.2');
   * // => 3.2
   */
  function toNumber(value) {
    if (typeof value == 'number') {
      return value;
    }
    if (isSymbol_1(value)) {
      return NAN;
    }
    if (isObject_1(value)) {
      var other = typeof value.valueOf == 'function' ? value.valueOf() : value;
      value = isObject_1(other) ? (other + '') : other;
    }
    if (typeof value != 'string') {
      return value === 0 ? value : +value;
    }
    value = value.replace(reTrim, '');
    var isBinary = reIsBinary.test(value);
    return (isBinary || reIsOctal.test(value))
      ? freeParseInt(value.slice(2), isBinary ? 2 : 8)
      : (reIsBadHex.test(value) ? NAN : +value);
  }

  var toNumber_1 = toNumber;

  /** Error message constants. */
  var FUNC_ERROR_TEXT = 'Expected a function';

  /* Built-in method references for those with the same name as other `lodash` methods. */
  var nativeMax$1 = Math.max,
      nativeMin = Math.min;

  /**
   * Creates a debounced function that delays invoking `func` until after `wait`
   * milliseconds have elapsed since the last time the debounced function was
   * invoked. The debounced function comes with a `cancel` method to cancel
   * delayed `func` invocations and a `flush` method to immediately invoke them.
   * Provide `options` to indicate whether `func` should be invoked on the
   * leading and/or trailing edge of the `wait` timeout. The `func` is invoked
   * with the last arguments provided to the debounced function. Subsequent
   * calls to the debounced function return the result of the last `func`
   * invocation.
   *
   * **Note:** If `leading` and `trailing` options are `true`, `func` is
   * invoked on the trailing edge of the timeout only if the debounced function
   * is invoked more than once during the `wait` timeout.
   *
   * If `wait` is `0` and `leading` is `false`, `func` invocation is deferred
   * until to the next tick, similar to `setTimeout` with a timeout of `0`.
   *
   * See [David Corbacho's article](https://css-tricks.com/debouncing-throttling-explained-examples/)
   * for details over the differences between `_.debounce` and `_.throttle`.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Function
   * @param {Function} func The function to debounce.
   * @param {number} [wait=0] The number of milliseconds to delay.
   * @param {Object} [options={}] The options object.
   * @param {boolean} [options.leading=false]
   *  Specify invoking on the leading edge of the timeout.
   * @param {number} [options.maxWait]
   *  The maximum time `func` is allowed to be delayed before it's invoked.
   * @param {boolean} [options.trailing=true]
   *  Specify invoking on the trailing edge of the timeout.
   * @returns {Function} Returns the new debounced function.
   * @example
   *
   * // Avoid costly calculations while the window size is in flux.
   * jQuery(window).on('resize', _.debounce(calculateLayout, 150));
   *
   * // Invoke `sendMail` when clicked, debouncing subsequent calls.
   * jQuery(element).on('click', _.debounce(sendMail, 300, {
   *   'leading': true,
   *   'trailing': false
   * }));
   *
   * // Ensure `batchLog` is invoked once after 1 second of debounced calls.
   * var debounced = _.debounce(batchLog, 250, { 'maxWait': 1000 });
   * var source = new EventSource('/stream');
   * jQuery(source).on('message', debounced);
   *
   * // Cancel the trailing debounced invocation.
   * jQuery(window).on('popstate', debounced.cancel);
   */
  function debounce(func, wait, options) {
    var lastArgs,
        lastThis,
        maxWait,
        result,
        timerId,
        lastCallTime,
        lastInvokeTime = 0,
        leading = false,
        maxing = false,
        trailing = true;

    if (typeof func != 'function') {
      throw new TypeError(FUNC_ERROR_TEXT);
    }
    wait = toNumber_1(wait) || 0;
    if (isObject_1(options)) {
      leading = !!options.leading;
      maxing = 'maxWait' in options;
      maxWait = maxing ? nativeMax$1(toNumber_1(options.maxWait) || 0, wait) : maxWait;
      trailing = 'trailing' in options ? !!options.trailing : trailing;
    }

    function invokeFunc(time) {
      var args = lastArgs,
          thisArg = lastThis;

      lastArgs = lastThis = undefined;
      lastInvokeTime = time;
      result = func.apply(thisArg, args);
      return result;
    }

    function leadingEdge(time) {
      // Reset any `maxWait` timer.
      lastInvokeTime = time;
      // Start the timer for the trailing edge.
      timerId = setTimeout(timerExpired, wait);
      // Invoke the leading edge.
      return leading ? invokeFunc(time) : result;
    }

    function remainingWait(time) {
      var timeSinceLastCall = time - lastCallTime,
          timeSinceLastInvoke = time - lastInvokeTime,
          timeWaiting = wait - timeSinceLastCall;

      return maxing
        ? nativeMin(timeWaiting, maxWait - timeSinceLastInvoke)
        : timeWaiting;
    }

    function shouldInvoke(time) {
      var timeSinceLastCall = time - lastCallTime,
          timeSinceLastInvoke = time - lastInvokeTime;

      // Either this is the first call, activity has stopped and we're at the
      // trailing edge, the system time has gone backwards and we're treating
      // it as the trailing edge, or we've hit the `maxWait` limit.
      return (lastCallTime === undefined || (timeSinceLastCall >= wait) ||
        (timeSinceLastCall < 0) || (maxing && timeSinceLastInvoke >= maxWait));
    }

    function timerExpired() {
      var time = now_1();
      if (shouldInvoke(time)) {
        return trailingEdge(time);
      }
      // Restart the timer.
      timerId = setTimeout(timerExpired, remainingWait(time));
    }

    function trailingEdge(time) {
      timerId = undefined;

      // Only invoke if we have `lastArgs` which means `func` has been
      // debounced at least once.
      if (trailing && lastArgs) {
        return invokeFunc(time);
      }
      lastArgs = lastThis = undefined;
      return result;
    }

    function cancel() {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
      lastInvokeTime = 0;
      lastArgs = lastCallTime = lastThis = timerId = undefined;
    }

    function flush() {
      return timerId === undefined ? result : trailingEdge(now_1());
    }

    function debounced() {
      var time = now_1(),
          isInvoking = shouldInvoke(time);

      lastArgs = arguments;
      lastThis = this;
      lastCallTime = time;

      if (isInvoking) {
        if (timerId === undefined) {
          return leadingEdge(lastCallTime);
        }
        if (maxing) {
          // Handle invocations in a tight loop.
          clearTimeout(timerId);
          timerId = setTimeout(timerExpired, wait);
          return invokeFunc(lastCallTime);
        }
      }
      if (timerId === undefined) {
        timerId = setTimeout(timerExpired, wait);
      }
      return result;
    }
    debounced.cancel = cancel;
    debounced.flush = flush;
    return debounced;
  }

  var debounce_1 = debounce;

  /** Error message constants. */
  var FUNC_ERROR_TEXT$1 = 'Expected a function';

  /**
   * Creates a throttled function that only invokes `func` at most once per
   * every `wait` milliseconds. The throttled function comes with a `cancel`
   * method to cancel delayed `func` invocations and a `flush` method to
   * immediately invoke them. Provide `options` to indicate whether `func`
   * should be invoked on the leading and/or trailing edge of the `wait`
   * timeout. The `func` is invoked with the last arguments provided to the
   * throttled function. Subsequent calls to the throttled function return the
   * result of the last `func` invocation.
   *
   * **Note:** If `leading` and `trailing` options are `true`, `func` is
   * invoked on the trailing edge of the timeout only if the throttled function
   * is invoked more than once during the `wait` timeout.
   *
   * If `wait` is `0` and `leading` is `false`, `func` invocation is deferred
   * until to the next tick, similar to `setTimeout` with a timeout of `0`.
   *
   * See [David Corbacho's article](https://css-tricks.com/debouncing-throttling-explained-examples/)
   * for details over the differences between `_.throttle` and `_.debounce`.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Function
   * @param {Function} func The function to throttle.
   * @param {number} [wait=0] The number of milliseconds to throttle invocations to.
   * @param {Object} [options={}] The options object.
   * @param {boolean} [options.leading=true]
   *  Specify invoking on the leading edge of the timeout.
   * @param {boolean} [options.trailing=true]
   *  Specify invoking on the trailing edge of the timeout.
   * @returns {Function} Returns the new throttled function.
   * @example
   *
   * // Avoid excessively updating the position while scrolling.
   * jQuery(window).on('scroll', _.throttle(updatePosition, 100));
   *
   * // Invoke `renewToken` when the click event is fired, but not more than once every 5 minutes.
   * var throttled = _.throttle(renewToken, 300000, { 'trailing': false });
   * jQuery(element).on('click', throttled);
   *
   * // Cancel the trailing throttled invocation.
   * jQuery(window).on('popstate', throttled.cancel);
   */
  function throttle(func, wait, options) {
    var leading = true,
        trailing = true;

    if (typeof func != 'function') {
      throw new TypeError(FUNC_ERROR_TEXT$1);
    }
    if (isObject_1(options)) {
      leading = 'leading' in options ? !!options.leading : leading;
      trailing = 'trailing' in options ? !!options.trailing : trailing;
    }
    return debounce_1(func, wait, {
      'leading': leading,
      'maxWait': wait,
      'trailing': trailing
    });
  }

  var throttle_1 = throttle;

  /**
   * The following are all the defaults
   * 
   * @see https://handsfree.js.org/ref/prop/config
   */
  var defaultConfig = {
    // Use CDN by default
    assetsPath: 'https://unpkg.com/handsfree@8.1.0/build/lib/assets',
    
    // This will load everything but the models. This is useful when you want to use run inference
    // on another device or context but run the plugins on the current device
    isCLient: false,

    // Setup config. Ignore this to have everything done for you automatically
    setup: {
      // The canvas element to use for rendering debug info like skeletons and keypoints
      canvas: {
        weboji: {
          // The canvas element to hold the skeletons and keypoints for weboji model
          $el: null,
          width: 1280,
          height: 720
        },
        hands: {
          // The canvas element to hold the skeletons and keypoints for hand model
          $el: null,
          width: 1280,
          height: 720
        },
        holistic: {
          // The canvas element to hold the skeletons and keypoints for holistic model
          $el: null,
          width: 1280,
          height: 720
        },
        pose: {
          // The canvas element to hold the skeletons and keypoints for pose model
          $el: null,
          width: 1280,
          height: 720
        },
        facemesh: {
          // The canvas element to hold the skeletons and keypoints for facemesh model
          $el: null,
          width: 1280,
          height: 720
        }
      },
      // The video source to use. If not present, one will be created to capture webcam
      video: {
        // The video element to hold the webcam stream
        $el: null,
        width: 1280,
        height: 720
      },
      // The wrapping element
      wrap: {
        // The element to put the video and canvas inside of
        $el: null,
        // The parent element
        $parent: null
      }
    },

    // Weboji model
    weboji: {
      enabled: false,
      throttle: 0,

      videoSettings: {
        // The video, canvas, or image element
        // Omit this to auto create a <VIDEO> with the webcam
        videoElement: null,

        // ID of the device to use
        // Omit this to use the system default
        deviceId: null,

        // Which camera to use on the device
        // Possible values: 'user' (front), 'environment' (back)
        facingMode: 'user',

        // Video dimensions
        idealWidth: 320,
        idealHeight: 240,
        minWidth: 240,
        maxWidth: 1280,
        minHeight: 240,
        maxHeight: 1280
      },

      // Thresholds needed before these are considered "activated"
      // - Ranges from 0 (not active) to 1 (fully active)
      morphs: {
        threshold: {
          smileRight: 0.7,
          smileLeft: 0.7,
          browLeftDown: 0.8,
          browRightDown: 0.8,
          browLeftUp: 0.8,
          browRightUp: 0.8,
          eyeLeftClosed: 0.4,
          eyeRightClosed: 0.4,
          mouthOpen: 0.3,
          mouthRound: 0.8,
          upperLip: 0.5
        }
      }
    },

    // Hands model
    hands: {
      enabled: false,
      // The maximum number of hands to detect [0 - 4]
      maxNumHands: 2,

      // Minimum confidence [0 - 1] for a hand to be considered detected
      minDetectionConfidence: 0.5,

      // Minimum confidence [0 - 1] for the landmark tracker to be considered detected
      // Higher values are more robust at the expense of higher latency
      minTrackingConfidence: 0.5
    },

    // Facemesh model
    facemesh: {
      enabled: false,
      // The maximum number of faces to detect [1 - 4]
      maxNumFaces: 1,

      // Minimum confidence [0 - 1] for a face to be considered detected
      minDetectionConfidence: 0.5,
      
      // Minimum confidence [0 - 1] for the landmark tracker to be considered detected
      // Higher values are more robust at the expense of higher latency
      minTrackingConfidence: 0.5
    },

    // Pose model
    pose: {
      enabled: false,
      
      // Outputs only the top 25 pose landmarks if true,
      // otherwise shows all 33 full body pose landmarks
      // - Note: Setting this to true may result in better accuracy 
      upperBodyOnly: false,

      // Helps reduce jitter over multiple frames if true
      smoothLandmarks: true,

      // Minimum confidence [0 - 1] for a person detection to be considered detected
      minDetectionConfidence: 0.5,

      // Minimum confidence [0 - 1] for the pose tracker to be considered detected
      // Higher values are more robust at the expense of higher latency
      minTrackingConfidence: 0.5
    },

    // Holistic model
    holistic: {
      enabled: false,
      
      // Outputs only the top 25 pose landmarks if true,
      // otherwise shows all 33 full body pose landmarks
      // - Note: Setting this to true may result in better accuracy 
      upperBodyOnly: true,

      // Helps reduce jitter over multiple frames if true
      smoothLandmarks: true,

      // Minimum confidence [0 - 1] for a person detection to be considered detected
      minDetectionConfidence: 0.5,
          
      // Minimum confidence [0 - 1] for the pose tracker to be considered detected
      // Higher values are more robust at the expense of higher latency
      minTrackingConfidence: 0.5
    },

    plugin: {}
  };

  /*!
   * VERSION: 2.1.3
   * DATE: 2019-05-17
   * UPDATES AND DOCS AT: http://greensock.com
   *
   * @license Copyright (c) 2008-2019, GreenSock. All rights reserved.
   * This work is subject to the terms at http://greensock.com/standard-license or for
   * Club GreenSock members, the software agreement that was issued with your membership.
   *
   * @author: Jack Doyle, jack@greensock.com
   */
  /* eslint-disable */

  /* ES6 changes:
  	- declare and export _gsScope at top.
  	- set var TweenLite = the result of the main function
  	- export default TweenLite at the bottom
  	- return TweenLite at the bottom of the main function
  	- pass in _gsScope as the first parameter of the main function (which is actually at the bottom)
  	- remove the "export to multiple environments" in Definition().
   */
  var _gsScope = (typeof(window) !== "undefined") ? window : (typeof(module) !== "undefined" && module.exports && typeof(global) !== "undefined") ? global : window || {};

  var TweenLite = (function(window) {
  		var _exports = {},
  			_doc = window.document,
  			_globals = window.GreenSockGlobals = window.GreenSockGlobals || window;
  		if (_globals.TweenLite) {
  			return _globals.TweenLite; //in case the core set of classes is already loaded, don't instantiate twice.
  		}
  		var _namespace = function(ns) {
  				var a = ns.split("."),
  					p = _globals, i;
  				for (i = 0; i < a.length; i++) {
  					p[a[i]] = p = p[a[i]] || {};
  				}
  				return p;
  			},
  			gs = _namespace("com.greensock"),
  			_tinyNum = 0.00000001,
  			_slice = function(a) { //don't use Array.prototype.slice.call(target, 0) because that doesn't work in IE8 with a NodeList that's returned by querySelectorAll()
  				var b = [],
  					l = a.length,
  					i;
  				for (i = 0; i !== l; b.push(a[i++])) {}
  				return b;
  			},
  			_emptyFunc = function() {},
  			_isArray = (function() { //works around issues in iframe environments where the Array global isn't shared, thus if the object originates in a different window/iframe, "(obj instanceof Array)" will evaluate false. We added some speed optimizations to avoid Object.prototype.toString.call() unless it's absolutely necessary because it's VERY slow (like 20x slower)
  				var toString = Object.prototype.toString,
  					array = toString.call([]);
  				return function(obj) {
  					return obj != null && (obj instanceof Array || (typeof(obj) === "object" && !!obj.push && toString.call(obj) === array));
  				};
  			}()),
  			a, i, p, _ticker, _tickerActive,
  			_defLookup = {},

  			/**
  			 * @constructor
  			 * Defines a GreenSock class, optionally with an array of dependencies that must be instantiated first and passed into the definition.
  			 * This allows users to load GreenSock JS files in any order even if they have interdependencies (like CSSPlugin extends TweenPlugin which is
  			 * inside TweenLite.js, but if CSSPlugin is loaded first, it should wait to run its code until TweenLite.js loads and instantiates TweenPlugin
  			 * and then pass TweenPlugin to CSSPlugin's definition). This is all done automatically and internally.
  			 *
  			 * Every definition will be added to a "com.greensock" global object (typically window, but if a window.GreenSockGlobals object is found,
  			 * it will go there as of v1.7). For example, TweenLite will be found at window.com.greensock.TweenLite and since it's a global class that should be available anywhere,
  			 * it is ALSO referenced at window.TweenLite. However some classes aren't considered global, like the base com.greensock.core.Animation class, so
  			 * those will only be at the package like window.com.greensock.core.Animation. Again, if you define a GreenSockGlobals object on the window, everything
  			 * gets tucked neatly inside there instead of on the window directly. This allows you to do advanced things like load multiple versions of GreenSock
  			 * files and put them into distinct objects (imagine a banner ad uses a newer version but the main site uses an older one). In that case, you could
  			 * sandbox the banner one like:
  			 *
  			 * <script>
  			 *     var gs = window.GreenSockGlobals = {}; //the newer version we're about to load could now be referenced in a "gs" object, like gs.TweenLite.to(...). Use whatever alias you want as long as it's unique, "gs" or "banner" or whatever.
  			 * </script>
  			 * <script src="js/greensock/v1.7/TweenMax.js"></script>
  			 * <script>
  			 *     window.GreenSockGlobals = window._gsQueue = window._gsDefine = null; //reset it back to null (along with the special _gsQueue variable) so that the next load of TweenMax affects the window and we can reference things directly like TweenLite.to(...)
  			 * </script>
  			 * <script src="js/greensock/v1.6/TweenMax.js"></script>
  			 * <script>
  			 *     gs.TweenLite.to(...); //would use v1.7
  			 *     TweenLite.to(...); //would use v1.6
  			 * </script>
  			 *
  			 * @param {!string} ns The namespace of the class definition, leaving off "com.greensock." as that's assumed. For example, "TweenLite" or "plugins.CSSPlugin" or "easing.Back".
  			 * @param {!Array.<string>} dependencies An array of dependencies (described as their namespaces minus "com.greensock." prefix). For example ["TweenLite","plugins.TweenPlugin","core.Animation"]
  			 * @param {!function():Object} func The function that should be called and passed the resolved dependencies which will return the actual class for this definition.
  			 * @param {boolean=} global If true, the class will be added to the global scope (typically window unless you define a window.GreenSockGlobals object)
  			 */
  			Definition = function(ns, dependencies, func, global) {
  				this.sc = (_defLookup[ns]) ? _defLookup[ns].sc : []; //subclasses
  				_defLookup[ns] = this;
  				this.gsClass = null;
  				this.func = func;
  				var _classes = [];
  				this.check = function(init) {
  					var i = dependencies.length,
  						missing = i,
  						cur, a, n, cl;
  					while (--i > -1) {
  						if ((cur = _defLookup[dependencies[i]] || new Definition(dependencies[i], [])).gsClass) {
  							_classes[i] = cur.gsClass;
  							missing--;
  						} else if (init) {
  							cur.sc.push(this);
  						}
  					}
  					if (missing === 0 && func) {
  						a = ("com.greensock." + ns).split(".");
  						n = a.pop();
  						cl = _namespace(a.join("."))[n] = this.gsClass = func.apply(func, _classes);

  						//exports to multiple environments
  						if (global) {
  							_globals[n] = _exports[n] = cl; //provides a way to avoid global namespace pollution. By default, the main classes like TweenLite, Power1, Strong, etc. are added to window unless a GreenSockGlobals is defined. So if you want to have things added to a custom object instead, just do something like window.GreenSockGlobals = {} before loading any GreenSock files. You can even set up an alias like window.GreenSockGlobals = windows.gs = {} so that you can access everything like gs.TweenLite. Also remember that ALL classes are added to the window.com.greensock object (in their respective packages, like com.greensock.easing.Power1, com.greensock.TweenLite, etc.)
  							/*
  							if (typeof(module) !== "undefined" && module.exports) { //node
  								if (ns === moduleName) {
  									module.exports = _exports[moduleName] = cl;
  									for (i in _exports) {
  										cl[i] = _exports[i];
  									}
  								} else if (_exports[moduleName]) {
  									_exports[moduleName][n] = cl;
  								}
  							} else if (typeof(define) === "function" && define.amd){ //AMD
  								define((window.GreenSockAMDPath ? window.GreenSockAMDPath + "/" : "") + ns.split(".").pop(), [], function() { return cl; });
  							}
  							*/
  						}
  						for (i = 0; i < this.sc.length; i++) {
  							this.sc[i].check();
  						}
  					}
  				};
  				this.check(true);
  			},

  			//used to create Definition instances (which basically registers a class that has dependencies).
  			_gsDefine = window._gsDefine = function(ns, dependencies, func, global) {
  				return new Definition(ns, dependencies, func, global);
  			},

  			//a quick way to create a class that doesn't have any dependencies. Returns the class, but first registers it in the GreenSock namespace so that other classes can grab it (other classes might be dependent on the class).
  			_class = gs._class = function(ns, func, global) {
  				func = func || function() {};
  				_gsDefine(ns, [], function(){ return func; }, global);
  				return func;
  			};

  		_gsDefine.globals = _globals;



  /*
   * ----------------------------------------------------------------
   * Ease
   * ----------------------------------------------------------------
   */
  		var _baseParams = [0, 0, 1, 1],
  			Ease = _class("easing.Ease", function(func, extraParams, type, power) {
  				this._func = func;
  				this._type = type || 0;
  				this._power = power || 0;
  				this._params = extraParams ? _baseParams.concat(extraParams) : _baseParams;
  			}, true),
  			_easeMap = Ease.map = {},
  			_easeReg = Ease.register = function(ease, names, types, create) {
  				var na = names.split(","),
  					i = na.length,
  					ta = (types || "easeIn,easeOut,easeInOut").split(","),
  					e, name, j, type;
  				while (--i > -1) {
  					name = na[i];
  					e = create ? _class("easing."+name, null, true) : gs.easing[name] || {};
  					j = ta.length;
  					while (--j > -1) {
  						type = ta[j];
  						_easeMap[name + "." + type] = _easeMap[type + name] = e[type] = ease.getRatio ? ease : ease[type] || new ease();
  					}
  				}
  			};

  		p = Ease.prototype;
  		p._calcEnd = false;
  		p.getRatio = function(p) {
  			if (this._func) {
  				this._params[0] = p;
  				return this._func.apply(null, this._params);
  			}
  			var t = this._type,
  				pw = this._power,
  				r = (t === 1) ? 1 - p : (t === 2) ? p : (p < 0.5) ? p * 2 : (1 - p) * 2;
  			if (pw === 1) {
  				r *= r;
  			} else if (pw === 2) {
  				r *= r * r;
  			} else if (pw === 3) {
  				r *= r * r * r;
  			} else if (pw === 4) {
  				r *= r * r * r * r;
  			}
  			return (t === 1) ? 1 - r : (t === 2) ? r : (p < 0.5) ? r / 2 : 1 - (r / 2);
  		};

  		//create all the standard eases like Linear, Quad, Cubic, Quart, Quint, Strong, Power0, Power1, Power2, Power3, and Power4 (each with easeIn, easeOut, and easeInOut)
  		a = ["Linear","Quad","Cubic","Quart","Quint,Strong"];
  		i = a.length;
  		while (--i > -1) {
  			p = a[i]+",Power"+i;
  			_easeReg(new Ease(null,null,1,i), p, "easeOut", true);
  			_easeReg(new Ease(null,null,2,i), p, "easeIn" + ((i === 0) ? ",easeNone" : ""));
  			_easeReg(new Ease(null,null,3,i), p, "easeInOut");
  		}
  		_easeMap.linear = gs.easing.Linear.easeIn;
  		_easeMap.swing = gs.easing.Quad.easeInOut; //for jQuery folks


  /*
   * ----------------------------------------------------------------
   * EventDispatcher
   * ----------------------------------------------------------------
   */
  		var EventDispatcher = _class("events.EventDispatcher", function(target) {
  			this._listeners = {};
  			this._eventTarget = target || this;
  		});
  		p = EventDispatcher.prototype;

  		p.addEventListener = function(type, callback, scope, useParam, priority) {
  			priority = priority || 0;
  			var list = this._listeners[type],
  				index = 0,
  				listener, i;
  			if (this === _ticker && !_tickerActive) {
  				_ticker.wake();
  			}
  			if (list == null) {
  				this._listeners[type] = list = [];
  			}
  			i = list.length;
  			while (--i > -1) {
  				listener = list[i];
  				if (listener.c === callback && listener.s === scope) {
  					list.splice(i, 1);
  				} else if (index === 0 && listener.pr < priority) {
  					index = i + 1;
  				}
  			}
  			list.splice(index, 0, {c:callback, s:scope, up:useParam, pr:priority});
  		};

  		p.removeEventListener = function(type, callback) {
  			var list = this._listeners[type], i;
  			if (list) {
  				i = list.length;
  				while (--i > -1) {
  					if (list[i].c === callback) {
  						list.splice(i, 1);
  						return;
  					}
  				}
  			}
  		};

  		p.dispatchEvent = function(type) {
  			var list = this._listeners[type],
  				i, t, listener;
  			if (list) {
  				i = list.length;
  				if (i > 1) {
  					list = list.slice(0); //in case addEventListener() is called from within a listener/callback (otherwise the index could change, resulting in a skip)
  				}
  				t = this._eventTarget;
  				while (--i > -1) {
  					listener = list[i];
  					if (listener) {
  						if (listener.up) {
  							listener.c.call(listener.s || t, {type:type, target:t});
  						} else {
  							listener.c.call(listener.s || t);
  						}
  					}
  				}
  			}
  		};


  /*
   * ----------------------------------------------------------------
   * Ticker
   * ----------------------------------------------------------------
   */
   		var _reqAnimFrame = window.requestAnimationFrame,
  			_cancelAnimFrame = window.cancelAnimationFrame,
  			_getTime = Date.now || function() {return new Date().getTime();},
  			_lastUpdate = _getTime();

  		//now try to determine the requestAnimationFrame and cancelAnimationFrame functions and if none are found, we'll use a setTimeout()/clearTimeout() polyfill.
  		a = ["ms","moz","webkit","o"];
  		i = a.length;
  		while (--i > -1 && !_reqAnimFrame) {
  			_reqAnimFrame = window[a[i] + "RequestAnimationFrame"];
  			_cancelAnimFrame = window[a[i] + "CancelAnimationFrame"] || window[a[i] + "CancelRequestAnimationFrame"];
  		}

  		_class("Ticker", function(fps, useRAF) {
  			var _self = this,
  				_startTime = _getTime(),
  				_useRAF = (useRAF !== false && _reqAnimFrame) ? "auto" : false,
  				_lagThreshold = 500,
  				_adjustedLag = 33,
  				_tickWord = "tick", //helps reduce gc burden
  				_fps, _req, _id, _gap, _nextTime,
  				_tick = function(manual) {
  					var elapsed = _getTime() - _lastUpdate,
  						overlap, dispatch;
  					if (elapsed > _lagThreshold) {
  						_startTime += elapsed - _adjustedLag;
  					}
  					_lastUpdate += elapsed;
  					_self.time = (_lastUpdate - _startTime) / 1000;
  					overlap = _self.time - _nextTime;
  					if (!_fps || overlap > 0 || manual === true) {
  						_self.frame++;
  						_nextTime += overlap + (overlap >= _gap ? 0.004 : _gap - overlap);
  						dispatch = true;
  					}
  					if (manual !== true) { //make sure the request is made before we dispatch the "tick" event so that timing is maintained. Otherwise, if processing the "tick" requires a bunch of time (like 15ms) and we're using a setTimeout() that's based on 16.7ms, it'd technically take 31.7ms between frames otherwise.
  						_id = _req(_tick);
  					}
  					if (dispatch) {
  						_self.dispatchEvent(_tickWord);
  					}
  				};

  			EventDispatcher.call(_self);
  			_self.time = _self.frame = 0;
  			_self.tick = function() {
  				_tick(true);
  			};

  			_self.lagSmoothing = function(threshold, adjustedLag) {
  				if (!arguments.length) { //if lagSmoothing() is called with no arguments, treat it like a getter that returns a boolean indicating if it's enabled or not. This is purposely undocumented and is for internal use.
  					return (_lagThreshold < 1 / _tinyNum);
  				}
  				_lagThreshold = threshold || (1 / _tinyNum); //zero should be interpreted as basically unlimited
  				_adjustedLag = Math.min(adjustedLag, _lagThreshold, 0);
  			};

  			_self.sleep = function() {
  				if (_id == null) {
  					return;
  				}
  				if (!_useRAF || !_cancelAnimFrame) {
  					clearTimeout(_id);
  				} else {
  					_cancelAnimFrame(_id);
  				}
  				_req = _emptyFunc;
  				_id = null;
  				if (_self === _ticker) {
  					_tickerActive = false;
  				}
  			};

  			_self.wake = function(seamless) {
  				if (_id !== null) {
  					_self.sleep();
  				} else if (seamless) {
  					_startTime += -_lastUpdate + (_lastUpdate = _getTime());
  				} else if (_self.frame > 10) { //don't trigger lagSmoothing if we're just waking up, and make sure that at least 10 frames have elapsed because of the iOS bug that we work around below with the 1.5-second setTimout().
  					_lastUpdate = _getTime() - _lagThreshold + 5;
  				}
  				_req = (_fps === 0) ? _emptyFunc : (!_useRAF || !_reqAnimFrame) ? function(f) { return setTimeout(f, ((_nextTime - _self.time) * 1000 + 1) | 0); } : _reqAnimFrame;
  				if (_self === _ticker) {
  					_tickerActive = true;
  				}
  				_tick(2);
  			};

  			_self.fps = function(value) {
  				if (!arguments.length) {
  					return _fps;
  				}
  				_fps = value;
  				_gap = 1 / (_fps || 60);
  				_nextTime = this.time + _gap;
  				_self.wake();
  			};

  			_self.useRAF = function(value) {
  				if (!arguments.length) {
  					return _useRAF;
  				}
  				_self.sleep();
  				_useRAF = value;
  				_self.fps(_fps);
  			};
  			_self.fps(fps);

  			//a bug in iOS 6 Safari occasionally prevents the requestAnimationFrame from working initially, so we use a 1.5-second timeout that automatically falls back to setTimeout() if it senses this condition.
  			setTimeout(function() {
  				if (_useRAF === "auto" && _self.frame < 5 && (_doc || {}).visibilityState !== "hidden") {
  					_self.useRAF(false);
  				}
  			}, 1500);
  		});

  		p = gs.Ticker.prototype = new gs.events.EventDispatcher();
  		p.constructor = gs.Ticker;


  /*
   * ----------------------------------------------------------------
   * Animation
   * ----------------------------------------------------------------
   */
  		var Animation = _class("core.Animation", function(duration, vars) {
  				this.vars = vars = vars || {};
  				this._duration = this._totalDuration = duration || 0;
  				this._delay = Number(vars.delay) || 0;
  				this._timeScale = 1;
  				this._active = !!vars.immediateRender;
  				this.data = vars.data;
  				this._reversed = !!vars.reversed;

  				if (!_rootTimeline) {
  					return;
  				}
  				if (!_tickerActive) { //some browsers (like iOS 6 Safari) shut down JavaScript execution when the tab is disabled and they [occasionally] neglect to start up requestAnimationFrame again when returning - this code ensures that the engine starts up again properly.
  					_ticker.wake();
  				}

  				var tl = this.vars.useFrames ? _rootFramesTimeline : _rootTimeline;
  				tl.add(this, tl._time);

  				if (this.vars.paused) {
  					this.paused(true);
  				}
  			});

  		_ticker = Animation.ticker = new gs.Ticker();
  		p = Animation.prototype;
  		p._dirty = p._gc = p._initted = p._paused = false;
  		p._totalTime = p._time = 0;
  		p._rawPrevTime = -1;
  		p._next = p._last = p._onUpdate = p._timeline = p.timeline = null;
  		p._paused = false;


  		//some browsers (like iOS) occasionally drop the requestAnimationFrame event when the user switches to a different tab and then comes back again, so we use a 2-second setTimeout() to sense if/when that condition occurs and then wake() the ticker.
  		var _checkTimeout = function() {
  				if (_tickerActive && _getTime() - _lastUpdate > 2000 && ((_doc || {}).visibilityState !== "hidden" || !_ticker.lagSmoothing())) { //note: if the tab is hidden, we should still wake if lagSmoothing has been disabled.
  					_ticker.wake();
  				}
  				var t = setTimeout(_checkTimeout, 2000);
  				if (t.unref) {
  					// allows a node process to exit even if the timeout’s callback hasn't been invoked. Without it, the node process could hang as this function is called every two seconds.
  					t.unref();
  				}
  			};
  		_checkTimeout();


  		p.play = function(from, suppressEvents) {
  			if (from != null) {
  				this.seek(from, suppressEvents);
  			}
  			return this.reversed(false).paused(false);
  		};

  		p.pause = function(atTime, suppressEvents) {
  			if (atTime != null) {
  				this.seek(atTime, suppressEvents);
  			}
  			return this.paused(true);
  		};

  		p.resume = function(from, suppressEvents) {
  			if (from != null) {
  				this.seek(from, suppressEvents);
  			}
  			return this.paused(false);
  		};

  		p.seek = function(time, suppressEvents) {
  			return this.totalTime(Number(time), suppressEvents !== false);
  		};

  		p.restart = function(includeDelay, suppressEvents) {
  			return this.reversed(false).paused(false).totalTime(includeDelay ? -this._delay : 0, (suppressEvents !== false), true);
  		};

  		p.reverse = function(from, suppressEvents) {
  			if (from != null) {
  				this.seek((from || this.totalDuration()), suppressEvents);
  			}
  			return this.reversed(true).paused(false);
  		};

  		p.render = function(time, suppressEvents, force) {
  			//stub - we override this method in subclasses.
  		};

  		p.invalidate = function() {
  			this._time = this._totalTime = 0;
  			this._initted = this._gc = false;
  			this._rawPrevTime = -1;
  			if (this._gc || !this.timeline) {
  				this._enabled(true);
  			}
  			return this;
  		};

  		p.isActive = function() {
  			var tl = this._timeline, //the 2 root timelines won't have a _timeline; they're always active.
  				startTime = this._startTime,
  				rawTime;
  			return (!tl || (!this._gc && !this._paused && tl.isActive() && (rawTime = tl.rawTime(true)) >= startTime && rawTime < startTime + this.totalDuration() / this._timeScale - _tinyNum));
  		};

  		p._enabled = function (enabled, ignoreTimeline) {
  			if (!_tickerActive) {
  				_ticker.wake();
  			}
  			this._gc = !enabled;
  			this._active = this.isActive();
  			if (ignoreTimeline !== true) {
  				if (enabled && !this.timeline) {
  					this._timeline.add(this, this._startTime - this._delay);
  				} else if (!enabled && this.timeline) {
  					this._timeline._remove(this, true);
  				}
  			}
  			return false;
  		};


  		p._kill = function(vars, target) {
  			return this._enabled(false, false);
  		};

  		p.kill = function(vars, target) {
  			this._kill(vars, target);
  			return this;
  		};

  		p._uncache = function(includeSelf) {
  			var tween = includeSelf ? this : this.timeline;
  			while (tween) {
  				tween._dirty = true;
  				tween = tween.timeline;
  			}
  			return this;
  		};

  		p._swapSelfInParams = function(params) {
  			var i = params.length,
  				copy = params.concat();
  			while (--i > -1) {
  				if (params[i] === "{self}") {
  					copy[i] = this;
  				}
  			}
  			return copy;
  		};

  		p._callback = function(type) {
  			var v = this.vars,
  				callback = v[type],
  				params = v[type + "Params"],
  				scope = v[type + "Scope"] || v.callbackScope || this,
  				l = params ? params.length : 0;
  			switch (l) { //speed optimization; call() is faster than apply() so use it when there are only a few parameters (which is by far most common). Previously we simply did var v = this.vars; v[type].apply(v[type + "Scope"] || v.callbackScope || this, v[type + "Params"] || _blankArray);
  				case 0: callback.call(scope); break;
  				case 1: callback.call(scope, params[0]); break;
  				case 2: callback.call(scope, params[0], params[1]); break;
  				default: callback.apply(scope, params);
  			}
  		};

  //----Animation getters/setters --------------------------------------------------------

  		p.eventCallback = function(type, callback, params, scope) {
  			if ((type || "").substr(0,2) === "on") {
  				var v = this.vars;
  				if (arguments.length === 1) {
  					return v[type];
  				}
  				if (callback == null) {
  					delete v[type];
  				} else {
  					v[type] = callback;
  					v[type + "Params"] = (_isArray(params) && params.join("").indexOf("{self}") !== -1) ? this._swapSelfInParams(params) : params;
  					v[type + "Scope"] = scope;
  				}
  				if (type === "onUpdate") {
  					this._onUpdate = callback;
  				}
  			}
  			return this;
  		};

  		p.delay = function(value) {
  			if (!arguments.length) {
  				return this._delay;
  			}
  			if (this._timeline.smoothChildTiming) {
  				this.startTime( this._startTime + value - this._delay );
  			}
  			this._delay = value;
  			return this;
  		};

  		p.duration = function(value) {
  			if (!arguments.length) {
  				this._dirty = false;
  				return this._duration;
  			}
  			this._duration = this._totalDuration = value;
  			this._uncache(true); //true in case it's a TweenMax or TimelineMax that has a repeat - we'll need to refresh the totalDuration.
  			if (this._timeline.smoothChildTiming) if (this._time > 0) if (this._time < this._duration) if (value !== 0) {
  				this.totalTime(this._totalTime * (value / this._duration), true);
  			}
  			return this;
  		};

  		p.totalDuration = function(value) {
  			this._dirty = false;
  			return (!arguments.length) ? this._totalDuration : this.duration(value);
  		};

  		p.time = function(value, suppressEvents) {
  			if (!arguments.length) {
  				return this._time;
  			}
  			if (this._dirty) {
  				this.totalDuration();
  			}
  			return this.totalTime((value > this._duration) ? this._duration : value, suppressEvents);
  		};

  		p.totalTime = function(time, suppressEvents, uncapped) {
  			if (!_tickerActive) {
  				_ticker.wake();
  			}
  			if (!arguments.length) {
  				return this._totalTime;
  			}
  			if (this._timeline) {
  				if (time < 0 && !uncapped) {
  					time += this.totalDuration();
  				}
  				if (this._timeline.smoothChildTiming) {
  					if (this._dirty) {
  						this.totalDuration();
  					}
  					var totalDuration = this._totalDuration,
  						tl = this._timeline;
  					if (time > totalDuration && !uncapped) {
  						time = totalDuration;
  					}
  					this._startTime = (this._paused ? this._pauseTime : tl._time) - ((!this._reversed ? time : totalDuration - time) / this._timeScale);
  					if (!tl._dirty) { //for performance improvement. If the parent's cache is already dirty, it already took care of marking the ancestors as dirty too, so skip the function call here.
  						this._uncache(false);
  					}
  					//in case any of the ancestor timelines had completed but should now be enabled, we should reset their totalTime() which will also ensure that they're lined up properly and enabled. Skip for animations that are on the root (wasteful). Example: a TimelineLite.exportRoot() is performed when there's a paused tween on the root, the export will not complete until that tween is unpaused, but imagine a child gets restarted later, after all [unpaused] tweens have completed. The startTime of that child would get pushed out, but one of the ancestors may have completed.
  					if (tl._timeline) {
  						while (tl._timeline) {
  							if (tl._timeline._time !== (tl._startTime + tl._totalTime) / tl._timeScale) {
  								tl.totalTime(tl._totalTime, true);
  							}
  							tl = tl._timeline;
  						}
  					}
  				}
  				if (this._gc) {
  					this._enabled(true, false);
  				}
  				if (this._totalTime !== time || this._duration === 0) {
  					if (_lazyTweens.length) {
  						_lazyRender();
  					}
  					this.render(time, suppressEvents, false);
  					if (_lazyTweens.length) { //in case rendering caused any tweens to lazy-init, we should render them because typically when someone calls seek() or time() or progress(), they expect an immediate render.
  						_lazyRender();
  					}
  				}
  			}
  			return this;
  		};

  		p.progress = p.totalProgress = function(value, suppressEvents) {
  			var duration = this.duration();
  			return (!arguments.length) ? (duration ? this._time / duration : this.ratio) : this.totalTime(duration * value, suppressEvents);
  		};

  		p.startTime = function(value) {
  			if (!arguments.length) {
  				return this._startTime;
  			}
  			if (value !== this._startTime) {
  				this._startTime = value;
  				if (this.timeline) if (this.timeline._sortChildren) {
  					this.timeline.add(this, value - this._delay); //ensures that any necessary re-sequencing of Animations in the timeline occurs to make sure the rendering order is correct.
  				}
  			}
  			return this;
  		};

  		p.endTime = function(includeRepeats) {
  			return this._startTime + ((includeRepeats != false) ? this.totalDuration() : this.duration()) / this._timeScale;
  		};

  		p.timeScale = function(value) {
  			if (!arguments.length) {
  				return this._timeScale;
  			}
  			var pauseTime, t;
  			value = value || _tinyNum; //can't allow zero because it'll throw the math off
  			if (this._timeline && this._timeline.smoothChildTiming) {
  				pauseTime = this._pauseTime;
  				t = (pauseTime || pauseTime === 0) ? pauseTime : this._timeline.totalTime();
  				this._startTime = t - ((t - this._startTime) * this._timeScale / value);
  			}
  			this._timeScale = value;
  			t = this.timeline;
  			while (t && t.timeline) { //must update the duration/totalDuration of all ancestor timelines immediately in case in the middle of a render loop, one tween alters another tween's timeScale which shoves its startTime before 0, forcing the parent timeline to shift around and shiftChildren() which could affect that next tween's render (startTime). Doesn't matter for the root timeline though.
  				t._dirty = true;
  				t.totalDuration();
  				t = t.timeline;
  			}
  			return this;
  		};

  		p.reversed = function(value) {
  			if (!arguments.length) {
  				return this._reversed;
  			}
  			if (value != this._reversed) {
  				this._reversed = value;
  				this.totalTime(((this._timeline && !this._timeline.smoothChildTiming) ? this.totalDuration() - this._totalTime : this._totalTime), true);
  			}
  			return this;
  		};

  		p.paused = function(value) {
  			if (!arguments.length) {
  				return this._paused;
  			}
  			var tl = this._timeline,
  				raw, elapsed;
  			if (value != this._paused) if (tl) {
  				if (!_tickerActive && !value) {
  					_ticker.wake();
  				}
  				raw = tl.rawTime();
  				elapsed = raw - this._pauseTime;
  				if (!value && tl.smoothChildTiming) {
  					this._startTime += elapsed;
  					this._uncache(false);
  				}
  				this._pauseTime = value ? raw : null;
  				this._paused = value;
  				this._active = this.isActive();
  				if (!value && elapsed !== 0 && this._initted && this.duration()) {
  					raw = tl.smoothChildTiming ? this._totalTime : (raw - this._startTime) / this._timeScale;
  					this.render(raw, (raw === this._totalTime), true); //in case the target's properties changed via some other tween or manual update by the user, we should force a render.
  				}
  			}
  			if (this._gc && !value) {
  				this._enabled(true, false);
  			}
  			return this;
  		};


  /*
   * ----------------------------------------------------------------
   * SimpleTimeline
   * ----------------------------------------------------------------
   */
  		var SimpleTimeline = _class("core.SimpleTimeline", function(vars) {
  			Animation.call(this, 0, vars);
  			this.autoRemoveChildren = this.smoothChildTiming = true;
  		});

  		p = SimpleTimeline.prototype = new Animation();
  		p.constructor = SimpleTimeline;
  		p.kill()._gc = false;
  		p._first = p._last = p._recent = null;
  		p._sortChildren = false;

  		p.add = p.insert = function(child, position, align, stagger) {
  			var prevTween, st;
  			child._startTime = Number(position || 0) + child._delay;
  			if (child._paused) if (this !== child._timeline) { //we only adjust the _pauseTime if it wasn't in this timeline already. Remember, sometimes a tween will be inserted again into the same timeline when its startTime is changed so that the tweens in the TimelineLite/Max are re-ordered properly in the linked list (so everything renders in the proper order).
  				child._pauseTime = this.rawTime() - (child._timeline.rawTime() - child._pauseTime);
  			}
  			if (child.timeline) {
  				child.timeline._remove(child, true); //removes from existing timeline so that it can be properly added to this one.
  			}
  			child.timeline = child._timeline = this;
  			if (child._gc) {
  				child._enabled(true, true);
  			}
  			prevTween = this._last;
  			if (this._sortChildren) {
  				st = child._startTime;
  				while (prevTween && prevTween._startTime > st) {
  					prevTween = prevTween._prev;
  				}
  			}
  			if (prevTween) {
  				child._next = prevTween._next;
  				prevTween._next = child;
  			} else {
  				child._next = this._first;
  				this._first = child;
  			}
  			if (child._next) {
  				child._next._prev = child;
  			} else {
  				this._last = child;
  			}
  			child._prev = prevTween;
  			this._recent = child;
  			if (this._timeline) {
  				this._uncache(true);
  			}
  			return this;
  		};

  		p._remove = function(tween, skipDisable) {
  			if (tween.timeline === this) {
  				if (!skipDisable) {
  					tween._enabled(false, true);
  				}

  				if (tween._prev) {
  					tween._prev._next = tween._next;
  				} else if (this._first === tween) {
  					this._first = tween._next;
  				}
  				if (tween._next) {
  					tween._next._prev = tween._prev;
  				} else if (this._last === tween) {
  					this._last = tween._prev;
  				}
  				tween._next = tween._prev = tween.timeline = null;
  				if (tween === this._recent) {
  					this._recent = this._last;
  				}

  				if (this._timeline) {
  					this._uncache(true);
  				}
  			}
  			return this;
  		};

  		p.render = function(time, suppressEvents, force) {
  			var tween = this._first,
  				next;
  			this._totalTime = this._time = this._rawPrevTime = time;
  			while (tween) {
  				next = tween._next; //record it here because the value could change after rendering...
  				if (tween._active || (time >= tween._startTime && !tween._paused && !tween._gc)) {
  					if (!tween._reversed) {
  						tween.render((time - tween._startTime) * tween._timeScale, suppressEvents, force);
  					} else {
  						tween.render(((!tween._dirty) ? tween._totalDuration : tween.totalDuration()) - ((time - tween._startTime) * tween._timeScale), suppressEvents, force);
  					}
  				}
  				tween = next;
  			}
  		};

  		p.rawTime = function() {
  			if (!_tickerActive) {
  				_ticker.wake();
  			}
  			return this._totalTime;
  		};

  /*
   * ----------------------------------------------------------------
   * TweenLite
   * ----------------------------------------------------------------
   */
  		var TweenLite = _class("TweenLite", function(target, duration, vars) {
  				Animation.call(this, duration, vars);
  				this.render = TweenLite.prototype.render; //speed optimization (avoid prototype lookup on this "hot" method)

  				if (target == null) {
  					throw "Cannot tween a null target.";
  				}

  				this.target = target = (typeof(target) !== "string") ? target : TweenLite.selector(target) || target;

  				var isSelector = (target.jquery || (target.length && target !== window && target[0] && (target[0] === window || (target[0].nodeType && target[0].style && !target.nodeType)))),
  					overwrite = this.vars.overwrite,
  					i, targ, targets;

  				this._overwrite = overwrite = (overwrite == null) ? _overwriteLookup[TweenLite.defaultOverwrite] : (typeof(overwrite) === "number") ? overwrite >> 0 : _overwriteLookup[overwrite];

  				if ((isSelector || target instanceof Array || (target.push && _isArray(target))) && typeof(target[0]) !== "number") {
  					this._targets = targets = _slice(target);  //don't use Array.prototype.slice.call(target, 0) because that doesn't work in IE8 with a NodeList that's returned by querySelectorAll()
  					this._propLookup = [];
  					this._siblings = [];
  					for (i = 0; i < targets.length; i++) {
  						targ = targets[i];
  						if (!targ) {
  							targets.splice(i--, 1);
  							continue;
  						} else if (typeof(targ) === "string") {
  							targ = targets[i--] = TweenLite.selector(targ); //in case it's an array of strings
  							if (typeof(targ) === "string") {
  								targets.splice(i+1, 1); //to avoid an endless loop (can't imagine why the selector would return a string, but just in case)
  							}
  							continue;
  						} else if (targ.length && targ !== window && targ[0] && (targ[0] === window || (targ[0].nodeType && targ[0].style && !targ.nodeType))) { //in case the user is passing in an array of selector objects (like jQuery objects), we need to check one more level and pull things out if necessary. Also note that <select> elements pass all the criteria regarding length and the first child having style, so we must also check to ensure the target isn't an HTML node itself.
  							targets.splice(i--, 1);
  							this._targets = targets = targets.concat(_slice(targ));
  							continue;
  						}
  						this._siblings[i] = _register(targ, this, false);
  						if (overwrite === 1) if (this._siblings[i].length > 1) {
  							_applyOverwrite(targ, this, null, 1, this._siblings[i]);
  						}
  					}

  				} else {
  					this._propLookup = {};
  					this._siblings = _register(target, this, false);
  					if (overwrite === 1) if (this._siblings.length > 1) {
  						_applyOverwrite(target, this, null, 1, this._siblings);
  					}
  				}
  				if (this.vars.immediateRender || (duration === 0 && this._delay === 0 && this.vars.immediateRender !== false)) {
  					this._time = -_tinyNum; //forces a render without having to set the render() "force" parameter to true because we want to allow lazying by default (using the "force" parameter always forces an immediate full render)
  					this.render(Math.min(0, -this._delay)); //in case delay is negative
  				}
  			}, true),
  			_isSelector = function(v) {
  				return (v && v.length && v !== window && v[0] && (v[0] === window || (v[0].nodeType && v[0].style && !v.nodeType))); //we cannot check "nodeType" if the target is window from within an iframe, otherwise it will trigger a security error in some browsers like Firefox.
  			},
  			_autoCSS = function(vars, target) {
  				var css = {},
  					p;
  				for (p in vars) {
  					if (!_reservedProps[p] && (!(p in target) || p === "transform" || p === "x" || p === "y" || p === "width" || p === "height" || p === "className" || p === "border") && (!_plugins[p] || (_plugins[p] && _plugins[p]._autoCSS))) { //note: <img> elements contain read-only "x" and "y" properties. We should also prioritize editing css width/height rather than the element's properties.
  						css[p] = vars[p];
  						delete vars[p];
  					}
  				}
  				vars.css = css;
  			};

  		p = TweenLite.prototype = new Animation();
  		p.constructor = TweenLite;
  		p.kill()._gc = false;

  //----TweenLite defaults, overwrite management, and root updates ----------------------------------------------------

  		p.ratio = 0;
  		p._firstPT = p._targets = p._overwrittenProps = p._startAt = null;
  		p._notifyPluginsOfEnabled = p._lazy = false;

  		TweenLite.version = "2.1.3";
  		TweenLite.defaultEase = p._ease = new Ease(null, null, 1, 1);
  		TweenLite.defaultOverwrite = "auto";
  		TweenLite.ticker = _ticker;
  		TweenLite.autoSleep = 120;
  		TweenLite.lagSmoothing = function(threshold, adjustedLag) {
  			_ticker.lagSmoothing(threshold, adjustedLag);
  		};

  		TweenLite.selector = window.$ || window.jQuery || function(e) {
  			var selector = window.$ || window.jQuery;
  			if (selector) {
  				TweenLite.selector = selector;
  				return selector(e);
  			}
  			if (!_doc) { //in some dev environments (like Angular 6), GSAP gets loaded before the document is defined! So re-query it here if/when necessary.
  				_doc = window.document;
  			}
  			return (!_doc) ? e : (_doc.querySelectorAll ? _doc.querySelectorAll(e) : _doc.getElementById((e.charAt(0) === "#") ? e.substr(1) : e));
  		};

  		var _lazyTweens = [],
  			_lazyLookup = {},
  			_numbersExp = /(?:(-|-=|\+=)?\d*\.?\d*(?:e[\-+]?\d+)?)[0-9]/ig,
  			_relExp = /[\+-]=-?[\.\d]/,
  			//_nonNumbersExp = /(?:([\-+](?!(\d|=)))|[^\d\-+=e]|(e(?![\-+][\d])))+/ig,
  			_setRatio = function(v) {
  				var pt = this._firstPT,
  					min = 0.000001,
  					val;
  				while (pt) {
  					val = !pt.blob ? pt.c * v + pt.s : (v === 1 && this.end != null) ? this.end : v ? this.join("") : this.start;
  					if (pt.m) {
  						val = pt.m.call(this._tween, val, this._target || pt.t, this._tween);
  					} else if (val < min) if (val > -min && !pt.blob) { //prevents issues with converting very small numbers to strings in the browser
  						val = 0;
  					}
  					if (!pt.f) {
  						pt.t[pt.p] = val;
  					} else if (pt.fp) {
  						pt.t[pt.p](pt.fp, val);
  					} else {
  						pt.t[pt.p](val);
  					}
  					pt = pt._next;
  				}
  			},
  			_blobRound = function(v) {
  				return (((v * 1000) | 0) / 1000) + "";
  			},
  			//compares two strings (start/end), finds the numbers that are different and spits back an array representing the whole value but with the changing values isolated as elements. For example, "rgb(0,0,0)" and "rgb(100,50,0)" would become ["rgb(", 0, ",", 50, ",0)"]. Notice it merges the parts that are identical (performance optimization). The array also has a linked list of PropTweens attached starting with _firstPT that contain the tweening data (t, p, s, c, f, etc.). It also stores the starting value as a "start" property so that we can revert to it if/when necessary, like when a tween rewinds fully. If the quantity of numbers differs between the start and end, it will always prioritize the end value(s). The pt parameter is optional - it's for a PropTween that will be appended to the end of the linked list and is typically for actually setting the value after all of the elements have been updated (with array.join("")).
  			_blobDif = function(start, end, filter, pt) {
  				var a = [],
  					charIndex = 0,
  					s = "",
  					color = 0,
  					startNums, endNums, num, i, l, nonNumbers, currentNum;
  				a.start = start;
  				a.end = end;
  				start = a[0] = start + ""; //ensure values are strings
  				end = a[1] = end + "";
  				if (filter) {
  					filter(a); //pass an array with the starting and ending values and let the filter do whatever it needs to the values.
  					start = a[0];
  					end = a[1];
  				}
  				a.length = 0;
  				startNums = start.match(_numbersExp) || [];
  				endNums = end.match(_numbersExp) || [];
  				if (pt) {
  					pt._next = null;
  					pt.blob = 1;
  					a._firstPT = a._applyPT = pt; //apply last in the linked list (which means inserting it first)
  				}
  				l = endNums.length;
  				for (i = 0; i < l; i++) {
  					currentNum = endNums[i];
  					nonNumbers = end.substr(charIndex, end.indexOf(currentNum, charIndex)-charIndex);
  					s += (nonNumbers || !i) ? nonNumbers : ","; //note: SVG spec allows omission of comma/space when a negative sign is wedged between two numbers, like 2.5-5.3 instead of 2.5,-5.3 but when tweening, the negative value may switch to positive, so we insert the comma just in case.
  					charIndex += nonNumbers.length;
  					if (color) { //sense rgba() values and round them.
  						color = (color + 1) % 5;
  					} else if (nonNumbers.substr(-5) === "rgba(") {
  						color = 1;
  					}
  					if (currentNum === startNums[i] || startNums.length <= i) {
  						s += currentNum;
  					} else {
  						if (s) {
  							a.push(s);
  							s = "";
  						}
  						num = parseFloat(startNums[i]);
  						a.push(num);
  						a._firstPT = {_next: a._firstPT, t:a, p: a.length-1, s:num, c:((currentNum.charAt(1) === "=") ? parseInt(currentNum.charAt(0) + "1", 10) * parseFloat(currentNum.substr(2)) : (parseFloat(currentNum) - num)) || 0, f:0, m:(color && color < 4) ? Math.round : _blobRound}; //limiting to 3 decimal places and casting as a string can really help performance when array.join() is called!
  						//note: we don't set _prev because we'll never need to remove individual PropTweens from this list.
  					}
  					charIndex += currentNum.length;
  				}
  				s += end.substr(charIndex);
  				if (s) {
  					a.push(s);
  				}
  				a.setRatio = _setRatio;
  				if (_relExp.test(end)) { //if the end string contains relative values, delete it so that on the final render (in _setRatio()), we don't actually set it to the string with += or -= characters (forces it to use the calculated value).
  					a.end = null;
  				}
  				return a;
  			},
  			//note: "funcParam" is only necessary for function-based getters/setters that require an extra parameter like getAttribute("width") and setAttribute("width", value). In this example, funcParam would be "width". Used by AttrPlugin for example.
  			_addPropTween = function(target, prop, start, end, overwriteProp, mod, funcParam, stringFilter, index) {
  				if (typeof(end) === "function") {
  					end = end(index || 0, target);
  				}
  				var type = typeof(target[prop]),
  					getterName = (type !== "function") ? "" : ((prop.indexOf("set") || typeof(target["get" + prop.substr(3)]) !== "function") ? prop : "get" + prop.substr(3)),
  					s = (start !== "get") ? start : !getterName ? target[prop] : funcParam ? target[getterName](funcParam) : target[getterName](),
  					isRelative = (typeof(end) === "string" && end.charAt(1) === "="),
  					pt = {t:target, p:prop, s:s, f:(type === "function"), pg:0, n:overwriteProp || prop, m:(!mod ? 0 : (typeof(mod) === "function") ? mod : Math.round), pr:0, c:isRelative ? parseInt(end.charAt(0) + "1", 10) * parseFloat(end.substr(2)) : (parseFloat(end) - s) || 0},
  					blob;

  				if (typeof(s) !== "number" || (typeof(end) !== "number" && !isRelative)) {
  					if (funcParam || isNaN(s) || (!isRelative && isNaN(end)) || typeof(s) === "boolean" || typeof(end) === "boolean") {
  						//a blob (string that has multiple numbers in it)
  						pt.fp = funcParam;
  						blob = _blobDif(s, (isRelative ? (parseFloat(pt.s) + pt.c) + (pt.s + "").replace(/[0-9\-\.]/g, "") : end), stringFilter || TweenLite.defaultStringFilter, pt);
  						pt = {t: blob, p: "setRatio", s: 0, c: 1, f: 2, pg: 0, n: overwriteProp || prop, pr: 0, m: 0}; //"2" indicates it's a Blob property tween. Needed for RoundPropsPlugin for example.
  					} else {
  						pt.s = parseFloat(s);
  						if (!isRelative) {
  							pt.c = (parseFloat(end) - pt.s) || 0;
  						}
  					}
  				}
  				if (pt.c) { //only add it to the linked list if there's a change.
  					if ((pt._next = this._firstPT)) {
  						pt._next._prev = pt;
  					}
  					this._firstPT = pt;
  					return pt;
  				}
  			},
  			_internals = TweenLite._internals = {isArray:_isArray, isSelector:_isSelector, lazyTweens:_lazyTweens, blobDif:_blobDif}, //gives us a way to expose certain private values to other GreenSock classes without contaminating tha main TweenLite object.
  			_plugins = TweenLite._plugins = {},
  			_tweenLookup = _internals.tweenLookup = {},
  			_tweenLookupNum = 0,
  			_reservedProps = _internals.reservedProps = {ease:1, delay:1, overwrite:1, onComplete:1, onCompleteParams:1, onCompleteScope:1, useFrames:1, runBackwards:1, startAt:1, onUpdate:1, onUpdateParams:1, onUpdateScope:1, onStart:1, onStartParams:1, onStartScope:1, onReverseComplete:1, onReverseCompleteParams:1, onReverseCompleteScope:1, onRepeat:1, onRepeatParams:1, onRepeatScope:1, easeParams:1, yoyo:1, immediateRender:1, repeat:1, repeatDelay:1, data:1, paused:1, reversed:1, autoCSS:1, lazy:1, onOverwrite:1, callbackScope:1, stringFilter:1, id:1, yoyoEase:1, stagger:1},
  			_overwriteLookup = {none:0, all:1, auto:2, concurrent:3, allOnStart:4, preexisting:5, "true":1, "false":0},
  			_rootFramesTimeline = Animation._rootFramesTimeline = new SimpleTimeline(),
  			_rootTimeline = Animation._rootTimeline = new SimpleTimeline(),
  			_nextGCFrame = 30,
  			_lazyRender = _internals.lazyRender = function() {
  				var l = _lazyTweens.length,
  					i, tween;
  				_lazyLookup = {};
  				for (i = 0; i < l; i++) {
  					tween = _lazyTweens[i];
  					if (tween && tween._lazy !== false) {
  						tween.render(tween._lazy[0], tween._lazy[1], true);
  						tween._lazy = false;
  					}
  				}
  				_lazyTweens.length = 0;
  			};

  		_rootTimeline._startTime = _ticker.time;
  		_rootFramesTimeline._startTime = _ticker.frame;
  		_rootTimeline._active = _rootFramesTimeline._active = true;
  		setTimeout(_lazyRender, 1); //on some mobile devices, there isn't a "tick" before code runs which means any lazy renders wouldn't run before the next official "tick".

  		Animation._updateRoot = TweenLite.render = function() {
  				var i, a, p;
  				if (_lazyTweens.length) { //if code is run outside of the requestAnimationFrame loop, there may be tweens queued AFTER the engine refreshed, so we need to ensure any pending renders occur before we refresh again.
  					_lazyRender();
  				}
  				_rootTimeline.render((_ticker.time - _rootTimeline._startTime) * _rootTimeline._timeScale, false, false);
  				_rootFramesTimeline.render((_ticker.frame - _rootFramesTimeline._startTime) * _rootFramesTimeline._timeScale, false, false);
  				if (_lazyTweens.length) {
  					_lazyRender();
  				}
  				if (_ticker.frame >= _nextGCFrame) { //dump garbage every 120 frames or whatever the user sets TweenLite.autoSleep to
  					_nextGCFrame = _ticker.frame + (parseInt(TweenLite.autoSleep, 10) || 120);
  					for (p in _tweenLookup) {
  						a = _tweenLookup[p].tweens;
  						i = a.length;
  						while (--i > -1) {
  							if (a[i]._gc) {
  								a.splice(i, 1);
  							}
  						}
  						if (a.length === 0) {
  							delete _tweenLookup[p];
  						}
  					}
  					//if there are no more tweens in the root timelines, or if they're all paused, make the _timer sleep to reduce load on the CPU slightly
  					p = _rootTimeline._first;
  					if (!p || p._paused) if (TweenLite.autoSleep && !_rootFramesTimeline._first && _ticker._listeners.tick.length === 1) {
  						while (p && p._paused) {
  							p = p._next;
  						}
  						if (!p) {
  							_ticker.sleep();
  						}
  					}
  				}
  			};

  		_ticker.addEventListener("tick", Animation._updateRoot);

  		var _register = function(target, tween, scrub) {
  				var id = target._gsTweenID, a, i;
  				if (!_tweenLookup[id || (target._gsTweenID = id = "t" + (_tweenLookupNum++))]) {
  					_tweenLookup[id] = {target:target, tweens:[]};
  				}
  				if (tween) {
  					a = _tweenLookup[id].tweens;
  					a[(i = a.length)] = tween;
  					if (scrub) {
  						while (--i > -1) {
  							if (a[i] === tween) {
  								a.splice(i, 1);
  							}
  						}
  					}
  				}
  				return _tweenLookup[id].tweens;
  			},
  			_onOverwrite = function(overwrittenTween, overwritingTween, target, killedProps) {
  				var func = overwrittenTween.vars.onOverwrite, r1, r2;
  				if (func) {
  					r1 = func(overwrittenTween, overwritingTween, target, killedProps);
  				}
  				func = TweenLite.onOverwrite;
  				if (func) {
  					r2 = func(overwrittenTween, overwritingTween, target, killedProps);
  				}
  				return (r1 !== false && r2 !== false);
  			},
  			_applyOverwrite = function(target, tween, props, mode, siblings) {
  				var i, changed, curTween, l;
  				if (mode === 1 || mode >= 4) {
  					l = siblings.length;
  					for (i = 0; i < l; i++) {
  						if ((curTween = siblings[i]) !== tween) {
  							if (!curTween._gc) {
  								if (curTween._kill(null, target, tween)) {
  									changed = true;
  								}
  							}
  						} else if (mode === 5) {
  							break;
  						}
  					}
  					return changed;
  				}
  				//NOTE: Add tiny amount to overcome floating point errors that can cause the startTime to be VERY slightly off (when a tween's time() is set for example)
  				var startTime = tween._startTime + _tinyNum,
  					overlaps = [],
  					oCount = 0,
  					zeroDur = (tween._duration === 0),
  					globalStart;
  				i = siblings.length;
  				while (--i > -1) {
  					if ((curTween = siblings[i]) === tween || curTween._gc || curTween._paused) ; else if (curTween._timeline !== tween._timeline) {
  						globalStart = globalStart || _checkOverlap(tween, 0, zeroDur);
  						if (_checkOverlap(curTween, globalStart, zeroDur) === 0) {
  							overlaps[oCount++] = curTween;
  						}
  					} else if (curTween._startTime <= startTime) if (curTween._startTime + curTween.totalDuration() / curTween._timeScale > startTime) if (!((zeroDur || !curTween._initted) && startTime - curTween._startTime <= _tinyNum * 2)) {
  						overlaps[oCount++] = curTween;
  					}
  				}

  				i = oCount;
  				while (--i > -1) {
  					curTween = overlaps[i];
  					l = curTween._firstPT; //we need to discern if there were property tweens originally; if they all get removed in the next line's _kill() call, the tween should be killed. See https://github.com/greensock/GreenSock-JS/issues/278
  					if (mode === 2) if (curTween._kill(props, target, tween)) {
  						changed = true;
  					}
  					if (mode !== 2 || (!curTween._firstPT && curTween._initted && l)) {
  						if (mode !== 2 && !_onOverwrite(curTween, tween)) {
  							continue;
  						}
  						if (curTween._enabled(false, false)) { //if all property tweens have been overwritten, kill the tween.
  							changed = true;
  						}
  					}
  				}
  				return changed;
  			},
  			_checkOverlap = function(tween, reference, zeroDur) {
  				var tl = tween._timeline,
  					ts = tl._timeScale,
  					t = tween._startTime;
  				while (tl._timeline) {
  					t += tl._startTime;
  					ts *= tl._timeScale;
  					if (tl._paused) {
  						return -100;
  					}
  					tl = tl._timeline;
  				}
  				t /= ts;
  				return (t > reference) ? t - reference : ((zeroDur && t === reference) || (!tween._initted && t - reference < 2 * _tinyNum)) ? _tinyNum : ((t += tween.totalDuration() / tween._timeScale / ts) > reference + _tinyNum) ? 0 : t - reference - _tinyNum;
  			};


  //---- TweenLite instance methods -----------------------------------------------------------------------------

  		p._init = function() {
  			var v = this.vars,
  				op = this._overwrittenProps,
  				dur = this._duration,
  				immediate = !!v.immediateRender,
  				ease = v.ease,
  				startAt = this._startAt,
  				i, initPlugins, pt, p, startVars, l;
  			if (v.startAt) {
  				if (startAt) {
  					startAt.render(-1, true); //if we've run a startAt previously (when the tween instantiated), we should revert it so that the values re-instantiate correctly particularly for relative tweens. Without this, a TweenLite.fromTo(obj, 1, {x:"+=100"}, {x:"-=100"}), for example, would actually jump to +=200 because the startAt would run twice, doubling the relative change.
  					startAt.kill();
  				}
  				startVars = {};
  				for (p in v.startAt) { //copy the properties/values into a new object to avoid collisions, like var to = {x:0}, from = {x:500}; timeline.fromTo(e, 1, from, to).fromTo(e, 1, to, from);
  					startVars[p] = v.startAt[p];
  				}
  				startVars.data = "isStart";
  				startVars.overwrite = false;
  				startVars.immediateRender = true;
  				startVars.lazy = (immediate && v.lazy !== false);
  				startVars.startAt = startVars.delay = null; //no nesting of startAt objects allowed (otherwise it could cause an infinite loop).
  				startVars.onUpdate = v.onUpdate;
  				startVars.onUpdateParams = v.onUpdateParams;
  				startVars.onUpdateScope = v.onUpdateScope || v.callbackScope || this;
  				this._startAt = TweenLite.to(this.target || {}, 0, startVars);
  				if (immediate) {
  					if (this._time > 0) {
  						this._startAt = null; //tweens that render immediately (like most from() and fromTo() tweens) shouldn't revert when their parent timeline's playhead goes backward past the startTime because the initial render could have happened anytime and it shouldn't be directly correlated to this tween's startTime. Imagine setting up a complex animation where the beginning states of various objects are rendered immediately but the tween doesn't happen for quite some time - if we revert to the starting values as soon as the playhead goes backward past the tween's startTime, it will throw things off visually. Reversion should only happen in TimelineLite/Max instances where immediateRender was false (which is the default in the convenience methods like from()).
  					} else if (dur !== 0) {
  						return; //we skip initialization here so that overwriting doesn't occur until the tween actually begins. Otherwise, if you create several immediateRender:true tweens of the same target/properties to drop into a TimelineLite or TimelineMax, the last one created would overwrite the first ones because they didn't get placed into the timeline yet before the first render occurs and kicks in overwriting.
  					}
  				}
  			} else if (v.runBackwards && dur !== 0) {
  				//from() tweens must be handled uniquely: their beginning values must be rendered but we don't want overwriting to occur yet (when time is still 0). Wait until the tween actually begins before doing all the routines like overwriting. At that time, we should render at the END of the tween to ensure that things initialize correctly (remember, from() tweens go backwards)
  				if (startAt) {
  					startAt.render(-1, true);
  					startAt.kill();
  					this._startAt = null;
  				} else {
  					if (this._time !== 0) { //in rare cases (like if a from() tween runs and then is invalidate()-ed), immediateRender could be true but the initial forced-render gets skipped, so there's no need to force the render in this context when the _time is greater than 0
  						immediate = false;
  					}
  					pt = {};
  					for (p in v) { //copy props into a new object and skip any reserved props, otherwise onComplete or onUpdate or onStart could fire. We should, however, permit autoCSS to go through.
  						if (!_reservedProps[p] || p === "autoCSS") {
  							pt[p] = v[p];
  						}
  					}
  					pt.overwrite = 0;
  					pt.data = "isFromStart"; //we tag the tween with as "isFromStart" so that if [inside a plugin] we need to only do something at the very END of a tween, we have a way of identifying this tween as merely the one that's setting the beginning values for a "from()" tween. For example, clearProps in CSSPlugin should only get applied at the very END of a tween and without this tag, from(...{height:100, clearProps:"height", delay:1}) would wipe the height at the beginning of the tween and after 1 second, it'd kick back in.
  					pt.lazy = (immediate && v.lazy !== false);
  					pt.immediateRender = immediate; //zero-duration tweens render immediately by default, but if we're not specifically instructed to render this tween immediately, we should skip this and merely _init() to record the starting values (rendering them immediately would push them to completion which is wasteful in that case - we'd have to render(-1) immediately after)
  					this._startAt = TweenLite.to(this.target, 0, pt);
  					if (!immediate) {
  						this._startAt._init(); //ensures that the initial values are recorded
  						this._startAt._enabled(false); //no need to have the tween render on the next cycle. Disable it because we'll always manually control the renders of the _startAt tween.
  						if (this.vars.immediateRender) {
  							this._startAt = null;
  						}
  					} else if (this._time === 0) {
  						return;
  					}
  				}
  			}
  			this._ease = ease = (!ease) ? TweenLite.defaultEase : (ease instanceof Ease) ? ease : (typeof(ease) === "function") ? new Ease(ease, v.easeParams) : _easeMap[ease] || TweenLite.defaultEase;
  			if (v.easeParams instanceof Array && ease.config) {
  				this._ease = ease.config.apply(ease, v.easeParams);
  			}
  			this._easeType = this._ease._type;
  			this._easePower = this._ease._power;
  			this._firstPT = null;

  			if (this._targets) {
  				l = this._targets.length;
  				for (i = 0; i < l; i++) {
  					if ( this._initProps( this._targets[i], (this._propLookup[i] = {}), this._siblings[i], (op ? op[i] : null), i) ) {
  						initPlugins = true;
  					}
  				}
  			} else {
  				initPlugins = this._initProps(this.target, this._propLookup, this._siblings, op, 0);
  			}

  			if (initPlugins) {
  				TweenLite._onPluginEvent("_onInitAllProps", this); //reorders the array in order of priority. Uses a static TweenPlugin method in order to minimize file size in TweenLite
  			}
  			if (op) if (!this._firstPT) if (typeof(this.target) !== "function") { //if all tweening properties have been overwritten, kill the tween. If the target is a function, it's probably a delayedCall so let it live.
  				this._enabled(false, false);
  			}
  			if (v.runBackwards) {
  				pt = this._firstPT;
  				while (pt) {
  					pt.s += pt.c;
  					pt.c = -pt.c;
  					pt = pt._next;
  				}
  			}
  			this._onUpdate = v.onUpdate;
  			this._initted = true;
  		};

  		p._initProps = function(target, propLookup, siblings, overwrittenProps, index) {
  			var p, i, initPlugins, plugin, pt, v;
  			if (target == null) {
  				return false;
  			}
  			if (_lazyLookup[target._gsTweenID]) {
  				_lazyRender(); //if other tweens of the same target have recently initted but haven't rendered yet, we've got to force the render so that the starting values are correct (imagine populating a timeline with a bunch of sequential tweens and then jumping to the end)
  			}

  			if (!this.vars.css) if (target.style) if (target !== window && target.nodeType) if (_plugins.css) if (this.vars.autoCSS !== false) { //it's so common to use TweenLite/Max to animate the css of DOM elements, we assume that if the target is a DOM element, that's what is intended (a convenience so that users don't have to wrap things in css:{}, although we still recommend it for a slight performance boost and better specificity). Note: we cannot check "nodeType" on the window inside an iframe.
  				_autoCSS(this.vars, target);
  			}
  			for (p in this.vars) {
  				v = this.vars[p];
  				if (_reservedProps[p]) {
  					if (v) if ((v instanceof Array) || (v.push && _isArray(v))) if (v.join("").indexOf("{self}") !== -1) {
  						this.vars[p] = v = this._swapSelfInParams(v, this);
  					}

  				} else if (_plugins[p] && (plugin = new _plugins[p]())._onInitTween(target, this.vars[p], this, index)) {

  					//t - target 		[object]
  					//p - property 		[string]
  					//s - start			[number]
  					//c - change		[number]
  					//f - isFunction	[boolean]
  					//n - name			[string]
  					//pg - isPlugin 	[boolean]
  					//pr - priority		[number]
  					//m - mod           [function | 0]
  					this._firstPT = pt = {_next:this._firstPT, t:plugin, p:"setRatio", s:0, c:1, f:1, n:p, pg:1, pr:plugin._priority, m:0};
  					i = plugin._overwriteProps.length;
  					while (--i > -1) {
  						propLookup[plugin._overwriteProps[i]] = this._firstPT;
  					}
  					if (plugin._priority || plugin._onInitAllProps) {
  						initPlugins = true;
  					}
  					if (plugin._onDisable || plugin._onEnable) {
  						this._notifyPluginsOfEnabled = true;
  					}
  					if (pt._next) {
  						pt._next._prev = pt;
  					}

  				} else {
  					propLookup[p] = _addPropTween.call(this, target, p, "get", v, p, 0, null, this.vars.stringFilter, index);
  				}
  			}

  			if (overwrittenProps) if (this._kill(overwrittenProps, target)) { //another tween may have tried to overwrite properties of this tween before init() was called (like if two tweens start at the same time, the one created second will run first)
  				return this._initProps(target, propLookup, siblings, overwrittenProps, index);
  			}
  			if (this._overwrite > 1) if (this._firstPT) if (siblings.length > 1) if (_applyOverwrite(target, this, propLookup, this._overwrite, siblings)) {
  				this._kill(propLookup, target);
  				return this._initProps(target, propLookup, siblings, overwrittenProps, index);
  			}
  			if (this._firstPT) if ((this.vars.lazy !== false && this._duration) || (this.vars.lazy && !this._duration)) { //zero duration tweens don't lazy render by default; everything else does.
  				_lazyLookup[target._gsTweenID] = true;
  			}
  			return initPlugins;
  		};

  		p.render = function(time, suppressEvents, force) {
  			var self = this,
  				prevTime = self._time,
  				duration = self._duration,
  				prevRawPrevTime = self._rawPrevTime,
  				isComplete, callback, pt, rawPrevTime;
  			if (time >= duration - _tinyNum && time >= 0) { //to work around occasional floating point math artifacts.
  				self._totalTime = self._time = duration;
  				self.ratio = self._ease._calcEnd ? self._ease.getRatio(1) : 1;
  				if (!self._reversed ) {
  					isComplete = true;
  					callback = "onComplete";
  					force = (force || self._timeline.autoRemoveChildren); //otherwise, if the animation is unpaused/activated after it's already finished, it doesn't get removed from the parent timeline.
  				}
  				if (duration === 0) if (self._initted || !self.vars.lazy || force) { //zero-duration tweens are tricky because we must discern the momentum/direction of time in order to determine whether the starting values should be rendered or the ending values. If the "playhead" of its timeline goes past the zero-duration tween in the forward direction or lands directly on it, the end values should be rendered, but if the timeline's "playhead" moves past it in the backward direction (from a postitive time to a negative time), the starting values must be rendered.
  					if (self._startTime === self._timeline._duration) { //if a zero-duration tween is at the VERY end of a timeline and that timeline renders at its end, it will typically add a tiny bit of cushion to the render time to prevent rounding errors from getting in the way of tweens rendering their VERY end. If we then reverse() that timeline, the zero-duration tween will trigger its onReverseComplete even though technically the playhead didn't pass over it again. It's a very specific edge case we must accommodate.
  						time = 0;
  					}
  					if (prevRawPrevTime < 0 || (time <= 0 && time >= -_tinyNum) || (prevRawPrevTime === _tinyNum && self.data !== "isPause")) if (prevRawPrevTime !== time) { //note: when this.data is "isPause", it's a callback added by addPause() on a timeline that we should not be triggered when LEAVING its exact start time. In other words, tl.addPause(1).play(1) shouldn't pause.
  						force = true;
  						if (prevRawPrevTime > _tinyNum) {
  							callback = "onReverseComplete";
  						}
  					}
  					self._rawPrevTime = rawPrevTime = (!suppressEvents || time || prevRawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
  				}

  			} else if (time < _tinyNum) { //to work around occasional floating point math artifacts, round super small values to 0.
  				self._totalTime = self._time = 0;
  				self.ratio = self._ease._calcEnd ? self._ease.getRatio(0) : 0;
  				if (prevTime !== 0 || (duration === 0 && prevRawPrevTime > 0)) {
  					callback = "onReverseComplete";
  					isComplete = self._reversed;
  				}
  				if (time > -_tinyNum) {
  					time = 0;
  				} else if (time < 0) {
  					self._active = false;
  					if (duration === 0) if (self._initted || !self.vars.lazy || force) { //zero-duration tweens are tricky because we must discern the momentum/direction of time in order to determine whether the starting values should be rendered or the ending values. If the "playhead" of its timeline goes past the zero-duration tween in the forward direction or lands directly on it, the end values should be rendered, but if the timeline's "playhead" moves past it in the backward direction (from a postitive time to a negative time), the starting values must be rendered.
  						if (prevRawPrevTime >= 0 && !(prevRawPrevTime === _tinyNum && self.data === "isPause")) {
  							force = true;
  						}
  						self._rawPrevTime = rawPrevTime = (!suppressEvents || time || prevRawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
  					}
  				}
  				if (!self._initted || (self._startAt && self._startAt.progress())) { //if we render the very beginning (time == 0) of a fromTo(), we must force the render (normal tweens wouldn't need to render at a time of 0 when the prevTime was also 0). This is also mandatory to make sure overwriting kicks in immediately. Also, we check progress() because if startAt has already rendered at its end, we should force a render at its beginning. Otherwise, if you put the playhead directly on top of where a fromTo({immediateRender:false}) starts, and then move it backwards, the from() won't revert its values.
  					force = true;
  				}
  			} else {
  				self._totalTime = self._time = time;

  				if (self._easeType) {
  					var r = time / duration, type = self._easeType, pow = self._easePower;
  					if (type === 1 || (type === 3 && r >= 0.5)) {
  						r = 1 - r;
  					}
  					if (type === 3) {
  						r *= 2;
  					}
  					if (pow === 1) {
  						r *= r;
  					} else if (pow === 2) {
  						r *= r * r;
  					} else if (pow === 3) {
  						r *= r * r * r;
  					} else if (pow === 4) {
  						r *= r * r * r * r;
  					}
  					self.ratio = (type === 1) ? 1 - r : (type === 2) ? r : (time / duration < 0.5) ? r / 2 : 1 - (r / 2);
  				} else {
  					self.ratio = self._ease.getRatio(time / duration);
  				}
  			}

  			if (self._time === prevTime && !force) {
  				return;
  			} else if (!self._initted) {
  				self._init();
  				if (!self._initted || self._gc) { //immediateRender tweens typically won't initialize until the playhead advances (_time is greater than 0) in order to ensure that overwriting occurs properly. Also, if all of the tweening properties have been overwritten (which would cause _gc to be true, as set in _init()), we shouldn't continue otherwise an onStart callback could be called for example.
  					return;
  				} else if (!force && self._firstPT && ((self.vars.lazy !== false && self._duration) || (self.vars.lazy && !self._duration))) {
  					self._time = self._totalTime = prevTime;
  					self._rawPrevTime = prevRawPrevTime;
  					_lazyTweens.push(self);
  					self._lazy = [time, suppressEvents];
  					return;
  				}
  				//_ease is initially set to defaultEase, so now that init() has run, _ease is set properly and we need to recalculate the ratio. Overall this is faster than using conditional logic earlier in the method to avoid having to set ratio twice because we only init() once but renderTime() gets called VERY frequently.
  				if (self._time && !isComplete) {
  					self.ratio = self._ease.getRatio(self._time / duration);
  				} else if (isComplete && self._ease._calcEnd) {
  					self.ratio = self._ease.getRatio((self._time === 0) ? 0 : 1);
  				}
  			}
  			if (self._lazy !== false) { //in case a lazy render is pending, we should flush it because the new render is occurring now (imagine a lazy tween instantiating and then immediately the user calls tween.seek(tween.duration()), skipping to the end - the end render would be forced, and then if we didn't flush the lazy render, it'd fire AFTER the seek(), rendering it at the wrong time.
  				self._lazy = false;
  			}
  			if (!self._active) if (!self._paused && self._time !== prevTime && time >= 0) {
  				self._active = true;  //so that if the user renders a tween (as opposed to the timeline rendering it), the timeline is forced to re-render and align it with the proper time/frame on the next rendering cycle. Maybe the tween already finished but the user manually re-renders it as halfway done.
  			}
  			if (prevTime === 0) {
  				if (self._startAt) {
  					if (time >= 0) {
  						self._startAt.render(time, true, force);
  					} else if (!callback) {
  						callback = "_dummyGS"; //if no callback is defined, use a dummy value just so that the condition at the end evaluates as true because _startAt should render AFTER the normal render loop when the time is negative. We could handle this in a more intuitive way, of course, but the render loop is the MOST important thing to optimize, so this technique allows us to avoid adding extra conditional logic in a high-frequency area.
  					}
  				}
  				if (self.vars.onStart) if (self._time !== 0 || duration === 0) if (!suppressEvents) {
  					self._callback("onStart");
  				}
  			}
  			pt = self._firstPT;
  			while (pt) {
  				if (pt.f) {
  					pt.t[pt.p](pt.c * self.ratio + pt.s);
  				} else {
  					pt.t[pt.p] = pt.c * self.ratio + pt.s;
  				}
  				pt = pt._next;
  			}

  			if (self._onUpdate) {
  				if (time < 0) if (self._startAt && time !== -0.0001) { //if the tween is positioned at the VERY beginning (_startTime 0) of its parent timeline, it's illegal for the playhead to go back further, so we should not render the recorded startAt values.
  					self._startAt.render(time, true, force); //note: for performance reasons, we tuck this conditional logic inside less traveled areas (most tweens don't have an onUpdate). We'd just have it at the end before the onComplete, but the values should be updated before any onUpdate is called, so we ALSO put it here and then if it's not called, we do so later near the onComplete.
  				}
  				if (!suppressEvents) if (self._time !== prevTime || isComplete || force) {
  					self._callback("onUpdate");
  				}
  			}
  			if (callback) if (!self._gc || force) { //check _gc because there's a chance that kill() could be called in an onUpdate
  				if (time < 0 && self._startAt && !self._onUpdate && time !== -0.0001) { //-0.0001 is a special value that we use when looping back to the beginning of a repeated TimelineMax, in which case we shouldn't render the _startAt values.
  					self._startAt.render(time, true, force);
  				}
  				if (isComplete) {
  					if (self._timeline.autoRemoveChildren) {
  						self._enabled(false, false);
  					}
  					self._active = false;
  				}
  				if (!suppressEvents && self.vars[callback]) {
  					self._callback(callback);
  				}
  				if (duration === 0 && self._rawPrevTime === _tinyNum && rawPrevTime !== _tinyNum) { //the onComplete or onReverseComplete could trigger movement of the playhead and for zero-duration tweens (which must discern direction) that land directly back on their start time, we don't want to fire again on the next render. Think of several addPause()'s in a timeline that forces the playhead to a certain spot, but what if it's already paused and another tween is tweening the "time" of the timeline? Each time it moves [forward] past that spot, it would move back, and since suppressEvents is true, it'd reset _rawPrevTime to _tinyNum so that when it begins again, the callback would fire (so ultimately it could bounce back and forth during that tween). Again, this is a very uncommon scenario, but possible nonetheless.
  					self._rawPrevTime = 0;
  				}
  			}
  		};

  		p._kill = function(vars, target, overwritingTween) {
  			if (vars === "all") {
  				vars = null;
  			}
  			if (vars == null) if (target == null || target === this.target) {
  				this._lazy = false;
  				return this._enabled(false, false);
  			}
  			target = (typeof(target) !== "string") ? (target || this._targets || this.target) : TweenLite.selector(target) || target;
  			var simultaneousOverwrite = (overwritingTween && this._time && overwritingTween._startTime === this._startTime && this._timeline === overwritingTween._timeline),
  				firstPT = this._firstPT,
  				i, overwrittenProps, p, pt, propLookup, changed, killProps, record, killed;
  			if ((_isArray(target) || _isSelector(target)) && typeof(target[0]) !== "number") {
  				i = target.length;
  				while (--i > -1) {
  					if (this._kill(vars, target[i], overwritingTween)) {
  						changed = true;
  					}
  				}
  			} else {
  				if (this._targets) {
  					i = this._targets.length;
  					while (--i > -1) {
  						if (target === this._targets[i]) {
  							propLookup = this._propLookup[i] || {};
  							this._overwrittenProps = this._overwrittenProps || [];
  							overwrittenProps = this._overwrittenProps[i] = vars ? this._overwrittenProps[i] || {} : "all";
  							break;
  						}
  					}
  				} else if (target !== this.target) {
  					return false;
  				} else {
  					propLookup = this._propLookup;
  					overwrittenProps = this._overwrittenProps = vars ? this._overwrittenProps || {} : "all";
  				}

  				if (propLookup) {
  					killProps = vars || propLookup;
  					record = (vars !== overwrittenProps && overwrittenProps !== "all" && vars !== propLookup && (typeof(vars) !== "object" || !vars._tempKill)); //_tempKill is a super-secret way to delete a particular tweening property but NOT have it remembered as an official overwritten property (like in BezierPlugin)
  					if (overwritingTween && (TweenLite.onOverwrite || this.vars.onOverwrite)) {
  						for (p in killProps) {
  							if (propLookup[p]) {
  								if (!killed) {
  									killed = [];
  								}
  								killed.push(p);
  							}
  						}
  						if ((killed || !vars) && !_onOverwrite(this, overwritingTween, target, killed)) { //if the onOverwrite returned false, that means the user wants to override the overwriting (cancel it).
  							return false;
  						}
  					}

  					for (p in killProps) {
  						if ((pt = propLookup[p])) {
  							if (simultaneousOverwrite) { //if another tween overwrites this one and they both start at exactly the same time, yet this tween has already rendered once (for example, at 0.001) because it's first in the queue, we should revert the values to where they were at 0 so that the starting values aren't contaminated on the overwriting tween.
  								if (pt.f) {
  									pt.t[pt.p](pt.s);
  								} else {
  									pt.t[pt.p] = pt.s;
  								}
  								changed = true;
  							}
  							if (pt.pg && pt.t._kill(killProps)) {
  								changed = true; //some plugins need to be notified so they can perform cleanup tasks first
  							}
  							if (!pt.pg || pt.t._overwriteProps.length === 0) {
  								if (pt._prev) {
  									pt._prev._next = pt._next;
  								} else if (pt === this._firstPT) {
  									this._firstPT = pt._next;
  								}
  								if (pt._next) {
  									pt._next._prev = pt._prev;
  								}
  								pt._next = pt._prev = null;
  							}
  							delete propLookup[p];
  						}
  						if (record) {
  							overwrittenProps[p] = 1;
  						}
  					}
  					if (!this._firstPT && this._initted && firstPT) { //if all tweening properties are killed, kill the tween. Without this line, if there's a tween with multiple targets and then you killTweensOf() each target individually, the tween would technically still remain active and fire its onComplete even though there aren't any more properties tweening.
  						this._enabled(false, false);
  					}
  				}
  			}
  			return changed;
  		};

  		p.invalidate = function() {
  			if (this._notifyPluginsOfEnabled) {
  				TweenLite._onPluginEvent("_onDisable", this);
  			}
  			var t = this._time;
  			this._firstPT = this._overwrittenProps = this._startAt = this._onUpdate = null;
  			this._notifyPluginsOfEnabled = this._active = this._lazy = false;
  			this._propLookup = (this._targets) ? {} : [];
  			Animation.prototype.invalidate.call(this);
  			if (this.vars.immediateRender) {
  				this._time = -_tinyNum; //forces a render without having to set the render() "force" parameter to true because we want to allow lazying by default (using the "force" parameter always forces an immediate full render)
  				this.render(t, false, this.vars.lazy !== false);
  			}
  			return this;
  		};

  		p._enabled = function(enabled, ignoreTimeline) {
  			if (!_tickerActive) {
  				_ticker.wake();
  			}
  			if (enabled && this._gc) {
  				var targets = this._targets,
  					i;
  				if (targets) {
  					i = targets.length;
  					while (--i > -1) {
  						this._siblings[i] = _register(targets[i], this, true);
  					}
  				} else {
  					this._siblings = _register(this.target, this, true);
  				}
  			}
  			Animation.prototype._enabled.call(this, enabled, ignoreTimeline);
  			if (this._notifyPluginsOfEnabled) if (this._firstPT) {
  				return TweenLite._onPluginEvent((enabled ? "_onEnable" : "_onDisable"), this);
  			}
  			return false;
  		};


  //----TweenLite static methods -----------------------------------------------------

  		TweenLite.to = function(target, duration, vars) {
  			return new TweenLite(target, duration, vars);
  		};

  		TweenLite.from = function(target, duration, vars) {
  			vars.runBackwards = true;
  			vars.immediateRender = (vars.immediateRender != false);
  			return new TweenLite(target, duration, vars);
  		};

  		TweenLite.fromTo = function(target, duration, fromVars, toVars) {
  			toVars.startAt = fromVars;
  			toVars.immediateRender = (toVars.immediateRender != false && fromVars.immediateRender != false);
  			return new TweenLite(target, duration, toVars);
  		};

  		TweenLite.delayedCall = function(delay, callback, params, scope, useFrames) {
  			return new TweenLite(callback, 0, {delay:delay, onComplete:callback, onCompleteParams:params, callbackScope:scope, onReverseComplete:callback, onReverseCompleteParams:params, immediateRender:false, lazy:false, useFrames:useFrames, overwrite:0});
  		};

  		TweenLite.set = function(target, vars) {
  			return new TweenLite(target, 0, vars);
  		};

  		TweenLite.getTweensOf = function(target, onlyActive) {
  			if (target == null) { return []; }
  			target = (typeof(target) !== "string") ? target : TweenLite.selector(target) || target;
  			var i, a, j, t;
  			if ((_isArray(target) || _isSelector(target)) && typeof(target[0]) !== "number") {
  				i = target.length;
  				a = [];
  				while (--i > -1) {
  					a = a.concat(TweenLite.getTweensOf(target[i], onlyActive));
  				}
  				i = a.length;
  				//now get rid of any duplicates (tweens of arrays of objects could cause duplicates)
  				while (--i > -1) {
  					t = a[i];
  					j = i;
  					while (--j > -1) {
  						if (t === a[j]) {
  							a.splice(i, 1);
  						}
  					}
  				}
  			} else if (target._gsTweenID) {
  				a = _register(target).concat();
  				i = a.length;
  				while (--i > -1) {
  					if (a[i]._gc || (onlyActive && !a[i].isActive())) {
  						a.splice(i, 1);
  					}
  				}
  			}
  			return a || [];
  		};

  		TweenLite.killTweensOf = TweenLite.killDelayedCallsTo = function(target, onlyActive, vars) {
  			if (typeof(onlyActive) === "object") {
  				vars = onlyActive; //for backwards compatibility (before "onlyActive" parameter was inserted)
  				onlyActive = false;
  			}
  			var a = TweenLite.getTweensOf(target, onlyActive),
  				i = a.length;
  			while (--i > -1) {
  				a[i]._kill(vars, target);
  			}
  		};



  /*
   * ----------------------------------------------------------------
   * TweenPlugin   (could easily be split out as a separate file/class, but included for ease of use (so that people don't need to include another script call before loading plugins which is easy to forget)
   * ----------------------------------------------------------------
   */
  		var TweenPlugin = _class("plugins.TweenPlugin", function(props, priority) {
  					this._overwriteProps = (props || "").split(",");
  					this._propName = this._overwriteProps[0];
  					this._priority = priority || 0;
  					this._super = TweenPlugin.prototype;
  				}, true);

  		p = TweenPlugin.prototype;
  		TweenPlugin.version = "1.19.0";
  		TweenPlugin.API = 2;
  		p._firstPT = null;
  		p._addTween = _addPropTween;
  		p.setRatio = _setRatio;

  		p._kill = function(lookup) {
  			var a = this._overwriteProps,
  				pt = this._firstPT,
  				i;
  			if (lookup[this._propName] != null) {
  				this._overwriteProps = [];
  			} else {
  				i = a.length;
  				while (--i > -1) {
  					if (lookup[a[i]] != null) {
  						a.splice(i, 1);
  					}
  				}
  			}
  			while (pt) {
  				if (lookup[pt.n] != null) {
  					if (pt._next) {
  						pt._next._prev = pt._prev;
  					}
  					if (pt._prev) {
  						pt._prev._next = pt._next;
  						pt._prev = null;
  					} else if (this._firstPT === pt) {
  						this._firstPT = pt._next;
  					}
  				}
  				pt = pt._next;
  			}
  			return false;
  		};

  		p._mod = p._roundProps = function(lookup) {
  			var pt = this._firstPT,
  				val;
  			while (pt) {
  				val = lookup[this._propName] || (pt.n != null && lookup[ pt.n.split(this._propName + "_").join("") ]);
  				if (val && typeof(val) === "function") { //some properties that are very plugin-specific add a prefix named after the _propName plus an underscore, so we need to ignore that extra stuff here.
  					if (pt.f === 2) {
  						pt.t._applyPT.m = val;
  					} else {
  						pt.m = val;
  					}
  				}
  				pt = pt._next;
  			}
  		};

  		TweenLite._onPluginEvent = function(type, tween) {
  			var pt = tween._firstPT,
  				changed, pt2, first, last, next;
  			if (type === "_onInitAllProps") {
  				//sorts the PropTween linked list in order of priority because some plugins need to render earlier/later than others, like MotionBlurPlugin applies its effects after all x/y/alpha tweens have rendered on each frame.
  				while (pt) {
  					next = pt._next;
  					pt2 = first;
  					while (pt2 && pt2.pr > pt.pr) {
  						pt2 = pt2._next;
  					}
  					if ((pt._prev = pt2 ? pt2._prev : last)) {
  						pt._prev._next = pt;
  					} else {
  						first = pt;
  					}
  					if ((pt._next = pt2)) {
  						pt2._prev = pt;
  					} else {
  						last = pt;
  					}
  					pt = next;
  				}
  				pt = tween._firstPT = first;
  			}
  			while (pt) {
  				if (pt.pg) if (typeof(pt.t[type]) === "function") if (pt.t[type]()) {
  					changed = true;
  				}
  				pt = pt._next;
  			}
  			return changed;
  		};

  		TweenPlugin.activate = function(plugins) {
  			var i = plugins.length;
  			while (--i > -1) {
  				if (plugins[i].API === TweenPlugin.API) {
  					_plugins[(new plugins[i]())._propName] = plugins[i];
  				}
  			}
  			return true;
  		};

  		//provides a more concise way to define plugins that have no dependencies besides TweenPlugin and TweenLite, wrapping common boilerplate stuff into one function (added in 1.9.0). You don't NEED to use this to define a plugin - the old way still works and can be useful in certain (rare) situations.
  		_gsDefine.plugin = function(config) {
  			if (!config || !config.propName || !config.init || !config.API) { throw "illegal plugin definition."; }
  			var propName = config.propName,
  				priority = config.priority || 0,
  				overwriteProps = config.overwriteProps,
  				map = {init:"_onInitTween", set:"setRatio", kill:"_kill", round:"_mod", mod:"_mod", initAll:"_onInitAllProps"},
  				Plugin = _class("plugins." + propName.charAt(0).toUpperCase() + propName.substr(1) + "Plugin",
  					function() {
  						TweenPlugin.call(this, propName, priority);
  						this._overwriteProps = overwriteProps || [];
  					}, (config.global === true)),
  				p = Plugin.prototype = new TweenPlugin(propName),
  				prop;
  			p.constructor = Plugin;
  			Plugin.API = config.API;
  			for (prop in map) {
  				if (typeof(config[prop]) === "function") {
  					p[map[prop]] = config[prop];
  				}
  			}
  			Plugin.version = config.version;
  			TweenPlugin.activate([Plugin]);
  			return Plugin;
  		};


  		//now run through all the dependencies discovered and if any are missing, log that to the console as a warning. This is why it's best to have TweenLite load last - it can check all the dependencies for you.
  		a = window._gsQueue;
  		if (a) {
  			for (i = 0; i < a.length; i++) {
  				a[i]();
  			}
  			for (p in _defLookup) {
  				if (!_defLookup[p].func) {
  					window.console.log("GSAP encountered missing dependency: " + p);
  				}
  			}
  		}

  		_tickerActive = false; //ensures that the first official animation forces a ticker.tick() to update the time when it is instantiated

  		return TweenLite;

  })(_gsScope);

  var globals = _gsScope.GreenSockGlobals;
  var nonGlobals = globals.com.greensock;
  var SimpleTimeline = nonGlobals.core.SimpleTimeline;
  var Animation = nonGlobals.core.Animation;
  var Ease = globals.Ease;
  var Linear = globals.Linear;
  var Power1 = globals.Power1;
  var Power2 = globals.Power2;
  var Power3 = globals.Power3;
  var Power4 = globals.Power4;
  var TweenPlugin = globals.TweenPlugin;
  var EventDispatcher = nonGlobals.events.EventDispatcher;

  /*!
   * VERSION: 2.1.3
   * DATE: 2019-05-17
   * UPDATES AND DOCS AT: http://greensock.com
   *
   * @license Copyright (c) 2008-2019, GreenSock. All rights reserved.
   * This work is subject to the terms at http://greensock.com/standard-license or for
   * Club GreenSock members, the software agreement that was issued with your membership.
   * 
   * @author: Jack Doyle, jack@greensock.com
   **/


  _gsScope._gsDefine("TweenMax", ["core.Animation","core.SimpleTimeline","TweenLite"], function() {

  		var _slice = function(a) { //don't use [].slice because that doesn't work in IE8 with a NodeList that's returned by querySelectorAll()
  				var b = [],
  					l = a.length,
  					i;
  				for (i = 0; i !== l; b.push(a[i++]));
  				return b;
  			},
  			_applyCycle = function(vars, targets, i) {
  				var alt = vars.cycle,
  					p, val;
  				for (p in alt) {
  					val = alt[p];
  					vars[p] = (typeof(val) === "function") ? val(i, targets[i], targets) : val[i % val.length];
  				}
  				delete vars.cycle;
  			},
  			//for distributing values across an array. Can accept a number, a function or (most commonly) a function which can contain the following properties: {base, amount, from, ease, grid, axis, length, each}. Returns a function that expects the following parameters: index, target, array. Recognizes the following
  			_distribute = function(v) {
  				if (typeof(v) === "function") {
  					return v;
  				}
  				var vars = (typeof(v) === "object") ? v : {each:v}, //n:1 is just to indicate v was a number; we leverage that later to set v according to the length we get. If a number is passed in, we treat it like the old stagger value where 0.1, for example, would mean that things would be distributed with 0.1 between each element in the array rather than a total "amount" that's chunked out among them all.
  					ease = vars.ease,
  					from = vars.from || 0,
  					base = vars.base || 0,
  					cache = {},
  					isFromKeyword = isNaN(from),
  					axis = vars.axis,
  					ratio = {center:0.5, end:1}[from] || 0;
  				return function(i, target, a) {
  					var l = (a || vars).length,
  						distances = cache[l],
  						originX, originY, x, y, d, j, max, min, wrap;
  					if (!distances) {
  						wrap = (vars.grid === "auto") ? 0 : (vars.grid || [Infinity])[0];
  						if (!wrap) {
  							max = -Infinity;
  							while (max < (max = a[wrap++].getBoundingClientRect().left) && wrap < l) { }
  							wrap--;
  						}
  						distances = cache[l] = [];
  						originX = isFromKeyword ? (Math.min(wrap, l) * ratio) - 0.5 : from % wrap;
  						originY = isFromKeyword ? l * ratio / wrap - 0.5 : (from / wrap) | 0;
  						max = 0;
  						min = Infinity;
  						for (j = 0; j < l; j++) {
  							x = (j % wrap) - originX;
  							y = originY - ((j / wrap) | 0);
  							distances[j] = d = !axis ? Math.sqrt(x * x + y * y) : Math.abs((axis === "y") ? y : x);
  							if (d > max) {
  								max = d;
  							}
  							if (d < min) {
  								min = d;
  							}
  						}
  						distances.max = max - min;
  						distances.min = min;
  						distances.v = l = vars.amount || (vars.each * (wrap > l ? l - 1 : !axis ? Math.max(wrap, l / wrap) : axis === "y" ? l / wrap : wrap)) || 0;
  						distances.b = (l < 0) ? base - l : base;
  					}
  					l = (distances[i] - distances.min) / distances.max;
  					return distances.b + (ease ? ease.getRatio(l) : l) * distances.v;
  				};
  			},
  			TweenMax = function(target, duration, vars) {
  				TweenLite.call(this, target, duration, vars);
  				this._cycle = 0;
  				this._yoyo = (this.vars.yoyo === true || !!this.vars.yoyoEase);
  				this._repeat = this.vars.repeat || 0;
  				this._repeatDelay = this.vars.repeatDelay || 0;
  				if (this._repeat) {
  					this._uncache(true); //ensures that if there is any repeat, the totalDuration will get recalculated to accurately report it.
  				}
  				this.render = TweenMax.prototype.render; //speed optimization (avoid prototype lookup on this "hot" method)
  			},
  			_tinyNum = 0.00000001,
  			TweenLiteInternals = TweenLite._internals,
  			_isSelector = TweenLiteInternals.isSelector,
  			_isArray = TweenLiteInternals.isArray,
  			p = TweenMax.prototype = TweenLite.to({}, 0.1, {}),
  			_blankArray = [];

  		TweenMax.version = "2.1.3";
  		p.constructor = TweenMax;
  		p.kill()._gc = false;
  		TweenMax.killTweensOf = TweenMax.killDelayedCallsTo = TweenLite.killTweensOf;
  		TweenMax.getTweensOf = TweenLite.getTweensOf;
  		TweenMax.lagSmoothing = TweenLite.lagSmoothing;
  		TweenMax.ticker = TweenLite.ticker;
  		TweenMax.render = TweenLite.render;
  		TweenMax.distribute = _distribute;

  		p.invalidate = function() {
  			this._yoyo = (this.vars.yoyo === true || !!this.vars.yoyoEase);
  			this._repeat = this.vars.repeat || 0;
  			this._repeatDelay = this.vars.repeatDelay || 0;
  			this._yoyoEase = null;
  			this._uncache(true);
  			return TweenLite.prototype.invalidate.call(this);
  		};

  		p.updateTo = function(vars, resetDuration) {
  			var self = this,
  				curRatio = self.ratio,
  				immediate = self.vars.immediateRender || vars.immediateRender,
  				p;
  			if (resetDuration && self._startTime < self._timeline._time) {
  				self._startTime = self._timeline._time;
  				self._uncache(false);
  				if (self._gc) {
  					self._enabled(true, false);
  				} else {
  					self._timeline.insert(self, self._startTime - self._delay); //ensures that any necessary re-sequencing of Animations in the timeline occurs to make sure the rendering order is correct.
  				}
  			}
  			for (p in vars) {
  				self.vars[p] = vars[p];
  			}
  			if (self._initted || immediate) {
  				if (resetDuration) {
  					self._initted = false;
  					if (immediate) {
  						self.render(0, true, true);
  					}
  				} else {
  					if (self._gc) {
  						self._enabled(true, false);
  					}
  					if (self._notifyPluginsOfEnabled && self._firstPT) {
  						TweenLite._onPluginEvent("_onDisable", self); //in case a plugin like MotionBlur must perform some cleanup tasks
  					}
  					if (self._time / self._duration > 0.998) { //if the tween has finished (or come extremely close to finishing), we just need to rewind it to 0 and then render it again at the end which forces it to re-initialize (parsing the new vars). We allow tweens that are close to finishing (but haven't quite finished) to work this way too because otherwise, the values are so small when determining where to project the starting values that binary math issues creep in and can make the tween appear to render incorrectly when run backwards.
  						var prevTime = self._totalTime;
  						self.render(0, true, false);
  						self._initted = false;
  						self.render(prevTime, true, false);
  					} else {
  						self._initted = false;
  						self._init();
  						if (self._time > 0 || immediate) {
  							var inv = 1 / (1 - curRatio),
  								pt = self._firstPT, endValue;
  							while (pt) {
  								endValue = pt.s + pt.c;
  								pt.c *= inv;
  								pt.s = endValue - pt.c;
  								pt = pt._next;
  							}
  						}
  					}
  				}
  			}
  			return self;
  		};

  		p.render = function(time, suppressEvents, force) {
  			if (!this._initted) if (this._duration === 0 && this.vars.repeat) { //zero duration tweens that render immediately have render() called from TweenLite's constructor, before TweenMax's constructor has finished setting _repeat, _repeatDelay, and _yoyo which are critical in determining totalDuration() so we need to call invalidate() which is a low-kb way to get those set properly.
  				this.invalidate();
  			}
  			var self = this,
  				totalDur = (!self._dirty) ? self._totalDuration : self.totalDuration(),
  				prevTime = self._time,
  				prevTotalTime = self._totalTime,
  				prevCycle = self._cycle,
  				duration = self._duration,
  				prevRawPrevTime = self._rawPrevTime,
  				isComplete, callback, pt, cycleDuration, r, type, pow, rawPrevTime, yoyoEase;
  			if (time >= totalDur - _tinyNum && time >= 0) { //to work around occasional floating point math artifacts.
  				self._totalTime = totalDur;
  				self._cycle = self._repeat;
  				if (self._yoyo && (self._cycle & 1) !== 0) {
  					self._time = 0;
  					self.ratio = self._ease._calcEnd ? self._ease.getRatio(0) : 0;
  				} else {
  					self._time = duration;
  					self.ratio = self._ease._calcEnd ? self._ease.getRatio(1) : 1;
  				}
  				if (!self._reversed) {
  					isComplete = true;
  					callback = "onComplete";
  					force = (force || self._timeline.autoRemoveChildren); //otherwise, if the animation is unpaused/activated after it's already finished, it doesn't get removed from the parent timeline.
  				}
  				if (duration === 0) if (self._initted || !self.vars.lazy || force) { //zero-duration tweens are tricky because we must discern the momentum/direction of time in order to determine whether the starting values should be rendered or the ending values. If the "playhead" of its timeline goes past the zero-duration tween in the forward direction or lands directly on it, the end values should be rendered, but if the timeline's "playhead" moves past it in the backward direction (from a postitive time to a negative time), the starting values must be rendered.
  					if (self._startTime === self._timeline._duration) { //if a zero-duration tween is at the VERY end of a timeline and that timeline renders at its end, it will typically add a tiny bit of cushion to the render time to prevent rounding errors from getting in the way of tweens rendering their VERY end. If we then reverse() that timeline, the zero-duration tween will trigger its onReverseComplete even though technically the playhead didn't pass over it again. It's a very specific edge case we must accommodate.
  						time = 0;
  					}
  					if (prevRawPrevTime < 0 || (time <= 0 && time >= -_tinyNum) || (prevRawPrevTime === _tinyNum && self.data !== "isPause")) if (prevRawPrevTime !== time) { //note: when this.data is "isPause", it's a callback added by addPause() on a timeline that we should not be triggered when LEAVING its exact start time. In other words, tl.addPause(1).play(1) shouldn't pause.
  						force = true;
  						if (prevRawPrevTime > _tinyNum) {
  							callback = "onReverseComplete";
  						}
  					}
  					self._rawPrevTime = rawPrevTime = (!suppressEvents || time || prevRawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
  				}

  			} else if (time < _tinyNum) { //to work around occasional floating point math artifacts, round super small values to 0.
  				self._totalTime = self._time = self._cycle = 0;
  				self.ratio = self._ease._calcEnd ? self._ease.getRatio(0) : 0;
  				if (prevTotalTime !== 0 || (duration === 0 && prevRawPrevTime > 0)) {
  					callback = "onReverseComplete";
  					isComplete = self._reversed;
  				}
  				if (time > -_tinyNum) {
  					time = 0;
  				} else if (time < 0) {
  					self._active = false;
  					if (duration === 0) if (self._initted || !self.vars.lazy || force) { //zero-duration tweens are tricky because we must discern the momentum/direction of time in order to determine whether the starting values should be rendered or the ending values. If the "playhead" of its timeline goes past the zero-duration tween in the forward direction or lands directly on it, the end values should be rendered, but if the timeline's "playhead" moves past it in the backward direction (from a postitive time to a negative time), the starting values must be rendered.
  						if (prevRawPrevTime >= 0) {
  							force = true;
  						}
  						self._rawPrevTime = rawPrevTime = (!suppressEvents || time || prevRawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
  					}
  				}
  				if (!self._initted) { //if we render the very beginning (time == 0) of a fromTo(), we must force the render (normal tweens wouldn't need to render at a time of 0 when the prevTime was also 0). This is also mandatory to make sure overwriting kicks in immediately.
  					force = true;
  				}
  			} else {
  				self._totalTime = self._time = time;
  				if (self._repeat !== 0) {
  					cycleDuration = duration + self._repeatDelay;
  					self._cycle = (self._totalTime / cycleDuration) >> 0; //originally _totalTime % cycleDuration but floating point errors caused problems, so I normalized it. (4 % 0.8 should be 0 but some browsers report it as 0.79999999!)
  					if (self._cycle !== 0) if (self._cycle === self._totalTime / cycleDuration && prevTotalTime <= time) {
  						self._cycle--; //otherwise when rendered exactly at the end time, it will act as though it is repeating (at the beginning)
  					}
  					self._time = self._totalTime - (self._cycle * cycleDuration);
  					if (self._yoyo) if ((self._cycle & 1) !== 0) {
  						self._time = duration - self._time;
  						yoyoEase = self._yoyoEase || self.vars.yoyoEase; //note: we don't set this._yoyoEase in _init() like we do other properties because it's TweenMax-specific and doing it here allows us to optimize performance (most tweens don't have a yoyoEase). Note that we also must skip the this.ratio calculation further down right after we _init() in this function, because we're doing it here.
  						if (yoyoEase) {
  							if (!self._yoyoEase) {
  								if (yoyoEase === true && !self._initted) { //if it's not initted and yoyoEase is true, this._ease won't have been populated yet so we must discern it here.
  									yoyoEase = self.vars.ease;
  									self._yoyoEase = yoyoEase = !yoyoEase ? TweenLite.defaultEase : (yoyoEase instanceof Ease) ? yoyoEase : (typeof(yoyoEase) === "function") ? new Ease(yoyoEase, self.vars.easeParams) : Ease.map[yoyoEase] || TweenLite.defaultEase;
  								} else {
  									self._yoyoEase = yoyoEase = (yoyoEase === true) ? self._ease : (yoyoEase instanceof Ease) ? yoyoEase : Ease.map[yoyoEase];
  								}
  							}
  							self.ratio = yoyoEase ? 1 - yoyoEase.getRatio((duration - self._time) / duration) : 0;
  						}
  					}
  					if (self._time > duration) {
  						self._time = duration;
  					} else if (self._time < 0) {
  						self._time = 0;
  					}
  				}
  				if (self._easeType && !yoyoEase) {
  					r = self._time / duration;
  					type = self._easeType;
  					pow = self._easePower;
  					if (type === 1 || (type === 3 && r >= 0.5)) {
  						r = 1 - r;
  					}
  					if (type === 3) {
  						r *= 2;
  					}
  					if (pow === 1) {
  						r *= r;
  					} else if (pow === 2) {
  						r *= r * r;
  					} else if (pow === 3) {
  						r *= r * r * r;
  					} else if (pow === 4) {
  						r *= r * r * r * r;
  					}
  					self.ratio = (type === 1) ? 1 - r : (type === 2) ? r : (self._time / duration < 0.5) ? r / 2 : 1 - (r / 2);

  				} else if (!yoyoEase) {
  					self.ratio = self._ease.getRatio(self._time / duration);
  				}

  			}

  			if (prevTime === self._time && !force && prevCycle === self._cycle) {
  				if (prevTotalTime !== self._totalTime) if (self._onUpdate) if (!suppressEvents) { //so that onUpdate fires even during the repeatDelay - as long as the totalTime changed, we should trigger onUpdate.
  					self._callback("onUpdate");
  				}
  				return;
  			} else if (!self._initted) {
  				self._init();
  				if (!self._initted || self._gc) { //immediateRender tweens typically won't initialize until the playhead advances (_time is greater than 0) in order to ensure that overwriting occurs properly. Also, if all of the tweening properties have been overwritten (which would cause _gc to be true, as set in _init()), we shouldn't continue otherwise an onStart callback could be called for example.
  					return;
  				} else if (!force && self._firstPT && ((self.vars.lazy !== false && self._duration) || (self.vars.lazy && !self._duration))) { //we stick it in the queue for rendering at the very end of the tick - this is a performance optimization because browsers invalidate styles and force a recalculation if you read, write, and then read style data (so it's better to read/read/read/write/write/write than read/write/read/write/read/write). The down side, of course, is that usually you WANT things to render immediately because you may have code running right after that which depends on the change. Like imagine running TweenLite.set(...) and then immediately after that, creating a nother tween that animates the same property to another value; the starting values of that 2nd tween wouldn't be accurate if lazy is true.
  					self._time = prevTime;
  					self._totalTime = prevTotalTime;
  					self._rawPrevTime = prevRawPrevTime;
  					self._cycle = prevCycle;
  					TweenLiteInternals.lazyTweens.push(self);
  					self._lazy = [time, suppressEvents];
  					return;
  				}
  				//_ease is initially set to defaultEase, so now that init() has run, _ease is set properly and we need to recalculate the ratio. Overall this is faster than using conditional logic earlier in the method to avoid having to set ratio twice because we only init() once but renderTime() gets called VERY frequently.
  				if (self._time && !isComplete && !yoyoEase) {
  					self.ratio = self._ease.getRatio(self._time / duration);
  				} else if (isComplete && this._ease._calcEnd && !yoyoEase) {
  					self.ratio = self._ease.getRatio((self._time === 0) ? 0 : 1);
  				}
  			}
  			if (self._lazy !== false) {
  				self._lazy = false;
  			}

  			if (!self._active) if (!self._paused && self._time !== prevTime && time >= 0) {
  				self._active = true; //so that if the user renders a tween (as opposed to the timeline rendering it), the timeline is forced to re-render and align it with the proper time/frame on the next rendering cycle. Maybe the tween already finished but the user manually re-renders it as halfway done.
  			}
  			if (prevTotalTime === 0) {
  				if (self._initted === 2 && time > 0) {
  					self._init(); //will just apply overwriting since _initted of (2) means it was a from() tween that had immediateRender:true
  				}
  				if (self._startAt) {
  					if (time >= 0) {
  						self._startAt.render(time, true, force);
  					} else if (!callback) {
  						callback = "_dummyGS"; //if no callback is defined, use a dummy value just so that the condition at the end evaluates as true because _startAt should render AFTER the normal render loop when the time is negative. We could handle this in a more intuitive way, of course, but the render loop is the MOST important thing to optimize, so this technique allows us to avoid adding extra conditional logic in a high-frequency area.
  					}
  				}
  				if (self.vars.onStart) if (self._totalTime !== 0 || duration === 0) if (!suppressEvents) {
  					self._callback("onStart");
  				}
  			}

  			pt = self._firstPT;
  			while (pt) {
  				if (pt.f) {
  					pt.t[pt.p](pt.c * self.ratio + pt.s);
  				} else {
  					pt.t[pt.p] = pt.c * self.ratio + pt.s;
  				}
  				pt = pt._next;
  			}

  			if (self._onUpdate) {
  				if (time < 0) if (self._startAt && self._startTime) { //if the tween is positioned at the VERY beginning (_startTime 0) of its parent timeline, it's illegal for the playhead to go back further, so we should not render the recorded startAt values.
  					self._startAt.render(time, true, force); //note: for performance reasons, we tuck this conditional logic inside less traveled areas (most tweens don't have an onUpdate). We'd just have it at the end before the onComplete, but the values should be updated before any onUpdate is called, so we ALSO put it here and then if it's not called, we do so later near the onComplete.
  				}
  				if (!suppressEvents) if (self._totalTime !== prevTotalTime || callback) {
  					self._callback("onUpdate");
  				}
  			}
  			if (self._cycle !== prevCycle) if (!suppressEvents) if (!self._gc) if (self.vars.onRepeat) {
  				self._callback("onRepeat");
  			}
  			if (callback) if (!self._gc || force) { //check gc because there's a chance that kill() could be called in an onUpdate
  				if (time < 0 && self._startAt && !self._onUpdate && self._startTime) { //if the tween is positioned at the VERY beginning (_startTime 0) of its parent timeline, it's illegal for the playhead to go back further, so we should not render the recorded startAt values.
  					self._startAt.render(time, true, force);
  				}
  				if (isComplete) {
  					if (self._timeline.autoRemoveChildren) {
  						self._enabled(false, false);
  					}
  					self._active = false;
  				}
  				if (!suppressEvents && self.vars[callback]) {
  					self._callback(callback);
  				}
  				if (duration === 0 && self._rawPrevTime === _tinyNum && rawPrevTime !== _tinyNum) { //the onComplete or onReverseComplete could trigger movement of the playhead and for zero-duration tweens (which must discern direction) that land directly back on their start time, we don't want to fire again on the next render. Think of several addPause()'s in a timeline that forces the playhead to a certain spot, but what if it's already paused and another tween is tweening the "time" of the timeline? Each time it moves [forward] past that spot, it would move back, and since suppressEvents is true, it'd reset _rawPrevTime to _tinyNum so that when it begins again, the callback would fire (so ultimately it could bounce back and forth during that tween). Again, this is a very uncommon scenario, but possible nonetheless.
  					self._rawPrevTime = 0;
  				}
  			}
  		};

  //---- STATIC FUNCTIONS -----------------------------------------------------------------------------------------------------------

  		TweenMax.to = function(target, duration, vars) {
  			return new TweenMax(target, duration, vars);
  		};

  		TweenMax.from = function(target, duration, vars) {
  			vars.runBackwards = true;
  			vars.immediateRender = (vars.immediateRender != false);
  			return new TweenMax(target, duration, vars);
  		};

  		TweenMax.fromTo = function(target, duration, fromVars, toVars) {
  			toVars.startAt = fromVars;
  			toVars.immediateRender = (toVars.immediateRender != false && fromVars.immediateRender != false);
  			return new TweenMax(target, duration, toVars);
  		};

  		TweenMax.staggerTo = TweenMax.allTo = function(targets, duration, vars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope) {
  			var a = [],
  				staggerFunc = _distribute(vars.stagger || stagger),
  				cycle = vars.cycle,
  				fromCycle = (vars.startAt || _blankArray).cycle,
  				l, copy, i, p;
  			if (!_isArray(targets)) {
  				if (typeof(targets) === "string") {
  					targets = TweenLite.selector(targets) || targets;
  				}
  				if (_isSelector(targets)) {
  					targets = _slice(targets);
  				}
  			}
  			targets = targets || [];
  			l = targets.length - 1;
  			for (i = 0; i <= l; i++) {
  				copy = {};
  				for (p in vars) {
  					copy[p] = vars[p];
  				}
  				if (cycle) {
  					_applyCycle(copy, targets, i);
  					if (copy.duration != null) {
  						duration = copy.duration;
  						delete copy.duration;
  					}
  				}
  				if (fromCycle) {
  					fromCycle = copy.startAt = {};
  					for (p in vars.startAt) {
  						fromCycle[p] = vars.startAt[p];
  					}
  					_applyCycle(copy.startAt, targets, i);
  				}
  				copy.delay = staggerFunc(i, targets[i], targets) + (copy.delay || 0);
  				if (i === l && onCompleteAll) {
  					copy.onComplete = function() {
  						if (vars.onComplete) {
  							vars.onComplete.apply(vars.onCompleteScope || this, arguments);
  						}
  						onCompleteAll.apply(onCompleteAllScope || vars.callbackScope || this, onCompleteAllParams || _blankArray);
  					};
  				}
  				a[i] = new TweenMax(targets[i], duration, copy);
  			}
  			return a;
  		};

  		TweenMax.staggerFrom = TweenMax.allFrom = function(targets, duration, vars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope) {
  			vars.runBackwards = true;
  			vars.immediateRender = (vars.immediateRender != false);
  			return TweenMax.staggerTo(targets, duration, vars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope);
  		};

  		TweenMax.staggerFromTo = TweenMax.allFromTo = function(targets, duration, fromVars, toVars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope) {
  			toVars.startAt = fromVars;
  			toVars.immediateRender = (toVars.immediateRender != false && fromVars.immediateRender != false);
  			return TweenMax.staggerTo(targets, duration, toVars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope);
  		};

  		TweenMax.delayedCall = function(delay, callback, params, scope, useFrames) {
  			return new TweenMax(callback, 0, {delay:delay, onComplete:callback, onCompleteParams:params, callbackScope:scope, onReverseComplete:callback, onReverseCompleteParams:params, immediateRender:false, useFrames:useFrames, overwrite:0});
  		};

  		TweenMax.set = function(target, vars) {
  			return new TweenMax(target, 0, vars);
  		};

  		TweenMax.isTweening = function(target) {
  			return (TweenLite.getTweensOf(target, true).length > 0);
  		};

  		var _getChildrenOf = function(timeline, includeTimelines) {
  				var a = [],
  					cnt = 0,
  					tween = timeline._first;
  				while (tween) {
  					if (tween instanceof TweenLite) {
  						a[cnt++] = tween;
  					} else {
  						if (includeTimelines) {
  							a[cnt++] = tween;
  						}
  						a = a.concat(_getChildrenOf(tween, includeTimelines));
  						cnt = a.length;
  					}
  					tween = tween._next;
  				}
  				return a;
  			},
  			getAllTweens = TweenMax.getAllTweens = function(includeTimelines) {
  				return _getChildrenOf(Animation._rootTimeline, includeTimelines).concat( _getChildrenOf(Animation._rootFramesTimeline, includeTimelines) );
  			};

  		TweenMax.killAll = function(complete, tweens, delayedCalls, timelines) {
  			if (tweens == null) {
  				tweens = true;
  			}
  			if (delayedCalls == null) {
  				delayedCalls = true;
  			}
  			var a = getAllTweens((timelines != false)),
  				l = a.length,
  				allTrue = (tweens && delayedCalls && timelines),
  				isDC, tween, i;
  			for (i = 0; i < l; i++) {
  				tween = a[i];
  				if (allTrue || (tween instanceof SimpleTimeline) || ((isDC = (tween.target === tween.vars.onComplete)) && delayedCalls) || (tweens && !isDC)) {
  					if (complete) {
  						tween.totalTime(tween._reversed ? 0 : tween.totalDuration());
  					} else {
  						tween._enabled(false, false);
  					}
  				}
  			}
  		};

  		TweenMax.killChildTweensOf = function(parent, complete) {
  			if (parent == null) {
  				return;
  			}
  			var tl = TweenLiteInternals.tweenLookup,
  				a, curParent, p, i, l;
  			if (typeof(parent) === "string") {
  				parent = TweenLite.selector(parent) || parent;
  			}
  			if (_isSelector(parent)) {
  				parent = _slice(parent);
  			}
  			if (_isArray(parent)) {
  				i = parent.length;
  				while (--i > -1) {
  					TweenMax.killChildTweensOf(parent[i], complete);
  				}
  				return;
  			}
  			a = [];
  			for (p in tl) {
  				curParent = tl[p].target.parentNode;
  				while (curParent) {
  					if (curParent === parent) {
  						a = a.concat(tl[p].tweens);
  					}
  					curParent = curParent.parentNode;
  				}
  			}
  			l = a.length;
  			for (i = 0; i < l; i++) {
  				if (complete) {
  					a[i].totalTime(a[i].totalDuration());
  				}
  				a[i]._enabled(false, false);
  			}
  		};

  		var _changePause = function(pause, tweens, delayedCalls, timelines) {
  			tweens = (tweens !== false);
  			delayedCalls = (delayedCalls !== false);
  			timelines = (timelines !== false);
  			var a = getAllTweens(timelines),
  				allTrue = (tweens && delayedCalls && timelines),
  				i = a.length,
  				isDC, tween;
  			while (--i > -1) {
  				tween = a[i];
  				if (allTrue || (tween instanceof SimpleTimeline) || ((isDC = (tween.target === tween.vars.onComplete)) && delayedCalls) || (tweens && !isDC)) {
  					tween.paused(pause);
  				}
  			}
  		};

  		TweenMax.pauseAll = function(tweens, delayedCalls, timelines) {
  			_changePause(true, tweens, delayedCalls, timelines);
  		};

  		TweenMax.resumeAll = function(tweens, delayedCalls, timelines) {
  			_changePause(false, tweens, delayedCalls, timelines);
  		};

  		TweenMax.globalTimeScale = function(value) {
  			var tl = Animation._rootTimeline,
  				t = TweenLite.ticker.time;
  			if (!arguments.length) {
  				return tl._timeScale;
  			}
  			value = value || _tinyNum; //can't allow zero because it'll throw the math off
  			tl._startTime = t - ((t - tl._startTime) * tl._timeScale / value);
  			tl = Animation._rootFramesTimeline;
  			t = TweenLite.ticker.frame;
  			tl._startTime = t - ((t - tl._startTime) * tl._timeScale / value);
  			tl._timeScale = Animation._rootTimeline._timeScale = value;
  			return value;
  		};


  //---- GETTERS / SETTERS ----------------------------------------------------------------------------------------------------------

  		p.progress = function(value, suppressEvents) {
  			return (!arguments.length) ? (this.duration() ? this._time / this._duration : this.ratio) : this.totalTime( this.duration() * ((this._yoyo && (this._cycle & 1) !== 0) ? 1 - value : value) + (this._cycle * (this._duration + this._repeatDelay)), suppressEvents);
  		};

  		p.totalProgress = function(value, suppressEvents) {
  			return (!arguments.length) ? this._totalTime / this.totalDuration() : this.totalTime( this.totalDuration() * value, suppressEvents);
  		};

  		p.time = function(value, suppressEvents) {
  			if (!arguments.length) {
  				return this._time;
  			}
  			if (this._dirty) {
  				this.totalDuration();
  			}
  			var duration = this._duration,
  				cycle = this._cycle,
  				cycleDur = cycle * (duration + this._repeatDelay);
  			if (value > duration) {
  				value = duration;
  			}
  			return this.totalTime((this._yoyo && (cycle & 1)) ? duration - value + cycleDur : this._repeat ? value + cycleDur : value, suppressEvents);
  		};

  		p.duration = function(value) {
  			if (!arguments.length) {
  				return this._duration; //don't set _dirty = false because there could be repeats that haven't been factored into the _totalDuration yet. Otherwise, if you create a repeated TweenMax and then immediately check its duration(), it would cache the value and the totalDuration would not be correct, thus repeats wouldn't take effect.
  			}
  			return Animation.prototype.duration.call(this, value);
  		};

  		p.totalDuration = function(value) {
  			if (!arguments.length) {
  				if (this._dirty) {
  					//instead of Infinity, we use 999999999999 so that we can accommodate reverses
  					this._totalDuration = (this._repeat === -1) ? 999999999999 : this._duration * (this._repeat + 1) + (this._repeatDelay * this._repeat);
  					this._dirty = false;
  				}
  				return this._totalDuration;
  			}
  			return (this._repeat === -1) ? this : this.duration( (value - (this._repeat * this._repeatDelay)) / (this._repeat + 1) );
  		};

  		p.repeat = function(value) {
  			if (!arguments.length) {
  				return this._repeat;
  			}
  			this._repeat = value;
  			return this._uncache(true);
  		};

  		p.repeatDelay = function(value) {
  			if (!arguments.length) {
  				return this._repeatDelay;
  			}
  			this._repeatDelay = value;
  			return this._uncache(true);
  		};

  		p.yoyo = function(value) {
  			if (!arguments.length) {
  				return this._yoyo;
  			}
  			this._yoyo = value;
  			return this;
  		};


  		return TweenMax;

  	}, true);

  var TweenMax = globals.TweenMax;

  var pluginFacePointer = {
    models: 'weboji',
    enabled: false,

    tags: ['browser'],

    // The pointer element
    $pointer: null,

    // Pointers position
    pointer: { x: -20, y: -20 },

    // Used to smoothen out the pointer
    tween: {
      x: 0,
      y: 0,
      positionList: []
    },

    config: {
      // Used to offset the pointer, like when the webcam is not in front of you
      offset: {
        // Nudge the pointer by this amount
        x: 0,
        y: 0,
        // Calibrate the head (in degrees)
        pitch: -15,
        yaw: -12,
        roll: 0
      },

      // Sets how senstive the pointer is
      speed: {
        x: 1,
        y: 1
      }
    },

    onEnable () {
      if (!this.$pointer) {
        const $pointer = document.createElement('div');
        $pointer.classList.add('handsfree-pointer', 'handsfree-pointer-face', 'handsfree-hide-when-started-without-weboji');
        document.body.appendChild($pointer);
        this.$pointer = $pointer;
      }

      this.$pointer?.classList.remove('handsfree-hidden');
    },

    onFrame ({weboji}) {
      // Get X/Y as if looking straight aweboji
      let x = weboji.translation[0] * window.outerWidth;
      let y = window.outerHeight - weboji.translation[1] * window.outerHeight;
      let z = (1 - weboji.translation[2]) * window.outerWidth * 2.5;

      // Add pitch/yaw
      x +=
        z *
        Math.tan(weboji.rotation[1] + (this.config.offset.yaw * Math.PI) / 180) *
        this.config.speed.x;

      y +=
        z *
          Math.tan(
            weboji.rotation[0] + (this.config.offset.pitch * Math.PI) / 180
          ) *
          this.config.speed.y -
        window.outerHeight;

      // Add offsets
      x += this.config.offset.x;
      y += this.config.offset.y;

      // @todo Make the sensitivity variable
      this.handsfree.TweenMax.to(this.tween, 1, {
        x,
        y,
        overwrite: true,
        ease: 'linear.easeNone',
        immediateRender: true
      });

      this.$pointer.style.left = `${this.tween.x}px`;
      this.$pointer.style.top = `${this.tween.y}px`;
      weboji.pointer = {
        x: this.tween.x,
        y: this.tween.y
      };
    },

    /**
     * Toggle pointer
     */
    onDisable () {
      this.$pointer?.classList.add('handsfree-hidden');
    }
  };

  /**
   * Click on things with a gesture
   */
  var pluginFaceClick = {
    models: 'weboji',
    enabled: false,

    tags: ['browser'],

    config: {
      // How often in milliseconds to trigger clicks
      throttle: 50,

      // Max number of frames to keep down
      maxMouseDownedFrames: 1,

      // Morphs to watch for and their required confidences
      morphs: {
        0: 0.25,
        1: 0.25
      }
    },

    // Number of frames mouse has been downed
    mouseDowned: 0,
    // Is the mouse up?
    mouseUp: false,
    // Whether one of the morph confidences have been met
    thresholdMet: false,

    onUse () {
      this.throttle(this.config.throttle);
    },

    /**
     * Maps .maybeClick to a new throttled function
     */
    throttle (throttle) {
      this.maybeClick = this.handsfree.throttle(
        function (weboji) {
          this.click(weboji);
        },
        throttle,
        { trailing: false }
      );
    },

    /**
     * Detect click state and trigger a real click event
     */
    onFrame ({weboji}) {
      // Detect if the threshold for clicking is met with specific morphs
      this.thresholdMet = false;
      Object.keys(this.config.morphs).forEach((key) => {
        const morph = +this.config.morphs[key];
        if (morph > 0 && weboji.morphs[key] >= morph) this.thresholdMet = true;
      });

      // Click/release and add body classes
      if (this.thresholdMet) {
        this.mouseDowned++;
        document.body.classList.add('handsfree-clicked');
      } else {
        this.mouseUp = this.mouseDowned;
        this.mouseDowned = 0;
        document.body.classList.remove('handsfree-clicked');
      }

      // Set the state
      if (
        this.mouseDowned > 0 &&
        this.mouseDowned <= this.config.maxMouseDownedFrames
      )
        weboji.pointer.state = 'mouseDown';
      else if (this.mouseDowned > this.config.maxMouseDownedFrames)
        weboji.pointer.state = 'mouseDrag';
      else if (this.mouseUp) weboji.pointer.state = 'mouseUp';
      else ;

      // Actually click something (or focus it)
      if (weboji.pointer.state === 'mouseDown') {
        this.maybeClick(weboji);
      }
    },

    /**
     * The actual click method, this is what gets throttled
     */
    click (weboji) {
      const $el = document.elementFromPoint(weboji.pointer.x, weboji.pointer.y);
      if ($el) {
        $el.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: weboji.pointer.x,
            clientY: weboji.pointer.y
          })
        );

        // Focus
        if (['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes($el.nodeName))
          $el.focus();

        weboji.pointer.$target = $el;
      }
    },

    /**
     * Throttles the click event
     * - Defined in onuse
     */
    maybeClick: function() {}
  };

  /**
   * Scrolls the page vertically
   */
  var pluginFaceScroll = {
    models: 'weboji',
    enabled: false,

    tags: ['browser'],

    // Number of frames the current element is the same as the last
    numFramesFocused: 0,
    // The last scrollable target focused
    $lastTarget: null,
    // The current scrollable target
    $target: null,

    config: {
      // Number of frames over the same element before activating that element
      framesToFocus: 10,

      vertScroll: {
        // The multiplier to scroll by. Lower numbers are slower
        scrollSpeed: 0.05,
        // How many pixels from the top/bottom of the scroll area to scroll
        scrollZone: 100
      }
    },

    onUse () {
      this.$target = window;
    },

    /**
     * Scroll the page when the cursor goes above/below the threshold
     */
    onFrame ({weboji}) {
      // @FIXME we shouldn't need to do this, but this is occasionally reset to {x: 0, y: 0} when running in client mode
      if (!weboji.pointer.x && !weboji.pointer.y) return

      // Check for hover
      this.checkForFocus(weboji);
      let isScrolling = false;

      // Get bounds
      let bounds;
      let scrollTop = this.getTargetScrollTop();

      if (this.$target.getBoundingClientRect) {
        bounds = this.$target.getBoundingClientRect();
      } else {
        bounds = { top: 0, bottom: window.innerHeight };
      }

      // Check on click
      if (weboji.pointer.state === 'mouseDown') {
        this.numFramesFocused = 0;
        this.maybeSetTarget(weboji);
      }

      // Scroll up
      if (weboji.pointer.y < bounds.top + this.config.vertScroll.scrollZone) {
        this.$target.scrollTo(
          0,
          scrollTop +
            (weboji.pointer.y - bounds.top - this.config.vertScroll.scrollZone) *
              this.config.vertScroll.scrollSpeed
        );

        isScrolling = true;
      }

      // Scroll down
      if (weboji.pointer.y > bounds.bottom - this.config.vertScroll.scrollZone) {
        this.$target.scrollTo(
          0,
          scrollTop -
            (bounds.bottom -
              weboji.pointer.y -
              this.config.vertScroll.scrollZone) *
              this.config.vertScroll.scrollSpeed
        );

        isScrolling = true;
      }

      isScrolling && this.maybeSelectNewTarget();
    },

    /**
     * Check that the scroll is actually happening, otherwise traverse up the DOM
     */
    maybeSelectNewTarget() {
      let curScrollTop = this.getTargetScrollTop();
      let didNotScroll = false;

      // Check if we have scrolled up
      this.$target.scrollTo(0, curScrollTop + this.config.vertScroll.scrollSpeed);
      if (curScrollTop === this.getTargetScrollTop()) {
        didNotScroll = true;
      } else {
        this.$target.scrollTo(0, curScrollTop - this.config.vertScroll.scrollSpeed);
        return
      }

      // Check if we have scrolled down
      this.$target.scrollTo(0, curScrollTop - this.config.vertScroll.scrollSpeed);
      if (curScrollTop === this.getTargetScrollTop()) {
        if (didNotScroll) {
          this.numFramesFocused = 0;

          this.selectTarget(
            this.recursivelyFindScrollbar(this.$target.parentElement)
          );
        }
      } else {
        this.$target.scrollTo(0, curScrollTop + this.config.vertScroll.scrollSpeed);
        return
      }
    },

    /**
     * Gets the scrolltop, taking account the window object
     */
    getTargetScrollTop() {
      return this.$target?.scrollY || this.$target?.scrollTop || 0
    },

    /**
     * Checks to see if we've hovered over an element for x turns
     */
    checkForFocus: throttle_1(function(weboji) {
      let $potTarget = document.elementFromPoint(
        weboji.pointer.x,
        weboji.pointer.y
      );
      if (!$potTarget) return
      $potTarget = this.recursivelyFindScrollbar($potTarget);

      if ($potTarget === this.$lastTarget) {
        ++this.numFramesFocused;
      } else {
        this.numFramesFocused = 0;
      }

      if (this.numFramesFocused > this.config.framesToFocus) {
        this.selectTarget($potTarget);
      }

      this.$lastTarget = $potTarget;
    }, 100),

    /**
     * Select and style the element
     */
    selectTarget($potTarget) {
      // Check required in case the window is the target
      if (this.$target.classList) {
        this.$target.classList.remove('handsfree-scroll-focus');
      }
      if ($potTarget && $potTarget.classList) {
        $potTarget.classList.add('handsfree-scroll-focus');
      }

      if ($potTarget.nodeName === 'HTML' || !$potTarget.nodeName) {
        $potTarget = window;
      }

      this.$target = $potTarget;
    },

    /**
     * Sets a new scroll target on click
     */
    maybeSetTarget(weboji) {
      if (weboji.pointer.state === 'mouseDown' && weboji.pointer.$target) {
        this.selectTarget(this.recursivelyFindScrollbar(weboji.pointer.$target));
      }
    },

    /**
     * Traverses up the DOM until a scrollbar is found, or until we hit the body/window
     */
    recursivelyFindScrollbar($target) {
      const styles =
        $target && $target.getBoundingClientRect ? getComputedStyle($target) : {};

      if (
        $target &&
        $target.scrollHeight > $target.clientHeight &&
        (styles.overflow === 'auto' ||
          styles.overflow === 'auto scroll' ||
          styles.overflowY === 'auto' ||
          styles.overflowY === 'auto scroll')
      ) {
        return $target
      } else {
        if ($target && $target.parentElement) {
          return this.recursivelyFindScrollbar($target.parentElement)
        } else {
          return window
        }
      }
    }
  };

  /**
   * Scrolls the page vertically by closing hand
   */
  var pluginPinchScroll = {
    models: 'hands',
    tags: ['browser'],
    enabled: false,

    // Number of frames the current element is the same as the last
    numFramesFocused: 0,
    // The current scrollable target
    $target: null,

    // The original grab point
    origScrollTop: 0,

    // The tweened scrollTop, used to smoothen out scroll
    tweenScroll: {y: 0},

    // Number of frames that has passed since the last grab
    framesSinceLastGrab: 0,

    config: {
      // Number of frames over the same element before activating that element
      framesToFocus: 10,

      // Number of pixels the middle and thumb tips must be near each other to drag
      threshold: 50,

      // Number of frames where a hold is not registered before releasing a drag
      numThresholdErrorFrames: 5,

      // Speed multiplier
      speed: 2
    },

    onUse () {
      this.$target = window;
    },

    /**
     * Scroll the page when the cursor goes above/below the threshold
     */
    onFrame ({hands}) {
      if (!hands.multiHandLandmarks) return
      const height = this.handsfree.debug.$canvas.hands.height;
      
      // Detect if the threshold for clicking is met with specific morphs
      const a = hands.multiHandLandmarks[0][4].x - hands.multiHandLandmarks[0][8].x;
      const b = hands.multiHandLandmarks[0][4].y - hands.multiHandLandmarks[0][8].y;
      const c = Math.sqrt(a*a + b*b) * height;
      this.thresholdMet = c < this.config.threshold;

      // Set the original grab point
      if (this.thresholdMet) {
        if (this.framesSinceLastGrab > this.config.numThresholdErrorFrames) {
          this.origScrollTop = this.getTargetScrollTop() + hands.multiHandLandmarks[0][4].y * height * this.config.speed;
          this.handsfree.TweenMax.killTweensOf(this.tweenScroll);
        }
        this.framesSinceLastGrab = 0;
      }
      ++this.framesSinceLastGrab;
      
      // Scroll
      if (this.framesSinceLastGrab < this.config.numThresholdErrorFrames) {
        this.handsfree.TweenMax.to(this.tweenScroll, 1, {
          y: this.origScrollTop - hands.multiHandLandmarks[0][4].y * height * this.config.speed,
          overwrite: true,
          ease: 'linear.easeNone',
          immediateRender: true  
        });
        
        this.$target.scrollTo(0, this.tweenScroll.y);
      }
    },

    /**
     * Gets the scrolltop, taking account the window object
     */
    getTargetScrollTop () {
      return this.$target.scrollY || this.$target.scrollTop || 0
    }
  };

  /*
            ✨
            (\.   \      ,/)
              \(   |\     )/
              //\  | \   /\\
            (/ /\_#oo#_/\ \)
              \/\  ####  /\/
                  \`##'


            🧙‍♂️ Presenting 🧙‍♀️

                Handsfree.js
                  8.1.0

    Docs:       https://handsfree.js.org
    Repo:       https://github.com/midiblocks/handsfree
    Discord:    https://discord.gg/snbB62DUT9
    Newsletter: http://eepurl.com/hhD7S1

    


    /////////////////////////////////////////////////////////////
    ///////////////////// Table of Contents /////////////////////
    /////////////////////////////////////////////////////////////

    Use "CTRL+F + #n" to hop around in this file
    
    #1 Setup
    #2 Loop
    #3 Plugins
    #4 Events
    #5 Helpers
    #6 Debugger

  */

  const corePlugins = {
    facePointer: pluginFacePointer,
    faceClick: pluginFaceClick,
    faceScroll: pluginFaceScroll,
    pinchScroll: pluginPinchScroll,
  };



  /////////////////////////////////////////////////////////////
  ////////////////////////// #1 SETUP /////////////////////////
  /////////////////////////////////////////////////////////////

  // Used to separate video, canvas, etc ID's
  let id = 0;

  /**
   * The Handsfree class
   */
  class Handsfree {
    /**
     * Let's do this 🖐
     * @see https://handsfree.js.org/ref/prop/config
     * 
     * @param {Object} config The initial config to use
     */
    constructor (config = {}) {
      // Helpers
      this.throttle = throttle_1;
      this.TweenMax = TweenMax;
      
      // Assign the instance ID
      this.id = ++id;
      this.version = '8.1.0';
      this.data = {};

      // Dependency management
      this.dependencies = {
        loading: [],
        loaded: []
      };
      // List of mediapipe models (by name) that are warming up
      this.mediapipeWarmups = {
        isWarmingUp: false,
        hands: false,
        pose: false,
        facemesh: false,
        holistic: false
      };

      // Plugins
      this.plugin = {};
      this.taggedPlugins = {
        untagged: []
      };
      
      // Clean config and set defaults
      this.config = this.cleanConfig(config);

      // Setup
      this.setupDebugger();
      this.prepareModels();
      this.loadCorePlugins();

      // Start tracking when all models are loaded
      this.numModelsLoaded = 0;
      this.on('modelReady', () => {
        let numActiveModels = 0;
        Object.keys(this.model).forEach(modelName => {
          this.model[modelName].enabled && ++numActiveModels;
        });
        
        if (++this.numModelsLoaded === numActiveModels) {
          document.body.classList.remove('handsfree-loading');
          document.body.classList.add('handsfree-started');

          if (!this.config.isClient) {
            this.isLooping = true;
            this.loop();
          }
        }
      });

      this.emit('init', this);
    }

    /**
     * Prepares the models
     */
    prepareModels () {
      this.model = {
        weboji: {},
        hands: {},
        facemesh: {},
        pose: {},
        holistic: {}
      };
      this.model.weboji = new WebojiModel(this, this.config.weboji);
      this.model.hands = new HandsModel(this, this.config.hands);
      this.model.pose = new PoseModel(this, this.config.pose);
      this.model.facemesh = new FacemeshModel(this, this.config.facemesh);
      this.model.holistic = new HolisticModel(this, this.config.holistic);
    }

    /**
     * Cleans and sanitizes the config, setting up defaults
     * @see https://handsfree.js.org/ref/method/cleanConfig
     * 
     * @param config {Object} The config object to use
     * @param defaults {Object} (Optional) The defaults to use.
     *    If null, then the original Handsfree.js defaults will be used
     * 
     * @returns {Object} The cleaned config
     */
    cleanConfig (config, defaults) {
      // Set default
      if (!defaults) defaults = Object.assign({}, defaultConfig);
      
      defaults.setup.wrap.$parent = document.body;

      // Map model booleans to objects
      if (typeof config.weboji === 'boolean') {
        config.weboji = {enabled: config.weboji};
      }
      if (typeof config.hands === 'boolean') {
        config.hands = {enabled: config.hands};
      }
      if (typeof config.facemesh === 'boolean') {
        config.facemesh = {enabled: config.facemesh};
      }
      if (typeof config.pose === 'boolean') {
        config.pose = {enabled: config.pose};
      }
      if (typeof config.holistic === 'boolean') {
        config.holistic = {enabled: config.holistic};
      }

      // Map plugin booleans to objects
      config.plugin && Object.keys(config.plugin).forEach(plugin => {
        if (typeof config.plugin[plugin] === 'boolean') {
          config.plugin[plugin] = {enabled: config.plugin[plugin]};
        }
      });        

      return merge_1({}, defaults, config)
    }

    /**
     * Updates the instance, loading required dependencies
     * @see https://handsfree.js.org./ref/method/update
     * 
     * @param {Object} config The changes to apply
     * @param {Function} callback Called after
     */
    update (config, callback) {
      this.config = this.cleanConfig(config, this.config)

      // Run enable/disable methods on changed models
      ;['hands', 'facemesh', 'pose', 'holistic', 'weboji'].forEach(model => {
        let wasEnabled = this.model[model].enabled;
        this.config[model].config = this.model[model].config;

        if (wasEnabled && !this.config[model].enabled) this.model[model].disable();
        else if (!wasEnabled && this.config[model].enabled) this.model[model].enable(false);
      });

      // Enable plugins
      config.plugin && Object.keys(config.plugin).forEach(plugin => {
        if (typeof config.plugin[plugin].enabled === 'boolean') {
          if (config.plugin[plugin].enabled) {
            this.plugin[plugin].enable();
          } else {
            this.plugin[plugin].disable();
          }
        }
      });
      
      // Start
      if (this.isLooping && callback) {
        callback();
      } else {
        this.start(callback);
      }
    }




    /////////////////////////////////////////////////////////////
    /////////////////////////// #2 LOOP /////////////////////////
    /////////////////////////////////////////////////////////////


    

    /**
     * Starts the trackers
     * @see https://handsfree.js.org/ref/method/start
     * 
     * @param {Function} callback The callback to run before the very first frame
     */
    start (callback) {
      // Cleans any configs since instantiation (particularly for boolean-ly set plugins)
      this.config = this.cleanConfig(this.config, this.config);
      
      // Start loading
      document.body.classList.add('handsfree-loading');
      this.emit('loading', this);

      // Call the callback once things are loaded
      callback && document.addEventListener('handsfree-modelReady', callback, {once: true});
      
      // Load dependencies
      this.numModelsLoaded = 0;
      Object.keys(this.model).forEach(modelName => {
        const model = this.model[modelName];
        
        if (model.enabled && !model.dependenciesLoaded) {
          model.loadDependencies();
        } else if (model.enabled) {
          this.emit('modelReady', model);
          this.emit(`${modelName}ModelReady`, model);
        }
      });

      // Enable initial plugins
      Object.keys(this.config.plugin).forEach(plugin => {
        if (typeof this.config.plugin?.[plugin]?.enabled === 'boolean' && this.config.plugin[plugin].enabled) {
          this.plugin[plugin].enable();
        }
      });    
    }

    /**
     * Stops tracking
     * - Currently this just stops the tracker
     * 
     * @see https://handsfree.js.org/ref/method/stop
     */
    stop () {
      location.reload();
    }

    /**
     * Pauses inference to free up resources but maintains the
     * webcam stream so that it can be unpaused instantly
     * 
     * @see https://handsfree.js.org/ref/method/pause
     */
    pause () {
      this.isLooping = false;
    }

    /**
     * Resumes the loop from an unpaused state
     * 
     * @see https://handsfree.js.org/ref/method/pause
     */
    unpause () {
      if (!this.isLooping) {
        this.isLooping = true;
        this.loop();
      }
    }

    /**
     * Called on every webcam frame
     * @see https://handsfree.js.org/ref/method/loop
     */
    loop () {
      // Get model data
      Object.keys(this.model).forEach(modelName => {
        const model = this.model[modelName];
        if (model.enabled && model.dependenciesLoaded) {
          model.getData();
        }
      });
      this.emit('data', this.data);

      // Run untagged plugins
      this.taggedPlugins.untagged?.forEach(pluginName => {
        this.plugin[pluginName].enabled && this.plugin[pluginName]?.onFrame(this.data);
      });

      // Render video behind everything else
      // - Note: Weboji uses its own camera
      if (this.isDebugging) {
        const isUsingCamera = ['hands', 'pose', 'holistic', 'facemesh'].find(model => {
          if (this.model[model].enabled) {
            return model
          }
        });

        if (isUsingCamera) {
          this.debug.context.video.drawImage(this.debug.$video, 0, 0, this.debug.$canvas.video.width, this.debug.$canvas.video.height);
        }
      }

      this.isLooping && requestAnimationFrame(() => this.isLooping && this.loop());
    }

    
    


    /////////////////////////////////////////////////////////////
    //////////////////////// #3 PLUGINS /////////////////////////
    /////////////////////////////////////////////////////////////


    


    /**
     * Adds a callback (we call it a plugin) to be called after every tracked frame
     * @see https://handsfree.js.org/ref/method/use
     *
     * @param {String} name The plugin name
     * @param {Object|Function} config The config object, or a callback to run on every fram
     * @returns {Plugin} The plugin object
     */
    use (name, config) {
      // Make sure we have an options object
      if (typeof config === 'function') {
        config = {
          onFrame: config
        };
      }

      config = merge_1({},
        {
          // Stores the plugins name for internal use
          name,
          // The model to apply this plugin to
          models: [],
          // Plugin tags for quickly turning things on/off
          tags: [],
          // Whether the plugin is enabled by default
          enabled: true,
          // A set of default config values the user can override during instanciation
          config: {},
          // (instance) => Called on every frame
          onFrame: null,
          // (instance) => Called when the plugin is first used
          onUse: null,
          // (instance) => Called when the plugin is enabled
          onEnable: null,
          // (instance) => Called when the plugin is disabled
          onDisable: null
        },
        config
      );

      // Sanitize
      if (typeof config.models === 'string') {
        config.models = [config.models];
      }

      // Setup plugin tags
      if (typeof config.tags === 'string') {
        config.tags = [config.tags];
      }
      config.tags.forEach(tag => {
        if (!this.taggedPlugins[tag]) this.taggedPlugins[tag] = [];
        this.taggedPlugins[tag].push(name);
      });
      
      // Create the plugin
      this.plugin[name] = new Plugin(config, this);
      this.plugin[name].onUse && this.plugin[name].onUse();

      // Store a reference to the plugin to simplify things
      if (config.models.length) {
        config.models.forEach(modelName => {
          this.model[modelName].plugins.push(name);
        });
      } else {
        this.taggedPlugins.untagged.push(name);
      }
    
      return this.plugin[name]
    }

    /**
     * Enable plugins by tags
     * @see https://handsfree.js.org/ref/method/enablePlugins
     * 
     * @param {string|object} tags (Optional) The plugins with tags to enable. Enables all if null
     */
    enablePlugins (tags) {
      // Sanitize
      if (typeof tags === 'string') tags = [tags];
      if (!tags) tags = Object.keys(this.taggedPlugins);

      tags.forEach(tag => {
        this.taggedPlugins[tag].forEach(pluginName => {
          this.plugin[pluginName].enable();
        });
      });
    }

    /**
     * Disable plugins by tags
     * @see https://handsfree.js.org/ref/method/disablePlugins
     * 
     * @param {string|object} tags (Optional) The plugins with tags to disable. Disables all if null
     */
    disablePlugins (tags) {
      // Sanitize
      if (typeof tags === 'string') tags = [tags];
      if (!tags) tags = Object.keys(this.taggedPlugins);

      tags.forEach(tag => {
        this.taggedPlugins[tag].forEach(pluginName => {
          this.plugin[pluginName].disable();
        });
      });
    }

    /**
     * Run plugins manually
     * @param {Object} data The data to run
     */
    runPlugins (data) {
      this.data = data;
      
      // Run model plugins
      Object.keys(this.model).forEach(name => {
        this.model[name].data = data?.[name];
        this.model[name].runPlugins();
      });
      
      // Run untagged plugins
      this.taggedPlugins.untagged?.forEach(pluginName => {
        this.plugin[pluginName].enabled && this.plugin[pluginName]?.onFrame(this.data);
      });
    }




    /////////////////////////////////////////////////////////////
    ///////////////////////// #4 EVENTS /////////////////////////
    /////////////////////////////////////////////////////////////


    


    /**
     * Triggers a document event with `handsfree-${eventName}`
     * @see https://handsfree.js.org/ref/method/emit
     * 
     * @param {String} eventName The name of the event
     * @param {*} detail (optional) Data to send with the event
     */
    emit (eventName, detail = null) {
      const event = new CustomEvent(`handsfree-${eventName}`, {detail});
      document.dispatchEvent(event);
    }

    /**
     * Calls a callback on `document` when an event is triggered
     * @see https://handsfree.js.org/ref/method/on
     *
     * @param {String} eventName The `handsfree-${eventName}` to listen to
     * @param {Function} callback The callback to call
     * @param {Object} opts The options to pass into addEventListener (eg: {once: true})
     */
    on (eventName, callback, opts) {
      document.addEventListener(`handsfree-${eventName}`, (ev) => {
        callback(ev.detail);
      }, opts);
    }



    /////////////////////////////////////////////////////////////
    //////////////////////// #5 HELPERS /////////////////////////
    /////////////////////////////////////////////////////////////



    /**
     * Helper to normalze a value within a max range
     * @see https://handsfree.js.org/ref/method/normalize
     * 
     * @param {Number} value The value to normalize
     * @param {Number} max The maximum value to normalize to, or the upper bound
     * @param {Number} min The minimum value to normalize to, or the lower bound
     */
    normalize (value, max, min = 0) {
      return (value - min) / (max - min)
    }

    /**
     * Gets the webcam media stream into handsfree.debug.$video
     * @see https://handsfree.js.org/ref/method/getUserMedia
     * 
     * @param {Object} callback The callback to call after the stream is received
     */
    getUserMedia (callback) {
      // Start getting the stream and call callback after
      if (!this.debug.stream && !this.debug.isGettingStream) {
        this.debug.isGettingStream = true;
        
        navigator.mediaDevices
          .getUserMedia({
            audio: false,
            video: {
              facingMode: 'user',
              width: this.debug.$video.width,
              height: this.debug.$video.height
            }
          })
          .then((stream) => {
            this.debug.stream = stream;
            this.debug.$video.srcObject = stream;
            this.debug.$video.onloadedmetadata = () => {
              this.debug.$video.play();
              this.emit('gotUserMedia', stream);
              callback && callback();
            };
          })
          .catch((err) => {
            console.error(`Error getting user media: ${err}`);
          })
          .finally(() => {
            this.debug.isGettingStream = false;
          });

      // If a media stream is getting gotten then run the callback once the media stream is ready
      } else if (!this.debug.stream && this.debug.isGettingStream) {
        callback && this.on('gotUserMedia', callback);
      
      // If everything is loaded then just call the callback
      } else {
        this.debug.$video.play();
        this.emit('gotUserMedia', this.debug.stream);
        callback && callback();
      }
    }

    /**
     * Loads all the core plugins (see #6)
     */
    loadCorePlugins () {
      Object.keys(corePlugins).forEach(name => {
        this.use(name, corePlugins[name]);
      });    
    }



    /////////////////////////////////////////////////////////////
    //////////////////////// #6 DEBUGGER ////////////////////////
    /////////////////////////////////////////////////////////////



    /**
     * Sets up the video and canvas elements
     */
    setupDebugger () {
      this.debug = {};
      
      // debugger wrap
      if (!this.config.setup.wrap.$el) {
        const $wrap = document.createElement('DIV');
        $wrap.classList.add('handsfree-debugger');
        this.config.setup.wrap.$el = $wrap;
      }
      this.debug.$wrap = this.config.setup.wrap.$el;

      // Create video element
      if (!this.config.setup.video.$el) {
        const $video = document.createElement('VIDEO');
        $video.setAttribute('playsinline', true);
        $video.classList.add('handsfree-video');
        $video.setAttribute('id', `handsfree-video-${this.id}`);
        this.config.setup.video.$el = $video;
      }
      this.debug.$video = this.config.setup.video.$el;
      this.debug.$video.width = this.config.setup.video.width;
      this.debug.$video.height = this.config.setup.video.height;
      this.debug.$wrap.appendChild(this.debug.$video);

      // Context 2D canvases
      this.debug.$canvas = {};
      this.debug.context = {};
      this.config.setup.canvas.video = {
        width: this.debug.$video.width,
        height: this.debug.$video.height
      }

      // The video canvas is used to display the video
      ;['video', 'weboji', 'facemesh', 'pose', 'hands', 'holistic'].forEach(model => {
        this.debug.$canvas[model] = {};
        this.debug.context[model] = {};
        
        let $canvas = this.config.setup.canvas[model].$el;
        if (!$canvas) {
          $canvas = document.createElement('CANVAS');
          this.config.setup.canvas[model].$el = $canvas;
        }
        
        // Classes
        $canvas.classList.add('handsfree-canvas', `handsfree-canvas-${model}`, `handsfree-hide-when-started-without-${model}`);
        $canvas.setAttribute('id', `handsfree-canvas-${model}-${this.id}`);

        // Dimensions
        this.debug.$canvas[model] = this.config.setup.canvas[model].$el;
        this.debug.$canvas[model].width = this.config.setup.canvas[model].width;
        this.debug.$canvas[model].height = this.config.setup.canvas[model].height;
        this.debug.$wrap.appendChild(this.debug.$canvas[model]);

        // Context
        if (model === 'weboji') ; else {
          this.debug.context[model] = this.debug.$canvas[model].getContext('2d');  
        }
      });
      
      // Append everything to the body
      this.config.setup.wrap.$parent.appendChild(this.debug.$wrap);

      // Add classes
      if (this.config.showDebug) {
        this.showDebugger();
      } else {
        this.hideDebugger();
      }
    }

    /**
     * Shows the debugger
     */
    showDebugger () {
      this.isDebugging = true;
      document.body.classList.add('handsfree-show-debug');
      document.body.classList.remove('handsfree-hide-debug');
    }

    /**
     * Hides the debugger
     */
    hideDebugger () {
      this.isDebugging = false;
      document.body.classList.remove('handsfree-show-debug');
      document.body.classList.add('handsfree-hide-debug');
    }
  }

  return Handsfree;

})));
