import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  build: {
    // เพิ่ม limit เพื่อไม่ให้ขึ้น warning (unit: kB)
    chunkSizeWarningLimit: 1000,

    rollupOptions: {
      output: {
        // แยก vendor libraries ออกเป็น chunk ต่างหาก
        manualChunks: {
          "firebase-app":  ["firebase/app"],
          "firebase-auth": ["firebase/auth"],
          "firebase-db":   ["firebase/database"],
          "react-vendor":  ["react", "react-dom"],
        },
      },
    },
  },
});
