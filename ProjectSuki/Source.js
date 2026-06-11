const config = require('./Config.json');
const { MangaSource } = require('../Common/SourceBase');
const { matchAll, stripTags, uniqueBy } = require('../Common/html');
const { parseImages } = require('../Common/listParsers');

class ProjectSukiSource extends MangaSource {
  constructor(options = {}) {
    super(config, {
      ...options,
      userAgent: options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
    });
  }

  async search(query) {
    return this.mangaList(this.parseBooks(await this.request(`/search?q=${encodeURIComponent(query)}`)));
  }

  async popular() {
    return this.mangaList(this.parseBooks(await this.request('/browse')));
  }

  async latest() {
    return this.mangaList(this.parseBooks(await this.request('/')));
  }

  async details(bookUrlOrId) {
    const path = this.toBookPath(bookUrlOrId);
    const html = await this.request(path);
    return this.manga({
      id: path.split('/').pop(),
      title: this.firstText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || `Book ${path.split('/').pop()}`,
      url: this.absoluteUrl(path),
      coverUrl: this.firstAttribute(html, /<img[^>]+src="([^"]+\/images\/gallery\/[^"]+)"/i),
      chapters: this.parseChapters(html),
    });
  }

  async chapters(bookUrlOrId) {
    return this.chapterList((await this.details(bookUrlOrId)).chapters);
  }

  async pages(readUrlOrPath) {
    const path = this.toReadPath(readUrlOrPath);
    const html = await this.request(path);
    const { bookId, chapterId } = this.parseReadPath(path);
    const images = this.parsePageImages(html);
    const data = await this.requestJson('/callpage', {
      method: 'POST',
      body: JSON.stringify({ bookid: bookId, chapterid: chapterId, first: true }),
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        referer: this.absoluteUrl(path),
      },
    });
    images.push(...this.parsePageImages(data.src || ''));
    return this.pageList([...new Set(images)].map((url, index) => ({
      index: index + 1,
      url: this.absoluteUrl(url),
    })));
  }

  parseBooks(html) {
    const coversByBook = new Map();
    for (const match of matchAll(html, /src="([^"]+\/images\/gallery\/(\d+)\/[^"]+)"/g)) {
      coversByBook.set(match[2], this.absoluteUrl(match[1]));
    }
    const titlesByBook = new Map();
    for (const match of matchAll(html, /<h4[^>]*>\s*<a[^>]+href="\/book\/(\d+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h4>/g)) {
      titlesByBook.set(match[1], stripTags(match[2]));
    }

    const books = matchAll(html, /href="(\/book\/(\d+))"/g).map((match) => ({
      id: match[2],
      title: titlesByBook.get(match[2]) || `Book ${match[2]}`,
      url: this.absoluteUrl(match[1]),
      coverUrl: coversByBook.get(match[2]) || null,
    }));
    return uniqueBy(books, 'id');
  }

  parseChapters(html) {
    const chapters = matchAll(html, /href="(\/read\/(\d+)\/(\d+)\/1)"/g).map((match) => ({
      id: match[3],
      title: `Chapter ${match[3]}`,
      url: this.absoluteUrl(match[1]),
      mangaId: match[2],
    }));
    return uniqueBy(chapters, 'id');
  }

  parsePageImages(html) {
    return parseImages(html, (url) => !url.includes('/images/gallery/'))
      .concat(matchAll(html, /src=['"]([^'"]+\/images\/gallery\/\d+\/[^'"]+\/\d+\?)['"]/g).map((match) => match[1]));
  }

  firstText(html, regex) {
    const match = String(html).match(regex);
    return match ? stripTags(match[1]) : null;
  }

  firstAttribute(html, regex) {
    const match = String(html).match(regex);
    return match ? this.absoluteUrl(match[1]) : null;
  }

  toBookPath(value) {
    if (value && typeof value === 'object') return this.toBookPath(value.url || value.id);
    if (String(value).startsWith('http')) return new URL(value).pathname;
    if (String(value).startsWith('/book/')) return value;
    return `/book/${value}`;
  }

  toReadPath(value) {
    if (value && typeof value === 'object') return this.toReadPath(value.url || value.id);
    if (String(value).startsWith('http')) return new URL(value).pathname;
    return String(value);
  }

  parseReadPath(path) {
    const match = String(path).match(/\/read\/(\d+)\/(\d+)\/\d+/);
    if (!match) throw new Error(`Invalid ProjectSuki reader path: ${path}`);
    return { bookId: match[1], chapterId: match[2] };
  }
}

module.exports = ProjectSukiSource;
