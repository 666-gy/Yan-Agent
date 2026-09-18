'use strict';
// One-off doc mining helper: anysearch extract writes single-line JSON; this
// converts it to readable text and prints only lines matching a keyword.
const fs = require('fs');
const [,, inFile, keyword, limit] = process.argv;
let text;
try { text = JSON.parse(fs.readFileSync(inFile, 'utf8')).content.replace(/\\n/g, '\n'); }
catch { text = fs.readFileSync(inFile, 'utf8'); }
text = text.replace(/\[\]\(([^)]*)\)/g, '($1)');
fs.writeFileSync(inFile.replace(/\.md$/, '.txt'), text);
const lines = text.split('\n').filter(l => new RegExp(keyword, 'i').test(l) && !/^\s*\*/.test(l));
console.log(lines.slice(0, Number(limit) || 40).map(l => l.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
console.log(`[total ${lines.length} matches, file: ${inFile.replace(/\.md$/, '.txt')}]`);
