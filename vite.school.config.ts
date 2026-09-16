import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const accountProxy = {
  target: "http://127.0.0.1:8788",
  changeOrigin: false,
};

const rankedProductProxy = {
  target: "http://127.0.0.1:8789",
  changeOrigin: false,
  ws: true,
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/auth": accountProxy,
      "/api/account": accountProxy,
      "/api/leaderboard": accountProxy,
      "/api/matchmaking": rankedProductProxy,
      "/api/matches": rankedProductProxy,
      "/api/product-health": rankedProductProxy,
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
        ws: true,
      },
    },
  },
});