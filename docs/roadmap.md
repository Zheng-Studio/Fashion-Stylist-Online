# Roadmap

## 已完成

### M0 · 从家庭版重建骨架（2026-09-25）
- [x] 后端新骨架：FastAPI + SQLAlchemy 2 + Alembic，按 routers / services / domain / providers 分层
- [x] 数据模型：用户即模特，去掉「模特 / 共享单品 / 管理 PIN / settings」；新增扣费流水表 `charge_record`
- [x] 选款逻辑原样迁入：句柄机制、格式 + 结构校验、校验失败重试、硬负约束 / 季节预过滤
- [x] 大模型 → OpenAI 兼容 `chat/completions`（结构化输出方式可配）
- [x] 生图 → OpenAI 兼容 `images/edits`：换装（single / serial 两种方式）、单品 AI 编辑、白底标准照
- [x] 登录 / 扣费 / 存储 / 后台任务做成可替换实现，先放 dev / ledger / 本地 / 线程池
- [x] 图片 key 不可变（旋转写新 key），去掉家庭版的 mtime 版本号机制
- [x] 前端：删前门选人、管理区、PIN、模特管理、模型切换；接 token；「我」页面改为本人照片管理
- [x] 测试：后端 18 条（临时库 + 假模型），前端 token 处理 4 条
- [x] 去掉心愿单（迁移 `drop wishlist`）：衣橱里的单品全部参与选款

## 进行中

### M1 · 用真实接口验证（最大风险，最先做）

当前配置：`LLM_MODEL=deepseek-flash`（`LLM_JSON_MODE=json_object`）/ `IMAGE_MODEL=doubao-seedream-4.5`（`IMAGE_SIZE=1728x2304`），两个口子都走 Lucimix 网关 `https://bizapi.lucimix.com/v1`。

- [x] 大模型接口打通：`deepseek-flash` + `json_object` 返回合法 JSON，选款文本链路通（1.7s）
- [x] 自动打标：`deepseek-flash` 自带 vision，字段完整稳定（5.2s）→ **不用单独配 `LLM_VISION_MODEL`**
- [x] 生图接入 Lucimix 网关 `/v1/images/generations`（JSON body，参考图字段 `image`），接入方式见 [lucimix-image-api.md](lucimix-image-api.md)
- [x] **验证生图接口能一次输入多张图**：`doubao-seedream-4.5` 支持 1 人 + 多件单品一次调用（实测 5 张输入）→ **结论：固定 single，serial 模式已删**
- [x] 换装效果评估（单组）：1 人 + 4 件（内搭 / 下装 / 外套 / 鞋）36.6s，输出 1728x2304，单画面、单人物、无拼贴
- [x] `IMAGE_SIZE` 对 Seedream 生效：请求 1728x2304，输出尺寸一致
- [ ] 用真实衣橱跑完整选款流程，评估选款质量——目前只用「2 个候选」的极简 case 验过，句柄协议 / 结构校验 / 重试都没在真实规模下压过
- [ ] 换装多跑几组，覆盖叠穿、整身（连衣裙）、配饰、帽子等场景，按需调 `domain/dressing.py` 提示词
- [ ] 白底标准照、AI 编辑的效果评估

## 下一步

### M2 · 对接 Lucimix
- [ ] 登录：确认 token 的传递方式（URL 参数 / postMessage）与校验接口，实现 `LucimixAuth`
- [ ] 扣费：确认扣费接口（是否支持预扣 + 退回），实现 `LucimixBilling`；确认各动作的价格
- [ ] iframe 适配：嵌入尺寸、与宿主页通信

### M3 · 部署形态
- [ ] Postgres（`DATABASE_URL` 切换 + 加 `psycopg` 依赖）
- [ ] 对象存储实现 `storage.py`，前端 `VITE_FILES_BASE` 指向 CDN
- [ ] Redis + 独立 worker 替换进程内线程池（多实例部署时必须）
- [ ] Dockerfile + docker-compose（api / worker / redis / postgres）
- [ ] 依赖版本锁定（目前 requirements 未锁版本）

### 待定
- [ ] 新用户的空衣橱引导（是否给示例单品）
- [ ] UI 改版（现沿用家庭版样式，`styles.css` 里还有已删页面的旧样式可清理）
- [ ] 旋转后取消编辑会留下孤儿文件，需要定期清理
- [ ] **生成图带「AI生成」水印**（右下角）：商业功能要不要保留、能否去掉，待确认
- [ ] 生图耗时偏长（5 张 36.6s）而 `TASK_WORKERS=2`：用户等待与并发都要评估（关联 M3）
- [ ] 换模型注意：网关上的纯文本模型（`deepseek-v4-pro`、`glm-5.1/5.2/5.3`）**不能**当视觉模型；`gemini-3.1` 是 `async_image`（异步取结果），与现在同步的 `providers/image.py` 不兼容
- [ ] 清理死代码：`domain/dressing.py` 的 `serial_prompt()`、`config.tryon_mode`（换装已固定 single）
