# IFS Telegram Bot POC 设计方案

## 1. 方案结论

本项目采用 Cloudflare Worker + D1 + 绑定式 Google Apps Script 的混合架构：

- Cloudflare Worker 是公网入口，负责 Telegram Webhook、权限、消息、幂等、任务编排和审核进度抓取。
- D1 保存事件、Agent 业务记录、Telegram 消息映射、回调去重、审计日志和官方审核进度历史。
- Apps Script 绑定在复制后的 IFS 工作簿中，使用 `SpreadsheetApp` 探测、读取和修改私有 Sheet。
- Google Sheet 是 checkbox 实际状态的唯一事实来源；D1 中的状态只是用于展示和故障恢复的镜像。
- `Bot Records` 隐藏页作为工作簿内的可人工检查镜像，并为 callback 的 `record_id -> codename` 定位链提供本地依据。

这意味着原需求中“第一版不部署独立后端”和“Telegram Webhook 直接部署为 Apps Script Web App”两点，被本次明确指定的 Worker + D1 技术栈取代。Apps Script Web App 仍存在，但只接受 Worker 发来的签名内部请求。

## 2. 推荐目录

```text
ifs-bot/
├── apps-script/
│   ├── Config.gs
│   ├── Utils.gs
│   ├── WorkbookInspector.gs
│   ├── BotRecords.gs
│   ├── Validation.gs
│   ├── SheetRepository.gs       # 阶段三
│   ├── FormHandler.gs           # 阶段四
│   ├── WorkerApi.gs             # 阶段二/四
│   ├── WebApp.gs                # 阶段三，Worker -> Apps Script Bridge
│   ├── ScanHandler.gs           # 阶段六
│   └── Setup.gs                 # 阶段二以后
├── worker/
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── routes/
│   │   │   ├── telegram-webhook.ts
│   │   │   ├── submissions.ts
│   │   │   └── health.ts
│   │   ├── services/
│   │   │   ├── telegram.ts
│   │   │   ├── apps-script-bridge.ts
│   │   │   ├── callback-service.ts
│   │   │   ├── message-renderer.ts
│   │   │   └── review-board.ts
│   │   ├── repositories/
│   │   │   ├── events.ts
│   │   │   ├── records.ts
│   │   │   ├── updates.ts
│   │   │   └── audit-log.ts
│   │   └── domain/
│   │       ├── callback-data.ts
│   │       ├── codename.ts
│   │       └── types.ts
│   ├── migrations/
│   │   └── 0001_initial.sql
│   ├── test/
│   ├── wrangler.jsonc
│   ├── package.json
│   └── tsconfig.json
├── docs/
│   ├── DESIGN.md
│   └── DEPLOYMENT.md             # 实现阶段补充
└── README.md
```

阶段一只提供 Apps Script 的诊断文件；Worker 目录在方案通过后再初始化，避免提前固化未审核的数据库和 API。

## 3. 组件职责与事实来源

| 数据 | 权威来源 | 镜像/索引 |
| --- | --- | --- |
| 到场与数据确认 checkbox | Google Sheet 当前单元格 | D1 records、Bot Records |
| Codename 与计分数据 | Google Form 响应/正式计分板 | D1 submission snapshot |
| Telegram chat/message 映射 | D1 | Bot Records |
| Telegram update/callback 是否处理 | D1 唯一约束 | 无 |
| 操作审计 | D1 audit_logs | Bot Records 最后操作字段 |
| 官方 Scores 审核进度 | 官方发布 Sheet | D1 review_status_history |
| 工作簿列映射 | Apps Script Properties | D1 event 配置摘要（只读镜像） |

任何按钮操作都必须在 Apps Script 内重新读取 Sheet，消息也必须以该次返回的实际状态渲染，不能以 D1 缓存直接判断。

## 4. 核心数据流

### 4.1 表单提交与更新

1. Spreadsheet Form Submit 安装式 Trigger 调用 `handleFormSubmit(e)`。
2. Apps Script 读取事件所在响应行，执行 `flush()`，必要时进行少量短重试。
3. 按配置读取字段，并按 Codename 在正式计分板做精确规范化查找。
4. Apps Script 生成 submission snapshot 和稳定 hash，以共享 HMAC 密钥签名后 POST 到 Worker。
5. Worker 按 `(event_id, normalized_codename)` upsert D1 record，按 snapshot hash 去重。
6. Worker 发送或编辑 Telegram 消息，并把 `chat_id/message_id` 写入 D1。
7. Worker 返回消息映射；Apps Script 更新 `Bot Records` 镜像。
8. 定时 Apps Script 扫描负责发现编辑响应、End Stats 补充和公式延迟。

### 4.2 Telegram 回调

1. Telegram POST 到 Worker `/telegram/webhook`。
2. Worker 校验 `X-Telegram-Bot-Api-Secret-Token`，并以 `update_id` 唯一约束去重。
3. 解析 `callback_query`，验证 `callback_query.from.id` 在事件允许列表中。
4. 校验 callback 格式，例如 `a:1:Ab3x9KpQ` 或 `d:0:Ab3x9KpQ`。
5. Worker 调用 `answerCallbackQuery`，避免客户端持续 loading。
6. Worker 向 Apps Script Bridge 发送带 HMAC 的明确目标状态请求。
7. Apps Script 获取 Script Lock，通过 `record_id -> Bot Records -> codename -> 正式表唯一行` 重新定位。
8. Apps Script 验证配置和 checkbox 数据验证后，明确写入 checked/unchecked 配置值；禁止取反写入。
9. Apps Script 重新读取两个 checkbox 的真实状态，更新 Bot Records，并返回状态。
10. Worker 在 D1 记录审计并调用 `editMessageText` 更新消息。

失败时不猜测：0 个或多个 Codename 匹配、配置无效、列非 checkbox、受保护或签名失败都停止写入。

### 4.3 官方 Scores 审核进度

已有发布页只显示 `Location` 和 `Current Status`，不包含 IFS Event ID。因此不能仅凭 event ID 安全匹配审核行。

POC 的事件配置需要同时保存：

- `event_id`：用户传入的 IFS 事件 ID；
- `review_location`：审核进度板中的准确 Location 文本；
- 可选 `review_location_normalized`：仅用于大小写和空白归一化后的精确匹配；
- `review_board_url`：默认使用已提供的发布页，但保持可配置。

Worker Cron 每 5 分钟抓取发布表，解析后对 Location 做规范化精确匹配，写入状态历史。状态变化时编辑事件管理消息或发送通知。找不到或重复匹配时只告警，不自动绑定。若以后确认存在“event ID -> 官方 Location”的可信 API，再替换人工配置。

## 5. D1 初步数据模型

### events

- `event_id TEXT PRIMARY KEY`
- `spreadsheet_id TEXT NOT NULL UNIQUE`
- `apps_script_url TEXT NOT NULL`
- `target_chat_id TEXT NOT NULL`
- `allowed_user_ids_json TEXT NOT NULL`
- `timezone TEXT NOT NULL`
- `review_location TEXT`
- `review_board_url TEXT`
- `config_state TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Telegram ID 使用 TEXT，避免跨语言整数精度问题。

### records

- `record_id TEXT PRIMARY KEY`
- `event_id TEXT NOT NULL`
- `codename TEXT NOT NULL`
- `normalized_codename TEXT NOT NULL`
- `faction TEXT`
- `telegram_chat_id TEXT`
- `telegram_message_id TEXT`
- `submission_count INTEGER NOT NULL DEFAULT 0`
- `last_submission_hash TEXT`
- `start_stats_received INTEGER NOT NULL DEFAULT 0`
- `end_stats_received INTEGER NOT NULL DEFAULT 0`
- `attendance_state INTEGER`
- `data_confirmed_state INTEGER`
- `last_error TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `UNIQUE(event_id, normalized_codename)`

### telegram_updates

- `update_id TEXT PRIMARY KEY`
- `callback_query_id TEXT UNIQUE`
- `status TEXT NOT NULL`
- `received_at TEXT NOT NULL`
- `completed_at TEXT`
- `last_error TEXT`

### submissions

- `event_id TEXT NOT NULL`
- `source_sheet_gid TEXT NOT NULL`
- `source_row INTEGER NOT NULL`
- `snapshot_hash TEXT NOT NULL`
- `record_id TEXT`
- `payload_json TEXT NOT NULL`
- `observed_at TEXT NOT NULL`
- `UNIQUE(event_id, source_sheet_gid, source_row, snapshot_hash)`

### audit_logs

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `event_id TEXT NOT NULL`
- `record_id TEXT`
- `action TEXT NOT NULL`
- `target_state INTEGER`
- `actual_state INTEGER`
- `telegram_user_id TEXT`
- `telegram_user_label TEXT`
- `result TEXT NOT NULL`
- `error_code TEXT`
- `created_at TEXT NOT NULL`

### review_status_history

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `event_id TEXT NOT NULL`
- `location TEXT NOT NULL`
- `status TEXT NOT NULL`
- `source_hash TEXT NOT NULL`
- `observed_at TEXT NOT NULL`
- `UNIQUE(event_id, source_hash)`

所有 SQL 使用 prepared statements。需要同时写入 update 状态和 audit 时使用 D1 `batch()`，以事务方式提交。

## 6. 接口设计

### Worker 公网接口

- `POST /telegram/webhook`：仅 Telegram；校验 Telegram secret header。
- `GET /healthz`：只返回构建版本和依赖可用性，不返回配置值。

### Worker 内部接口

- `POST /internal/submissions`：Apps Script 上报提交快照。
- `POST /internal/scan-result`：Apps Script 上报扫描变化。
- `POST /internal/config-report`：Apps Script 上报校验摘要，可选。

内部请求使用 HMAC-SHA256。签名覆盖时间戳、nonce 和原始 body；Worker 在 D1 中保存短期 nonce，拒绝超时和重放。

### Apps Script Bridge

- `POST <web-app-url>`，请求 envelope 的 `action` 只允许白名单：
  - `set_confirmation_state`
  - `read_record_state`
  - `run_scan`

Apps Script Web App 的事件对象没有可靠的任意请求头入口，因此 Worker -> Apps Script 的签名放在 JSON envelope 中，不放自定义 header。Envelope 包含 `timestamp`、`nonce`、`payload_b64` 和 `signature`。Apps Script 校验签名和时间窗后才解析 payload。

Apps Script Bridge 不接受任意 sheet、row、column 或 A1 range。它只接受 `event_id`、`record_id`、动作类型和目标布尔状态。

## 7. 安全设计

- Telegram Bot Token、Webhook Secret、Apps Script 共享密钥使用 Worker Secrets；不写入 `wrangler.jsonc`。
- Apps Script 使用 Script Properties 保存 Worker URL、共享密钥、工作簿配置。
- Telegram Webhook URL 不包含 Bot Token。
- Worker 校验 Telegram secret header；Apps Script 不直接接 Telegram。
- 授权只认 `callback_query.from.id`，不认 username。
- callback_data 只携带动作、明确目标状态和随机短 record ID，远低于 64 bytes。
- record ID 使用至少 72 bit 随机值的 base64url 表示，不使用自增 ID。
- Apps Script 写入列由配置白名单限制；每次写入前重新做唯一 Codename 定位。
- Worker 与 Apps Script 双向请求都做 HMAC、时间窗和 nonce 校验。
- 消息使用 Telegram HTML parse mode，并统一转义动态文本。
- 日志只保留 record ID、规范化错误码和必要上下文，不记录 Token、共享密钥或完整 Stats payload。

## 8. 幂等与并发

- `telegram_updates.update_id` 和 `callback_query_id` 唯一约束阻止 Telegram 重试重复执行。
- callback 使用 `a:1:id` / `a:0:id` / `d:1:id` / `d:0:id`，重复执行得到相同 Sheet 状态。
- D1 条件更新将任务从 `received -> processing -> completed/failed`。
- Apps Script 使用 `LockService.getScriptLock().tryLock(...)` 串行化同一绑定脚本的查找、写入和 Bot Records 更新。
- Sheet 单元格始终由 Apps Script 在锁内重新读取和写回。
- `submissions` 的 source + hash 唯一约束阻止 Trigger 和扫描任务重复发消息。
- Telegram 编辑出现 `message is not modified` 视为成功；消息被删除时发送替代消息并更新映射。

## 9. 当前未知模板字段

在诊断输出返回前，下列内容全部保持未配置：

- 复制后工作簿 ID；
- 正式计分板 Sheet 名称、gid 和表头行；
- Form Responses Sheet 名称、gid 和表头行；
- Codename 的准确表头或兼容列号；
- Faction、提交时间、Start/End Stats、Start/End AP 的准确表头；
- Participation/到场确认的准确表头或列号；
- Data Confirmed/数据确认的准确表头或列号；
- checkbox 是标准 boolean 还是自定义 checked/unchecked 值；
- 目标列是否由公式、数组公式或受保护范围控制；
- Codename 是否在正式表中唯一；
- 编辑 Form response 是否触发提交事件；
- 公式从 Form Responses 更新到正式计分板所需延迟；
- event ID 与官方审核进度板 Location 的对应关系；
- Telegram 目标是私聊、普通群还是 forum topic；
- 同一 Codename 是否允许多条独立事件记录。

## 10. 分阶段交付

1. 诊断：运行本次提供的 `inspectWorkbookStructure()`、`createBotRecordsSheet()`、`validateConfiguration()`。
2. Telegram：创建 Worker/D1，完成 webhook、secret header、权限、测试按钮和 answerCallbackQuery。
3. Sheet 写入：实现签名 Bridge、唯一 Codename 查找、明确 checkbox 写入与真实状态返回。
4. 表单触发：实现 snapshot 上报和消息创建/更新。
5. 状态同步：完善 message mapping、人工 Sheet 修改同步和故障恢复。
6. 兜底与审核进度：Apps Script 定时扫描私有工作簿；Worker Cron 抓取公开审核进度板。

## 11. 阶段一审核门槛

只有同时满足以下条件才进入正式写入阶段：

- `validateConfiguration()` 返回 `ok: true`；
- 三个关键字段 Codename、Attendance、Data Confirmed 均唯一定位；
- 两个状态列检测到 checkbox 数据验证，或人工明确批准兼容值配置；
- 目标 Sheet 和列未被不可编辑保护阻止；
- event ID 与 review Location 的映射由用户确认；
- 用户确认本设计中 Sheet、D1、Bot Records 的事实来源划分。

