'use strict';

exports.__esModule = true;
exports.default = createPersistoid;

var _constants = require('./constants');

function createPersistoid(config) {
  // defaults
  var blacklist = config.blacklist || null;
  var whitelist = config.whitelist || null;
  var largeObjects = config.largeObjects || null;
  var transforms = config.transforms || [];
  var throttle = config.throttle || 0;
  var storageKey = '' + (config.keyPrefix !== undefined ? config.keyPrefix : _constants.KEY_PREFIX) + config.key;

  var storage = config.storage;

  // initialize stateful values
  var lastState = {};
  var stagedState = {};
  var keysToProcess = [];
  var timeIterator = null;
  var writePromise = null;

  var update = function update(state) {
    var includeLargeObjects = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

    // add any changed keys to the queue
    Object.keys(state).forEach(function (key) {
      var subState = state[key];
      if (!passWhitelistBlacklist(key)) return; // is keyspace ignored? noop
      if (lastState[key] === state[key]) return; // value unchanged? noop
      if (keysToProcess.indexOf(key) !== -1) return; // is key already queued? noop
      if (largeObjects.indexOf(key) !== -1 && !includeLargeObjects) return;
      keysToProcess.push(key); // add key to queue
    });

    // start the time iterator if not running (read: throttle)
    if (timeIterator === null) {
      timeIterator = setInterval(processNextKey, throttle);
    }

    lastState = state;
  };

  function processNextKey() {
    if (keysToProcess.length === 0) {
      if (timeIterator) clearInterval(timeIterator);
      timeIterator = null;
      return;
    }

    var key = keysToProcess.shift();
    var endState = transforms.reduce(function (subState, transformer) {
      return transformer.in(subState, key);
    }, lastState[key]);
    if (typeof endState !== 'undefined') stagedWrite(key, endState);
  }

  function stagedWrite(key, endState) {
    try {
      stagedState[key] = serialize(endState);
    } catch (err) {
      console.error('redux-persist/createPersistoid: error serializing state', err);
    }
    if (keysToProcess.length === 0) {
      // cleanup any removed keys just before write.
      Object.keys(stagedState).forEach(function (key) {
        if (lastState[key] === undefined) {
          delete stagedState[key];
        }
      });

      writePromise = storage.setItem(storageKey, serialize(stagedState)).catch(onWriteFail);
    }
  }

  function passWhitelistBlacklist(key) {
    if (whitelist && whitelist.indexOf(key) === -1) return false;
    if (blacklist && blacklist.indexOf(key) !== -1) return false;
    return true;
  }

  function onWriteFail(err) {
    // @TODO add fail handlers (typically storage full)
    if (err && process.env.NODE_ENV !== 'production') {
      console.error('Error storing data', err);
    }
  }

  var flush = function flush() {
    while (keysToProcess.length !== 0) {
      processNextKey();
    }
    return writePromise || Promise.resolve();
  };

  // return `persistoid`
  return {
    update: update,
    flush: flush
  };
}

// @NOTE in the future this may be exposed via config


function serialize(data) {
  return JSON.stringify(data);
}