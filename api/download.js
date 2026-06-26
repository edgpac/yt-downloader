'use strict';

const ytdl = require('@distube/ytdl-core');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, quality, mode } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

  let videoUrl = url.trim();

  if (!ytdl.validateURL(videoUrl)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    const info = await ytdl.getInfo(videoUrl, {
      requestOptions: {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    });

    const title = info.videoDetails.title || 'video';

    if (mode === 'audio') {
      const formats = ytdl
        .filterFormats(info.formats, 'audioonly')
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
      const fmt = formats[0];
      if (!fmt) throw new Error('No audio stream found for this video');
      return res.json({
        downloadUrl: fmt.url,
        title,
        ext: fmt.container || 'webm',
        quality: 'audio',
      });
    }

    if (mode === 'mute') {
      const formats = ytdl
        .filterFormats(info.formats, 'videoonly')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const qLabel = quality !== 'max' ? quality + 'p' : null;
      const fmt = (qLabel && formats.find(f => f.qualityLabel === qLabel)) || formats[0];
      if (!fmt) throw new Error('No video stream found');
      return res.json({
        downloadUrl: fmt.url,
        title,
        ext: fmt.container || 'mp4',
        quality: fmt.qualityLabel,
      });
    }

    // Video + audio (combined streams — YouTube provides these up to ~720p)
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

    const note =
      quality === '1080' && fmt.qualityLabel !== '1080p'
        ? `1080p requires stream merging — returning best available: ${fmt.qualityLabel}`
        : null;

    return res.json({
      downloadUrl: fmt.url,
      title,
      ext: fmt.container || 'mp4',
      quality: fmt.qualityLabel,
      note,
    });
  } catch (e) {
    const msg = e?.message || 'Failed to fetch video info';
    const status = msg.includes('private') || msg.includes('not available') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
};
