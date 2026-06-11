const {
  normalizeBookmark,
  normalizeChapter,
  normalizeComment,
  normalizeManga,
  normalizePage,
  normalizeSearchResult,
  normalizeUser,
  hasOwnMethod,
} = require('./schema');
const { createHttpClient, NetworkError } = require('./httpClient');

class UnsupportedFeatureError extends Error {
  constructor(feature) {
    super(`${feature} is not supported by this source`);
    this.name = 'UnsupportedFeatureError';
    this.code = 'UNSUPPORTED_FEATURE';
    this.feature = feature;
  }
}

class SourceUnavailableError extends Error {
  constructor(source, reason) {
    super(`${source} is unavailable: ${reason}`);
    this.name = 'SourceUnavailableError';
    this.code = 'SOURCE_UNAVAILABLE';
    this.source = source;
    this.reason = reason;
  }
}

class MangaSource {
  constructor(config, options = {}) {
    this.config = config;
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.rawFetch = options.fetch || globalThis.fetch;
    this.fetch = createHttpClient(this.rawFetch, {
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      backoffMs: options.backoffMs,
    });
    this.defaultHeaders = {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': options.userAgent || 'AppV2-MangaExtension/0.1',
      ...options.headers,
    };
    this.wrapContractMethods();
  }

  wrapContractMethods() {
    const wrappers = {
      search: (value) => normalizeSearchResult(value),
      popular: (value) => normalizeSearchResult(value),
      latest: (value) => normalizeSearchResult(value),
      details: (value) => normalizeManga(value),
      chapters: (value) => (Array.isArray(value) ? value : []).map(normalizeChapter),
      pages: (value) => (Array.isArray(value) ? value : []).map(normalizePage),
      comments: (value) => (Array.isArray(value) ? value : []).map(normalizeComment),
      bookmarks: (value) => (Array.isArray(value) ? value : []).map(normalizeBookmark),
    };

    const SourceClass = this.constructor;
    for (const [method, normalize] of Object.entries(wrappers)) {
      if (!hasOwnMethod(SourceClass, method) || this[method]?.isContractWrapped) continue;
      const original = this[method].bind(this);
      const wrapped = async (...args) => normalize(await original(...args));
      wrapped.isContractWrapped = true;
      this[method] = wrapped;
    }
  }

  async request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await this.fetch(url, {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
    }

    return response.text();
  }

  async requestJson(path, options = {}) {
    const text = await this.request(path, {
      ...options,
      headers: {
        accept: 'application/json',
        ...options.headers,
      },
    });
    return JSON.parse(text);
  }

  absoluteUrl(path) {
    if (!path) return null;
    return String(path).startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  unavailable(reason) {
    throw new SourceUnavailableError(this.config.name, reason);
  }

  unsupported(feature) {
    throw new UnsupportedFeatureError(feature);
  }

  async search() {
    return this.unsupported('search');
  }

  async popular() {
    return this.unsupported('popular');
  }

  async latest() {
    return this.unsupported('latest');
  }

  async details() {
    return this.unsupported('details');
  }

  async chapters() {
    return this.unsupported('chapters');
  }

  async pages() {
    return this.unsupported('pages');
  }

  manga(value) {
    return normalizeManga(value);
  }

  chapter(value) {
    return normalizeChapter(value);
  }

  page(value) {
    return normalizePage(value);
  }

  user(value) {
    return normalizeUser(value);
  }

  comment(value) {
    return normalizeComment(value);
  }

  bookmark(value) {
    return normalizeBookmark(value);
  }

  searchResult(value, options = {}) {
    return normalizeSearchResult(value, options);
  }

  mangaList(items, options = {}) {
    return this.searchResult({ items, ...options });
  }

  chapterList(items) {
    return (Array.isArray(items) ? items : []).map((item) => this.chapter(item));
  }

  pageList(items) {
    return (Array.isArray(items) ? items : []).map((item) => this.page(item));
  }

  async login() {
    return this.unsupported('login');
  }

  async comments() {
    return this.unsupported('comments');
  }

  async bookmarks() {
    return this.unsupported('bookmarks');
  }

  async notifications() {
    return this.unsupported('notifications');
  }
}

module.exports = {
  MangaSource,
  NetworkError,
  SourceUnavailableError,
  UnsupportedFeatureError,
};
