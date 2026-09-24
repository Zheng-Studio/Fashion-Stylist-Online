/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 文件访问前缀：本地开发由后端托管在 /files/；上线换对象存储/CDN 时在构建时注入其地址
  readonly VITE_FILES_BASE?: string;
  // API 地址前缀：默认同源；前后端分开部署时注入后端地址
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
