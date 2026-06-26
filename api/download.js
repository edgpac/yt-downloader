'use strict';

const INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacydev.net',
  'https://yt.artemislena.eu',
  'https://invidious.projectsegfau.lt',
];

function extractVideoId(url) {
  const m = String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function getVideoInfo(videoId) {
  let lastError = 'All servers are busy — please try again in a moment.';
  for (const instance of INSTANCES) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 9000);
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        signal: ac.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!res.ok) { lastError = `Server returned ${res.status}`; continue; }
      const data = await res.json();
      if (data.error) {
        lastError = data.error;
        if (/private|not available|unavailable/i.test(data.error)) break;
        continue;
      }
      return data;
    } catch (e) {
      lastError = e.name === 'AbortError' ? 'Server timed out' : e.message;
    }
  }
  throw new Error(lastError);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, quality, mode } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

  const videoId = extractVideoId(url.trim());
  if (!videoId) return res.status(400).json({ error: 'Could not parse video ID from URL' });

  try {
    const info = await getVideoInfo(videoId);
    const title = info.title || 'video';

    if (mode === 'audio') {
      const formats = (info.adaptiveFormats || [])
        .filter(f => typeof f.type === 'string' && f.type.startsWith('audio/'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (!formats[0]) throw new Error('No audio stream found for this video');
      return res.json({ downloadUrl: formats[0].url, title, ext: 'm4a', quality: 'audio' });
    }

    if (mode === 'mute') {
      const formats = (info.adaptiveFormats || [])
        .filter(f => typeof f.type === 'string' && f.type.startsWith('video/'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const qLabel = quality === 'max' ? null : quality + 'p';
      const fmt = (qLabel && formats.find(f => f.qualityLabel === qLabel)) || formats[0];
      if (!fmt) throw new Error('No video stream found');
      return res.json({ downloadUrl: fmt.url, title, ext: 'mp4', quality: fmt.qualityLabel });
    }

    // Combined video + audio (formatStreams, max ~720p)
    const combined = info.formatStreams || [];
    const qLabel = (quality === 'max' || quality === '1080') ? null : quality + 'p';
    let fmt = qLabel ? combined.find(f => f.qualityLabel === qLabel) : null;
    if (!fmt) {
      for (const q of ['720p60', '720p', '480p', '360p', '240p']) {
        fmt = combined.find(f => f.qualityLabel === q);
        if (fmt) break;
      }
      fmt = fmt || combined[0];
    }
    if (!fmt) throw new Error('No combined stream found for this video');

    const note = (quality === '1080' && fmt.qualityLabel !== '1080p')
      ? `1080p needs stream merging — got best available: ${fmt.qualityLabel}`
      : null;

    return res.json({ downloadUrl: fmt.url, title, ext: 'mp4', quality: fmt.qualityLabel, note });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to fetch video info' });
  }
};
