const config = require('./Config.json');
const { MangaSource } = require('../Common/SourceBase');
const { matchAll, stripTags, uniqueBy } = require('../Common/html');
const { titleFromSlug } = require('../Common/listParsers');
const { generateMangafireVrf } = require('./mangafireVrf');

class MangafireSource extends MangaSource {
  constructor(options = {}) {
    super(config, options);
  }

  async search(query) {
    const data = await this.requestJson(`/ajax/manga/search?keyword=${encodeURIComponent(query)}&vrf=${generateMangafireVrf(query)}`, {
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    if (data.status !== 200) {
      return this.unavailable(data.message || 'Mangafire search API rejected the request.');
    }
    return this.mangaList(this.parseManga(data.result?.html || ''));
  }

  async popular() {
    return this.mangaList(this.parseManga(await this.request('/type/manga')));
  }

  async latest() {
    return this.mangaList(this.parseManga(await this.request('/updated')));
  }

  async details(mangaUrlOrPath) {
    const path = this.toMangaPath(mangaUrlOrPath);
    const html = await this.request(path);
    return this.manga({
      id: path.split('/').pop(),
      title: this.firstText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || titleFromSlug(path),
      url: this.absoluteUrl(path),
      coverUrl: this.firstAttribute(html, /<img[^>]+src="([^"]+static\.mfcdn[^"]+)"/i),
      tags: matchAll(html, /href="\/genre\/([^"]+)"/g).map((match) => match[1]),
      chapters: this.parseChapters(html),
    });
  }

  async chapters(mangaUrlOrPath) {
    return this.chapterList((await this.details(mangaUrlOrPath)).chapters);
  }

  async pages(chapterUrlOrPath) {
    const { mangaId, type, lang, chapterSlug } = this.parseReadPath(chapterUrlOrPath);
    const chapters = await this.fetchChapterList(mangaId, type, lang);
    const chapter = chapters.find((item) => item.slug === chapterSlug);
    if (!chapter) throw new Error(`Chapter not found in Mangafire list: ${chapterSlug}`);
    const data = await this.requestJson(`/ajax/read/${type}/${chapter.id}?vrf=${generateMangafireVrf(`${type}@${chapter.id}`)}`, {
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    return this.pageList((data.result?.images || []).map((image, index) => ({
      index: index + 1,
      url: Array.isArray(image) ? image[0] : image,
    })).filter((page) => page.url));
  }

  parseManga(html) {
    const covers = [...matchAll(html, /href="(\/manga\/[^"]+)"[\s\S]{0,300}?src="([^"]+)"/g)]
      .reduce((map, match) => map.set(match[1], match[2]), new Map());
    const titles = [...matchAll(html, /<a[^>]+href="(\/manga\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
      .reduce((map, match) => map.set(match[1], this.firstText(match[2], /<h6[^>]*>([\s\S]*?)<\/h6>/i)), new Map());
    const items = matchAll(html, /href="(\/manga\/[^"]+)"/g).map((match) => {
      const path = match[1];
      return {
        id: path.split('/').pop(),
        title: titles.get(path) || titleFromSlug(path),
        url: this.absoluteUrl(path),
        coverUrl: covers.get(path) || null,
      };
    });
    return uniqueBy(items, 'id');
  }

  parseChapters(html) {
    const chapters = matchAll(html, /data-number="([^"]+)"[\s\S]{0,200}?href="(\/read\/[^"]+)"/g)
      .map((match) => ({
        id: match[2].split('/').pop(),
        title: `Chapter ${match[1]}`,
        number: match[1],
        url: this.absoluteUrl(match[2]),
      }));
    return uniqueBy(chapters, 'url');
  }

  async fetchChapterList(mangaId, type, lang) {
    const data = await this.requestJson(`/ajax/read/${mangaId}/${type}/${lang}?vrf=${generateMangafireVrf(`${mangaId}@${type}@${lang}`)}`, {
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    return matchAll(data.result?.html || '', /<a[^>]+href="([^"]+)"[^>]+data-number="([^"]+)"[^>]+data-id="([^"]+)"/g)
      .map((match) => ({
        url: this.absoluteUrl(match[1]),
        slug: match[1].split('/').pop(),
        number: match[2],
        id: match[3],
      }));
  }

  parseReadPath(value) {
    if (value && typeof value === 'object') return this.parseReadPath(value.url || value.id);
    const path = String(value).startsWith('http') ? new URL(value).pathname : String(value);
    const match = path.match(/\/read\/[^.]+\.([^/]+)\/([^/]+)\/((?:chapter|volume)-[^/]+)/);
    if (!match) throw new Error(`Invalid Mangafire reader path: ${value}`);
    return { mangaId: match[1], lang: match[2], chapterSlug: match[3], type: match[3].startsWith('volume-') ? 'volume' : 'chapter' };
  }

  firstText(html, regex) {
    const match = String(html).match(regex);
    return match ? stripTags(match[1]) : null;
  }

  firstAttribute(html, regex) {
    const match = String(html).match(regex);
    return match ? match[1] : null;
  }

  toMangaPath(value) {
    if (String(value).startsWith('http')) return new URL(value).pathname;
    if (String(value).startsWith('/manga/')) return value;
    return `/manga/${value}`;
  }
}

module.exports = MangafireSource;
