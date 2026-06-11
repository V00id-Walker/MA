const config = require('./Config.json');
const { MangaSource } = require('../Common/SourceBase');
const { matchAll, stripTags, uniqueBy } = require('../Common/html');
const { parseImages, titleFromSlug } = require('../Common/listParsers');

class AsuraSource extends MangaSource {
  constructor(options = {}) {
    super(config, options);
    this.apiBaseUrl = options.apiBaseUrl || 'https://api.asurascans.com';
    this.accessToken = options.accessToken || null;
    this.refreshToken = options.refreshToken || null;
    this.cachedUser = null;
    this.bookmarkIds = [];
    this.unreadNotifications = null;
  }

  async search(query) {
    const html = await this.request(`/browse?search=${encodeURIComponent(query)}`);
    const items = this.parseSeries(html);
    return this.mangaList(items.length ? items : this.parseSeries(await this.request('/browse')));
  }

  async popular() {
    const items = this.parseSeries(await this.request('/series-ranking'));
    return this.mangaList(items.length ? items : this.parseSeries(await this.request('/')));
  }

  async latest() {
    return this.mangaList(this.parseUpdates(await this.request('/')));
  }

  async details(seriesUrlOrPath) {
    const path = this.toPath(seriesUrlOrPath);
    const html = await this.request(path);
    return this.manga({
      id: this.parseSeriesId(html) || path.split('/').filter(Boolean).pop(),
      title: this.firstText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || titleFromSlug(path),
      url: this.absoluteUrl(path),
      coverUrl: this.firstAttribute(html, /<img[^>]+src="([^"]+asura-images\/covers[^"]+)"/i),
      authors: this.linksForBrowseParam(html, 'author'),
      artists: this.linksForBrowseParam(html, 'artist'),
      tags: this.linksForBrowseParam(html, 'genres'),
      chapters: this.parseChapters(html),
    });
  }

  async chapters(seriesUrlOrPath) {
    return this.chapterList((await this.details(seriesUrlOrPath)).chapters);
  }

  async pages(chapterUrlOrPath) {
    const path = this.toPath(chapterUrlOrPath);
    const html = await this.request(path);
    return this.pageList(parseImages(html, (url) => !url.includes('/chapters/')).map((url, index) => ({
      index: index + 1,
      url,
    })));
  }

  async login(credentials = {}) {
    const data = await this.apiJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: credentials.email || credentials.username,
        password: credentials.password,
        remember_me: credentials.rememberMe ?? true,
      }),
    }, { auth: false });
    this.applyAuthData(data.data || data);
    return {
      status: 'success',
      user: this.userFromApi(this.cachedUser),
    };
  }

  async logout() {
    const refreshToken = this.refreshToken;
    if (refreshToken) {
      await this.apiJson('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      }, { auth: false });
    }
    this.accessToken = null;
    this.refreshToken = null;
    this.cachedUser = null;
    this.bookmarkIds = [];
    this.unreadNotifications = null;
    return { status: 'ok' };
  }

  async profile() {
    const data = await this.apiJson('/api/me');
    this.cachedUser = data.data || data.user || data;
    return this.userFromApi(this.cachedUser);
  }

  async bookmarks() {
    await this.refreshSession();
    return this.bookmarkIds.map((seriesId) => this.bookmark({
      id: String(seriesId),
      manga: this.manga({ id: String(seriesId) }),
      status: 'bookmarked',
      type: 'series',
    }));
  }

  async setBookmark(input = {}) {
    const seriesId = this.bookmarkSeriesId(input);
    await this.apiJson(`/api/bookmarks/${encodeURIComponent(seriesId)}`, { method: 'POST' });
    if (!this.bookmarkIds.includes(Number(seriesId))) this.bookmarkIds.push(Number(seriesId));
    return this.bookmark({
      id: String(seriesId),
      manga: this.manga({ id: String(seriesId), url: input.url || null, title: input.title || null }),
      status: 'bookmarked',
      type: 'series',
      updatedAt: new Date().toISOString(),
    });
  }

  async removeBookmark(input = {}) {
    const seriesId = this.bookmarkSeriesId(input);
    await this.apiJson(`/api/bookmarks/${encodeURIComponent(seriesId)}`, { method: 'DELETE' });
    this.bookmarkIds = this.bookmarkIds.filter((id) => Number(id) !== Number(seriesId));
    return this.bookmark({
      id: String(seriesId),
      manga: this.manga({ id: String(seriesId), url: input.url || null, title: input.title || null }),
      status: null,
      type: 'series',
      updatedAt: new Date().toISOString(),
    });
  }

  async notifications() {
    await this.refreshSession();
    return { count: this.unreadNotifications ?? 0, notifications: [] };
  }

  async notificationCount() {
    return { count: (await this.notifications()).count };
  }

  parseSeries(html) {
    const items = matchAll(html, /href="(\/comics\/[^"\/]+)"([\s\S]{0,500}?)(?=<a\s|<\/a>|$)/g).map((match) => {
      const path = match[1];
      return {
        id: path.split('/').pop(),
        title: titleFromSlug(path),
        url: this.absoluteUrl(path),
        coverUrl: this.firstAttribute(match[2], /src="([^"]+asura-images\/covers[^"]+)"/i),
      };
    });
    return uniqueBy(items, 'url');
  }

  parseUpdates(html) {
    return this.parseSeries(html).map((item) => ({
      ...item,
      latestChapter: null,
    }));
  }

  parseChapters(html) {
    const mangaId = this.parseSeriesId(html);
    const chapters = matchAll(html, /href="(\/comics\/[^"]+\/chapter\/([^"]+))"/g)
      .map((match) => ({
        id: match[2],
        title: `Chapter ${match[2]}`,
        number: Number(match[2]),
        mangaId,
        url: this.absoluteUrl(match[1]),
      }));
    return uniqueBy(chapters, 'url');
  }

  parseSeriesId(html) {
    const match = String(html).match(/&quot;seriesId&quot;:\[0,(\d+)\]/)
      || String(html).match(/"seriesId":\s*(\d+)/)
      || String(html).match(/&quot;series_id&quot;:\[0,(\d+)\]/);
    return match ? String(match[1]) : null;
  }

  async refreshSession() {
    if (!this.refreshToken) return;
    const data = await this.apiJson('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    }, { auth: false });
    this.applyAuthData(data.data || data);
  }

  applyAuthData(data = {}) {
    this.accessToken = data.access_token || this.accessToken;
    this.refreshToken = data.refresh_token || this.refreshToken;
    this.cachedUser = data.user || this.cachedUser;
    this.bookmarkIds = Array.isArray(data.bookmark_ids) ? data.bookmark_ids : this.bookmarkIds;
    this.unreadNotifications = typeof data.unread_notifications === 'number'
      ? data.unread_notifications
      : this.unreadNotifications;
  }

  userFromApi(user = {}) {
    return this.user({
      id: user.id,
      name: user.username || user.email || null,
      avatarUrl: user.profile_picture_url || null,
      url: user.username ? `${this.baseUrl}/user/${encodeURIComponent(user.username)}` : null,
    });
  }

  bookmarkSeriesId(input = {}) {
    const raw = typeof input === 'object' ? input.mangaId || input.seriesId || input.id : input;
    if (!raw) throw new Error('Asura bookmark requires a numeric series id. Call details() first and pass the returned manga.');
    const value = String(raw);
    if (!/^\d+$/.test(value)) throw new Error(`Asura bookmark requires numeric series id, got: ${value}`);
    return value;
  }

  async apiJson(path, options = {}, { auth = true } = {}) {
    if (auth && !this.accessToken) throw new Error('Asura authentication required. Call login() first or construct with { accessToken }.');
    const response = await this.fetch(`${this.apiBaseUrl}${path}`, {
      ...options,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...options.headers,
        ...(auth && this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!response.ok) throw new Error(data.error || data.message || `Asura API request failed: ${response.status}`);
    return data;
  }

  linksForBrowseParam(html, param) {
    const regex = new RegExp(`href="/browse\\?${param}=([^"]+)"`, 'g');
    return matchAll(html, regex).map((match) => decodeURIComponent(match[1].replace(/\+/g, ' ')));
  }

  firstText(html, regex) {
    const match = String(html).match(regex);
    return match ? stripTags(match[1]) : null;
  }

  firstAttribute(html, regex) {
    const match = String(html).match(regex);
    return match ? match[1] : null;
  }

  toPath(value) {
    if (value && typeof value === 'object') return this.toPath(value.url || value.id);
    if (String(value).startsWith('http')) return new URL(value).pathname;
    return String(value).startsWith('/') ? value : `/comics/${value}`;
  }
}

module.exports = AsuraSource;
