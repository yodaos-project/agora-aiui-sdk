/** An SDK error with a stable code and a message safe to show in the UI. */
export class AgoraVoiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AgoraVoiceError';
    this.code = code;
  }
}

export function cancelled() {
  return new AgoraVoiceError('ABORTED', 'The voice session was cancelled.');
}

export function checkSignal(signal) {
  if (signal?.aborted) throw cancelled();
}

/** Adopt a resource before yielding to callers; dispose of results arriving after cancellation. */
export function acquire(promise, signal, accept = () => {}, late = () => {}) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      signal.removeEventListener('abort', abort);
      abort();
    }
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) {
          Promise.resolve()
            .then(() => late(value))
            .catch(() => {});
          reject(cancelled());
          return;
        }
        try {
          accept(value);
          resolve(value);
        } catch (error) {
          Promise.resolve()
            .then(() => late(value))
            .catch(() => {});
          reject(error);
        }
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(signal.aborted ? cancelled() : error);
      },
    );
  });
}

/** Run independent cleanup with a deadline, including adapters that ignore AbortSignal. */
export function bounded(operation, timeout, parentSignal) {
  const controller = new AbortController();
  return new Promise((resolve) => {
    const abort = () => finish('failed');
    const timer = setTimeout(() => finish('timeout'), timeout);
    parentSignal?.addEventListener('abort', abort, { once: true });
    if (parentSignal?.aborted) {
      abort();
      return;
    }
    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        () => finish('complete'),
        () => finish('failed'),
      );
    function finish(result) {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abort);
      controller.abort();
      resolve(result);
    }
  });
}

export function positiveMilliseconds(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result <= 0 || result > 2_147_483_647) {
    throw new TypeError(`${name} must be a positive number of milliseconds.`);
  }
  return result;
}
