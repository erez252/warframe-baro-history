// api/warframe-data.js
export default async function handler(req, res) {
  const rawUrl = 'https://raw.githubusercontent.com/erez252/warframe-baro-history/main/data/warframe_data.json';
  const r = await fetch(rawUrl);
  if (!r.ok) return res.status(r.status).send('Failed to fetch data');
  const json = await r.json();
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.status(200).json(json);
}
