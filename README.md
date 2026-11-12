# Fashion Stylist Online

对话式 AI 穿搭助手，支持管理个人衣橱、按需求推荐搭配，并生成上身效果图。

用户用一句话说需求（"今天通勤，大地色系，不要裙子"），助手从**用户自己的衣橱**里挑出一套搭配，
再用用户本人的照片生成上身效果图。每位用户只有自己的衣橱和照片，**用户即模特**。

## 功能

- **对话选款**：大模型从衣橱候选里挑一套，支持"把刚才的裤子换成裙子"这类连续调整。
- **上身效果图**：本人照片 + 整套单品，一次调用生成。
- **衣橱管理**：上传单品图后自动打标（名称、品类、颜色、季节等），也可手动编辑；单品支持白底标准照和 AI 编辑。
- **我**：管理本人照片，选一张作为生图底图。
- **首次体验**：新用户先上传本人照片，用预置示例单品生成一张试穿图，再进入正常使用（示例单品不写入个人衣橱）。

**收费**：上身效果图、单品 AI 编辑、白底标准照收费，**成功后才扣**，失败不扣；选款和自动打标不收费。

## 快速开始

需要 Python 3.12+、Node 20+。下面的命令以 Windows PowerShell 为例。

### 第一次

```powershell
# 后端
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
copy .env.example .env                                  # 填大模型 / 生图接口，见下文「配置」
.\.venv\Scripts\python.exe -m alembic upgrade head      # 建表
.\.venv\Scripts\python.exe scripts/seed_dev.py          # 可选：给本地 dev 用户灌示例衣橱（仅开发用，部署不用跑）

# 前端
cd ..\frontend
npm install
```

### 日常启动

直接双击仓库根目录的脚本。它们会先检查环境，再挑一个空闲端口（默认 8000 / 5173，被占用就往后找），最后打印真实的访问地址：

| 脚本 | 作用 |
|---|---|
| `启动Online.bat` | 前后端一起启动，绑 `0.0.0.0`，同一 Wi-Fi 下的手机也能访问。**一边开发一边看效果用这个**。前后端端口各自独立漂移，前端代理跟着后端走 |
| `start-backend.bat` | 只启动后端（固定 `127.0.0.1:8000`，被占用就直接报错） |

也可以手动启动：

```powershell
cd backend  ; .\.venv\Scripts\python.exe dev.py   # 后端 http://127.0.0.1:8000
cd frontend ; npm run dev                          # 前端 http://localhost:5173（/api、/files 代理到 8000）
```

手动启动时端口是默认值（后端 8000，前端从 5173 起找空闲的）。`启动Online.bat` 挑好端口后会通过 `VITE_API_PORT` 告诉 [frontend/vite.config.ts](frontend/vite.config.ts)，所以它换端口时前端代理会跟着换。

- 前后端都带热重载：改前端代码浏览器立刻更新，改 `backend/app/` 下的代码后端自动重启。改 `backend/.env` 要手动重启后端。
- 不要用 `uvicorn --reload`，它在 Windows 上重载一次后会卡死（见 [pitfalls](docs/pitfalls.md) #3）。
- 不带 token 打开页面就是 dev 默认用户；地址加 `?token=bob` 就是另一个用户 bob，第一次访问时自动创建。
- 接口文档：http://127.0.0.1:8000/docs

### 新用户首次体验

新用户（`onboarding_completed` 为 false）先进入一条独立流程：上传本人照片 → AI 补全为全身照并推断性别（可修改）→ 选一个预置场景（每个场景 3–4 件单品）→ 生成一张试穿图 → 完成后才进入正常应用。已有用户在迁移后保持原来的正常页面。

预置单品目录在 [backend/sample/example_items.json](backend/sample/example_items.json)，**运行时只读，不写进个人衣橱**，搭配上只记 `example_item_ids`。

## 配置

全部走环境变量或 `backend/.env`（含密钥，不进 Git）。完整列表和说明见 [backend/.env.example](backend/.env.example)。

| 变量 | 说明 |
|---|---|
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 大模型（OpenAI 兼容 `chat/completions`），选款和自动打标共用，**必须是多模态模型** |
| `LLM_JSON_MODE` | 结构化输出方式：`json_schema` / `json_object`（默认）/ `none`，按厂商支持程度选 |
| `IMAGE_MODEL` | 生图模型（OpenAI 兼容 `images/generations`） |
| `IMAGE_BASE_URL` / `IMAGE_API_KEY` | 生图接口地址和密钥，不填沿用 LLM 的 |
| `IMAGE_SIZE` | 生图输出像素，默认 `1728x2304`（3:4），须是所选模型支持的尺寸 |
| `DATABASE_URL` | 默认 `backend/data/app.db`（SQLite）；线上填 Postgres |
| `STORAGE_DIR` | 图片存储目录，默认 `backend/data/files` |
| `AUTH_MODE` / `BILLING_MODE` | 本地开发使用 `dev` / `ledger`；部署注意事项见下文「部署」 |
| `CORS_ORIGINS` | 允许的前端来源，JSON 数组，默认 `["*"]`；同源反代时不用改 |
| `TASK_WORKERS` | 生图任务并发数，默认 2（进程内线程池） |

前端构建时可注入：`VITE_API_BASE`（前后端不同源时）、`VITE_FILES_BASE`（图片走对象存储 / CDN 时）。

## 示例数据在哪

`backend/sample/` 是随代码发布的示例数据，分两套，用途不同：

| 位置 | 内容 | 谁在用 | 是否写入数据库 |
|---|---|---|---|
| [backend/sample/example_items.json](backend/sample/example_items.json) | 57 件预置单品（女装 `W01`–`W26`、男装 `M01`–`M15`，另含中性款），图片为腾讯 COS 公网 URL（`image_url`） | 首次体验流程（[app/example_catalog.py](backend/app/example_catalog.py)），运行时读取 | 否，只在搭配上记 `example_item_ids` |
| [backend/sample/items.json](backend/sample/items.json) + [backend/sample/items/](backend/sample/items/) | 18 件示例单品 + 对应图片 | 本地开发的 [scripts/seed_dev.py](backend/scripts/seed_dev.py) | 是，写入该 dev 用户自己的衣橱 |
| [backend/sample/photos/](backend/sample/photos/) | 示例人物照 `sample_female.jpg` / `sample_male.jpg` | 同上 | 是，作为该用户的本人照片 |

部署注意：

- `example_items.json` 里的图片地址必须能被用户浏览器直接访问。现在指向公开的腾讯 COS；如果换 bucket、加签名或改私有读，要同步改 `image_url`，否则首次体验页会裂图。
- `seed_dev.py` 和 `items.json` 那套只用于本地开发，**线上不要跑**，也不要把 dev 用户的衣橱数据带过去。

## 部署

> 当前代码按**单机、单进程**部署。正式多实例上线前还有几步（见 [docs/roadmap.md](docs/roadmap.md) M3），部署前先看下面的「部署前必须确认」。

### 部署前必须确认

- **不要用 `AUTH_MODE=dev` 直接暴露公网**：dev 模式下任意 token 就当作任意用户，等于没有登录。Lucimix 登录（`LucimixAuth`）尚未接入，正式对外前只能放在内网 / 网关后，或先用固定 token 做封闭测试。
- **只能单进程**：生图任务跑在进程内线程池，进程启动时会把所有 `pending` / `running` 的生成记录标成失败。开多个 worker / 多实例会互相误杀任务，所以 `uvicorn --workers` 目前只能是 1。多实例需要先按 roadmap 换成 Redis 队列。
- **`BILLING_MODE=ledger` 只写扣费流水，不会真正扣费。**
- `requirements.txt` 未锁定版本；用 Postgres 需要额外装驱动：`pip install "psycopg[binary]"`（还没写进 requirements）。

### 步骤

```bash
# 1. 后端依赖（Linux 示例；Windows 把 source 换成 .venv\Scripts\activate）
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. 配置：照 .env.example 填 LLM_* / IMAGE_*；
#    线上把 DATABASE_URL 指到 Postgres，STORAGE_DIR 指到持久化目录
cp .env.example .env

# 3. 建表 / 升级
python -m alembic upgrade head

# 4. 前端构建（产物在 frontend/dist）
cd ../frontend
npm ci
npm run build

# 5. 启动后端（不要用 dev.py，也不要加 --reload / --workers）
cd ../backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- 前端静态文件交给 Nginx 或任意静态服务器，把 `/api` 和 `/files` 反代到后端（Nginx 要配 SPA fallback：找不到的路径回 `index.html`）。也可以构建前注入 `VITE_API_BASE` / `VITE_FILES_BASE` 让前端直连，此时需要处理 CORS。
- `STORAGE_DIR` 必须可写并持久化（目录不存在会自动创建），用 SQLite 时 `backend/data/app.db` 也要备份。
- 部署**不需要**运行 `scripts/seed_dev.py`：新用户会走首次体验，示例单品直接读 `backend/sample/example_items.json`。
- 健康检查：`GET /health`。
- 后端重启会中断正在跑的生成任务（会被标成失败，前端提示重试），尽量避开用户使用高峰。

## 数据存在哪

本地开发时都在 `backend/data/`（已在 `.gitignore` 里）：

- `app.db`：数据库，单品、搭配、生成记录、扣费流水。
- `files/u/<用户id>/`：图片，按 `items/`（单品）、`photos/`（本人照片）、`generations/`（效果图）分目录。

图片 key 形如 `u/<用户id>/<类型>/<uuid>.jpg`，写入后不再修改，旋转、编辑都会写成新文件。

## 项目结构

```
frontend/  React + Vite + TypeScript
  src/auth.ts           token：iframe 地址 ?token= 或 postMessage，每个请求带 Authorization: Bearer
  src/api.ts            所有接口调用
  src/components/       Chat（对话选款 + 生图）/ Wardrobe + ItemForm（衣橱）/ MyProfile（我 + 照片）/ Onboarding（首次体验）/ TryonHistory（试穿记录）

backend/   FastAPI + SQLAlchemy 2 + Alembic
  app/routers/          me / items / images / recommend / outfits / generations / onboarding：参数校验、权限、错误码
  app/services/         recommend（选款流水线）/ tagging（自动打标）/ generation（生图任务）：编排
  app/domain/           纯逻辑，不做 IO，可直接单测：选款提示词、校验、搭配结构、换装提示词、图片处理
  app/providers/        外部模型：llm.py / image.py
  app/example_catalog.py  首次体验的预置单品和场景（只读，不入库）
  app/auth.py           登录         ┐
  app/billing.py        扣费         │ 可替换实现，业务代码只依赖接口
  app/storage.py        文件存储     │
  app/tasks.py          后台任务     ┘
  dev.py                开发用启动器（热重载）
  migrations/           Alembic 迁移
  scripts/seed_dev.py   本地开发灌示例衣橱（按性别选样例，幂等）
  sample/               示例数据：example_items.json（首次体验）/ items.json + items/ + photos/（本地 seed）
```

**可替换的四个口子**：换实现不用动业务代码。

| 口子 | 现在 | 以后 |
|---|---|---|
| `auth.py` | `dev`：token 本身就是用户标识 | 接入外部身份服务，校验 token 并获取用户信息 |
| `billing.py` | `ledger`：只写扣费流水 | 接入外部计费服务，记录流水并完成扣费 |
| `storage.py` | 本地目录，后端挂在 `/files/` | 对象存储 + CDN |
| `tasks.py` | 进程内线程池 | Redis 队列 + 独立 worker |

**选款怎么保证不乱挑**：交给大模型的候选单品用临时句柄（`鞋1`、`下装2`），不给真实 id；模型输出后校验句柄必须在候选集里、搭配结构合理，不合规就带着错误重问。

## 开发

### 提交前检查

```powershell
cd backend  ; .\.venv\Scripts\python.exe -m pytest -q
cd frontend ; npx tsc --noEmit ; npm run lint ; npm test
```

后端测试用临时数据库、临时存储目录和假的大模型 / 生图，不碰开发数据，也不调外部接口。

### 改了数据模型

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic revision --autogenerate -m "说明"   # 生成后人工检查一遍
.\.venv\Scripts\python.exe -m alembic upgrade head
```

迁移前先备份 `backend/data/app.db`，跑完对比一下各表行数（见 [pitfalls](docs/pitfalls.md) 3d）。

## 文档

- [docs/roadmap.md](docs/roadmap.md)：进度与待办
- [docs/pitfalls.md](docs/pitfalls.md)：踩过的坑，遇到环境类的怪问题先翻这里
- [docs/DESIGN.md](docs/DESIGN.md)：视觉设计参考
- [CLAUDE.md](CLAUDE.md)：代码约定（分层、数据归属、扣费时机等）
