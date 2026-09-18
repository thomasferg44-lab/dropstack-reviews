const dateFmt = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" });

export function formatDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

// Display-only. Storage keeps whatever was entered; normalisation is a Stage 2/3 concern.
export function formatPhone(value) {
  if (!value) return "";
  const digits = String(value).replace(/[^\d+]/g, "");
  if (/^\+27\d{9}$/.test(digits)) {
    return `+27 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  if (/^0\d{9}$/.test(digits)) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return value;
}

// Storage normalisation. South African numbers become +27XXXXXXXXX so the
// unique(phone) constraint catches "082..." vs "+27 82..." duplicates.
// Anything else is stored as digits with a leading + if it had one.
export function normalisePhone(value) {
  if (!value) return null;
  let v = String(value).trim().replace(/[\s\-().]/g, "");
  if (!v) return null;
  if (v.startsWith("00")) v = "+" + v.slice(2);
  if (/^0\d{9}$/.test(v)) return "+27" + v.slice(1);
  if (/^27\d{9}$/.test(v)) return "+" + v;
  if (/^\+27\d{9}$/.test(v)) return v;
  if (/^\+\d{7,15}$/.test(v)) return v;
  if (/^\d{7,15}$/.test(v)) return "+" + v;
  return v; // leave odd input alone; the form flags it
}

export function isPlausiblePhone(value) {
  const n = normalisePhone(value);
  return n === null || /^\+\d{7,15}$/.test(n);
}

export function normaliseEmail(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v || null;
}
