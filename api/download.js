'use strict';

const ytdl = require('@distube/ytdl-core');

function parseCookies(str) {
  if (!str) return [];
  return str.split(';').map(pair => {
    const eq = pair.indexOf('=');
    if (eq === -1) return null;
    return {
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      domain: '.youtube.com',
      path: '/',
      httpOnly: false,
      secure: true,
    };
  }).filter(Boolean);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, quality, mode } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

  const videoUrl = url.trim();
  if (!ytdl.validateURL(videoUrl)) return res.status(400).json({ error: 'Invalid YouTube URL' });

  try {
    const cookieStr = process.env.YOUTUBE_COOKIE || '';
    const cookies = parseCookies(cookieStr);
    const agent = ytdl.createAgent(cookies);

    const info = await ytdl.getInfo(videoUrl, { agent });
    const title = info.videoDetails.title || 'video';

    if (mode === 'audio') {
      const formats = ytdl
        .filterFormats(info.formats, 'audioonly')
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
      const fmt = formats[0];
      if (!fmt) throw new Error('No audio stream found for this video');
      return res.json({ downloadUrl: fmt.url, title, ext: fmt.container || 'webm', quality: 'audio' });
    }

    if (mode === 'mute') {
      const formats = ytdl
        .filterFormats(info.formats, 'videoonly')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const qLabel = quality !== 'max' ? quality + 'p' : null;
      const fmt = (qLabel && formats.find(f => f.qualityLabel === qLabel)) || formats[0];
      if (!fmt) throw new Error('No video stream found');
      return res.json({ downloadUrl: fmt.url, title, ext: fmt.container || 'mp4', quality: fmt.qualityLabel });
    }

    // Combined video + audio
    const combined = ytdl.filterFormats(info.formats, 'audioandvideo');
    const qLabel = quality !== 'max' && quality !== '1080' ? quality + 'p' : null;
    let fmt = qLabel ? combined.find(f => f.qualityLabel === qLabel) : null;
    if (!fmt) {
      for (const q of ['720p60', '720p', '480p', '360p']) {
        fmt = combined.find(f => f.qualityLabel === q);
        if (fmt) break;
      }
      fmt = fmt || combined[0];
    }
    if (!fmt) throw new Error('No combined stream found for this video');

    const note = quality === '1080' && fmt.qualityLabel !== '1080p'
      ? `1080p requires stream merging — returning best available: ${fmt.qualityLabel}`
      : null;

    return res.json({ downloadUrl: fmt.url, title, ext: fmt.container || 'mp4', quality: fmt.qualityLabel, note });
  } catch (e) {
    const msg = e?.message || 'Failed to fetch video info';
    const botBlocked = /sign in|bot|confirm/i.test(msg);
    return res.status(botBlocked ? 403 : 500).json({ error: msg, botBlocked });
  }
};
