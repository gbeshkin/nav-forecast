module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

  try {
    const response = await fetch('https://gis.transpordiamet.ee/navhoiatused/en.html', {
      headers: {
        'User-Agent': 'TallinnBayNavForecast/4.0 (+vercel serverless)'
      }
    });

    if (!response.ok) {
      res.status(response.status).json({ items: [], meta: { source: 'Transpordiamet', message: `Upstream status ${response.status}` } });
      return;
    }

    const html = await response.text();
    const compact = html.replace(/\s+/g, ' ');
    const matches = [...compact.matchAll(/Nr\s*(\d+):\s*([^<]+?)\.\s*([^.;<]*\d{2}\/\d{2}\/\d{4}[^<]*?)(?=Nr\s*\d+:|<\/|$)/g)];

    const items = matches.slice(0, 8).map((match) => {
      const number = match[1];
      const title = match[2].trim();
      const blob = match[3].trim();
      const periodMatch = blob.match(/(\d{2}\/\d{2}\/\d{4}[^.;<]*)/);
      const period = periodMatch ? periodMatch[1].trim() : '';
      const ended = /-\s*$/.test(period) ? false : false;
      return {
        id: number,
        title: `Nr ${number}: ${title}`,
        period,
        area: title,
        text: 'Смотри официальный сервис Transpordiamet для полной карточки и координат.',
        ended
      };
    });

    if (!items.length) {
      const simple = [...compact.matchAll(/Nr\s*(\d+):\s*([^<]+?)(?=Nr\s*\d+:|<\/|$)/g)].slice(0, 8).map((match) => ({
        id: match[1],
        title: `Nr ${match[1]}: ${match[2].trim()}`,
        period: '',
        area: '',
        text: 'Смотри официальный сервис Transpordiamet для полной карточки и координат.',
        ended: false
      }));
      res.status(200).json({ items: simple, meta: { source: 'Transpordiamet HTML parser', fallback: true } });
      return;
    }

    res.status(200).json({ items, meta: { source: 'Transpordiamet HTML parser' } });
  } catch (error) {
    res.status(500).json({ items: [], meta: { source: 'warnings proxy', message: error.message } });
  }
};
