# Fashion Stylist Online

对话式 AI 穿搭助手，作为第三方应用以 iframe 形式嵌入 **Lucimix** 平台。

用户用自然语言说需求（"今天通勤，大地色系，不要裙子"），助手从**用户自己的衣橱**里挑一套搭配，
再用用户本人的照片生成上身效果图。

> 本项目基于家庭自用版 [Fashion-Stylist](https://github.com/Zheng-Studio/Fashion-Stylist) v0.15（commit `89a550b`）重建：
> 选款逻辑（句柄机制、校验、结构规则、预过滤）原样迁入，其余按线上部署重新搭。家庭版的完整演进历史在原仓库。

## 和家庭版的区别

| | 家庭版 | 本项目 |
|---|---|---|
| 用户 | 前门选家庭成员 + 管理 PIN | Lucimix 平台用户（token），**用户即模特** |
| 衣橱 | 成员专属 + 家庭共享 | 每个用户只有自己的 |
| 大模型 | 本地 Ollama | OpenAI 兼容接口（可配任意厂商） |
| 生图 | 本地 ComfyUI，逐件串行换装 | OpenAI 兼容 `images/edits`，默认一次调用换整套 |
| 数据库 | SQLite + 手写迁移 | SQLAlchemy + Alembic（本地 SQLite / 线上 Postgres） |
| 图片 | 本地目录，原地覆盖 + mtime 版本号 | 存储抽象（本地 / 以后对象存储），key 不可变 |
| 后台任务 | daemon 线程 | 线程池（接口已留，可换队列） |

## 架构

```
frontend/  React + Vite + TS
  src/auth.ts          token：iframe ?token= 或 postMessage → 每个请求带 Authorization: Bearer
  src/api.ts           所有接口调用
  src/components/      Chat（对话选款 + 生图）/ Wardrobe + ItemForm（衣橱）/ MyProfile（我 + 照片）

backend/   FastAPI
  app/main.py          装配：路由 + CORS + 本地文件服务
  app/routers/         me / items / images / recommend / outfits / generations
  app/services/        recommend（选款流水线）/ tagging（自动打标）/ generation（生图任务）
  app/domain/          纯逻辑，无 IO：taxonomy / prompt_builder / validator / structure / dressing / imaging / tagging
  app/providers/       外部模型：llm.py（chat/completions）/ image.py（images/edits）
  app/auth.py          登录：dev（本地）/ lucimix（待接入）
  app/billing.py       扣费：ledger（只记流水）/ lucimix（待接入）
  app/storage.py       文件存储：LocalStorage（以后加对象存储实现）
  app/tasks.py         后台任务：进程内线程池（以后换 Redis 队列）
  migrations/          Alembic 迁移
  scripts/seed_dev.py  给开发用户灌示例衣橱
  sample/              示例单品图 + 示例人物照
```

**可替换的四个口子**（业务代码只依赖接口，换实现不动业务）：

| 口子 | 现在 | 以后 |
|---|---|---|
| `auth.py` | `AUTH_MODE=dev`：token 本身当用户 id | `lucimix`：拿 token 调平台换用户信息 |
| `billing.py` | `BILLING_MODE=ledger`：只写 `charge_record` | `lucimix`：记流水 + 调平台扣费 |
| `storage.py` | 本地目录，后端挂 `/files/` | 对象存储 + CDN，前端构建时注入 `VITE_FILES_BASE` |
| `tasks.py` | 进程内线程池 | Redis 队列 + 独立 worker（多实例部署时） |

**收费规则**：生成上身图、单品 AI 编辑、白底标准照收费，**成功后才扣**，失败不扣；选款和自动打标不收费。

## 本地开发

需要 Python 3.12+、Node 20+。

```powershell
# 后端（首次）
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
copy .env.example .env                                  # 填大模型 / 生图接口
.\.venv\Scripts\python.exe -m alembic upgrade head      # 建表
.\.venv\Scripts\python.exe scripts/seed_dev.py          # 可选：给 dev 用户灌示例衣橱 + 照片

# 后端（运行）
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload

# 前端
cd frontend
npm install
npm run dev          # http://localhost:5173，/api 和 /files 已代理到 8000
```

- 不带 token 打开页面 = dev 默认用户；地址加 `?token=bob` 就是另一个用户 bob（dev 模式下 token 即用户标识）。
- 接口文档：`http://127.0.0.1:8000/docs`。

### 检查（提交前都要过）

```powershell
cd backend  ; .\.venv\Scripts\python.exe -m pytest -q
cd frontend ; npx tsc --noEmit ; npm run lint ; npm test
```

后端测试用临时 SQLite + 临时存储目录 + 假的大模型/生图，不碰开发数据、不调外部接口。

### 改了数据模型

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic revision --autogenerate -m "说明"   # 生成后人工检查一遍
.\.venv\Scripts\python.exe -m alembic upgrade head
```

## 配置

全部走环境变量或 `backend/.env`，完整列表见 [backend/.env.example](backend/.env.example)。关键几项：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 默认 `sqlite:///backend/data/app.db`；线上填 Postgres |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 选款用的大模型 |
| `LLM_VISION_MODEL` | 自动打标用的视觉模型，不填沿用 `LLM_MODEL` |
| `LLM_JSON_MODE` | `json_schema` / `json_object`（默认）/ `none`，按厂商支持程度选 |
| `IMAGE_MODEL`（+ `IMAGE_BASE_URL` / `IMAGE_API_KEY`） | 生图接口，地址和 key 不填沿用 LLM 的 |
| `TRYON_MODE` | `single`（默认，人物 + 全部单品一次调用）/ `serial`（逐件，接口只收 2 张图时用） |
| `AUTH_MODE` / `BILLING_MODE` | `dev` / `ledger`（对接 Lucimix 前） |

前端构建时可注入：`VITE_API_BASE`（前后端不同源时）、`VITE_FILES_BASE`（文件走对象存储/CDN 时）。

## 文档

- [docs/roadmap.md](docs/roadmap.md)：进度与待办
- [docs/pitfalls.md](docs/pitfalls.md)：踩过的坑（遇到环境类怪问题先翻这里）
- [docs/DESIGN.md](docs/DESIGN.md)：视觉设计参考（沿用家庭版）
