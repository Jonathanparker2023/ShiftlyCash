// Vercel serverless function — same-origin proxy for ElevenLabs text-to-speech.
// The API key lives ONLY here, read from a server-side env var. Never commit a real key.
// Required env var (set in Vercel Project Settings -> Environment Variables): ELEVENLABS_API_KEY
//
// The browser POSTs to /api/elevenlabs?voice=<voiceId> with the same JSON body it used
// to send directly (text, model_id, voice_settings); this function forwards it upstream
// with the secret header attached server-side and streams back the audio/mpeg bytes.
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { res.status(500).json({ error: 'ELEVENLABS_API_KEY is not configured on the server' }); return; }
  const voice = req.query && req.query.voice;
  if (!voice) { res.status(400).json({ error: 'missing voice query parameter' }); return; }
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const upstream = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voice), {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: body
    });
    if (!upstream.ok) {
      const t = await upstream.text();
      res.status(upstream.status).send(t);
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: 'Upstream request failed: ' + String(e && e.message ? e.message : e) });
  }
};
