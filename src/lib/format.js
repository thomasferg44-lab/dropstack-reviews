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
