import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5178,
    fs: {
      deny: [
        ".env",
        ".env.*",
        "**/.local/**",
        "**/.tools/**",
        "**/.git/**",
        "**/server/**",
        "**/scripts/**",
      ],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5179",
        changeOrigin: true,
        headers: { origin: "http://127.0.0.1:5179" },
      },
    },
  },
});
