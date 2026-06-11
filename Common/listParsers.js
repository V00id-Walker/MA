const { decodeHtml, matchAll, stripTags, uniqueBy } = require('./html');

function titleFromSlug(slug = '') {
  return decodeURIComponent(String(slug).split('/').filter(Boolean).pop() || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/-\d+[a-z0-9]*$/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseLinkedSeries(html, baseUrl, pattern) {
  const items = matchAll(html, pattern).map((match) => {
    const path = match[1];
    const slug = path.split('/').filter(Boolean).pop();
    return {
      id: slug,
      title: titleFromSlug(slug),
      url: `${baseUrl}${path}`,
      coverUrl: null,
    };
  });
  return uniqueBy(items, 'url');
}

function parseImages(html, reject = () => false) {
  return [...new Set(matchAll(html, /(?:src|href)="([^"]+\.(?:avif|webp|jpg|jpeg|png)(?:\?[^"]*)?)"/gi)
    .map((match) => decodeHtml(match[1]))
    .filter((url) => !reject(url)))];
}

module.exports = {
  parseImages,
  parseLinkedSeries,
  stripTags,
  titleFromSlug,
};
