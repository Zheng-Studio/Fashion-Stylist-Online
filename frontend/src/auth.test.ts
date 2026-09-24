import { afterEach, describe, expect, it, vi } from "vitest";

// auth 模块有模块级状态（token），每个用例重新导入一份干净的
async function freshAuth() {
  vi.resetModules();
  return import("./auth");
}

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("auth token", () => {
  it("从 iframe 地址的 ?token= 读取，并从地址栏抹掉", async () => {
    window.history.replaceState(null, "", "/?token=abc&x=1");
    const auth = await freshAuth();
    expect(auth.initAuth()).toBe("abc");
    expect(auth.authHeaders()).toEqual({ Authorization: "Bearer abc" });
    expect(window.location.search).toBe("?x=1");
  });

  it("刷新后（地址里没 token）沿用本标签页存下的 token", async () => {
    window.history.replaceState(null, "", "/?token=abc");
    (await freshAuth()).initAuth();
    const reloaded = await freshAuth();
    expect(reloaded.initAuth()).toBe("abc");
  });

  it("没有 token 时不带 Authorization 头（后端 dev 模式按默认用户处理）", async () => {
    const auth = await freshAuth();
    expect(auth.initAuth()).toBe("");
    expect(auth.authHeaders()).toEqual({});
  });

  it("平台 postMessage 过来的 token 用 setToken 注入", async () => {
    const auth = await freshAuth();
    auth.setToken("from-message");
    expect(auth.authHeaders()).toEqual({ Authorization: "Bearer from-message" });
  });
});
