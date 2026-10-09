# Fashion Stylist Online

对话式 AI 穿搭助手，作为第三方应用以 iframe 形式嵌入 **Lucimix** 平台。

用户用一句话说需求（"今天通勤，大地色系，不要裙子"），助手从**用户自己的衣橱**里挑出一套搭配，
再用用户本人的照片生成上身效果图。每个平台用户只有自己的衣橱和照片，**用户即模特**。

## 功能

- **对话选款**：大模型从衣橱候选里挑一套，支持"把刚才的裤子换成裙子"这类连续调整。
- **上身效果图**：本人照片 + 整套单品，一次调用生成。
- **衣橱管理**：上传单品图后自动打标（名称、品类、颜色、季节等），也可手动编辑；单品支持白底标准照和 AI 编辑。
- **我**：管理本人照片，选一张作为生图底图。

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
.\.venv\Scripts\python.exe scripts/seed_dev.py          # 可选：给 dev 用户灌示例衣橱 + 示例照片

# 前端
cd ..\frontend
npm install
```

### 日常启动

直接双击仓库根目录的脚本。它们会先检查环境和端口占用，再打印真实的访问地址：

| 脚本 | 作用 |
|---|---|
| `启动Online.bat` | 前后端一起启动，绑 `0.0.0.0`，同一 Wi-Fi 下的手机也能访问。**一边开发一边看效果用这个** |
| `start-backend.bat` | 只启动后端（`127.0.0.1:8000`） |

也可以手动启动：

```powershell
cd backend  ; .\.venv\Scripts\python.exe dev.py   # 后端 http://127.0.0.1:8000
cd frontend ; npm run dev                          # 前端 http://localhost:5173（/api、/files 代理到 8000）
```

- 前后端都带热重载：改前端代码浏览器立刻更新，改 `backend/app/` 下的代码后端自动重启。改 `backend/.env` 要手动重启后端。
- 不要用 `uvicorn --reload`，它在 Windows 上重载一次后会卡死（见 [pitfalls](docs/pitfalls.md) #3）。
- 不带 token 打开页面就是 dev 默认用户；地址加 `?token=bob` 就是另一个用户 bob，第一次访问时自动创建。
- 接口文档：http://127.0.0.1:8000/docs

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
| `AUTH_MODE` / `BILLING_MODE` | 对接 Lucimix 前用 `dev` / `ledger` |

前端构建时可注入：`VITE_API_BASE`（前后端不同源时）、`VITE_FILES_BASE`（图片走对象存储 / CDN 时）。

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
  src/components/       Chat（对话选款 + 生图）/ Wardrobe + ItemForm（衣橱）/ MyProfile（我 + 照片）

backend/   FastAPI + SQLAlchemy 2 + Alembic
  app/routers/          me / items / images / recommend / outfits / generations：参数校验、权限、错误码
  app/services/         recommend（选款流水线）/ tagging（自动打标）/ generation（生图任务）：编排
  app/domain/           纯逻辑，不做 IO，可直接单测：选款提示词、校验、搭配结构、换装提示词、图片处理
  app/providers/        外部模型：llm.py / image.py
  app/auth.py           登录         ┐
  app/billing.py        扣费         │ 可替换实现，业务代码只依赖接口
  app/storage.py        文件存储     │
  app/tasks.py          后台任务     ┘
  dev.py                开发用启动器（热重载）
  migrations/           Alembic 迁移
  scripts/seed_dev.py   给开发用户灌示例数据
  sample/               示例单品图 + 示例人物照
```

**可替换的四个口子**：换实现不用动业务代码。

| 口子 | 现在 | 以后 |
|---|---|---|
| `auth.py` | `dev`：token 本身就是用户标识 | `lucimix`：拿 token 调平台换用户信息 |
| `billing.py` | `ledger`：只写扣费流水 | `lucimix`：记流水 + 调平台扣费 |
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
- [docs/lucimix-image-api.md](docs/lucimix-image-api.md)：Lucimix 生图接口接入说明
- [CLAUDE.md](CLAUDE.md)：代码约定（分层、数据归属、扣费时机等）
