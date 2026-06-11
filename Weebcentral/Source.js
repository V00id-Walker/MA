const config = require('./Config.json');
const { MangaSource } = require('../Common/SourceBase');
const { decodeHtml, matchAll, stripTags, uniqueBy } = require('../Common/html');

class WeebcentralSource extends MangaSource {
  constructor(options = {}) {
    super(config, options);
    this.sessionCookie = options.sessionCookie || options.cookie || null;
  }

  async search(query) {
    const body = new URLSearchParams({ text: query });
    const html = await this.request('/search/simple?location=main', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'hx-request': 'true',
      },
    });

    return this.mangaList(this.parseSeriesCards(html));
  }

  async latest(page = 1) {
    const html = await this.request(`/latest-updates/${page}`, {
      headers: { 'hx-request': 'true' },
    });
    return this.mangaList(this.parseUpdateCards(html), { page });
  }

  async popular(page = 1) {
    if (page !== 1) return this.mangaList([], { page });
    const html = await this.request('/hot-series?sort=weekly_views', {
      headers: { 'hx-request': 'true' },
    });
    return this.mangaList(this.parseSeriesCards(html), { page });
  }

  async details(seriesUrlOrId) {
    const path = this.toSeriesPath(seriesUrlOrId);
    const html = await this.request(path);
    const id = this.extractSeriesId(path);
    const chapters = await this.chapters(path, html);

    return this.manga({
      id,
      title: this.firstText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || this.titleFromPath(path),
      url: `${this.baseUrl}${path}`,
      coverUrl: this.firstAttribute(html, /<img[^>]+src="([^"]+)"[^>]+alt="[^"]*cover/i),
      authors: this.linksForSearchParam(html, 'author'),
      tags: this.linksForSearchParam(html, 'included_tag'),
      type: this.linksForSearchParam(html, 'included_type')[0] || null,
      status: this.linksForSearchParam(html, 'included_status')[0] || null,
      chapters,
    });
  }

  async chapters(seriesUrlOrId, existingHtml = null) {
    const path = this.toSeriesPath(seriesUrlOrId);
    const html = existingHtml || await this.request(path);
    const fullListPath = this.firstAttribute(html, /hx-get="https:\/\/weebcentral\.com([^"]+full-chapter-list)"/i);
    const listHtml = fullListPath
      ? await this.request(fullListPath, {
          headers: {
            'hx-request': 'true',
            referer: `${this.baseUrl}${path}`,
          },
        })
      : html;

    return this.chapterList(this.parseChapters(listHtml));
  }

  async pages(chapterUrlOrId) {
    const path = this.toChapterPath(chapterUrlOrId);
    const html = await this.request(`${path}/images?is_prev=False&current_page=1&reading_style=long_strip`, {
      headers: {
        'hx-request': 'true',
        referer: `${this.baseUrl}${path}`,
      },
    });
    const imageUrls = matchAll(html, /https?:\/\/[^"'<>\s]+?\.(?:avif|webp|jpg|jpeg|png)(?:\?[^"'<>\s]*)?/gi)
      .map((match) => decodeHtml(match[0]))
      .filter((url) => !url.includes('/cover/') && !url.includes('/static/images/'));

    return this.pageList([...new Set(imageUrls)].map((url, index) => ({
      index: index + 1,
      url,
    })));
  }

  async login(credentials = {}) {
    const email = credentials.email || credentials.username;
    const password = credentials.password;
    const data = await this.requestForm('/auth/login', {
      email,
      password,
      visitor_id: credentials.visitorId || '',
    }, { captureCookies: true });
    if (!/Login Successful/i.test(data)) {
      throw new Error(stripTags(data) || 'WeebCentral login failed');
    }
    return {
      status: 'success',
      user: await this.profile(),
      cookie: this.sessionCookie,
    };
  }

  async logout() {
    const data = await this.authRequest('/auth/logout', {
      method: 'POST',
      headers: { 'hx-request': 'true' },
      captureCookies: true,
    });
    this.sessionCookie = null;
    return { message: stripTags(data) || 'Logged out' };
  }

  async profile() {
    const html = await this.authRequest('/users/me/profiles');
    const name = this.firstText(html, /<title>([\s\S]*?)\| Weeb Central<\/title>/i)
      || this.firstAttribute(html, /name="username"[^>]+value="([^"]+)"/i)
      || 'Account';
    return this.user({
      id: this.firstAttribute(html, /href="https:\/\/weebcentral\.com\/users\/([^/"]+)\/profiles"/i) || 'me',
      name: name.replace(/^My\s+/i, '').trim() || 'Account',
      avatarUrl: this.firstAttribute(html, /<img[^>]+src="([^"]+avatar[^"]+)"/i),
      url: `${this.baseUrl}/users/me/profiles`,
    });
  }

  async comments(ref, options = {}) {
    const { contentId, contentType } = this.commentRef(ref, options);
    const params = new URLSearchParams({ content_type: contentType });
    if (options.cursor) params.set('cursor', options.cursor);
    const html = await this.request(`/comments/contents/${encodeURIComponent(contentId)}?${params}`, {
      headers: this.sessionCookie ? { cookie: this.sessionCookie, 'hx-request': 'true' } : { 'hx-request': 'true' },
    });
    return this.parseComments(html, contentId, contentType).map((item) => this.comment(item));
  }

  async postComment(input = {}) {
    const { contentId, contentType } = this.commentRef(input, input);
    const html = await this.authRequest(`/comments?content_id=${encodeURIComponent(contentId)}&content_type=${encodeURIComponent(contentType)}`, {
      method: 'POST',
      body: new URLSearchParams({ content: input.content }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'hx-request': 'true',
      },
    });
    const comments = this.parseComments(html, contentId, contentType);
    return this.comment(comments[0] || {
      id: this.firstAttribute(html, /id="comment-([^"]+)"/),
      body: input.content,
      chapterId: contentType === 'chapter' ? contentId : null,
      mangaId: contentType === 'series' ? contentId : null,
    });
  }

  async deleteComment(commentId) {
    const id = typeof commentId === 'object' ? commentId.commentId || commentId.id : commentId;
    const html = await this.authRequest(`/comments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'hx-request': 'true' },
    });
    return { message: stripTags(html) || 'Comment deleted' };
  }

  async bookmarks() {
    const html = await this.authRequest('/users/me/bookmarks/data?display_mode=Full%20Display', {
      headers: { 'hx-request': 'true' },
    });
    return this.parseBookmarks(html);
  }

  async setBookmark(input = {}) {
    const chapterId = this.extractChapterId(input.chapterId || input.id || input.url);
    const chapter = input && typeof input === 'object' ? input : {};
    const context = await this.chapterBookmarkContext(chapterId, chapter);
    await this.authRequest(`/chapters/${encodeURIComponent(chapterId)}/bookmarks`, {
      method: 'POST',
      body: new URLSearchParams({
        series_id: context.seriesId,
        chapter_type: context.chapterType,
        number: context.number,
        page: String(context.page),
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'hx-request': 'true',
      },
    });
    return this.bookmark({
      id: chapterId,
      chapter: this.chapter({
        id: chapterId,
        url: `${this.baseUrl}/chapters/${chapterId}`,
      }),
      status: 'bookmarked',
      type: 'chapter',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async removeBookmark(input = {}) {
    const chapterId = this.extractChapterId(input.chapterId || input.id || input.url || input);
    await this.authRequest(`/users/me/bookmarks?chapter_id=${encodeURIComponent(chapterId)}&page=${encodeURIComponent(input.page || 0)}`, {
      method: 'DELETE',
      headers: { 'hx-request': 'true' },
    });
    return this.bookmark({
      id: chapterId,
      chapter: this.chapter({
        id: chapterId,
        url: `${this.baseUrl}/chapters/${chapterId}`,
      }),
      status: null,
      type: 'chapter',
      updatedAt: new Date().toISOString(),
    });
  }

  async notifications() {
    const html = await this.authRequest('/users/me/notifications', {
      headers: { 'hx-request': 'true' },
    });
    return {
      count: this.notificationCountFromHtml(html),
      html,
    };
  }

  async notificationCount() {
    return { count: (await this.notifications()).count };
  }

  parseSeriesCards(html) {
    const links = matchAll(html, /<a[^>]+href="https:\/\/weebcentral\.com\/series\/([^"\/]+)(?:\/([^"]+))?"[^>]*>([\s\S]*?)<\/a>/g)
      .map((match) => {
        const [, id, slug = '', block = ''] = match;
        const title = this.titleFromBlock(block) || decodeURIComponent(slug.replace(/-/g, ' '));
        return {
          id,
          title,
          url: `${this.baseUrl}/series/${id}${slug ? `/${slug}` : ''}`,
          coverUrl: this.firstAttribute(block, /<img[^>]+src="([^"]+)"/i),
        };
      });

    return uniqueBy(links, 'id');
  }

  parseUpdateCards(html) {
    const series = this.parseSeriesCards(html);
    const chapterLinks = matchAll(html, /href="https:\/\/weebcentral\.com\/chapters\/([^"]+)"/g)
      .map((match) => ({
        id: match[1],
        url: `${this.baseUrl}/chapters/${match[1]}`,
      }));

    return series.map((item, index) => ({
      ...item,
      latestChapter: chapterLinks[index] || null,
    }));
  }

  parseChapters(html) {
    const chapters = matchAll(html, /<a[^>]+href="https:\/\/weebcentral\.com\/chapters\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)
      .map((match) => {
        const [, id, block] = match;
        const title = this.titleFromChapterBlock(block) || null;
        return {
          id,
          title,
          url: `${this.baseUrl}/chapters/${id}`,
          number: this.chapterNumberFromTitle(title),
        };
      })
      .filter((chapter) => chapter.title);

    return uniqueBy(chapters, 'id');
  }

  parseComments(html, contentId, contentType) {
    return matchAll(html, /<article[^>]+id="comment-([^"]+)"[^>]*>([\s\S]*?)(?=<article[^>]+id="comment-|<\/section>\s*(?:<div|$))/g)
      .filter((match) => !match[1].startsWith('list-'))
      .map((match) => {
        const [, id, block] = match;
        return {
          id,
          user: this.user({
            id: this.firstAttribute(block, /href="https:\/\/weebcentral\.com\/users\/([^/"]+)\/profiles"/i),
            name: this.firstText(block, /<span[^>]*class="[^"]*font-semibold[^"]*"[^>]*>([\s\S]*?)<\/span>/i),
            avatarUrl: this.firstAttribute(block, /<img[^>]+src="([^"]+avatar[^"]+)"/i),
            url: this.firstAttribute(block, /href="(https:\/\/weebcentral\.com\/users\/[^"]+\/profiles)"/i),
          }),
          body: this.firstText(block, /<p[^>]*class="[^"]*whitespace-pre-wrap[^"]*"[^>]*>([\s\S]*?)<\/p>/i),
          createdAt: this.firstAttribute(block, /<time[^>]+datetime="([^"]+)"/i),
          updatedAt: this.firstAttribute(block, /<time[^>]+datetime="([^"]+)"/i),
          chapterId: contentType === 'chapter' ? contentId : null,
          mangaId: contentType === 'series' ? contentId : null,
          parentId: null,
        };
      });
  }

  parseBookmarks(html) {
    const series = this.parseSeriesCards(html);
    const chapters = this.parseChapters(html);
    if (!series.length && !chapters.length) return [];
    return (chapters.length ? chapters : series.map((item) => ({ id: item.id, url: item.url, title: item.title })))
      .map((chapter, index) => this.bookmark({
        id: chapter.id,
        manga: series[index] ? this.manga(series[index]) : null,
        chapter: chapter.url?.includes('/chapters/') ? this.chapter(chapter) : null,
        status: 'bookmarked',
        type: chapter.url?.includes('/chapters/') ? 'chapter' : 'series',
      }));
  }

  notificationCountFromHtml(html) {
    const text = stripTags(html);
    const match = text.match(/\((\d+)\)|\b(\d+)\b/);
    return match ? Number(match[1] || match[2]) : 0;
  }

  async chapterBookmarkContext(chapterId, chapter = {}) {
    const fallback = {
      seriesId: chapter.mangaId || chapter.seriesId || '',
      chapterType: chapter.chapterType || 'Chapter',
      number: chapter.number || this.chapterNumberFromTitle(chapter.title) || '',
      page: chapter.page || 0,
    };
    if (fallback.seriesId && fallback.number) return fallback;

    const html = await this.authRequest(`/chapters/${encodeURIComponent(chapterId)}`, {
      headers: { 'hx-request': 'true' },
    });
    const vals = this.firstAttribute(html, /hx-vals='([^']+)'/i)
      || this.firstAttribute(html, /hx-vals="([^"]+)"/i);
    const parsedVals = this.parseHxVals(vals);

    return {
      seriesId: fallback.seriesId
        || parsedVals.series_id
        || this.firstAttribute(html, /href="https:\/\/weebcentral\.com\/series\/([^/"']+)/i)
        || '',
      chapterType: fallback.chapterType || parsedVals.chapter_type || 'Chapter',
      number: fallback.number || parsedVals.number || this.chapterNumberFromTitle(stripTags(html)) || '',
      page: fallback.page || parsedVals.page || 0,
    };
  }

  parseHxVals(value) {
    if (!value) return {};
    try {
      return JSON.parse(decodeHtml(value).replace(/'/g, '"'));
    } catch {
      return {};
    }
  }

  async requestForm(path, fields, options = {}) {
    return this.authCapableRequest(path, {
      method: 'POST',
      body: new URLSearchParams(fields),
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'hx-request': 'true',
        ...options.headers,
      },
      captureCookies: options.captureCookies,
    });
  }

  async authRequest(path, options = {}) {
    if (!this.sessionCookie) throw new Error('WeebCentral authentication required. Call login() first or construct with { sessionCookie }.');
    return this.authCapableRequest(path, options);
  }

  async authCapableRequest(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await this.fetch(url, {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options.headers,
        ...(this.sessionCookie ? { cookie: this.sessionCookie } : {}),
      },
    });
    if (options.captureCookies) this.captureCookies(response);
    const text = await response.text();
    if (!response.ok) throw new Error(stripTags(text) || `Request failed: ${response.status} ${response.statusText} for ${url}`);
    return text;
  }

  captureCookies(response) {
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    if (!cookies.length) return;
    this.sessionCookie = cookies.map((cookie) => cookie.trim().split(';')[0]).join('; ');
  }

  linksForSearchParam(html, param) {
    const regex = new RegExp(`href="https://weebcentral\\.com/search\\?${param}=([^"]+)"`, 'g');
    return matchAll(html, regex).map((match) => decodeHtml(decodeURIComponent(match[1].replace(/\+/g, ' '))));
  }

  titleFromBlock(block) {
    const lineClamp = this.firstText(block, /<[^>]+line-clamp-[^>]*>([\s\S]*?)<\/[^>]+>/i);
    if (lineClamp) return lineClamp;

    const cleaned = String(block)
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<picture[\s\S]*?<\/picture>/gi, ' ')
      .replace(/<img[^>]*>/gi, ' ');
    return stripTags(cleaned);
  }

  titleFromChapterBlock(block) {
    return this.firstText(block, /<span class="">([\s\S]*?)<\/span>/i)
      || this.firstText(block, /<span[^>]*>\s*((?:Chapter|Episode)[^<]+)<\/span>/i)
      || this.titleFromBlock(block);
  }

  chapterNumberFromTitle(title) {
    const match = String(title || '').match(/\b(?:Chapter|Episode)\s+(\d+(?:\.\d+)?)/i);
    return match ? Number(match[1]) : null;
  }

  titleFromPath(path) {
    const slug = path.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(slug.replace(/-/g, ' '));
  }

  firstText(html, regex) {
    const match = String(html).match(regex);
    return match ? stripTags(match[1]) : null;
  }

  firstAttribute(html, regex) {
    const match = String(html).match(regex);
    return match ? decodeHtml(match[1]) : null;
  }

  toSeriesPath(value) {
    if (value && typeof value === 'object') return this.toSeriesPath(value.url || value.id);
    if (String(value).startsWith('http')) return new URL(value).pathname;
    if (String(value).startsWith('/series/')) return value;
    return `/series/${value}`;
  }

  toChapterPath(value) {
    if (value && typeof value === 'object') return this.toChapterPath(value.url || value.id);
    if (String(value).startsWith('http')) return new URL(value).pathname;
    if (String(value).startsWith('/chapters/')) return value;
    return `/chapters/${value}`;
  }

  extractChapterId(value) {
    const path = this.toChapterPath(value);
    const match = path.match(/\/chapters\/([^/]+)/);
    return match ? match[1] : String(value);
  }

  extractSeriesId(path) {
    const match = path.match(/\/series\/([^/]+)/);
    return match ? match[1] : null;
  }

  commentRef(value, options = {}) {
    if (options.contentId) return { contentId: options.contentId, contentType: options.contentType || 'chapter' };
    if (value?.contentId) return { contentId: value.contentId, contentType: value.contentType || 'chapter' };
    const text = typeof value === 'object' ? value.url || value.chapterId || value.mangaId || value.id : value;
    const path = String(text).startsWith('http') ? new URL(text).pathname : String(text);
    if (path.includes('/series/') || options.contentType === 'series') {
      return { contentId: this.extractSeriesId(path) || path, contentType: 'series' };
    }
    return { contentId: this.extractChapterId(path), contentType: 'chapter' };
  }
}

module.exports = WeebcentralSource;
