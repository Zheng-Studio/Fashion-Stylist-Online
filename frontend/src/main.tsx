import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initAuth } from "./auth";
import "./styles.css";

// 先读平台传进来的 token，再渲染（之后所有请求都会带上）
initAuth();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
