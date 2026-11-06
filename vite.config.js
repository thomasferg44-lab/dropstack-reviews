import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { companyConfig } from "./companyConfig.js";
import { renderLanding, landingTitle, fillTemplate } from "./src/public/render.js";
import { renderShowcase, showcaseTitle } from "./src/public/showcaseRender.js";

const root = import.meta.dirname;

// Serves /r/<token> from r.html during `npm run dev`, and /showcase from
// showcase.html. Netlify does the same in production via netlify.toml.
function publicRoutes() {
  return {
    name: "dropstack-public-routes",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/r\/(?![^/?#]*\.)/.test(req.url)) req.url = "/r.html";
        else if (req.url && /^\/showcase(?:[/?#]|$)/.test(req.url)) req.url = "/showcase.html";
        next();
      });
    },
  };
}

// The public pages are pre-rendered from companyConfig.js at build time: the
// client's name, colours, logo/monogram and the Google button are in the HTML
// itself. Nothing on a customer's screen waits for JavaScript or the network,
// and there is no default colour to flash before the brand arrives.
function prerenderPublicPages() {
  return {
    name: "dropstack-prerender-public",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const file = ctx.filename ?? "";
        if (file.endsWith("r.html")) {
          return fillTemplate(html, { body: renderLanding(companyConfig, {}), title: landingTitle(companyConfig), config: companyConfig });
        }
        if (file.endsWith("showcase.html")) {
          return fillTemplate(html, { body: renderShowcase(companyConfig, companyConfig.showcase?.reviews ?? []), title: showcaseTitle(companyConfig), config: companyConfig });
        }
        return html;
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), publicRoutes(), prerenderPublicPages()],
  build: {
    rollupOptions: {
      input: {
        // The owner dashboard: React, Tailwind, supabase-js.
        main: resolve(root, "index.html"),
        // The public landing: its own entry so a customer opening a review
        // link never downloads the dashboard bundle.
        redirect: resolve(root, "r.html"),
        // The showcase strip, framed by /showcase.js on the client's site.
        showcase: resolve(root, "showcase.html"),
      },
    },
  },
});
