'use strict';
const axios = require('axios');
const NodeCache = require('node-cache');

const listCache = new NodeCache({ stdTTL: 600 });
const detailCache = new NodeCache({ stdTTL: 300 });

const API_BASE  = 'https://phim.nguonc.com/api';
const SITE_BASE = 'https://phim.nguonc.com';
const IMG_BASE  = 'https://phim.nguonc.com';

const client = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': SITE_BASE + '/',
    'Accept': 'application/json, */*',
  },
});

async function apiGet(url, params = {}) {
  try {
    const res = await client.get(url, { params });
    return res.data;
  } catch(e) {
    console.error('[NguonC] API error:', url, e.message);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildThumb(raw) {
  if (!raw) return '';
  raw = raw.trim();
  if (raw.startsWith('http')) return raw;
  return IMG_BASE + '/' + raw.replace(/^\//, '');
}

function cleanHtml(text) {
  return (text || '').replace(/<[^>]+>/g, '').trim();
}

function listFromDicts(arr, key = 'name') {
  if (!Array.isArray(arr)) return '';
  return arr.map(d => d[key] || '').filter(Boolean).join(', ');
}

function inferType(item) {
  const type = (item.type || '').toLowerCase();
  if (['series','tvshows','hoathinh','phim-bo'].includes(type)) return 'series';
  if (['single','movie','phim-le'].includes(type)) return 'movie';
  const epTot = String(item.ep_total || '');
  const epCur = String(item.ep_current || '').toLowerCase();
  const totMatch = epTot.match(/(\d+)/);
  if (totMatch && parseInt(totMatch[1]) > 1) return 'series';
  if (['hoàn tất','full','complete'].some(x => epCur.includes(x))) {
    const curMatch = epCur.match(/(\d+)/);
    if (curMatch && parseInt(curMatch[1]) > 1) return 'series';
    return 'movie';
  }
  const curMatch = epCur.match(/(\d+)/);
  if (curMatch && parseInt(curMatch[1]) > 1) return 'series';
  return 'movie';
}

// ── Parse list response ───────────────────────────────────────────────────────
function parseItems(data) {
  if (!data || data.status !== 'success') return { items: [], paginate: {} };
  const raw = data.items || [];
  const paginate = data.paginate || {};
  const items = raw.map(item => {
    const name = item.name || '';
    const originName = item.original_name || '';
    const displayName = (originName && originName.toLowerCase() !== name.toLowerCase())
      ? `${name} - ${originName}` : name;
    const epCur = String(item.current_episode || item.episode_current || '');
    const epTot = String(item.total_episodes  || item.episode_total  || '');
    return {
      name, originName, displayName,
      slug: item.slug || '',
      thumb: buildThumb(item.thumb_url || item.poster_url),
      poster: buildThumb(item.poster_url || item.thumb_url),
      epCur, epTot,
      year: String(item.year || ''),
      type: String(item.type || ''),
    };
  });
  return { items, paginate };
}

// ── Parse detail response ─────────────────────────────────────────────────────
function parseDetail(data) {
  if (!data || !data.movie) return null;
  const movie = data.movie;
  const name = movie.name || '';
  const originName = movie.original_name || '';
  const displayName = (originName && originName.toLowerCase() !== name.toLowerCase())
    ? `${name} - ${originName}` : name;

  // Parse servers + episodes
  const servers = [];
  for (const sv of (movie.episodes || [])) {
    const svName = sv.server_name || 'Server';
    const eps = [];
    for (const ep of (sv.items || [])) {
      const m3u8  = (ep.m3u8  || '').trim();
      const embed = (ep.embed || '').trim();
      let link = '';
      let isHls = false;
      if (m3u8 && m3u8.startsWith('http') && m3u8.includes('.m3u8')) {
        link = m3u8; isHls = true;
      } else if (embed && embed.startsWith('http')) {
        link = embed; isHls = false;
      } else continue;
      eps.push({ name: ep.name || '?', m3u8, embed, link, isHls });
    }
    if (eps.length) servers.push({ serverName: svName, episodes: eps });
  }

  const tmdb = movie.tmdb || {};
  return {
    name, originName, displayName,
    slug: movie.slug || '',
    thumb: buildThumb(movie.thumb_url || movie.poster_url),
    poster: buildThumb(movie.poster_url || movie.thumb_url),
    plot: cleanHtml(movie.content || '') || displayName,
    year: String(movie.year || ''),
    genre: listFromDicts(movie.category || []),
    country: listFromDicts(movie.country || []),
    actor: Array.isArray(movie.actor) ? movie.actor.join(', ') : '',
    director: Array.isArray(movie.director) ? movie.director.join(', ') : '',
    rating: parseFloat(tmdb.vote_average || 0) || 0,
    epCurrent: String(movie.episode_current || ''),
    epTotal: String(movie.episode_total || ''),
    type: movie.type || '',
    servers,
  };
}

// ── API calls ─────────────────────────────────────────────────────────────────
async function getLatest(page = 1) {
  const key = `latest_${page}`;
  const c = listCache.get(key); if (c) return c;
  const data = await apiGet(`${API_BASE}/films/phim-moi-cap-nhat`, { page });
  const r = parseItems(data);
  listCache.set(key, r); return r;
}

async function getCategory(slug, page = 1) {
  const key = `cat_${slug}_${page}`;
  const c = listCache.get(key); if (c) return c;
  const data = await apiGet(`${API_BASE}/films/danh-sach/${slug}`, { page });
  const r = parseItems(data);
  listCache.set(key, r); return r;
}

async function getGenre(slug, page = 1) {
  const key = `genre_${slug}_${page}`;
  const c = listCache.get(key); if (c) return c;
  const data = await apiGet(`${API_BASE}/films/the-loai/${slug}`, { page });
  const r = parseItems(data);
  listCache.set(key, r); return r;
}

async function getCountry(slug, page = 1) {
  const key = `country_${slug}_${page}`;
  const c = listCache.get(key); if (c) return c;
  const data = await apiGet(`${API_BASE}/films/quoc-gia/${slug}`, { page });
  const r = parseItems(data);
  listCache.set(key, r); return r;
}

async function search(keyword, page = 1) {
  const key = `search_${keyword}_${page}`;
  const c = listCache.get(key); if (c) return c;
  const data = await apiGet(`${API_BASE}/films/search`, { keyword, page, limit: 24 });
  const r = parseItems(data);
  listCache.set(key, r); return r;
}

async function getDetail(slug) {
  const key = `detail_${slug}`;
  const c = detailCache.get(key); if (c) return c;
  const data = await apiGet(`${API_BASE}/film/${slug}`);
  const r = parseDetail(data);
  if (r) detailCache.set(key, r);
  return r;
}

function toMeta(item) {
  const type = inferType(item);
  return {
    id: `nguonc:${item.slug}`,
    type,
    name: item.displayName || item.name,
    poster: item.poster || item.thumb || '',
    background: item.thumb || item.poster || '',
    description: `${item.epCur ? 'Tập: ' + item.epCur : ''}${item.year ? ' | ' + item.year : ''}`.trim(),
    year: item.year ? parseInt(item.year) : undefined,
    language: 'vi',
  };
}

function toFullMeta(detail) {
  const type = detail.type === 'single' ? 'movie' : 'series';
  const meta = {
    id: `nguonc:${detail.slug}`,
    type,
    name: detail.displayName || detail.name,
    poster: detail.poster || detail.thumb || '',
    background: detail.thumb || detail.poster || '',
    description: detail.plot || '',
    year: detail.year ? parseInt(detail.year) : undefined,
    genres: detail.genre ? detail.genre.split(', ') : [],
    cast: detail.actor ? detail.actor.split(', ') : [],
    director: detail.director || '',
    imdbRating: detail.rating ? String(detail.rating) : undefined,
    language: 'vi',
  };

  // Build videos cho series
  if (type === 'series' && detail.servers.length > 0) {
    const videos = [];
    for (let si = 0; si < detail.servers.length; si++) {
      const server = detail.servers[si];
      for (let ei = 0; ei < server.episodes.length; ei++) {
        const ep = server.episodes[ei];
        const epNum = parseInt(ep.name) || (ei + 1);
        videos.push({
          id: `nguonc:${detail.slug}:${si}:${ei}`,
          title: `Tập ${ep.name} - ${server.serverName}`,
          season: 1,
          episode: epNum,
        });
      }
    }
    // Deduplicate theo episode number
    const seen = new Set();
    meta.videos = videos.filter(v => {
      if (seen.has(v.episode)) return false;
      seen.add(v.episode); return true;
    });
  }

  return meta;
}

const CATEGORIES = [
  { slug: 'phim-bo',   name: '📺 Phim Bộ' },
  { slug: 'phim-le',   name: '🎬 Phim Lẻ' },
  { slug: 'dang-chieu',name: '🎦 Đang Chiếu' },
  { slug: 'tv-shows',  name: '📡 TV Shows' },
  { slug: 'hoat-hinh', name: '🎌 Hoạt Hình' },
];

const GENRES = [
  { slug: 'hanh-dong',           name: '🥊 Hành Động' },
  { slug: 'tinh-cam',            name: '💖 Tình Cảm' },
  { slug: 'lang-man',            name: '🌹 Lãng Mạn' },
  { slug: 'phim-hai',            name: '😂 Hài' },
  { slug: 'bi-an',               name: '🔍 Bí Ẩn' },
  { slug: 'tam-ly',              name: '🧠 Tâm Lý' },
  { slug: 'kinh-di',             name: '👻 Kinh Dị' },
  { slug: 'gia-tuong',           name: '🧙 Giả Tưởng' },
  { slug: 'khoa-hoc-vien-tuong', name: '🚀 Khoa Học Viễn Tưởng' },
  { slug: 'co-trang',            name: '⚔️ Cổ Trang' },
  { slug: 'chien-tranh',         name: '🪖 Chiến Tranh' },
  { slug: 'gay-can',             name: '😱 Gây Cấn' },
  { slug: 'chinh-kich',          name: '🎭 Chính Kịch' },
  { slug: 'lich-su',             name: '📜 Lịch Sử' },
  { slug: 'gia-dinh',            name: '🏠 Gia Đình' },
  { slug: 'phieu-luu',           name: '🌍 Phiêu Lưu' },
  { slug: 'tai-lieu',            name: '🎥 Tài Liệu' },
  { slug: 'phim-18',             name: '🔞 Phim 18+' },
];

const COUNTRIES = [
  { slug: 'au-my',      name: '🇺🇸 Âu Mỹ' },
  { slug: 'trung-quoc', name: '🇨🇳 Trung Quốc' },
  { slug: 'han-quoc',   name: '🇰🇷 Hàn Quốc' },
  { slug: 'nhat-ban',   name: '🇯🇵 Nhật Bản' },
  { slug: 'hong-kong',  name: '🇭🇰 Hồng Kông' },
  { slug: 'viet-nam',   name: '🇻🇳 Việt Nam' },
  { slug: 'thai-lan',   name: '🇹🇭 Thái Lan' },
  { slug: 'anh',        name: '🇬🇧 Anh' },
  { slug: 'phap',       name: '🇫🇷 Pháp' },
  { slug: 'dai-loan',   name: '🇹🇼 Đài Loan' },
  { slug: 'an-do',      name: '🇮🇳 Ấn Độ' },
];

module.exports = {
  getLatest, getCategory, getGenre, getCountry, search, getDetail,
  toMeta, toFullMeta, inferType,
  CATEGORIES, GENRES, COUNTRIES,
};