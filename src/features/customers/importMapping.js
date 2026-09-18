import { normalisePhone, normaliseEmail, isPlausiblePhone } from "../../lib/format.js";

// Column-name guessing. Real client lists come from Excel, a CRM export, or a
// phone contacts dump, so be generous. Matching is on lowercased alphanumerics.
const HINTS = {
  name:  ["name", "fullname", "customername", "clientname", "customer", "client", "contact", "contactname"],
  first: ["firstname", "first", "givenname", "forename"],
  last:  ["lastname", "last", "surname", "familyname"],
  phone: ["phone", "phonenumber", "cell", "cellphone", "cellnumber", "mobile", "mobilenumber", "tel", "telephone",
          "whatsapp", "whatsappnumber", "contactnumber", "number", "cellno", "telno"],
  email: ["email", "emailaddress", "mail", "e-mail", "emailid"],
};

const key = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function guessMapping(headers) {
  const keyed = headers.map(key);
  const find = (field) => {
    const exact = keyed.findIndex((k) => HINTS[field].includes(k));
    if (exact >= 0) return exact;
    return keyed.findIndex((k) => HINTS[field].some((hint) => hint.length > 3 && k.includes(hint)));
  };
  const first = find("first");
  const last = find("last");
  let name = find("name");
  // "first name" contains "name" — don't let a split-name column double as the full name.
  if (name === first || name === last) name = -1;
  return { name, first, last, phone: find("phone"), email: find("email") };
}

// Turns parsed rows into insert-ready customers plus a per-row verdict.
// Nothing is dropped silently: every skipped row carries a reason.
export function buildImportPlan(rows, mapping) {
  const seenPhones = new Set();
  const seenEmails = new Set();
  const plan = [];

  rows.forEach((r, i) => {
    const pick = (idx) => (idx >= 0 && idx < r.length ? r[idx] : "");
    let name = pick(mapping.name);
    if (!name && (mapping.first >= 0 || mapping.last >= 0)) {
      name = [pick(mapping.first), pick(mapping.last)].filter(Boolean).join(" ");
    }
    const rawPhone = pick(mapping.phone);
    const rawEmail = pick(mapping.email);
    const phone = normalisePhone(rawPhone);
    const email = normaliseEmail(rawEmail);
    const line = i + 2; // 1-based, after the header row

    const notes = [];
    if (!name && !phone && !email) return plan.push({ line, status: "skip", reason: "Empty row", row: r });
    if (rawPhone && !isPlausiblePhone(rawPhone)) notes.push(`Phone "${rawPhone}" not recognised, left blank`);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) notes.push(`Email "${rawEmail}" doesn't look valid, left blank`);
    const cleanPhone = rawPhone && !isPlausiblePhone(rawPhone) ? null : phone;
    const cleanEmail = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : email;

    if (!name) {
      name = cleanPhone || cleanEmail;
      notes.push("No name in file, used contact as name");
    }
    if (!cleanPhone && !cleanEmail) notes.push("No phone or email — can't be sent a request");

    if (cleanPhone && seenPhones.has(cleanPhone)) {
      return plan.push({ line, status: "skip", reason: `Duplicate phone ${cleanPhone} earlier in file`, row: r });
    }
    if (!cleanPhone && cleanEmail && seenEmails.has(cleanEmail)) {
      return plan.push({ line, status: "skip", reason: `Duplicate email ${cleanEmail} earlier in file`, row: r });
    }
    if (cleanPhone) seenPhones.add(cleanPhone);
    if (cleanEmail) seenEmails.add(cleanEmail);

    plan.push({ line, status: "ok", customer: { name, phone: cleanPhone, email: cleanEmail }, notes, row: r });
  });

  return plan;
}
