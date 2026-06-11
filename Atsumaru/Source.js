const config = require('./Config.json');
const { MangaSource } = require('../Common/SourceBase');

class AtsumaruSource extends MangaSource {
  constructor(options = {}) {
    super(config, options);
    this.sessionCookie = options.sessionCookie || options.cookie || null;
  }

  imageUrl(path) {
    return this.absoluteUrl(path);
  }

  mapSeries(item) {
    return {
      id: item.id,
      title: item.title,
      url: `${this.baseUrl}/manga/${item.id}`,
      coverUrl: this.imageUrl(item.mediumImage || item.smallImage || item.image),
      isAdult: item.isAdult || false,
      type: item.type || null,
      rating: item.mbRating || null,
      views: item.views || null,
    };
  }

  async homeSection(key) {
    const data = await this.requestJson('/api/home/page');
    const section = data.homePage.sections.find((item) => item.key === key || item.title === key);
    return section?.items?.map((item) => this.mapSeries(item)) || [];
  }

  async search(query) {
    const params = new URLSearchParams({
      q: query,
      query_by: 'title',
      per_page: '24',
    });
    const data = await this.requestJson(`/collections/manga/documents/search?${params}`);
    const hits = data.hits || data.results || [];
    return this.mangaList(hits.map((hit) => this.mapSeries(hit.document || hit)));
  }

  async popular() {
    const data = await this.requestJson('/api/search/popular');
    return this.mangaList(data.items.map((item) => this.mapSeries(item)));
  }

  async latest() {
    return this.mangaList(await this.homeSection('Recently Updated'));
  }

  async details(seriesIdOrUrl) {
    const id = this.extractMangaId(seriesIdOrUrl);
    const data = await this.requestJson(`/api/manga/info?mangaId=${encodeURIComponent(id)}`);
    return this.manga({
      id: data.id,
      title: data.title,
      url: `${this.baseUrl}/manga/${data.id}`,
      coverUrl: this.imageUrl(data.mediumImage || data.smallImage || data.image),
      type: data.type || null,
      chapters: this.mapChapters(data.id, data.chapters || []),
    });
  }

  async chapters(seriesIdOrUrl) {
    const details = await this.details(seriesIdOrUrl);
    return this.chapterList(details.chapters);
  }

  async pages(chapterRef) {
    const { mangaId, chapterId } = this.extractReadRef(chapterRef);
    const data = await this.requestJson(`/api/read/chapter?mangaId=${encodeURIComponent(mangaId)}&chapterId=${encodeURIComponent(chapterId)}`);
    return this.pageList((data.readChapter?.pages || []).map((page, index) => ({
      index: index + 1,
      url: this.imageUrl(page.image),
      width: page.width || null,
      height: page.height || null,
    })));
  }

  async login(credentials = {}) {
    const username = credentials.username || credentials.email;
    const password = credentials.password;
    const body = new URLSearchParams({ username, password });
    const data = await this.api('/api/auth/login', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      captureCookies: true,
    });
    if (data.status === 'error') throw new Error(data.error || 'Atsumaru login failed');
    return {
      status: data.status || 'ok',
      user: data.me ? this.mapUser(data.me) : null,
      cookie: this.sessionCookie,
    };
  }

  async logout() {
    const data = await this.authApi('/api/auth/logout/self', { method: 'POST' });
    this.sessionCookie = null;
    return data;
  }

  async profile() {
    const data = await this.api('/api/auth/me');
    return data.me ? this.mapUser(data.me) : null;
  }

  async comments(ref, options = {}) {
    const sectionId = options.sectionId || ref?.sectionId || await this.commentSectionId(ref);
    const params = new URLSearchParams({
      sectionId,
      maxDepth: String(Math.max(2, Number(options.maxDepth || 2))),
    });
    if (options.parentId) params.set('parentId', options.parentId);
    if (options.highlightedCommentId) params.set('highlightedCommentId', options.highlightedCommentId);
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.flat) params.set('flat', 'true');
    if (options.sort) params.set('sort', options.sort);
    const data = await this.api(`/api/comments/v2/threads?${params}`);
    return this.flattenComments(data.comments || []).map((comment) => this.mapComment(comment));
  }

  async postComment(input = {}) {
    const sectionId = input.sectionId || await this.commentSectionId(input);
    const data = await this.authApi('/api/comments/v2/postComment', {
      method: 'POST',
      json: {
        sectionId,
        parentId: input.parentId || null,
        replyingToId: input.replyingToId || null,
        content: input.content,
        spoiler: Boolean(input.spoiler),
      },
    });
    if (data.status === 'error') throw new Error(data.error || 'Atsumaru comment post failed');
    return data.comment ? this.comment(this.mapComment(data.comment)) : data;
  }

  async editComment(input = {}) {
    const data = await this.authApi('/api/comments/v2/editComment', {
      method: 'POST',
      json: {
        commentId: input.commentId,
        content: input.content,
        spoiler: Boolean(input.spoiler),
      },
    });
    if (data.status === 'error') throw new Error(data.error || 'Atsumaru comment edit failed');
    return data.comment ? this.comment(this.mapComment(data.comment)) : data;
  }

  async deleteComment(commentId) {
    return this.authApi('/api/comments/v2/removeComment', {
      method: 'POST',
      json: { commentId: typeof commentId === 'object' ? commentId.commentId || commentId.id : commentId },
    });
  }

  async bookmarks(options = {}) {
    const params = new URLSearchParams();
    if (options.adult) params.set('adult', '1');
    if (options.includeAdult) params.set('includeAdult', '1');
    const data = await this.authApi(`/api/user/bookmarksPage${params.size ? `?${params}` : ''}`);
    return (data.bookmarks || []).map((item) => this.mapBookmark(item));
  }

  async bookmarkIds() {
    const data = await this.authApi('/api/user/bookmarkIds');
    return data.bookmarks || [];
  }

  async bookmarkStatus(mangaId) {
    return this.authApi(`/api/user/bookmark?mangaId=${encodeURIComponent(this.extractMangaId(mangaId))}`);
  }

  async setBookmark(input = {}) {
    const mangaId = this.extractMangaId(input.mangaId || input.id);
    const item = {
      mangaId,
      status: input.status || null,
      type: input.type || null,
      ts: input.ts || Date.now(),
    };
    await this.authApi('/api/user/syncBookmarks', {
      method: 'POST',
      json: [item],
    });
    return this.bookmark({
      id: mangaId,
      manga: this.mapSeries({ id: mangaId, title: input.title || null, image: input.coverUrl || null }),
      status: item.status,
      type: item.type,
      createdAt: new Date(item.ts).toISOString(),
      updatedAt: new Date(item.ts).toISOString(),
    });
  }

  async removeBookmark(mangaId) {
    return this.setBookmark({ mangaId, status: null, type: null });
  }

  async notifications(options = {}) {
    const params = new URLSearchParams({
      page: String(options.page || 0),
      limit: String(options.limit || 20),
    });
    if (options.type) params.set('type', options.type);
    return this.authApi(`/api/notifications/page?${params}`);
  }

  async notificationCount() {
    return this.authApi('/api/notifications/count');
  }

  async notificationPopover() {
    return this.authApi('/api/notifications/popover');
  }

  async markNotificationAsRead(id) {
    return this.authApi(`/api/notifications/markAsRead?id=${encodeURIComponent(typeof id === 'object' ? id.id : id)}`, {
      method: 'POST',
    });
  }

  async markAllNotificationsAsRead() {
    return this.authApi('/api/notifications/markAllAsRead', { method: 'POST' });
  }

  mapChapters(mangaId, chapters) {
    return this.chapterList(chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title || `Chapter ${chapter.number}`,
      number: chapter.number || null,
      url: `${this.baseUrl}/read/${mangaId}/${chapter.id}`,
      mangaId,
      pageCount: chapter.pageCount || null,
    })).reverse());
  }

  mapUser(user) {
    return this.user({
      id: user.id,
      name: user.usernameDisplay || user.username || user.usernameSlug || null,
      avatarUrl: this.imageUrl(user.pfp),
      url: user.usernameSlug ? `${this.baseUrl}/u/${user.usernameSlug}` : null,
    });
  }

  mapComment(comment) {
    return {
      id: comment.id,
      user: comment.user ? this.mapUser(comment.user) : null,
      body: comment.content || null,
      createdAt: this.dateValue(comment.createdAt),
      updatedAt: this.dateValue(comment.updatedAt || comment.editedAt),
      chapterId: comment.chapterId || null,
      mangaId: comment.mangaId || null,
      parentId: comment.parentId || null,
    };
  }

  mapBookmark(item) {
    const manga = this.mapSeries({
      id: item.id || item.mangaId,
      title: item.title,
      mediumImage: item.mediumImage || item.posterMedium || item.image,
      smallImage: item.smallImage || item.posterSmall,
      image: item.image || item.poster,
      isAdult: item.isAdult,
      type: item.type,
      mbRating: item.mbRating,
      views: item.views,
    });
    return this.bookmark({
      id: item.id || item.mangaId,
      manga,
      chapter: item.chapter ? this.chapter({
        id: item.chapter.id,
        title: item.chapter.title || `Chapter ${item.chapter.number}`,
        number: item.chapter.number,
        mangaId: item.id || item.mangaId,
      }) : null,
      status: item.bookmarkStatus || item.status || null,
      type: item.bookmarkType || item.type || null,
      createdAt: this.dateValue(item.bookmarkedAt || item.createdAt),
      updatedAt: this.dateValue(item.updatedAt || item.bookmarkedAt),
    });
  }

  flattenComments(comments) {
    return comments.flatMap((comment) => [
      comment,
      ...this.flattenComments(comment.replies || []),
    ]);
  }

  async commentSectionId(ref) {
    const chapterId = this.extractChapterId(ref);
    const data = await this.api(`/api/comments/commentSections/getCommentSection?chapterId=${encodeURIComponent(chapterId)}`);
    if (!data.section?.id) throw new Error(`Atsumaru comment section not found for chapter ${chapterId}`);
    return data.section.id;
  }

  extractChapterId(value) {
    if (typeof value === 'object') return value.chapterId || value.id;
    const parts = String(value).startsWith('http') ? new URL(value).pathname.split('/').filter(Boolean) : String(value).split('/').filter(Boolean);
    if (parts[0] === 'read') return parts[2];
    return String(value);
  }

  async authApi(path, options = {}) {
    if (!this.sessionCookie && !options.allowAnonymous) {
      throw new Error('Atsumaru authentication required. Call login() first or construct with { sessionCookie }.');
    }
    return this.api(path, options);
  }

  async api(path, options = {}) {
    const headers = {
      accept: 'application/json',
      ...options.headers,
    };
    const request = { ...options, headers };
    delete request.json;
    delete request.captureCookies;
    delete request.allowAnonymous;

    if (options.json !== undefined) {
      request.body = JSON.stringify(options.json);
      request.headers = {
        'content-type': 'application/json',
        ...headers,
      };
    }

    if (this.sessionCookie) {
      request.headers.cookie = this.sessionCookie;
    }

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await this.fetch(url, request);
    if (options.captureCookies) this.captureCookies(response);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const message = this.apiErrorMessage(data);
      throw new Error(message || `Request failed: ${response.status} ${response.statusText} for ${url}`);
    }
    return data;
  }

  apiErrorMessage(data) {
    if (!data || typeof data !== 'object') return data;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
    if (typeof data.error?.message === 'string') return data.error.message;
    return JSON.stringify(data);
  }

  captureCookies(response) {
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    if (!cookies.length) return;
    this.sessionCookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  }

  dateValue(value) {
    if (value == null) return null;
    if (typeof value === 'number') return new Date(value).toISOString();
    return value;
  }

  extractMangaId(value) {
    const text = String(value);
    if (text.startsWith('http')) return new URL(text).pathname.split('/').filter(Boolean).pop();
    if (text.startsWith('/manga/')) return text.split('/').filter(Boolean).pop();
    return text;
  }

  extractReadRef(value) {
    if (typeof value === 'object') return { mangaId: value.mangaId, chapterId: value.chapterId || value.id };
    const parts = String(value).startsWith('http') ? new URL(value).pathname.split('/').filter(Boolean) : String(value).split('/').filter(Boolean);
    if (parts[0] === 'read') return { mangaId: parts[1], chapterId: parts[2] };
    throw new Error('Atsumaru chapter reference must be /read/{mangaId}/{chapterId} or { mangaId, chapterId }');
  }
}

module.exports = AtsumaruSource;
