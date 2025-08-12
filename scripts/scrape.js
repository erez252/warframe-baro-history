// scripts/scrape.js
const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');

const TARGET_URL = process.env.TARGET_URL || 'https://wiki.warframe.com/w/Baro_Ki%27Teer/Trades';
const BASE_URL = 'https://wiki.warframe.com';

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  await page.waitForSelector('table.listtable.sortable.jquery-tablesorter', { timeout: 15000 });

  const extracted = await page.evaluate((baseUrl) => {
    const table = document.querySelector('table.listtable.sortable.jquery-tablesorter');
    if (!table) return [];
    const rows = Array.from(table.querySelectorAll('tbody tr'));

    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length !== 4) return null;

      const firstCell = cells[0];
      const itemNameEls = firstCell.querySelectorAll('a');
      const itemName = itemNameEls.length ? itemNameEls[itemNameEls.length - 1].innerText.trim() : null;

      // Extract Wiki URL from the first <a> tag
      const wikiAnchor = firstCell.querySelector('a');
      const wikiURL = wikiAnchor ? baseUrl + wikiAnchor.getAttribute('href') : null;

      // Extract Thumbnail URL from the <img> tag
      const imgEl = firstCell.querySelector('img');
      let wikiThumbnail = null;
      if (imgEl) {
        // Prefer srcset for higher resolution, otherwise fall back to src
        const srcset = imgEl.getAttribute('srcset');
        if (srcset) {
          const urls = srcset.split(',').map(s => s.trim().split(' '));
          // Take the 2x version if available
          wikiThumbnail = baseUrl + (urls.find(u => u[1] === '2x')?.[0] || urls[0][0]);
        } else {
          wikiThumbnail = baseUrl + imgEl.getAttribute('src');
        }
      }

      const itemType = cells[1].innerText.trim();
      const third = cells[2].innerText.trim();
      let credits = null, ducats = null;
      if (third.includes('+')) {
        const parts = third.split('+').map(s => s.trim().replace(/,/g, ''));
        credits = parseInt(parts[0], 10) || null;
        ducats = parseInt(parts[1], 10) || null;
      } else {
        credits = parseInt(third.replace(/,/g, ''), 10) || null;
      }

      // --- START of the updated date parsing logic ---
      const dateStrings = cells[3].innerText.trim().split('\n').map(s => s.trim()).filter(Boolean);
      const dates = dateStrings.map(dateString => {
        // Use a regex to extract only the YYYY-MM-DD part
        const match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) {
          const [y, m, d] = match[1].split('-').map(Number);
          return new Date(Date.UTC(y, m - 1, d, 13, 0, 0)).toISOString(); // 13:00 UTC
        }
        return null; // Return null for any non-conforming date strings
      }).filter(Boolean); // Filter out any null values

      return { itemName, itemType, credits, ducats, dates, wikiURL, wikiThumbnail };
    }).filter(Boolean);
  }, BASE_URL);

  await browser.close();

  const out = {
    scrapedAt: new Date().toISOString(),
    source: TARGET_URL,
    items: extracted
  };

  const dir = path.join(process.cwd(), 'data');
  await fs.mkdir(dir, { recursive: true });
  const filename = path.join(dir, 'warframe_data.json');
  await fs.writeFile(filename, JSON.stringify(out, null, 2), 'utf8');
  console.log('Saved:', filename);
})();
