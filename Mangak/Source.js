const config = require('./Config.json');
const { MangaSource } = require('../Common/SourceBase');
const { stripTags } = require('../Common/html');

class MangakSource extends MangaSource {
  constructor(options = {}) {
    super(config, options);
  }

  async search(query) {
    const data = await this.nextData(`/search?q=${encodeURIComponent(query)}`);
    return this.mangaList(this.mapSeries(data.props?.pageProps?.ssrItems || []));
  }

  async popular() {
    const data = await this.nextData('/trending/manga');
    return this.mangaList(this.mapSeries(data.props?.pageProps?.items || data.props?.pageProps?.ssrItems || []));
  }

  async latest() {
    const data = await this.nextData('/latest');
    return this.mangaList(this.mapSeries(data.props?.pageProps?.items || data.props?.pageProps?.ssrItems || []));
  }

  async details(seriesUrlOrPath) {
    const path = this.toSeriesPath(seriesUrlOrPath);
    const data = await this.nextData(path);
    const manga = data.props?.pageProps?.initialManga;
    if (!manga) throw new Error(`Mangak details not found for ${path}`);
    return this.manga({
      id: manga.id || manga.slug,
      title: manga.name,
      url: this.absoluteUrl(manga.url || path),
      coverUrl: manga.cover || null,
      status: manga.status || null,
      description: stripTags(manga.description || ''),
      tags: (manga.genres || []).map((genre) => genre.name || genre.slug).filter(Boolean),
      chapters: this.mapChapters(manga.chapters || manga.latestChapters || []),
    });
  }

  async chapters(seriesUrlOrPath) {
    return this.chapterList((await this.details(seriesUrlOrPath)).chapters);
  }

  async pages(chapterUrlOrPath) {
    const data = await this.nextData(this.toPath(chapterUrlOrPath));
    const chapter = data.props?.pageProps?.initialChapter;
    if (!chapter) throw new Error(`Mangak reader data not found for ${chapterUrlOrPath}`);
    return this.pageList((chapter.images || []).map((url, index) => ({ index: index + 1, url })));
  }

  mapSeries(items) {
    return items.map((item) => ({
      id: item.id || item.slug,
      title: item.name,
      url: this.absoluteUrl(item.url),
      coverUrl: item.cover || null,
      latestChapter: item.latestChapters?.[0] ? this.mapChapters([item.latestChapters[0]])[0] : null,
    })).filter((item) => item.title && item.url);
  }

  mapChapters(chapters) {
    return this.chapterList(chapters.map((chapter) => ({
      id: chapter.realId || chapter.id || chapter.slug,
      title: chapter.name || chapter.slug,
      number: chapter.chapterNumber || chapter.chapter_number || null,
      url: this.absoluteUrl(chapter.url),
    })).filter((chapter) => chapter.url));
  }

  async nextData(path) {
    const html = await this.request(path);
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) throw new Error(`Mangak Next data not found for ${path}`);
    return JSON.parse(match[1]);
  }

  toSeriesPath(value) {
    const path = this.toPath(value);
    return path.startsWith('/manga/') ? path.slice('/manga'.length) : path;
  }

  toPath(value) {
    if (value && typeof value === 'object') return this.toPath(value.url || value.id);
    if (String(value).startsWith('http')) return new URL(value).pathname;
    return String(value).startsWith('/') ? value : `/${value}`;
  }
}

module.exports = MangakSource;
