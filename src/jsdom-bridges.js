/* eslint-disable max-classes-per-file -- a Request and a URL, both standing in for Node's */
// Node's own, taken before any window replaces them.
const NodeBlob = globalThis.Blob;
const NodeFormData = globalThis.FormData;
const NodeRequest = globalThis.Request;
const NodeURL = globalThis.URL;

// jsdom has no fetch, so Node's serves it, and Node's fetch can not read a jsdom Blob or FormData (it
// calls blob.stream(), which jsdom lacks), nor can jsdom take Node's AbortSignal. These bridge the
// two as vitest's jsdom environment does: a Request and a URL.createObjectURL that convert jsdom's
// bodies, and an addEventListener that accepts Node's signal.
function jsdomBridges(window) {
  const impl = Object.getOwnPropertySymbols(Object.getOwnPropertyDescriptors(new window.Blob()))[0];
  // eslint-disable-next-line no-underscore-dangle -- jsdom keeps a Blob's bytes on its internal impl
  const toNodeBlob = (blob) => new NodeBlob([blob[impl]._buffer], { type: blob.type });
  const toNodeBody = (body) => {
    if (body instanceof window.Blob) {
      return toNodeBlob(body);
    }
    if (body instanceof window.FormData) {
      const formData = new NodeFormData();
      body.forEach((value, key) => formData.append(key, value instanceof window.Blob ? toNodeBlob(value) : value));
      return formData;
    }
    return body;
  };
  class Request extends NodeRequest {
    constructor(input, init) {
      super(input, init?.body == null ? init : { ...init, body: toNodeBody(init.body) });
    }

    static [Symbol.hasInstance](instance) {
      return instance instanceof NodeRequest;
    }
  }
  class URL extends NodeURL {
    static createObjectURL(blob) {
      return NodeURL.createObjectURL(blob instanceof window.Blob ? toNodeBlob(blob) : blob);
    }

    static [Symbol.hasInstance](instance) {
      return instance instanceof NodeURL;
    }
  }
  const { addEventListener } = window.EventTarget.prototype;
  const forwarded = new WeakMap();
  const jsdomSignal = (signal) => {
    if (!forwarded.has(signal)) {
      const controller = new window.AbortController();
      signal.addEventListener('abort', () => controller.abort(signal.reason));
      forwarded.set(signal, controller.signal);
    }
    return forwarded.get(signal);
  };

  window.EventTarget.prototype.addEventListener = function bridgedAddEventListener(type, listener, options) {
    const signal = options?.signal;
    const bridged =
      signal && !(signal instanceof window.AbortSignal) ? { ...options, signal: jsdomSignal(signal) } : options;
    return addEventListener.call(this, type, listener, bridged);
  };
  return { Request, URL };
}

module.exports = { jsdomBridges };
