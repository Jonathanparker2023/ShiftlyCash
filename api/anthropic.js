// Vercel serverless function — same-origin proxy for the Anthropic Messages API.
// The API key lives ONLY here, read from a server-side env var. Never commit a real key.
// Required env var (set in Vercel Project Settings -> Environment Variables): ANTHROPIC_API_KEY
//
// The browser POSTs the same JSON body it used to send directly to Anthropic
// (model, max_tokens, system, messages); this function forwards it upstream
// with the secret header attached server-side and returns the JSON response.
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' }); return; }
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: body
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'Upstream request failed: ' + String(e && e.message ? e.message : e) });
  }
};
