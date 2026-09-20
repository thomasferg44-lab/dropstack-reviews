import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Serves /r/<token> from r.html during `npm run dev`. Netlify does the same
// thing in production via the rewrite in netlify.toml.
function publicRedirectRoute() {
  return {
    name: "dropstack-redirect-route",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        // Matches /r/ and /r/<token>, exactly like the Netlify rewrite for /r/*.
        if (req.url && /^\/r\/(?![^/?#]*\.)/.test(req.url)) req.url = "/r.html";
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), publicRedirectRoute()],
  build: {
    rollupOptions: {
      input: {
        // The owner dashboard: React, Tailwind, supabase-js.
        main: resolve(__dirname, "index.html"),
        // The public redirect page: its own entry so a customer opening a review
        // link never downloads the dashboard bundle.
        redirect: resolve(__dirname, "r.html"),
      },
    },
  },
});
