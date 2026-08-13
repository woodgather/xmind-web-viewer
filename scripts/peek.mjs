// Verify the parser handles both JSON and XML xmind files.
// Avoids JSDOM by checking the zip contents directly.
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const files = [
  'public/xmind/极简快速阅读-思维导图.xmind',
  'public/xmind/如何阅读一本书-思维导图.xmind',
];

for (const f of files) {
  const buf = await readFile(f);
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.keys(zip.files);
  const hasJson = entries.includes('content.json') || entries.includes('contents.json');
  const hasXml  = entries.includes('content.xml');
  console.log(`${f}`);
  console.log(`  entries: ${entries.join(', ')}`);
  console.log(`  format:  ${hasJson ? 'JSON' : hasXml ? 'XML' : 'UNKNOWN'}`);

  if (hasJson) {
    const text = await zip.file('content.json').async('string');
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data[0]?.sheets || data.sheets || []);
    const sheet = arr[0];
    const root = sheet.rootTopic || sheet.topic;
    let count = 0;
    (function walk(n) { count++; for (const c of (n.children?.attached || [])) walk(c); })(root);
    console.log(`  sheet:   ${sheet.title || '(no title)'}`);
    console.log(`  root:    ${root.title}`);
    console.log(`  nodes:   ${count}`);
  } else if (hasXml) {
    const text = await zip.file('content.xml').async('string');
    const sheetMatches = text.match(/<sheet[^>]*>/g) || [];
    const topicMatches = text.match(/<topic\b/g) || [];
    console.log(`  sheets:  ${sheetMatches.length}`);
    console.log(`  topics:  ${topicMatches.length}`);
    // first topic title
    const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    console.log(`  first title: ${m ? m[1].slice(0, 50) : '(none)'}`);
  }
  console.log();
}
