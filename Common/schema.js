const REQUIRED_METHODS = ['search', 'popular', 'latest', 'details', 'chapters', 'pages'];
const OPTIONAL_FEATURE_METHODS = ['login', 'comments', 'bookmarks', 'notifications'];

const MODEL_FIELDS = {
  Manga: [
    'id',
    'title',
    'url',
    'coverUrl',
    'description',
    'authors',
    'artists',
    'tags',
    'type',
    'status',
    'isAdult',
    'rating',
    'views',
    'latestChapter',
    'chapters',
  ],
  Chapter: [
    'id',
    'title',
    'url',
    'number',
    'mangaId',
    'volume',
    'language',
    'publishedAt',
    'pageCount',
  ],
  Page: ['index', 'url', 'width', 'height'],
  User: ['id', 'name', 'avatarUrl', 'url'],
  Comment: ['id', 'user', 'body', 'createdAt', 'updatedAt', 'chapterId', 'mangaId', 'parentId'],
  Bookmark: ['id', 'manga', 'chapter', 'status', 'type', 'createdAt', 'updatedAt'],
  SearchResult: ['items', 'total', 'page', 'hasNextPage', 'nextPageToken'],
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function withFields(fields, value, overrides = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return fields.reduce((result, field) => {
    result[field] = Object.prototype.hasOwnProperty.call(overrides, field)
      ? overrides[field]
      : Object.prototype.hasOwnProperty.call(input, field)
        ? input[field]
        : null;
    return result;
  }, {});
}

function normalizeUser(value) {
  return withFields(MODEL_FIELDS.User, value);
}

function normalizeChapter(value) {
  return withFields(MODEL_FIELDS.Chapter, value, {
    id: value?.id == null ? null : String(value.id),
    title: value?.title ?? null,
    url: value?.url ?? null,
    number: value?.number ?? null,
    mangaId: value?.mangaId == null ? null : String(value.mangaId),
    volume: value?.volume ?? null,
    language: value?.language ?? null,
    publishedAt: value?.publishedAt ?? null,
    pageCount: value?.pageCount ?? null,
  });
}

function normalizeManga(value) {
  return withFields(MODEL_FIELDS.Manga, value, {
    id: value?.id == null ? null : String(value.id),
    title: value?.title ?? null,
    url: value?.url ?? null,
    coverUrl: value?.coverUrl ?? null,
    description: value?.description ?? null,
    authors: asArray(value?.authors),
    artists: asArray(value?.artists),
    tags: asArray(value?.tags),
    type: value?.type ?? null,
    status: value?.status ?? null,
    isAdult: value?.isAdult ?? null,
    rating: value?.rating ?? null,
    views: value?.views ?? null,
    latestChapter: value?.latestChapter ? normalizeChapter(value.latestChapter) : null,
    chapters: asArray(value?.chapters).map(normalizeChapter),
  });
}

function normalizePage(value) {
  return withFields(MODEL_FIELDS.Page, value, {
    index: value?.index ?? null,
    url: value?.url ?? null,
    width: value?.width ?? null,
    height: value?.height ?? null,
  });
}

function normalizeComment(value) {
  return withFields(MODEL_FIELDS.Comment, value, {
    user: value?.user ? normalizeUser(value.user) : null,
  });
}

function normalizeBookmark(value) {
  return withFields(MODEL_FIELDS.Bookmark, value, {
    manga: value?.manga ? normalizeManga(value.manga) : null,
    chapter: value?.chapter ? normalizeChapter(value.chapter) : null,
    status: value?.status ?? null,
    type: value?.type ?? null,
  });
}

function normalizeSearchResult(value, options = {}) {
  const input = Array.isArray(value) ? { items: value } : value || {};
  return withFields(MODEL_FIELDS.SearchResult, input, {
    items: asArray(input.items).map(normalizeManga),
    total: input.total ?? null,
    page: input.page ?? options.page ?? null,
    hasNextPage: input.hasNextPage ?? null,
    nextPageToken: input.nextPageToken ?? null,
  });
}

function assertModelFields(modelName, value, path = modelName) {
  const fields = MODEL_FIELDS[modelName];
  if (!fields) throw new Error(`Unknown model schema: ${modelName}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }

  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  const missing = expected.filter((field) => !actual.includes(field));
  const extra = actual.filter((field) => !expected.includes(field));

  if (missing.length || extra.length) {
    throw new Error(`${path} fields mismatch. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}`);
  }
}

function assertSearchResult(value, path = 'SearchResult') {
  assertModelFields('SearchResult', value, path);
  if (!Array.isArray(value.items)) throw new Error(`${path}.items must be an array`);
  value.items.forEach((item, index) => assertManga(item, `${path}.items[${index}]`));
}

function assertManga(value, path = 'Manga') {
  assertModelFields('Manga', value, path);
  if (!Array.isArray(value.authors)) throw new Error(`${path}.authors must be an array`);
  if (!Array.isArray(value.artists)) throw new Error(`${path}.artists must be an array`);
  if (!Array.isArray(value.tags)) throw new Error(`${path}.tags must be an array`);
  if (!Array.isArray(value.chapters)) throw new Error(`${path}.chapters must be an array`);
  value.chapters.forEach((chapter, index) => assertChapter(chapter, `${path}.chapters[${index}]`));
  if (value.latestChapter !== null) assertChapter(value.latestChapter, `${path}.latestChapter`);
}

function assertChapter(value, path = 'Chapter') {
  assertModelFields('Chapter', value, path);
}

function assertPage(value, path = 'Page') {
  assertModelFields('Page', value, path);
}

function assertComment(value, path = 'Comment') {
  assertModelFields('Comment', value, path);
  if (value.user !== null) assertModelFields('User', value.user, `${path}.user`);
}

function assertBookmark(value, path = 'Bookmark') {
  assertModelFields('Bookmark', value, path);
  if (value.manga !== null) assertManga(value.manga, `${path}.manga`);
  if (value.chapter !== null) assertChapter(value.chapter, `${path}.chapter`);
}

function hasOwnMethod(SourceClass, method) {
  return typeof SourceClass.prototype[method] === 'function'
    && Object.prototype.hasOwnProperty.call(SourceClass.prototype, method);
}

function validateSourceClass(SourceClass, config) {
  const errors = [];
  for (const method of REQUIRED_METHODS) {
    if (!hasOwnMethod(SourceClass, method)) {
      errors.push(`${config.name || 'Source'} must implement ${method}()`);
    }
  }

  const features = Array.isArray(config.features) ? config.features : [];
  for (const feature of features) {
    if (!OPTIONAL_FEATURE_METHODS.includes(feature)) {
      errors.push(`${config.name || 'Source'} declares unknown feature "${feature}"`);
    } else if (!hasOwnMethod(SourceClass, feature)) {
      errors.push(`${config.name || 'Source'} declares ${feature} but does not implement ${feature}()`);
    }
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
}

module.exports = {
  MODEL_FIELDS,
  OPTIONAL_FEATURE_METHODS,
  REQUIRED_METHODS,
  assertBookmark,
  assertChapter,
  assertComment,
  assertManga,
  assertPage,
  assertSearchResult,
  hasOwnMethod,
  normalizeBookmark,
  normalizeChapter,
  normalizeComment,
  normalizeManga,
  normalizePage,
  normalizeSearchResult,
  normalizeUser,
  validateSourceClass,
};
