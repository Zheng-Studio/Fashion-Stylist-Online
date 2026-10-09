# 踩坑记录（Pitfalls）

> 按「现象 → 原因 → 解法」记，新坑往上加。部分条目继承自家庭版（Fashion-Stylist），仍然适用的才保留。
> 开发环境：Windows 11 + PowerShell / git bash，后端 Python venv，前端 Vite。

## 后端 / Python

### A1. `alembic.ini` 里写中文注释，Windows 上 alembic 直接崩
- **现象**：`alembic upgrade head` 报 `UnicodeDecodeError: 'gbk' codec can't decode byte ...`。
- **原因**：alembic 用**系统区域编码**读 ini 文件，中文 Windows 上是 GBK，而文件是 UTF-8。
- **解法**：`alembic.ini` 保持纯 ASCII（注释写英文）。中文说明写进 `migrations/env.py`（Python 源码按 UTF-8 读，没问题）。

### A2. 图片 URL 必须不可变：改图写新 key，不原地覆盖
- **背景**：家庭版旋转图片是原地覆盖、路径不变，结果浏览器拿着旧缓存不回源，刷新后「又变回旧图」，前后查了三轮，最后只能给 URL 拼文件 mtime 版本号兜住。
- **现在的约定**：存储 key 一律带 uuid，**写入后永不修改**——旋转、编辑都写新 key、返回新 key。文件变 = key 变 = URL 变，缓存和 CDN 天然正确，不需要任何破缓存参数。
- **别做**：不要给图片 URL 拼 `?_=Date.now()` 之类的参数（等于让缓存彻底失效）；也不要为了「省一个文件」改回原地覆盖。

### 3c. 拿真库的**副本**跑破坏性测试，但磁盘文件是共用的 → 误删了真实图片（家庭版踩过）
- **现象**：为测「删单品会不会级联清理」，把 `core.db` 复制一份、把 `app.main.DB_PATH` 指到副本上再跑 `DELETE /api/items/{id}`。DB 确实没动，但 `sample_16` 的**主图（白底图）被真删了**——它在 `assets/items/users/` 下，是真实文件。
- **原因**：`delete_item` 不只删行，还调 `cleanup_item_image_files()` 去 `unlink()` 磁盘文件。**换 DB 只隔离了数据库，没隔离文件系统**，而 `ASSETS_DIR` 是模块级常量、跟 `DB_PATH` 无关。`Path.unlink()` 也不进回收站，删了就没了。
- **解法/教训**：跑任何会走到「删除/覆盖资源」路径的测试前，先问一句**这个接口除了数据库还碰什么**。要么连 `ASSETS_DIR` 一起改指到临时目录，要么干脆造一条只属于测试的数据（自己建 item + 自己上传图）再删它，别拿存量数据当小白鼠。
- **补救**：本次影响面就一处——把该单品 images 里失效的那条摘掉、主图回落到仍在的样例原图即可（白底图之后在 UI 里重新「生成白底」就能补回）。
- **现在的处理**：`tests/conftest.py` 在 import app 之前把 `DATABASE_URL` 和 `STORAGE_DIR` 都指到临时目录，测试不会碰到开发数据。写新测试时保持这个前提。

### 3b. SQLite 外键默认**关闭**，而且是每连接开关
- **现象**（家庭版踩过）：删掉被搭配引用的单品，接口 200，但 `outfit_item` 里的关联行还在。
- **原因**：SQLite 必须**每条连接**执行 `PRAGMA foreign_keys = ON` 外键才生效，建表时写了 `REFERENCES` 也没用。
- **现在的处理**：`app/db.py` 在引擎的 `connect` 事件里统一打开，所有连接（含 alembic）都走 `make_engine()`。Postgres 没这个问题。外键一律 `ON DELETE CASCADE`：删单品 = 搭配里少掉那一件，搭配本身作为历史保留。
- **教训**：**声明了外键 ≠ 外键生效**，要用真实的 DELETE 去验（`tests/test_recommend_generate.py::test_deleting_item_keeps_outfit`）。

### 3d. SQLite batch 迁移改父表会级联删光子表
- **现象**：删 `user.avatar` / `user.gender` 的迁移跑完，`user` 行还在，但 `item` 从 16 条变成 0 条，搭配也一起没了。
- **原因**：SQLite 不支持 DROP COLUMN 时，Alembic 的 `batch_alter_table` 用「建新表 → 拷数据 → DROP 旧表 → 改名」来改表。迁移连接也走 `make_engine()`，外键是开着的（见 3b），所以 DROP 旧的 `user` 表会触发子表的 `ON DELETE CASCADE`。改子表（比如删 `item.is_in_wishlist`）没事，**改被引用的父表才会出事**。
- **现在的处理**：`migrations/env.py` 在 SQLite 上跑迁移前先 `PRAGMA foreign_keys = OFF`（这条在事务里不生效，要放在 `begin_transaction` 之前），跑完用 `PRAGMA foreign_key_check` 检查一遍再打开。回归测试是 `tests/test_migrations.py`。
- **教训**：迁移前先备份 `data/app.db`；跑完对比各表行数，不要只看表结构。

### 3. uvicorn `--reload` 在 Windows 上重启一次后彻底卡死
- **现象**：改第一次 `.py` 会重载，之后再怎么改都没有 "Reloading" 日志，reloader 静默卡住；旧子进程还活着、继续占着端口（→ #5b）。
- **实测结论**（uvicorn 0.53.0 + watchfiles 1.3.0）：**不是 watchfiles 的问题**。直接调 `watchfiles.watch()` 时 added / modified / deleted 全部正常收到，编辑器的原子写入（tmp + rename）也收得到。卡住的是 uvicorn 自己的 `BaseReload.restart()`：
  ```python
  os.kill(self.process.pid, signal.CTRL_C_EVENT)   # 立刻返回，但子进程根本没收到
  self.process.join()                              # 永久阻塞在这里
  ```
  `CTRL_C_EVENT` 底层是 `GenerateConsoleCtrlEvent`，只能广播给**控制台进程组**；multiprocessing spawn 出来的子进程不是独立进程组，信号落不到它身上，`join()` 就一直等下去。
- **解法**：别用 `uvicorn --reload`，改用 `backend/dev.py`（基于 `watchfiles.run_process()`）。它用 `os.kill(pid, SIGINT)` 停子进程，在 Windows 上 CPython 会走 `TerminateProcess` 硬杀，可靠。两个启动脚本（`start-backend.bat` / `启动Online.bat`）都已改成走它。
  ```powershell
  cd backend ; .\.venv\Scripts\python.exe dev.py    # 默认 127.0.0.1:8000；DEV_HOST=0.0.0.0 开局域网
  ```
- **教训**：失效点在 uvicorn 的进程重启逻辑，不在文件监视层——别再去调 `WATCHFILES_FORCE_POLLING` 之类的参数（实测无效）。

### 5. Python 依赖别装全局
- **现象**：`pip install httpx` 进了全局解释器。
- **解法**：项目内建 `backend/.venv`，依赖装进去；用 `backend/.venv/Scripts/python.exe` 跑。`.gitignore` 已忽略 `.venv/`。

### 5b. 8000 端口"杀不掉"，其实是 uvicorn 的孤儿子进程攥着套接字
- **现象**：`netstat -ano` 显示 8000 LISTENING 属于某 PID（如 30492），但 `tasklist /FI "PID eq <pid>"` 与 `Get-Process` 都查无此进程，`taskkill /F` 报"进程不存在"却仍占着端口。接口可能还能连上，但行为异常——孤儿跑的是旧代码：旧库路径时 → 500；旧代码缺新路由时 → GET 404 / POST 405（SPA 挂载拦截所致）。
- **原因**：**不是真僵尸套接字**。uvicorn 被非正常终止后，它 spawn 的 multiprocessing 子进程没被一起回收，子进程**继承了监听套接字句柄**，于是端口一直挂在那个已死的父 PID 名下。这些孤儿常是**用全局 python 起的**（裸 `python -m uvicorn …` 没走 venv，命中 #5 的延伸）——既占端口、又跑着改码前的旧逻辑，排查时极易误判成"我的改动有 bug"。
- **排查**：两条路任选——
  ① 按父 PID 找还活着的子进程：
  ```powershell
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*parent_pid=30492*' }
  ```
  会查到一个 `from multiprocessing.spawn import spawn_main; spawn_main(parent_pid=30492 ...)` 的 python.exe。
  ② 不依赖父 PID，直接列出所有还活着的 uvicorn / spawn 子进程（更省事，能一次看清是不是全局 python）：
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'uvicorn|multiprocess' } | Select ProcessId,CommandLine
  ```
- **解法**：`Stop-Process -Id <子进程PID> -Force`，端口立即释放，无需重启。根治两条：① 停 uvicorn 用 `Ctrl+C` 优雅退出（连带回收子进程，见 #3）；② **永远用 venv 起服务**（`backend\.venv\Scripts\python.exe -m uvicorn …`），别用裸 `python`，否则即便起来了也是旧解释器 + 旧代码（见 #5）。

## 大模型输出解析

### 0. LLM 输出校验放错层 → 整个功能挂掉
- **现象**：新增字段后 auto-tag 全部失败，前端显示"识别失败"，其他字段也不填了。
- **原因**：两个叠加错误——
  ① **大小写敏感**：`GENDER_ALIASES` 用 `value.strip()` 没 `.lower()`，LLM 回 `"Female"` / `"Neutral"` 就匹配不上，归一失败。
  ② **校验层错误**：把"必填"校验（`if not gender: raise ValueError`）放进了 LLM 解析器，解析失败 → 重试 → 还失败 → TagError 422 → 整个 auto-tag 挂掉，所有字段都不填。
- **教训**：
  - LLM 输出的字符串匹配**一律大小写不敏感**（`.strip().lower()` 后再查表）。
  - "必填"是**业务约束，放保存边界**（前端 `doSave` / 后端写库前），不要放进 LLM 响应解析器。解析器职责是"尽力归一，归一不了就留空"，保存时再拦截提示用户手填。
  - 调试 LLM 相关 bug 时**先加日志/看原始 LLM 返回**，不要凭猜测改多处再测——每次只改一个变量，否则找不到真正的根因。
- **解法**：`normalize_gender` 改为 `.strip().lower()` 后查表；解析器（现为 `domain/tagging.parse_tag_output`）不再对 gender 抛 `ValueError`；前端 `doSave` 加 `if (!gender)` 提示用户选择。

### 0b. 归一返回空 = 字段"静默丢值"（gender 续）
- **现象**：① 模特性别保存成功却不显示；② auto-tag 唯独 gender 空。
- **原因**：归一/填充返回空但不报错——① 迁移只给 `item` 补了 `NULL→unisex`、漏了 `model`；② `GENDER_ALIASES` 没覆盖「女性」「feminine」等写法，`normalize_gender` 返回 `""`。
- **教训**：归一返回空 = 数据静默丢失，最难查。别名表要覆盖 LLM 各种写法（中英/单复数/口语）；多表共用迁移逻辑要逐表对齐（`if table=="item"` 特判就是漏表信号）。

## Shell / 编码（Windows）

### 6. curl 传中文 JSON body 被 shell 弄坏
- **现象**：`curl -d '{"need":"中文…"}'` → FastAPI 报 `There was an error parsing the body`。
- **原因**：PowerShell/bash 对内联中文 + 引号的处理会破坏 JSON。
- **解法**：把 body 写进 UTF-8 文件，用 `curl --data-binary @file.json`。

### 7. 控制台中文显示乱码（但数据是好的）
- **现象**：打印接口返回的中文是乱码。
- **原因**：Windows 控制台默认 GBK 代码页，不是 UTF-8。
- **解法**：这是**显示**问题，不是数据问题——读响应文件时用 `encoding='utf-8'` 即可正常解析；必要时 `chcp 65001`。

### 8. git bash 的 `/tmp` ≠ Windows Python 的 `/tmp`
- **现象**：`curl -o /tmp/x.json` 后 Windows `python` 找不到该文件。
- **原因**：git bash 的 `/tmp` 映射到别处，Windows 解释器按字面找 `C:\tmp`。
- **解法**：跨 git-bash 与 Windows 程序传文件时，用项目内相对路径，别用 `/tmp`。

## 前端 / Vite / iOS

### 14. 一个弹窗里可以有**多条**夺焦路径，堵一条等于没堵（家庭版踩过两次）
- **现象**：「首次设置管理 PIN」时，点「再输一次」输入框**点了没反应**——光标看似进去了，敲键盘却一个字都进不去，框始终空白。
- **原因**：家庭版的 PIN 弹窗里有三处会把焦点抢回主 PIN 框，且**都是当初有意加的**（为 iOS「点空白不收键盘 / 用户手势才弹键盘」）：
  ① `onPinBlur` 的 `setTimeout(focus, 100)`；
  ② 弹窗内容区 `onClick` → 聚焦 PIN 框——**点确认框时事件冒泡到这里**，这条最隐蔽；
  ③ 「校验失败清空 pin 后重新聚焦」的 effect。
  主 PIN 框已满 4 位，焦点一旦被抢回，后续击键全被 `slice(0, 4)` 静默吞掉 → 表现就是「没反应」。
- **教训 1**：排查焦点问题时，别找到第一个 `focus()` 就收工。**把文件里所有 `focus()` / `autoFocus` 全列出来**，逐个问「什么时候触发、当前模式下该不该触发」。第一版修复只堵了①，用户实测照旧复现。
- **教训 2（更重要）**：焦点、事件冒泡这类行为，**读代码判断不算验证**。这个 bug 连续两轮靠推理下结论，第一轮就是错的。家庭版因此接了 `vitest + jsdom + @testing-library`，一条 `user.click(确认框)` + 断言 `document.activeElement` 就能立刻分出真假。
- **写完测试记得反向验一次**：把修复退回 bug 版，看测试是否变红——绿测试不等于有效测试。本例还直接拿 v0.14 原版跑了同一套（`git show <commit>:<path> > tmp.tsx`），确认 4 红 3 绿，才算证明测试复现了用户报的现象。

### 12. iOS 键盘：`.app` 随 `visualViewport` 缩放会闪、静止又保不住顶栏——「顶栏稳」和「不闪」不可兼得
- **现象**：对话页移动端把 `.app` 做成 `position:fixed` + 高度绑 `visualViewport.height`。键盘弹起时选哪种都有代价：
  - **缩放（app 高度跟 vv 缩到键盘上方）**：顶栏/输入框位置全对、稳定；但缩放那一下 iOS 会把整个 fixed 图层**重栅格化一次 → 上半部分闪一下**（`.msg`/顶栏提 GPU 层也压不住——iOS 对全屏 fixed 容器的 resize 就是整屏重绘）。
  - **静止（冻结 app 高度，不缩）**：不闪；但 iOS 聚焦输入框时会把**布局视口整体上滚** `offsetTop` 去露出输入框，`position:fixed` 是相对布局视口的 → **顶栏被顶出可视区**。想用 JS 补偿（改 `.app` 的 top/transform 追 `offsetTop`）：① 补偿整个 `.app` = 又动了全屏 fixed 容器 → 闪回来；② 只补偿顶栏那一条 = `visualViewport` 事件**滞后于 iOS 的滚动重绘一帧**，追不上 → 顶栏"消失又出现"地跳，做不到丝滑 sticky。
- **根因**：iOS Safari 上，① resize 全屏 fixed 容器必然整屏重栅格化；② `position:fixed` 锚在布局视口、键盘聚焦会滚布局视口，且 `visualViewport` 补偿天然滞后。二者叠加 → **「顶栏稳定可见」与「键盘弹起不闪」在纯 Web 上不可兼得**（无 `env(keyboard-inset-*)`/`interactive-widget`，iOS 都不支持）。
- **决定（v0.14）**：取**缩放模型**——`.app` 高度绑 `vv.height`、`top` 绑 `offsetTop`（仅键盘态跟随，普通滑动钉 0，见 #11）。**顶栏绝对稳、输入框准，接受键盘弹起时闪一次**（一次性、非持续）。`.app` 之外，弹层（portal 到 body）同样用 `--app-h/--app-top` 贴合可视区。
- **教训**：这类"键盘顶输入框"的坑别再试图两全——先跟用户确认优先级（稳 vs 不闪），再一条路走到底。别在 `.app` 上同时试 resize 和 transform 补偿，只会两个毛病都沾。

### 11. iOS：`position:fixed` app 绑 `visualViewport.offsetTop` → 普通滑动时整页（含顶栏/tabbar）被拖着走
- **现象**：对话页滑动时，**整个页面（顶栏 + 底部 tabbar + 内容）一起动、方向还和手指相反**；另有键盘弹起后底部 tabbar 被顶到键盘上方（没收起）。
- **原因**：移动端把 `.app` 做成 `position:fixed` + `top:var(--app-top)` + `height:var(--app-h)`，用 `visualViewport` 的 `offsetTop/height` 实时喂给 CSS（为的是键盘弹起时可视区上移的补偿）。两个坑：
  ① **offsetTop 无条件跟随**：普通滑动到边界时 iOS 橡皮筋回弹会让 `offsetTop` 瞬间抖动，`.app` 的 `top` 跟着抖 → 整个 fixed 层被拖动（顶栏/tabbar 一起飘，观感是"整页反向滑"）。
  ② **键盘检测用 `window.innerHeight - vv.height`**：**独立 PWA 模式下 iOS 会连 `innerHeight` 一起缩**，差值≈0，判不出键盘 → 依赖它的 `kb-open`（收 tabbar/去底部留白）不触发。
- **解法**：
  ① `--app-top` **只在键盘态才跟随 `offsetTop`**，非键盘态钉 `0`（`kbOpen ? vv.offsetTop : 0`）——普通滑动不再拖动整页。
  ② 键盘检测改用**布局视口 `document.documentElement.clientHeight`（不随键盘变，比 innerHeight 稳）+ 文本框 `focusin/focusout` 兜底**；聚焦即判键盘态，还能在键盘动画前就先收起 tabbar，连闪一下都省了。
  ③ 给内部滚动容器（`.chat-log` / 移动端 `.content`）加 `overscroll-behavior: contain`，从源头截断回弹链、别传导到整页。
- **教训**：凡是拿 `visualViewport` 事件驱动 `position:fixed` 布局的，务必区分「键盘态」和「普通滚动/橡皮筋」——offsetTop 在后者是噪声，跟随它必翻车。

### 10. iOS Safari：惯性滚动容器内的 `position:fixed` 弹层被裁剪/错位（弹窗"点了没反应"）
- **现象**：手机上点「添加单品」按钮**有按下变色**，但弹窗不出现；点单品图放大（Lightbox）也弹不出。**诡异点**：iPhone 12 Pro（390pt 宽）必现，12 Pro Max（428pt 宽）却正常——看起来像"宽度 bug"，但全站只有一个 640px 媒体断点，两台机器吃的是同一套移动样式。
- **原因**：弹层（`.modal-backdrop` / `.lightbox`，都是 `position:fixed; inset:0`）当时渲染在 `.content` **内部**，而 `.content` 在移动端是 `overflow-y:auto; -webkit-overflow-scrolling:touch` 的惯性滚动容器。**iOS Safari 已知 bug：惯性滚动容器内的 `position:fixed` 子元素会被裁剪/错位**，弹层在 DOM 里存在却画到可视区外。设备差异是表象——屏矮的 12 Pro 内容撑得 `.content` 可滚动→触发；屏高的 Pro Max 内容放得下不滚→不触发。**所以"只有某台手机不行"未必是宽度断点，先怀疑滚动容器 + fixed 的组合。**
- **教训**：① "按钮变色但无反应"先分清——变色只说明 touch 落到了元素上（`:active`），**不代表 onClick 没执行**，元素可能已渲染但不可见；别只盯着 click handler。② 全屏覆盖层（modal / lightbox / toast）**一律 portal 到 `document.body`**，别嵌在业务滚动容器里。
- **解法**：加 `components/Portal.tsx`（`createPortal` 到 body），包裹所有弹层根节点（现在统一走 `Modal` / `Lightbox` / `ItemDetail`）。

### 9. Vite dev server 默认只绑 IPv6 `[::1]`
- **现象**：`localhost`(127.0.0.1) 连不上 dev server。
- **原因**：默认只监听 `[::1]`。
- **解法**：`server.host: true` 显式监听所有地址。排查先 `netstat` 看实际绑的地址。
