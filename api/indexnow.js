// Tells Bing (and other IndexNow engines) about every public URL in our sitemaps.
// Runs from Vercel Cron once a day; manual run: GET with "Authorization: Bearer <CRON_SECRET>".
const KEY = 'ab593ba87ff766fc6878851cf15a0caa';
const HOST = 'www.maxzzdiesel.com';

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret ? req.headers.authorization !== `Bearer ${secret}` : !/vercel-cron/i.test(req.headers['user-agent'] || '')) return res.status(401).json({ error: 'unauthorized' });
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return res.status(200).json({ skipped: 'not production' });
  try {
    const urls = [];
    for (const sm of ['/sitemap.xml', '/sitemap-parts.xml']) {
      const r = await fetch(`https://${HOST}${sm}`);
      if (!r.ok) continue;
      const xml = await r.text();
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1].replace(/&amp;/g, '&'));
    }
    if (!urls.length) return res.status(200).json({ sent: 0 });
    const r = await fetch('https://api.indexnow.org/IndexNow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls.slice(0, 10000) })
    });
    console.log('indexnow', r.status, urls.length);
    return res.status(200).json({ sent: urls.length, status: r.status });
  } catch (e) {
    console.error('indexnow', e.message);
    return res.status(500).json({ error: 'failed' });
  }
};
