// scripts/scrape.js
const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');

const TARGET_URL = process.env.TARGET_URL || 'https://wiki.warframe.com/w/Baro_Ki%27Teer/Trades';

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  await page.waitForSelector('table.listtable.sortable.jquery-tablesorter', { timeout: 15000 });

  const extracted = await page.evaluate(() => {
    const table = document.querySelector('table.listtable.sortable.jquery-tablesorter');
    if (!table) return [];
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length !== 4) return null;
      const itemNameEls = cells[0].querySelectorAll('a');
      const itemName = itemNameEls.length ? itemNameEls[itemNameEls.length - 1].innerText.trim() : null;
      const itemType = cells[1].innerText.trim();
      const third = cells[2].innerText.trim();
      let credits = null, ducats = null;
      if (third.includes('+')) {
        const parts = third.split('+').map(s => s.trim().replace(/,/g,''));
        credits = parseInt(parts[0], 10) || null;
        ducats  = parseInt(parts[1], 10) || null;
      } else {
        credits = parseInt(third.replace(/,/g,''), 10) || null;
      }
      const fourth = cells[3].innerText.trim().split('\n').map(s => s.trim()).filter(Boolean);
      const dateString = fourth.length ? fourth[fourth.length - 1] : null;
      let date = null;
      if (dateString && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        const [y,m,d] = dateString.split('-').map(Number);
        date = new Date(Date.UTC(y, m-1, d, 13, 0, 0)).toISOString(); // 13:00 UTC
      }
      return { itemName, itemType, credits, ducats, date };
    }).filter(Boolean);
  });

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
