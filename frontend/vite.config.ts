import net from "node:net";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_PORT = 5173;

// 后端端口。启动脚本（启动Online.bat）发现 8000 被占用时会换一个，并通过
// VITE_API_PORT 告诉这里；手动 `npm run dev` 没有这个变量，就退回 8000。
const API_TARGET = `http://127.0.0.1:${Number(process.env.VITE_API_PORT) || 8000}`;

// 有没有进程在这个端口上应答。Windows 上两个进程能同时绑 0.0.0.0 的同一端口，
// Vite 自带的「端口被占就换下一个」检测不到，所以改成主动连一下看有没有人接。
function isPortTaken(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(300);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    const taken = await Promise.all([isPortTaken(port, "127.0.0.1"), isPortTaken(port, "::1")]);
    if (!taken.some(Boolean)) return port;
    console.log(`端口 ${port} 已被占用，尝试 ${port + 1}`);
  }
  throw new Error(`${start} 起 20 个端口都被占用`);
}

// 前端 dev server 把 /api 和 /files 代理到后端，避免跨域 & 硬编码地址
export default defineConfig(async ({ command, isPreview }) => ({
  plugins: [react()],
  build: {
    assetsDir: "static",
  },
  server: {
    // 显式监听所有地址，避免只绑 IPv6 [::1] 导致 localhost(127.0.0.1) 连不上
    host: true,
    // 只在 dev 时探测；启动Online.bat 会自己挑好端口再用 --port 传进来，这里是手动 `npm run dev` 的兜底
    port: command === "serve" && !isPreview ? await findFreePort(DEFAULT_PORT) : DEFAULT_PORT,
    // 端口已经挑好了，不让 Vite 再自己换，保证打印的地址就是实际地址
    strictPort: true,
    proxy: {
      "/api": API_TARGET,
      "/files": API_TARGET,
    },
  },
}));
