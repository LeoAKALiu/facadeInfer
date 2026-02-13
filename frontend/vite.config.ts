import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true
      },
      "/demo_data": {
        target: "http://localhost:8000",
        changeOrigin: true
      },
      "/thumb": {
        target: "http://localhost:8000",
        changeOrigin: true
      },
      "/viewport": {
        target: "http://localhost:8000",
        changeOrigin: true
      },
      "/floorplan_svg": {
        target: "http://localhost:8000",
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    include: ["@xeokit/xeokit-sdk"]
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks: {
          xeokit: ["@xeokit/xeokit-sdk"]
        }
      }
    }
  }
});

