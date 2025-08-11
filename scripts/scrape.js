// Function to extract and format the data
function scrapeWarframeWikiTable() {
  const table = document.querySelector('table.listtable.sortable.jquery-tablesorter');
  if (!table) {
    console.error('Table with class "listtable sortable jquery-tablesorter" not found.');
    return [];
  }

  const tableBody = table.querySelector('tbody');
  if (!tableBody) {
    console.error('Table body (tbody) not found.');
    return [];
  }

  const tableRows = tableBody.querySelectorAll('tr');
  const extractedData = [];

  tableRows.forEach(row => {
    const cells = row.querySelectorAll('td');

    if (cells.length === 4) {
      // 1. Get the Item Name
      const itemNameElements = cells[0].querySelectorAll('a');
      const itemName = itemNameElements.length > 0 ? itemNameElements[itemNameElements.length - 1].innerText.trim() : null;

      // 2. Get the Item Type
      const itemType = cells[1].innerText.trim();

      // 3. Get the Credits and Ducats as numbers
      let credits = null;
      let ducats = null;
      const thirdCellText = cells[2].innerText.trim();
      if (thirdCellText.includes('+')) {
        const parts = thirdCellText.split('+');
        credits = parseInt(parts[0].trim().replace(/,/g, ''), 10);
        ducats = parseInt(parts[1].trim(), 10);
      } else {
        credits = parseInt(thirdCellText.trim().replace(/,/g, ''), 10);
      }

      // 4. Get the latest date and create a UTC date object at 1 PM (13:00)
      const fourthCellText = cells[3].innerText.trim().split('\n');
      const dateString = fourthCellText.length > 0 ? fourthCellText[fourthCellText.length - 1].trim() : null;

      let date = null;
      if (dateString && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        const [year, month, day] = dateString.split('-').map(Number);
        const utcDate = new Date(Date.UTC(year, month - 1, day, 13, 0, 0));
        date = utcDate.toISOString();
      }

      extractedData.push({
        itemName,
        itemType,
        credits,
        ducats,
        date
      });
    }
  });

  return extractedData;
}

// Function to download the data as a JSON file
function downloadJson(data, filename = 'warframe_data.json') {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Run the script: scrape the data and then download it
const scrapedResults = scrapeWarframeWikiTable();
if (scrapedResults.length > 0) {
  downloadJson(scrapedResults);
  console.log('Download initiated for warframe_data.json');
} else {
  console.log('No data scraped to download.');
}
