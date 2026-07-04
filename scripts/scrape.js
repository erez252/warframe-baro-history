const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const puppeteer = require('puppeteer');

// Target URL with automatic fallback to modern Lua Module
let TARGET_URL = process.env.TARGET_URL || 'https://wiki.warframe.com/w/Module:Baro/data';
const BASE_URL = 'https://wiki.warframe.com';

// AUTO-CORRECTION: If the workflow provides the old HTML trades page, redirect to Lua module
if (TARGET_URL.includes('Baro_Ki%27Teer/Trades') || TARGET_URL.includes('Trades')) {
    console.log("⚠️ Old HTML Trades URL detected. Auto-redirecting to Lua Module source: Module:Baro/data");
    TARGET_URL = 'https://wiki.warframe.com/w/Module:Baro/data';
}

// Safely strips single-line and multi-line comments from raw Lua text
function stripLuaComments(src) {
    let res = "";
    let i = 0;
    let inDoubleQuote = false;
    let inSingleQuote = false;
    
    while (i < src.length) {
        let char = src[i];
        let next = src[i+1];
        
        if (inDoubleQuote) {
            if (char === '\\') { 
                res += src.substring(i, i+2); 
                i += 2; 
                continue; 
            }
            if (char === '\n' || char === '\r') {
                inDoubleQuote = false;
            }
            if (char === '"') inDoubleQuote = false;
            res += char;
            i++;
        } else if (inSingleQuote) {
            if (char === '\\') { 
                res += src.substring(i, i+2); 
                i += 2; 
                continue; 
            }
            if (char === '\n' || char === '\r') {
                inSingleQuote = false; 
            }
            if (char === "'") inSingleQuote = false;
            res += char;
            i++;
        } else {
            if (char === '-' && next === '-') {
                i += 2;
                if (src[i] === '[' && src[i+1] === '[') {
                    i += 2;
                    while (i < src.length && !(src[i] === ']' && src[i+1] === ']')) {
                        i++;
                    }
                    i += 2;
                } else {
                    while (i < src.length && src[i] !== '\n' && src[i] !== '\r') {
                        i++;
                    }
                }
            } else if (char === '"') {
                inDoubleQuote = true;
                res += char;
                i++;
            } else if (char === "'") {
                inSingleQuote = true;
                res += char;
                i++;
            } else {
                res += char;
                i++;
            }
        }
    }
    return res;
}

// Converts raw Lua characters into syntactic lexical tokens
function tokenizeLua(src) {
    let tokens = [];
    let i = 0;
    
    while (i < src.length) {
        let char = src[i];
        let next = src[i+1];
        
        if (/\s/.test(char)) {
            i++;
            continue;
        }

        // Handle Lua block strings: [[ long text ]]
        if (char === '[' && next === '[') {
            let str = "";
            i += 2;
            while (i < src.length) {
                if (src[i] === ']' && src[i+1] === ']') {
                    i += 2;
                    break;
                }
                str += src[i];
                i++;
            }
            tokens.push({ type: 'string', value: str });
            continue;
        }
        
        if (char === '{' || char === '}' || char === '[' || char === ']' || char === '=' || char === ',' || char === ';') {
            tokens.push({ type: 'operator', value: char });
            i++;
            continue;
        }
        
        // Handle standard quoted strings (with auto-close failsafe protection)
        if (char === '"' || char === "'") {
            let quoteType = char;
            let str = "";
            i++;
            
            while (i < src.length) {
                if (src[i] === '\n' || src[i] === '\r') {
                    break;
                }
                if (src[i] === '\\') {
                    str += src[i] + (src[i+1] || '');
                    i += 2;
                } else if (src[i] === quoteType) {
                    i++;
                    break;
                } else {
                    str += src[i];
                    i++;
                }
            }
            tokens.push({ type: 'string', value: str });
            continue;
        }
        
        let start = i;
        while (i < src.length && /[a-zA-Z0-9_\.\+\-]/.test(src[i])) {
            i++;
        }
        
        if (i > start) {
            let val = src.substring(start, i);
            let lowerVal = val.toLowerCase();
            
            if (lowerVal === 'true') {
                tokens.push({ type: 'boolean', value: true });
            } else if (lowerVal === 'false') {
                tokens.push({ type: 'boolean', value: false });
            } else if (lowerVal === 'nil') {
                tokens.push({ type: 'nil', value: null });
            } else if (!isNaN(Number(val))) {
                tokens.push({ type: 'number', value: Number(val) });
            } else {
                tokens.push({ type: 'identifier', value: val });
            }
            continue;
        }
        
        i++;
    }
    return tokens;
}

// Parses processed tokens into deep JS objects with healing arrays
function parseLuaTokens(tokens) {
    let index = 0;
    
    function peek() {
        return tokens[index];
    }
    
    function consume() {
        return tokens[index++];
    }
    
    function parseValue() {
        let tok = peek();
        if (!tok) return undefined;
        
        if (tok.type === 'string') {
            consume();
            return tok.value;
        }
        if (tok.type === 'number') {
            consume();
            return tok.value;
        }
        if (tok.type === 'boolean') {
            consume();
            return tok.value;
        }
        if (tok.type === 'nil') {
            consume();
            return null;
        }
        if (tok.type === 'operator' && tok.value === '{') {
            return parseTable();
        }
        if (tok.type === 'identifier') {
            consume();
            return tok.value;
        }
        
        consume();
        return null;
    }
    
    function parseTable() {
        consume(); // skip '{'
        
        let elements = [];
        let isDictionary = false;
        
        while (index < tokens.length) {
            let tok = peek();
            if (!tok) break;
            
            if (tok.type === 'operator' && tok.value === '}') {
                consume(); // skip '}'
                break;
            }
            
            if (tok.type === 'operator' && tok.value === '[') {
                isDictionary = true;
                consume(); // skip '['
                let keyVal = parseValue(); 
                
                if (peek() && peek().type === 'operator' && peek().value === ']') {
                    consume(); // skip ']'
                }
                if (peek() && peek().type === 'operator' && peek().value === '=') {
                    consume(); // skip '='
                }
                let val = parseValue();
                elements.push({ type: 'kv', key: keyVal, value: val });
            }
            else if (tok.type === 'identifier' && tokens[index+1] && tokens[index+1].type === 'operator' && tokens[index+1].value === '=') {
                isDictionary = true;
                let keyVal = consume().value; 
                consume(); // skip '='
                let val = parseValue();
                elements.push({ type: 'kv', key: keyVal, value: val });
            }
            else {
                let val = parseValue();
                if (val !== undefined) {
                    elements.push({ type: 'val', value: val });
                }
            }
            
            let next = peek();
            if (next && next.type === 'operator' && (next.value === ',' || next.value === ';')) {
                consume();
            }
        }
        
        if (isDictionary) {
            let obj = {};
            let arrayIdx = 1;
            for (let el of elements) {
                if (el.type === 'kv') {
                    obj[el.key] = el.value;
                } else {
                    obj[arrayIdx++] = el.value;
                }
            }
            return obj;
        } else {
            let arr = [];
            for (let el of elements) {
                arr.push(el.value);
            }
            return arr;
        }
    }
    
    while (index < tokens.length) {
        let tok = peek();
        if (tok && tok.type === 'identifier' && tok.value === 'return') {
            consume();
            continue;
        }
        break;
    }
    
    return parseValue();
}

// Maps raw parsed Lua structures back into original JSON schemas
function transformLuaToTargetJSON(parsedObj) {
    let rawItems = {};
    if (parsedObj && typeof parsedObj === 'object') {
        if (parsedObj.Items) {
            rawItems = parsedObj.Items;
        } else if (parsedObj.items) {
            rawItems = parsedObj.items;
        } else {
            rawItems = parsedObj; 
        }
    }
    
    const targetItems = [];
    
    for (const [key, item] of Object.entries(rawItems)) {
        if (!item || typeof item !== 'object') continue;
        
        // Handle Item Type & Subtype separation
        let itemType = item.Type || '';
        let itemSubType = null;
        if (typeof itemType === 'string') {
            const subtypeMatch = itemType.match(/^(.*)\s+\((.*)\)$/);
            if (subtypeMatch) {
                itemType = subtypeMatch[1].trim();
                itemSubType = subtypeMatch[2].trim();
            }
        }
        
        // Extract dates and convert to UTC 13:00 formatted array strings (chronologically reversed)
        let dateStrings = [];
        if (Array.isArray(item.OfferingDates)) {
            dateStrings = item.OfferingDates;
        } else if (item.OfferingDates && typeof item.OfferingDates === 'object') {
            dateStrings = Object.values(item.OfferingDates);
        }
        
        const dates = dateStrings.map(dateString => {
            if (typeof dateString !== 'string') return null;
            const match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
            if (match) {
                const [y, m, d] = match[1].split('-').map(Number);
                return new Date(Date.UTC(y, m - 1, d, 13, 0, 0)).toISOString(); 
            }
            return null;
        }).filter(Boolean).reverse();
        
        // Format Wiki URLs
        const itemLink = item.Link || key;
        const wikiURL = `${BASE_URL}/w/${encodeURIComponent(itemLink.replace(/ /g, '_'))}`;
        const wikiThumbnail = item.Image ? `${BASE_URL}/w/Special:FilePath/${encodeURIComponent(item.Image)}` : null;
        
        targetItems.push({
            itemName: item.Name || key,
            itemType: itemType,
            itemSubType: itemSubType,
            credits: item.CreditCost !== undefined ? Number(item.CreditCost) : null,
            ducats: item.DucatCost !== undefined ? Number(item.DucatCost) : null,
            dates: dates,
            wikiURL: wikiURL,
            wikiThumbnail: wikiThumbnail
        });
    }
    
    return {
        scrapedAt: new Date().toISOString(),
        source: TARGET_URL,
        items: targetItems
    };
}

// Simple direct HTTP downloader using Node native HTTPS modules
function downloadRawText(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };
        https.get(url, options, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Server returned status code: ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

(async () => {
    let rawLua = '';
    
    // Attempt fast raw HTTP fetch first to avoid booting up heavy Chromium containers (highly efficient on GitHub Runners!)
    try {
        const rawActionUrl = `${TARGET_URL}?action=raw`;
        console.log(`⚡ Attempting high-speed direct text fetch: ${rawActionUrl}`);
        rawLua = await downloadRawText(rawActionUrl);
        console.log('✅ Direct fetch successful!');
    } catch (fetchErr) {
        console.warn(`⚠️ Direct fetch failed or was blocked (${fetchErr.message}). Falling back to browser environment...`);
        
        const browser = await puppeteer.launch({
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote'
            ]
        });
        const page = await browser.newPage();
        
        // Optimizing page load parameters to disable images/CSS blocks for fast DOM performance
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (type === 'image' || type === 'stylesheet' || type === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`📡 Opening browser targeting page: ${TARGET_URL}`);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

        console.log('⌛ Resolving Lua data DOM container selectors...');
        await page.waitForFunction(() => {
            return !!(document.querySelector(".mw-code") || 
                      document.getElementById("wpTextbox1") || 
                      document.querySelector("pre"));
        }, { timeout: 20000 });

        rawLua = await page.evaluate(() => {
            const el = document.querySelector(".mw-code") || 
                       document.getElementById("wpTextbox1") || 
                       document.querySelector("pre");
            return el ? (el.value || el.innerText || el.textContent) : '';
        });

        await browser.close();
    }

    if (!rawLua || !rawLua.trim()) {
        throw new Error('❌ Error: Retrieved raw Lua code content is empty.');
    }

    console.log('⚙️ Compiling Lua modules through state-machine syntax parser...');
    const cleanLua = stripLuaComments(rawLua);
    const tokens = tokenizeLua(cleanLua);
    const rawParsedObj = parseLuaTokens(tokens);
    
    if (!rawParsedObj || typeof rawParsedObj !== 'object') {
        throw new Error('❌ Error: Lexical syntax compiler returned non-constructible data.');
    }

    console.log('🔄 Transforming items into structured JSON target database schema...');
    const finalJSONOutput = transformLuaToTargetJSON(rawParsedObj);
    
    const dir = path.join(process.cwd(), 'data');
    await fs.mkdir(dir, { recursive: true });
    
    const filename = path.join(dir, 'warframe_data.json');
    await fs.writeFile(filename, JSON.stringify(finalJSONOutput, null, 2), 'utf8');
    
    console.log(`✅ Compilation successful! Total elements transformed: ${finalJSONOutput.items.length}`);
    console.log('Saved to:', filename);
})();
