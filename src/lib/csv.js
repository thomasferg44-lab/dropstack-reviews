// Minimal RFC 4180 CSV parser. Handles quoted fields, escaped quotes (""),
// embedded newlines inside quotes, CRLF, a UTF-8 BOM, and auto-detects the
// delimiter (comma, semicolon, tab) — South African Excel often exports ";".

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, (firstLine.match(new RegExp(d === "\t" ? "\t" : `\\${d}`, "g")) || []).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(text, delimiter = detectDelimiter(text)) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }

  // Drop fully blank rows (common at the end of Excel exports).
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const [headerRow, ...body] = nonEmpty;
  const headers = headerRow.map((h) => h.trim());
  return { headers, rows: body.map((r) => headers.map((_, i) => (r[i] ?? "").trim())) };
}
