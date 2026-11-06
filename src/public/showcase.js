// Showcase strip page script: adds the owner's dashboard-entered reviews
// (published, never demo: reviews_showcase_list()) to the pre-rendered config
// ones, then tells the framing page its height. No React, no supabase-js.
import { companyConfig } from "../../companyConfig.js";
import { renderShowcase } from "./showcaseRender.js";
import { mockPublicRpc } from "../dev/mockPublic.js";

const MOCK = import.meta.env.VITE_MOCK_BACKEND === "1";
const MESSAGE_TYPE = "dropstack:reviews:height";

function postHeight() {
  if (window.parent === window) return;
  const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
  // "*" is safe here: the message is only a number, and the embed script
  // checks both the origin and the source window before acting on it.
  window.parent.postMessage({ type: MESSAGE_TYPE, height: document.querySelector("[data-empty]") ? 0 : h }, "*");
}

async function fetchReviews() {
  if (MOCK) { const r = await mockPublicRpc("reviews_showcase_list"); return Array.isArray(r) ? r : []; }
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/reviews_showcase_list`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}",
    });
    return res.ok ? await res.json() : [];
  } catch {
    return []; // the config reviews already on the page stay; nothing breaks
  }
}

postHeight();
if (typeof ResizeObserver === "function") new ResizeObserver(postHeight).observe(document.documentElement);
fetchReviews().then((rows) => {
  if (!rows.length) return;
  const tpl = document.createElement("template");
  tpl.innerHTML = renderShowcase(companyConfig, companyConfig.showcase?.reviews ?? [], rows);
  document.querySelector("main")?.replaceWith(tpl.content.firstElementChild);
  postHeight();
});
