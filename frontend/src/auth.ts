// 登录 token。
//
// 应用嵌在 Lucimix 的 iframe 里：平台把用户 token 交给我们，我们在每个 API 请求里带
// `Authorization: Bearer <token>`。不用 cookie——iframe 里是第三方上下文，Safari 等会拦。
//
// 平台具体怎么把 token 交过来还没定，目前支持两种：
//   1. iframe 地址带 ?token=xxx（读完就从地址栏抹掉，免得被复制/分享出去）；
//   2. 平台 postMessage 过来，调 setToken() 即可。
// 本地开发不带 token 时，后端 dev 模式会当作默认用户。
const KEY = "fs.token";
let token = "";

export function initAuth(): string {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    setToken(fromUrl);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", url.toString());
  } else {
    try {
      token = sessionStorage.getItem(KEY) ?? ""; // 刷新后沿用本标签页的 token
    } catch {
      /* 隐私模式等场景下 sessionStorage 可能直接抛错 */
    }
  }
  return token;
}

export function setToken(t: string) {
  token = t;
  try {
    sessionStorage.setItem(KEY, t);
  } catch {
    /* 存不了就只放内存 */
  }
}

export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
