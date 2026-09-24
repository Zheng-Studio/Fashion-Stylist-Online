import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// v0.15 接入。本期修的 bug 里有一半是 hooks 用法问题
// （updater 里发请求、useEffect 缺依赖、无条件夺焦），靠这套规则兜住下一次。
export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 组件文件里混导出常量会破坏 Fast Refresh，但本项目没踩过这个坑，降为 warn
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
