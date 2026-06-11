const config = require('./Config.json');
const { MangaSource } = require('../Common/SourceBase');
const { matchAll, stripTags, uniqueBy } = require('../Common/html');
const { titleFromSlug } = require('../Common/listParsers');

class MangataroSource extends MangaSource {
  constructor(options = {}) {
    super(config, options);
  }

  async search(query) {
    const items = await this.requestJson(`/wp-json/wp/v2/search?subtype=manga&search=${encodeURIComponent(query)}`);
    return this.mangaList(items.map((item) => ({
      id: String(item.id),
      title: stripTags(item.title),
      url: item.url,
      coverUrl: null,
    })).filter((item) => item.url));
  }

  async popular() {
    const items = await this.requestJson('/wp-json/wp/v2/manga?per_page=20');
    return this.mangaList(items.map((item) => ({
      id: String(item.id),
      title: stripTags(item.title?.rendered || ''),
      url: item.link,
      coverUrl: null,
    })).filter((item) => item.url));
  }

  async latest() {
    return this.mangaList(this.parseSeries(await this.request('/home')).map((item) => ({
      ...item,
      latestChapter: item.latestChapter || null,
    })));
  }

  async details(seriesUrlOrPath) {
    const path = this.toSeriesPath(seriesUrlOrPath);
    const html = await this.request(path);
    return this.manga({
      id: this.firstAttribute(html, /data-manga-id="([^"]+)"/) || path.split('/').pop(),
      title: this.firstAttribute(html, /data-manga-title="([^"]+)"/) || this.firstText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || titleFromSlug(path),
      url: this.absoluteUrl(path),
      coverUrl: this.firstAttribute(html, /data-manga-cover="([^"]+)"/) || this.firstAttribute(html, /<img[^>]+src="([^"]+content\/media[^"]+)"/),
      tags: matchAll(html, /<span[^>]*class="[^"]*"[^>]*>(Action|Adventure|Comedy|Drama|Fantasy|Romance|Shounen|Seinen|Supernatural|Sci-Fi|Horror)<\/span>/g).map((match) => match[1]),
      description: this.firstText(html, /id="description-content-tab"[^>]*>([\s\S]*?)<\/div>/i),
      chapters: this.parseChapters(html),
    });
  }

  async chapters(seriesUrlOrPath) {
    return this.chapterList((await this.details(seriesUrlOrPath)).chapters);
  }

  async pages(chapterUrlOrPath) {
    const html = await this.request(this.toPath(chapterUrlOrPath));
    return [...new Set(matchAll(html, /https?:\/\/[^"'<> ]+\/storage\/chapters\/[^"'<> ]+\.(?:webp|jpg|jpeg|png)/g)
      .map((match) => match[0].replace('mangataro.yachts', 'mangataro.org')))]
      .map((url, index) => this.page({ index: index + 1, url }));
  }

  parseSeries(html) {
    const items = matchAll(html, /href="(https:\/\/mangataro\.org\/manga\/([^"]+))"([\s\S]{0,700}?)(?=<a\s|<\/a>|$)/g)
      .map((match) => {
        const chapter = match[3].match(/href="(https:\/\/mangataro\.org\/read\/[^"]+)"/);
        return {
          id: match[2],
          title: titleFromSlug(match[2]),
          url: match[1],
          coverUrl: this.firstAttribute(match[3], /(?:src|data-src)="([^"]+)"/),
          latestChapter: chapter ? { id: chapter[1].split('/').pop(), title: titleFromSlug(chapter[1]), url: chapter[1] } : null,
        };
      });
    return uniqueBy(items, 'url');
  }

  parseChapters(html) {
    const chapters = matchAll(html, /href="(https:\/\/mangataro\.org\/read\/[^"]+)"/g).map((match) => ({
      id: match[1].split('/').pop(),
      title: titleFromSlug(match[1]),
      number: this.chapterNumberFromUrl(match[1]),
      url: match[1],
    }));
    return uniqueBy(chapters, 'url');
  }

  chapterNumberFromUrl(url) {
    const match = String(url).match(/\/ch(?:apter)?(\d+(?:\.\d+)?)/i);
    return match ? Number(match[1]) : null;
  }

  firstText(html, regex) {
    const match = String(html).match(regex);
    return match ? stripTags(match[1]) : null;
  }

  firstAttribute(html, regex) {
    const match = String(html).match(regex);
    return match ? match[1] : null;
  }

  toSeriesPath(value) {
    const path = this.toPath(value);
    return path.startsWith('/manga/') ? path : `/manga/${path.replace(/^\/+/, '')}`;
  }

  toPath(value) {
    if (value && typeof value === 'object') return this.toPath(value.url || value.id);
    if (String(value).startsWith('http')) return new URL(value).pathname;
    return String(value).startsWith('/') ? value : `/${value}`;
  }
}

module.exports = MangataroSource;
