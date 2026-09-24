import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 前端 dev server 把 /api 和 /files 代理到后端 8000，避免跨域 & 硬编码地址
export default defineConfig({
  plugins: [react()],
  build: {
    assetsDir: "static",
  },
  server: {
    // 显式监听所有地址，避免只绑 IPv6 [::1] 导致 localhost(127.0.0.1) 连不上
    host: true,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/files": "http://127.0.0.1:8000",
    },
  },
});
