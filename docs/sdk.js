(function (global) {
  "use strict";

  var SOURCE = "whatsapp-session-transfer";
  var TYPES = {
    ready: "CONNECTOR_READY",
    ping: "PING",
    startImport: "START_IMPORT",
    started: "IMPORT_TAB_OPENED",
    error: "IMPORT_TAB_ERROR"
  };
  var DEFAULT_TIMEOUT_MS = 1800;
  var FRAME_LOAD_TIMEOUT_MS = 5000;

  function scriptBaseUrl() {
    var script = document.currentScript;
    if (script && script.src) {
      return new URL(".", script.src).href;
    }
    return new URL("./", global.location.href).href;
  }

  var state = {
    frame: null,
    frameUrl: new URL("frame.html", scriptBaseUrl()).href,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };
  var globalListeners = {};

  function configure(options) {
    var next = options || {};
    if (next.frameUrl) {
      state.frameUrl = String(next.frameUrl);
      state.frame = null;
    }
    if (next.timeoutMs) {
      state.timeoutMs = Number(next.timeoutMs) || DEFAULT_TIMEOUT_MS;
    }
  }

  function on(eventName, handler) {
    if (!eventName || typeof handler !== "function") {
      return function () {};
    }
    globalListeners[eventName] = globalListeners[eventName] || [];
    globalListeners[eventName].push(handler);
    return function () {
      off(eventName, handler);
    };
  }

  function off(eventName, handler) {
    if (!globalListeners[eventName]) {
      return;
    }
    globalListeners[eventName] = globalListeners[eventName].filter(function (item) {
      return item !== handler;
    });
  }

  function emitGlobal(eventName, payload) {
    (globalListeners[eventName] || []).slice().forEach(function (handler) {
      try {
        handler(payload);
      } catch (error) {
        setTimeout(function () {
          throw error;
        }, 0);
      }
    });
  }

  function frameOrigin() {
    return new URL(state.frameUrl, window.location.href).origin;
  }

  function ensureFrame() {
    if (state.frame && state.frame.contentWindow) {
      return Promise.resolve(state.frame);
    }

    return new Promise(function (resolve, reject) {
      var frame = document.createElement("iframe");
      var timer = window.setTimeout(function () {
        reject(new Error("Bridge frame load timeout"));
      }, FRAME_LOAD_TIMEOUT_MS);

      frame.src = state.frameUrl;
      frame.title = "Session Transfer Bridge";
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.position = "fixed";
      frame.style.width = "1px";
      frame.style.height = "1px";
      frame.style.left = "-9999px";
      frame.style.top = "-9999px";
      frame.style.border = "0";
      frame.style.opacity = "0";
      frame.style.pointerEvents = "none";

      frame.addEventListener("load", function () {
        window.clearTimeout(timer);
        state.frame = frame;
        resolve(frame);
      }, { once: true });

      frame.addEventListener("error", function () {
        window.clearTimeout(timer);
        reject(new Error("Bridge frame failed to load"));
      }, { once: true });

      (document.body || document.documentElement).appendChild(frame);
    });
  }

  function request(type, payload, options) {
    var timeoutMs = Number((options && options.timeoutMs) || state.timeoutMs || DEFAULT_TIMEOUT_MS);
    return ensureFrame().then(function (frame) {
      return new Promise(function (resolve, reject) {
        var requestId = "connector-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        var done = false;

        function cleanup() {
          window.removeEventListener("message", onMessage);
          window.clearTimeout(timer);
        }

        function finish(fn, value) {
          if (done) {
            return;
          }
          done = true;
          cleanup();
          fn(value);
        }

        function onMessage(event) {
          if (event.source !== frame.contentWindow) {
            return;
          }
          var data = event.data || {};
          if (data.source !== SOURCE || data.requestId !== requestId) {
            return;
          }
          finish(resolve, data);
        }

        var timer = window.setTimeout(function () {
          finish(reject, new Error("Extension bridge timeout"));
        }, timeoutMs);

        window.addEventListener("message", onMessage);
        frame.contentWindow.postMessage(Object.assign({}, payload || {}, {
          target: SOURCE,
          type: type,
          requestId: requestId
        }), frameOrigin());
      });
    });
  }

  function ping(options) {
    return request(TYPES.ping, {}, options)
      .then(function (response) {
        var result = {
          installed: true,
          version: response.version || ""
        };
        emitGlobal("status", { status: "ready", result: result });
        return result;
      })
      .catch(function () {
        var result = {
          installed: false,
          version: ""
        };
        emitGlobal("missing", result);
        emitGlobal("status", { status: "missing", result: result });
        return result;
      });
  }

  function open(options) {
    var payload = normalizePresentationOptions(Object.assign({
      includeHistory: true,
      hideHistoryOption: true,
      lockHistoryOption: true,
      hideClientField: true,
      hideTokenField: true,
      lockClientField: true,
      lockTokenField: true,
      panelLayout: "center"
    }, options || {}));
    emitGlobal("status", { status: "opening", payload: payload });
    return ping({ timeoutMs: payload.timeoutMs })
      .then(function (connector) {
        if (!connector.installed) {
          var missingResponse = {
            ok: false,
            installed: false,
            error: "EXTENSION_NOT_AVAILABLE",
            fallbackUrl: fallbackUrl(payload)
          };
          emitGlobal("missing", missingResponse);
          emitGlobal("status", { status: "missing", result: missingResponse });
          return missingResponse;
        }
        return request(TYPES.startImport, {
          client: payload.client || "",
          token: payload.token || "",
          includeHistory: payload.includeHistory,
          hideHistoryOption: payload.hideHistoryOption,
          lockHistoryOption: payload.lockHistoryOption,
          hideClientField: payload.hideClientField,
          hideTokenField: payload.hideTokenField,
          lockClientField: payload.lockClientField,
          lockTokenField: payload.lockTokenField,
          panelLayout: payload.panelLayout
        }, { timeoutMs: payload.timeoutMs })
          .then(function (response) {
            if (response.type === TYPES.error) {
              var errorResponse = {
                ok: false,
                installed: true,
                error: response.error || "START_IMPORT_FAILED"
              };
              emitGlobal("error", errorResponse);
              emitGlobal("status", { status: "error", result: errorResponse });
              return errorResponse;
            }
            var openedResponse = {
              ok: true,
              installed: true,
              version: connector.version,
              tabId: response.tabId || null,
              reused: response.reused === true
            };
            emitGlobal("opened", openedResponse);
            emitGlobal("status", { status: "opened", result: openedResponse });
            return openedResponse;
          });
      })
      .catch(function (error) {
        var errorResponse = { error: error.message || String(error) };
        emitGlobal("error", errorResponse);
        emitGlobal("status", { status: "error", result: errorResponse });
        throw error;
      });
  }

  function fallbackUrl(options) {
    var payload = normalizePresentationOptions(options || {});
    var params = new URLSearchParams();
    if (payload.client) {
      params.set("client", String(payload.client));
    }
    if (payload.token) {
      params.set("token", String(payload.token));
    }
    setBooleanParamIfChanged(params, "includeHistory", payload.includeHistory, true);
    setBooleanParamIfChanged(params, "hideHistoryOption", payload.hideHistoryOption, true);
    setBooleanParamIfChanged(params, "lockHistoryOption", payload.lockHistoryOption, true);
    if (payload.hideClientField === false) {
      params.set("showClientField", "true");
    }
    if (payload.lockClientField === false) {
      params.set("canEditClient", "true");
    }
    if (payload.hideTokenField === false) {
      params.set("showTokenField", "true");
    }
    if (payload.lockTokenField === false) {
      params.set("canEditToken", "true");
    }
    if (payload.panelLayout === "corner") {
      params.set("panelLayout", payload.panelLayout);
    }
    var hash = params.toString();
    return "https://web.whatsapp.com/" + (hash ? "#" + hash : "");
  }

  function setBooleanParamIfChanged(params, key, value, defaultValue) {
    if (value !== undefined && value !== defaultValue) {
      params.set(key, value === true ? "true" : "false");
    }
  }

  function copyOptions(options) {
    var next = {};
    Object.keys(options || {}).forEach(function (key) {
      if (typeof options[key] !== "function") {
        next[key] = options[key];
      }
    });
    return next;
  }

  function normalizePresentationOptions(options) {
    var next = copyOptions(options || {});
    if (next.showClientField !== undefined) {
      next.hideClientField = next.showClientField === false;
    }
    if (next.showTokenField !== undefined) {
      next.hideTokenField = next.showTokenField === false;
    }
    if (next.canEditClient !== undefined) {
      next.lockClientField = next.canEditClient === false;
    }
    if (next.canEditToken !== undefined) {
      next.lockTokenField = next.canEditToken === false;
    }
    return next;
  }

  global.SessionTransfer = {
    configure: configure,
    on: on,
    off: off,
    ping: ping,
    open: open,
    fallbackUrl: fallbackUrl,
    buildWhatsAppUrl: fallbackUrl
  };
})(window);
