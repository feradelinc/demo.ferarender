import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          pdf: ["pdf-lib"],
          zip: ["jszip"],
          xml: ["@xmldom/xmldom", "xpath", "object-to-xml"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
