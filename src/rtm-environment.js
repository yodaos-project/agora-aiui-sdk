/** Scope browser compatibility to the pinned RTM bundle; never replace AIUI globals. */
export function createRtmEnvironment(root = globalThis) {
  const ink =
    /\bInk\//.test(root.navigator?.userAgent ?? '') ||
    (typeof root.WHIPSession === 'function' && typeof root.XMLHttpRequest !== 'function');
  const values = new Map();
  const events = new EventTarget();
  const eventMethods = Object.fromEntries(
    ['addEventListener', 'removeEventListener', 'dispatchEvent'].map((key) => [
      key,
      events[key].bind(events),
    ]),
  );
  // RTM cancels optional presence timers with null/undefined. Keep that browser
  // behavior local to the bundle until Ink's timer bindings accept absent IDs.
  const cancellation = {
    clearTimeout(id) {
      if (id != null) root.clearTimeout(id);
    },
    clearInterval(id) {
      if (id != null) root.clearInterval(id);
    },
  };
  const consoleMethods = new Map();
  const scopedConsole = new Proxy(root.console ?? console, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (!consoleMethods.has(key)) consoleMethods.set(key, value.bind(target));
      return consoleMethods.get(key);
    },
  });
  const browser = new Proxy(root, {
    get(target, key) {
      if (ink && Object.hasOwn(cancellation, key)) return cancellation[key];
      if (ink && key in eventMethods && typeof target[key] !== 'function') return eventMethods[key];
      return Reflect.get(target, key, target);
    },
  });
  const scope = new Proxy(
    {},
    {
      get(_target, key) {
        // Ink wx.connectSocket is a WebSocket alias, not a WeChat SocketTask.
        if (ink && key === 'wx') return undefined;
        if (ink && Object.hasOwn(cancellation, key)) return cancellation[key];
        if (key === 'console') return scopedConsole;
        return values.has(key) ? values.get(key) : Reflect.get(root, key, root);
      },
      set(_target, key, value) {
        values.set(key, value);
        return true;
      },
    },
  );
  // RTM 2.3.0 explicitly selects its Fetch implementation when this object has
  // no setRequestHeader. This is private transport selection, not a global XHR polyfill.
  class FetchTransport {
    open() {}
    abort() {}
  }
  return {
    scope,
    browser,
    console: scopedConsole,
    XMLHttpRequest: ink ? FetchTransport : root.XMLHttpRequest,
    clearTimeout: cancellation.clearTimeout,
    clearInterval: cancellation.clearInterval,
    fetch: (url, options) =>
      root.fetch(
        url,
        ink && options?.referrer === 'no-referrer' ? { ...options, referrer: '' } : options,
      ),
  };
}
