import { useEffect, useState } from "react";
import { MessageCircle, Shirt, UserRound } from "lucide-react";
import Chat from "./components/Chat";
import Wardrobe from "./components/Wardrobe";
import MyProfile from "./components/MyProfile";
import Sidebar, { type SidebarItem } from "./components/Sidebar";
import { fetchMe } from "./api";
import type { Me } from "./types";
import { errMsg } from "./utils";

// 身份由 Lucimix 平台决定（token 在 main.tsx 里 initAuth 读好），这里没有选人/登录页，
// 进来就是当前用户自己的空间：对话 / 衣橱 / 我。
type Tab = "chat" | "wardrobe" | "me";

// 桌面侧栏和移动端底部 tabbar 共用同一份定义
const TABS: SidebarItem<Tab>[] = [
  { key: "chat", label: "对话", Icon: MessageCircle },
  { key: "wardrobe", label: "衣橱", Icon: Shirt },
  { key: "me", label: "我", Icon: UserRound },
];

const BRAND = (
  <>
    <img className="brand-mark" src="/icon-192.png" alt="" />
    FashionStylist
  </>
);

// 刷新后停在原来的 tab
const TAB_KEY = "fs.tab";
function readTab(): Tab {
  try {
    const t = sessionStorage.getItem(TAB_KEY);
    return t === "wardrobe" || t === "me" ? t : "chat";
  } catch {
    return "chat";
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [me, setMe] = useState<Me | null>(null);
  const [meErr, setMeErr] = useState("");

  const reloadMe = () =>
    fetchMe()
      .then((m) => {
        setMe(m);
        setMeErr("");
      })
      .catch((e) => setMeErr(errMsg(e, "加载用户信息失败")));
  useEffect(() => {
    reloadMe();
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      /* 存不了就算了 */
    }
  }, [tab]);

  // 移动端键盘弹起时，把可视高度同步给 CSS（--app-h/--app-top）。
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    // 输入聚焦作为键盘态的兜底信号：iOS 有时连 innerHeight 一起缩，光靠高度差判不出键盘。
    let inputFocused = false;
    const sync = () => {
      const layoutH = root.clientHeight; // 布局视口高度不随键盘变，比 innerHeight 稳
      const kbHeight = Math.max(0, layoutH - vv.height - vv.offsetTop);
      const kbOpen = inputFocused || kbHeight > 120;
      root.classList.toggle("kb-open", kbOpen);
      root.style.setProperty("--app-h", `${vv.height}px`);
      // offsetTop 只在键盘态跟随；普通滑动钉 0，避免整个 fixed app 被拖着走（见 pitfalls）
      root.style.setProperty("--app-top", kbOpen ? `${vv.offsetTop}px` : "0px");
    };
    const onFocusChange = (focused: boolean) => (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        inputFocused = focused;
        sync();
      }
    };
    const onFocusIn = onFocusChange(true);
    const onFocusOut = onFocusChange(false);
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <div className="app">
      {/* 桌面导航（移动端 CSS 隐藏，改用底部 tabbar） */}
      <Sidebar brand={BRAND} items={TABS} active={tab} onSelect={setTab} />
      {/* 顶栏：仅移动端显示 */}
      <header className="topbar topbar-member">
        <div className="brand">{BRAND}</div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? "tab active" : "tab"}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className={tab === "chat" ? "content content-chat" : "content"}>
        {/* Chat 常驻挂载、仅按 tab 显隐：切走再回来，对话历史/在途请求都保留。
            chat-pane 的 height:100% 把 content→pane→.chat 的百分比高度链接上，
            否则输入框浮在滚动末尾（键盘弹起会被顶出可视区）。 */}
        <div className="chat-pane" style={{ display: tab === "chat" ? undefined : "none" }}>
          <Chat />
        </div>
        {tab === "wardrobe" && <Wardrobe />}
        {tab === "me" &&
          (me ? (
            <MyProfile me={me} onUpdated={setMe} />
          ) : (
            <div className="error">{meErr || "加载中…"}</div>
          ))}
      </main>

      {/* 底部 tabbar：仅移动端显示，键盘弹起时收起 */}
      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "tabbar-item active" : "tabbar-item"}
            onClick={() => setTab(t.key)}
            aria-label={t.label}
          >
            <t.Icon size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
