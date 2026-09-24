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

## 下一步

### M1 · 用真实接口验证（最大风险，最先做）
- [ ] 填入大模型接口，验证选款：结构化输出用哪种 `LLM_JSON_MODE` 最稳，选款质量是否与家庭版相当
- [ ] 验证自动打标：视觉模型是否可用、字段是否稳定
- [ ] **验证生图接口能否一次输入多张图**（人物 + 多件单品）：决定 `TRYON_MODE` 用 single 还是 serial
- [ ] 换装效果评估：用示例数据跑几组，对比 single / serial 的效果和耗时；按需调 `domain/dressing.py` 的提示词
- [ ] 白底标准照、AI 编辑的效果评估

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
