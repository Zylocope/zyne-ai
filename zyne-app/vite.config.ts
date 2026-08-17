import { defineConfig, type Plugin } from "vite";

// Browser-dev CORS proxy for feed sources: /zx/<host>/<path> is fetched
// server-side as https://<host>/<path>. The real (Tauri) app fetches
// directly via plugin-http and never uses this.
const zxProxy: Plugin = {
  name: "zx-proxy",
  configureServer(server) {
    server.middlewares.use("/zx", async (req, res) => {
      try {
        const m = (req.url || "").match(/^\/([^/]+)(\/.*)?$/);
        if (!m) { res.statusCode = 400; res.end("bad /zx path"); return; }
        const r = await fetch(`https://${m[1]}${m[2] || ""}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) zyne-feed/0.1",
            "Accept": "*/*",
          },
          redirect: "follow",
        });
        res.statusCode = r.status;
        res.setHeader("content-type", r.headers.get("content-type") || "text/plain");
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        res.statusCode = 502;
        res.end(String(e));
      }
    });
  },
};

// Tauri sets TAURI_DEV_HOST when targeting a physical mobile device so the
// phone can reach the dev server over the LAN. Desktop dev leaves it unset
// and we fall back to localhost.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  plugins: [zxProxy],
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host
      ? { protocol: "ws", host, port: 1430 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2021", "chrome105", "safari15"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});