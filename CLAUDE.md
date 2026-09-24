# CLAUDE.md

给 Claude Code 在本仓库工作的导引。项目介绍、架构、命令见 [README.md](README.md)，进度见 [docs/roadmap.md](docs/roadmap.md)，踩过的坑见 [docs/pitfalls.md](docs/pitfalls.md)。

## 项目是什么
对话式 AI 穿搭助手，作为第三方应用嵌入 Lucimix 平台（iframe）。**用户即模特**：每个平台用户只有自己的衣橱和照片。
由家庭自用版 Fashion-Stylist v0.15 重建而来；家庭版的约定（PIN、共享单品、Ollama、ComfyUI、`connect()` 等）**在这里都不适用**。

## 分层约定（后端）
- `domain/`：纯逻辑，不做 IO（不碰 DB、存储、网络），可以直接单测。选款的核心规则都在这里。
- `services/`：编排（DB + 存储 + 模型调用），不关心 HTTP。
- `routers/`：只做参数校验、权限（数据属于当前用户）、HTTP 错误码转换。
- `providers/` `auth.py` `billing.py` `storage.py` `tasks.py`：可替换实现。**业务代码只依赖它们的接口**，路由通过 `deps.py` 的依赖注入拿实例，测试用 `app.dependency_overrides` 换成假的。

## 必须遵守
- **数据都属于当前用户**：任何按 id 查单品 / 搭配 / 生成记录的地方都要校验 `user_id`，查不到和不是自己的一律 404。图片 key 要用 `storage.owned_by()` 校验是本人的。
- **图片 key 不可变**：存储 key 形如 `u/<user_id>/<kind>/<uuid>.jpg`，写入后不再修改。改图（旋转、编辑）一律写新 key 返回新 key。不要给图片 URL 拼破缓存参数。
- **扣费只在成功后**：调 `billing.charge()` 要放在结果已经落库之后；失败路径不能扣。选款、打标不收费。
- **LLM 只能从候选里选**：选款用临时句柄（`鞋1`、`下装2`），`validator` 强制校验句柄在候选集里，句柄不入库。不要把真实 id 交给模型。
- **必填是业务约束**：放在保存边界（前端保存 / 后端写库），不要放进模型输出解析器（见 pitfalls #0）。
- **配置不写死**：地址、密钥、模型名全部走环境变量（`app/config.py`），代码里不出现具体模型名。
- **改了 `models.py` 就要生成 Alembic 迁移**，生成后人工检查；`alembic.ini` 保持纯 ASCII（见 pitfalls A1）。
- **SQLite 外键**：引擎在 `db.py` 里统一开了 `PRAGMA foreign_keys`；不要绕开 `make_engine()` 自己建连接。

## 前端约定
- 所有接口调用走 `src/api.ts` 的 `request()`（自动带 token、统一错误文案）。
- 图片 URL 一律 `assetUrl(key)`。
- 弹层一律用 `Modal` / Portal 渲染到 body（iOS 惯性滚动容器里的 fixed 元素会被裁掉，见 pitfalls #10）。
- 焦点、事件冒泡、键盘这类行为，读代码判断不算验证，要写 vitest 真跑（见 pitfalls #14）。

## 提交前
```powershell
cd backend  ; .\.venv\Scripts\python.exe -m pytest -q
cd frontend ; npx tsc --noEmit ; npm run lint ; npm test
```
- 测试不能碰开发数据：后端 `tests/conftest.py` 已把数据库和存储指到临时目录，新测试沿用它的 fixture。
- 提交用 Conventional Commits 前缀：feat / fix / docs / chore / refactor / test。

## 环境
- Windows 11 + PowerShell / git bash；路径含中文时写文件用 UTF-8。
- Python 依赖只装进 `backend/.venv`，用 `backend/.venv/Scripts/python.exe` 跑。
- Windows 上 `uvicorn --reload` 经常漏接改动，改完后端手动重启（见 pitfalls #3）。
