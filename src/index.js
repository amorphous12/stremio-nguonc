'use strict';
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const nc = require('./nguonc');

const GENRE_MAP   = {};
nc.GENRES.forEach(g => { GENRE_MAP[g.name] = g.slug; });
const COUNTRY_MAP = {};
nc.COUNTRIES.forEach(c => { COUNTRY_MAP[c.name] = c.slug; });
const GENRE_NAMES   = nc.GENRES.map(g => g.name);
const COUNTRY_NAMES = nc.COUNTRIES.map(c => c.name);

const EXTRA_BASE = [{ name: 'skip' }, { name: 'search' }];
const EXTRA_FULL = [
  { name: 'skip' },
  { name: 'search' },
  { name: 'genre',   options: GENRE_NAMES },
  { name: 'country', options: COUNTRY_NAMES },
];

const manifest = {
  id: 'community.nguonc.com',
  version: '1.2.0',
  name: 'NguonC',
  description: 'Xem phim từ NguonC — Phim Bộ, Phim Lẻ, Vietsub, Thuyết Minh',
  logo: 'https://phim.nguonc.com/favicon.ico',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['nguonc:', 'tt'],
  catalogs: [
    { id: 'latest',     type: 'movie',  name: '🆕 Phim Mới Cập Nhật', extra: EXTRA_BASE },
    { id: 'phim-bo',    type: 'series', name: '📺 Phim Bộ',           extra: EXTRA_FULL },
    { id: 'phim-le',    type: 'movie',  name: '🎬 Phim Lẻ',           extra: EXTRA_FULL },
    { id: 'dang-chieu', type: 'movie',  name: '🎦 Đang Chiếu',         extra: EXTRA_BASE },
    { id: 'tv-shows',   type: 'series', name: '📡 TV Shows',           extra: EXTRA_BASE },
    { id: 'hoat-hinh',  type: 'series', name: '🎌 Hoạt Hình',         extra: EXTRA_BASE },
    { id: 'nc-au-my',      type: 'movie',  name: '🇺🇸 Phim Âu Mỹ',    extra: EXTRA_BASE },
    { id: 'nc-han-quoc',   type: 'series', name: '🇰🇷 Phim Hàn',       extra: EXTRA_BASE },
    { id: 'nc-trung-quoc', type: 'series', name: '🇨🇳 Phim Trung',     extra: EXTRA_BASE },
    { id: 'nc-nhat-ban',   type: 'series', name: '🇯🇵 Phim Nhật',       extra: EXTRA_BASE },
    { id: 'nc-hong-kong',  type: 'series', name: '🇭🇰 Phim Hồng Kông',  extra: EXTRA_BASE },
    { id: 'nc-viet-nam',   type: 'movie',  name: '🇻🇳 Phim Việt',       extra: EXTRA_BASE },
    { id: 'nc-thai-lan',   type: 'series', name: '🇹🇭 Phim Thái',       extra: EXTRA_BASE },
  ],
};

const CAT_SLUGS = new Set(['phim-bo','phim-le','dang-chieu','tv-shows','hoat-hinh']);
const COUNTRY_CATALOG = {
  'nc-au-my':'au-my','nc-han-quoc':'han-quoc','nc-trung-quoc':'trung-quoc',
  'nc-nhat-ban':'nhat-ban','nc-hong-kong':'hong-kong',
  'nc-viet-nam':'viet-nam','nc-thai-lan':'thai-lan',
};

const builder = new addonBuilder(manifest);

// ── Catalog ───────────────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const page = Math.floor((parseInt(extra.skip) || 0) / 24) + 1;
  let items = [];
  try {
    if (extra.search) {
      const r = await nc.search(extra.search, page);
      items = r.items || [];
    } else if (extra.genre && GENRE_MAP[extra.genre]) {
      const r = await nc.getGenre(GENRE_MAP[extra.genre], page);
      items = r.items || [];
    } else if (extra.country && COUNTRY_MAP[extra.country]) {
      const r = await nc.getCountry(COUNTRY_MAP[extra.country], page);
      items = r.items || [];
    } else if (id === 'latest') {
      const r = await nc.getLatest(page);
      items = r.items || [];
    } else if (CAT_SLUGS.has(id)) {
      const r = await nc.getCategory(id, page);
      items = r.items || [];
    } else if (COUNTRY_CATALOG[id]) {
      const r = await nc.getCountry(COUNTRY_CATALOG[id], page);
      items = r.items || [];
    }
    return { metas: items.map(nc.toMeta) };
  } catch(e) {
    console.error('[catalog] error:', e.message);
    return { metas: [] };
  }
});

// ── Meta ──────────────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {
  if (!id.startsWith('nguonc:')) return { meta: null };
  try {
    const slug = id.replace('nguonc:', '').split(':')[0];
    const detail = await nc.getDetail(slug);
    if (!detail) return { meta: null };
    return { meta: nc.toFullMeta(detail) };
  } catch(e) {
    console.error('[meta] error:', e.message);
    return { meta: null };
  }
});

// ── Stream builder ────────────────────────────────────────────────────────────
async function buildStreams(detail, siEi, episodeNum) {
  const streams = [];
  const servers = detail.servers || [];

  for (let sIdx = 0; sIdx < servers.length; sIdx++) {
    const server = servers[sIdx];
    const sn = server.serverName || `Server ${sIdx + 1}`;
    if (siEi !== null && siEi.si !== sIdx) continue;

    for (let eIdx = 0; eIdx < server.episodes.length; eIdx++) {
      const ep = server.episodes[eIdx];
      if (siEi !== null && siEi.ei !== null && siEi.ei !== eIdx) continue;
      if (episodeNum !== null) {
        const epNum = parseInt(ep.name) || (eIdx + 1);
        if (epNum !== episodeNum) continue;
      }

      if (ep.isHls && ep.m3u8) {
        streams.push({
          url: ep.m3u8,
          title: `▶ NguonC | ${sn} - Tập ${ep.name}`,
          behaviorHints: {
            notWebReady: false,
            headers: { 'Referer': 'https://phim.nguonc.com/' },
          },
        });
      } else if (ep.embed) {
        const resolved = await nc.resolveEmbed(ep.embed);
        if (resolved) {
          let embedOrigin = '';
          try { embedOrigin = new URL(ep.embed).origin; } catch(e) {}
          streams.push({
            url: resolved,
            title: `▶ NguonC | ${sn} - Tập ${ep.name}`,
            behaviorHints: {
              notWebReady: false,
              headers: {
                'Referer': ep.embed,
                'Origin': embedOrigin,
              },
            },
          });
        } else {
          streams.push({
            url: ep.embed,
            title: `🌐 NguonC | ${sn} - Tập ${ep.name} (Embed)`,
            behaviorHints: { notWebReady: true },
          });
        }
      }
    }
  }

  // Fallback: nếu không filter được → lấy server đầu tiên
  if (!streams.length && (siEi !== null || episodeNum !== null)) {
    const server = servers[0];
    if (server) {
      const sn = server.serverName || 'Server';
      for (const ep of server.episodes) {
        if (ep.isHls && ep.m3u8) {
          streams.push({
            url: ep.m3u8,
            title: `▶ NguonC | ${sn} - Tập ${ep.name}`,
            behaviorHints: {
              notWebReady: false,
              headers: { 'Referer': 'https://phim.nguonc.com/' },
            },
          });
        } else if (ep.embed) {
          const resolved = await nc.resolveEmbed(ep.embed);
          if (resolved) {
            streams.push({
              url: resolved,
              title: `▶ NguonC | ${sn} - Tập ${ep.name}`,
              behaviorHints: { notWebReady: false },
            });
          } else {
            streams.push({
              url: ep.embed,
              title: `🌐 NguonC | ${sn} - Tập ${ep.name} (Embed)`,
              behaviorHints: { notWebReady: true },
            });
          }
        }
      }
    }
  }

  console.log('[stream] streams built:', streams.length);
  return streams;
}

// ── Stream ────────────────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id }) => {
  console.log('[stream] id:', id);
  try {
    if (id.startsWith('nguonc:')) {
      const parts = id.replace('nguonc:', '').split(':');
      const slug = parts[0];
      const si = parts[1] !== undefined ? parseInt(parts[1]) : null;
      const ei = parts[2] !== undefined ? parseInt(parts[2]) : null;

      const detail = await nc.getDetail(slug);
      if (!detail) return { streams: [] };

      const streams = await buildStreams(
        detail,
        si !== null ? { si, ei } : null,
        null
      );
      return { streams };

    } else if (id.startsWith('tt')) {
      const parts = id.split(':');
      const imdbId = parts[0];
      const episodeNum = parts[2] ? parseInt(parts[2]) : null;

      let name = null;
      try {
        const res = await fetch(
          `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`,
          { signal: AbortSignal.timeout(8000) }
        );
        const meta = await res.json();
        name = meta?.meta?.name || meta?.meta?.names?.international;
      } catch(e) {
        console.error('[stream] cinemeta error:', e.message);
      }

      if (!name) return { streams: [] };
      console.log('[stream] IMDB:', imdbId, '→', name, 'ep:', episodeNum);

      const r = await nc.search(name, 1);
      if (!r.items?.length) return { streams: [] };

      const detail = await nc.getDetail(r.items[0].slug);
      if (!detail) return { streams: [] };

      const streams = await buildStreams(detail, null, episodeNum);
      return { streams };
    }

    return { streams: [] };
  } catch(e) {
    console.error('[stream] error:', e.message);
    return { streams: [] };
  }
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`NguonC Addon: http://localhost:${PORT}/manifest.json`);
