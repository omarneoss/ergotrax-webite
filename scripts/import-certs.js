const XLSX = require('xlsx');
const fs = require('fs');

const FILE = process.argv[2];
const BASE = process.argv[3];
const TOKEN = process.argv[4];
const DRY = process.argv.includes('--dry');

const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const AR_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
const toArNum = (n) => String(n).replace(/[0-9]/g, (d) => AR_DIGITS[+d]);
function fmtDate(raw) {
  const v = String(raw == null ? '' : raw).trim();
  const m = v.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (!m) return { en: v, ar: v };
  const d = +m[1], mo = +m[2] - 1, y = m[3];
  if (mo < 0 || mo > 11) return { en: v, ar: v };
  return { en: `${d} ${MONTHS_EN[mo]} ${y}`, ar: `${toArNum(d)} ${MONTHS_AR[mo]} ${toArNum(y)}` };
}
function normKey(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function rowGet(normRow, names) {
  for (const n of names) {
    const v = normRow[normKey(n)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

const wb = XLSX.readFile(FILE);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

const items = [];
let skipped = 0;
const seenCodes = new Set();
let dupes = 0;
for (const raw of rows) {
  const normRow = {};
  for (const k in raw) normRow[normKey(k)] = raw[k];
  const code = rowGet(normRow, ['code']).toUpperCase();
  const nameEn = rowGet(normRow, ['name_en', 'nameen', 'name']);
  if (!code || !nameEn) { skipped++; continue; }
  if (seenCodes.has(code)) { dupes++; continue; }
  seenCodes.add(code);
  const issued = fmtDate(rowGet(normRow, ['date', 'issued']));
  items.push({
    slug: code,
    data: {
      name: { en: nameEn, ar: rowGet(normRow, ['name_ar', 'namear']) },
      workshop: { en: rowGet(normRow, ['workshop_en', 'workshopen']), ar: rowGet(normRow, ['workshop_ar', 'workshopar']) },
      track: rowGet(normRow, ['track']),
      trainer: rowGet(normRow, ['trainer']),
      duration: { en: rowGet(normRow, ['duration_en', 'durationen', 'duration']), ar: rowGet(normRow, ['duration_ar', 'durationar']) },
      issued,
      result: {
        en: rowGet(normRow, ['result_en', 'resulten']) || 'Attended in full',
        ar: rowGet(normRow, ['result_ar', 'resultar']) || 'حضور كامل',
      },
      email: rowGet(normRow, ['email']),
      whatsapp: rowGet(normRow, ['whatsapp', 'whatsappnumber', 'whatsappno']),
    },
  });
}

console.log(`Parsed ${rows.length} rows -> ${items.length} valid, ${skipped} skipped (missing code/name), ${dupes} duplicate codes`);
console.log('Sample item:', JSON.stringify(items[0], null, 2));

if (DRY) { console.log('Dry run only, not uploading.'); process.exit(0); }

async function main() {
  let total = 0;
  for (let i = 0; i < items.length; i += 200) {
    const batch = items.slice(i, i + 200);
    const res = await fetch(`${BASE}/api/content/certificates/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ items: batch }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('Batch failed:', data); process.exit(1); }
    total += data.count;
    console.log(`Uploaded ${total} / ${items.length}`);
  }
  console.log('Done. Total imported:', total);
}
main();
