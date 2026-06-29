import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend proxy runs on :7860. We proxy /api to it so the browser never needs CORS
// and never talks to anything but this machine.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:7860",
        changeOrigin: true,
      },
    },
  },
});
