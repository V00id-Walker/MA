class NetworkError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NetworkError';
    this.code = details.code || 'NETWORK_ERROR';
    this.url = details.url || null;
    this.method = details.method || null;
    this.status = details.status || null;
    this.attempt = details.attempt || null;
    this.retriable = Boolean(details.retriable);
    this.cause = details.cause;
  }
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 350;
const RETRIABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestMethod(options = {}) {
  return String(options.method || 'GET').toUpperCase();
}

function shouldRetryStatus(status) {
  return RETRIABLE_STATUS.has(status);
}

function retryAllowed(method, options = {}) {
  if (options.retry === false) return false;
  if (typeof options.retry === 'number') return options.retry > 0;
  if (options.retryUnsafe === true) return true;
  return IDEMPOTENT_METHODS.has(method);
}

function retryDelay(attempt, baseDelay, response) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return baseDelay * (2 ** Math.max(0, attempt - 1));
}

function composeSignal(timeoutMs, externalSignal, url, method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new NetworkError(`Request timed out after ${timeoutMs}ms`, {
      code: 'REQUEST_TIMEOUT',
      url,
      method,
      retriable: true,
    }));
  }, timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
    }
  }

  return { signal: controller.signal, timeout };
}

function createHttpClient(fetchImpl = globalThis.fetch, defaults = {}) {
  const defaultTimeoutMs = defaults.timeoutMs || DEFAULT_TIMEOUT_MS;
  const defaultRetries = defaults.retries ?? DEFAULT_RETRIES;
  const defaultBackoffMs = defaults.backoffMs || DEFAULT_BACKOFF_MS;

  return async function httpFetch(url, options = {}) {
    const method = requestMethod(options);
    const timeoutMs = options.timeoutMs || defaultTimeoutMs;
    const retries = options.retries ?? options.retry ?? defaultRetries;
    const maxAttempts = retryAllowed(method, options) ? Number(retries) + 1 : 1;
    const backoffMs = options.backoffMs || defaultBackoffMs;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { signal, timeout } = composeSignal(timeoutMs, options.signal, String(url), method);
      try {
        const requestOptions = { ...options, signal };
        delete requestOptions.timeoutMs;
        delete requestOptions.retries;
        delete requestOptions.retry;
        delete requestOptions.retryUnsafe;
        delete requestOptions.backoffMs;

        const response = await fetchImpl(url, requestOptions);
        if (attempt < maxAttempts && shouldRetryStatus(response.status)) {
          await sleep(retryDelay(attempt, backoffMs, response));
          continue;
        }
        return response;
      } catch (error) {
        const isAbort = error?.name === 'AbortError' || error?.code === 'REQUEST_TIMEOUT';
        lastError = error instanceof NetworkError
          ? error
          : new NetworkError(error.message || 'Network request failed', {
              code: isAbort ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
              url: String(url),
              method,
              attempt,
              retriable: true,
              cause: error,
            });
        if (attempt >= maxAttempts) break;
        await sleep(retryDelay(attempt, backoffMs));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  };
}

module.exports = {
  DEFAULT_BACKOFF_MS,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  NetworkError,
  createHttpClient,
  shouldRetryStatus,
};
