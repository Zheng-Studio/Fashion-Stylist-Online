import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// v0.15 接入最小测试环境。动机很具体：PIN 弹窗的焦点行为连续两轮靠读代码判断，
// 第一轮就漏了一条夺焦路径。焦点/事件冒泡这类行为必须真跑才算数。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
