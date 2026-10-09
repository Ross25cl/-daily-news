# Day 22 部署手册 · PATCH / DELETE 上线 + 四类操作闭环（删除为**软删除**）

| 项目 | 内容 |
| ---- | ---- |
| 文档名称 | Day 22 部署手册（写接口扩容：改一条 → 删一条 → 增删改查闭环验证 + 软删除加练） |
| 撰写日期 | 2026-10-09（Day 22｜第 4 周） |
| 对应任务 | ① PATCH 实现 · ② DELETE 实现 · ③ 四类操作闭环验证 · **余力加练：软删除 `is_deleted`（当日补做）** |
| 今日边界 | **不做**：批量操作；用户系统。**软删除属余力加练，当日已补做**（见 §8） |
| 完成标准 | ① PATCH 修改一条数据生效 ② DELETE 删除后 GET 不再返回 ③ 增删改查四类操作闭环 |
| 今日掌握 | **删除为什么比新增更容易出事？你在哪加了确认？** |

**今日交付**

| 项 | 内容 |
| ---- | ---- |
| 新增接口 | `PATCH /api/matches`、`DELETE /api/matches`、`PATCH /api/news`、`DELETE /api/news` |
| 附带读接口 | `GET /api/matches?id=`、`GET /api/news?id=`（按 id 取单条，供改删验证；列表读仍占位） |
| 新增云函数 | `cloudfunctions/matches/`、`cloudfunctions/news/`（零依赖，PostgREST 访问 PG） |
| 新增共用零件 | `cloudfunctions/shared/httpKit.js`（包络/日志/body/id 校验/405/500） |
| 数据访问层 | `shared/matchesRepository.js`（新建）、`shared/newsItemsRepository.js`（加改删）；两表各加 `softDeleteById` / `restoreById` |
| 连接底座 | `shared/pg.js` 加 `updateRows` / `deleteRows` + **安全阀**（无 `eq.` 过滤的写一律拒绝） |
| 结构变更 | `db/migrate-day22.sql`（两表加 `note`）· `db/migrate-day22-soft-delete.sql`（两表加 `is_deleted`），均幂等 |
| 前端 | `checkup.html` 新增「④ 修改与删除」面板 + 原生 `<dialog>` 二次确认 + 软删除回执展示 |
| 软删除配套 | `favorites` 对已软删的资讯做**复活**（避免出现「说有这条、列表里却看不到」） |
| 公网地址 | 检查台 https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/checkup.html |

---

## 0. 一句话结论

> Day 21 之前，链路只能「读 + 新增」；今天把**改（PATCH）**和**删（DELETE）**补上，
> 两套核心表（`matches` / `news_items`）各一对，公网部署完成，
> **增删改查四类操作在公网真实跑通**（POST 造数 → GET → PATCH → GET → DELETE → GET 404，24/24 通过）。

**验收三问的答案**：

| 完成标准 | 结果 | 证据 |
| ---- | ---- | ---- |
| ① PATCH 修改一条数据生效 | ✅ | 状态「进行中」→「已结束」、比分 58:52 → 112:108；SELECT 复核新值已落库；`docs/day22-1-patch-before-after.png` |
| ② DELETE 删除后 GET 不再返回 | ✅ | 删除接口回传被删整行 + 页面复查 GET 得 **404「未找到该比赛记录」**；SELECT `count(*)=0`；`docs/day22-2-delete-gone.png` |
| ③ 四类操作闭环 | ✅ | 公网 24 项断言全过；本地全分支回归 37 项全过 |

---

## 1. 今日掌握项：删除为什么比新增更容易出事？你在哪加了确认？

> 新增是「**加**」：写错了最坏是多一条脏数据，看得见、删得掉，**可逆**。
> 删除是「**减**」：写错一个 `WHERE` 就是一片数据没了 —— 传统上这一步**不可逆**，没有回收站。
> （本日在第五道闸上把「不可逆」这件事本身也削掉了，见下。）

所以本项目对删除设了**五道闸**，「在哪里加确认」的答案是**三层都要有 + 还要给自己留一条后路**：

| # | 层 | 闸门 | 防的是什么 | 落点 |
| - | ---- | ---- | ---- | ---- |
| ① | 路径 / 方法 | 只认 `DELETE /api/matches`，写错方法先被 `405` 挡下 | 误触发 | `httpKit.createServer({allowedMethods})` |
| ② | **数据底座** | `pg.deleteRows` / `pg.updateRows` **拒绝无 `eq.` 过滤条件的写** | **少写 WHERE 导致清表**（最致命） | `shared/pg.js` |
| ③ | 接口层 | 先 `findById` → 不存在直接 `404`，**压根不发删除请求**；定位用 `id=eq.<id>` | 删错行 / 无效删除 | `cloudfunctions/matches/index.js` |
| ④ | 前端 | 原生 `<dialog>` 二次确认「确定要删除这条记录吗？」 | **人手误点** | `checkup.html` + `js/checkup.js` |
| ⑤ | **存储层** | **软删除**：根本不是真删，只把 `is_deleted` 置 `true`，查询跳过 | **删错了回不来**（不可逆这件事本身） | `softDeleteById` + `findById` 过滤 |

> ② ③ 是**代码里的确认**，④ 是**人手上的确认**，⑤ 是**留给自己的后路**。
> 前四道防的是「别删错」，第五道管的是「删错了还能回来」——`restoreById(id)` 一调用，数据就回来了。

**安全阀的实际报错**（少写条件时）：

```
拒绝执行无过滤条件的 DELETE（必须至少给一个 eq 条件，防止误改/误删整张表）
```

这条在本地回归里被专门测了 2 条断言（PATCH / DELETE 各一条），都如期拒绝。

**删除后自查**（不靠「返回 200」当证据）：删除执行完**再查一次**，结果写进 `data.verifiedGone` 与 `meta.message`；查得到就报 `false` 并提示「复查仍能查到，请再试一次」——把异常摆在明面上。

---

## 2. 板块① ②：PATCH / DELETE 实现

### 2.1 云函数与路由

| 路径 | 方法 | 云函数 | 网关路由 |
| ---- | ---- | ---- | ---- |
| `/api/matches` | GET / PATCH / DELETE | `matches` | `/api/matches` → `function:matches` |
| `/api/news` | GET / PATCH / DELETE | `news` | `/api/news` → `function:news` |

> 沿用 Day 18 结论：**一个路由一个云函数**（不同路径必须各登记路由）；**同路径不同方法可以同函数**，靠 `req.method` 分流。

### 2.2 分层（承 Day 19）

```
浏览器 → 网关 /api/matches → cloudfunctions/matches/index.js   ← 只接请求/调函数/返响应
                                   ↓
                             shared/matchesRepository.js        ← 表名/列名/字段映射/改删语句
                                   ↓
                             shared/pg.js                       ← 连接底座 + 安全阀
                                   ↓
                             CloudBase PG 的 HTTP API（PostgREST）
```

**SQL 注入防护**：本层与 repository 层都**不拼 SQL**——定位条件走 PostgREST 查询参数（`id=eq.…`），要改的值走 PATCH 的 JSON body，由平台侧编译成参数化 SQL。表名/列名来自 repository 的白名单常量。

### 2.3 可改字段白名单

| 表 | 可改字段 | 对应清单说法 |
| ---- | ---- | ---- |
| `matches` | `status` / `homeScore` / `awayScore` / `homeTeam` / `awayTeam` / `round` / `venue` / `note` | 赛事状态、最终比分、备注 |
| `news_items` | `title` / `summary` / `note` / `status` | 新闻标题、内容摘要、备注 |

> **`matches` 没有 title / summary 列**（它是赛程表）。清单点名的「标题 / 摘要」在此语境下是「主客队 + 比分 / 状态」的展示串 → **由字段现算**，不落库；「改标题」的语义 = 改 `homeTeam` / `awayTeam` / `round`。真正的「新闻标题 / 内容摘要」列在 `news_items` 上。
>
> **不可改**（提交了会被忽略并在 `meta.ignored` 列出，不静默吞）：`id`、`league`、`matchTime`、`dataSource`（matches）；`id`、`sourceUrl`、`digestDate`、`createdAt`（news_items）。

### 2.4 结构变更：`note` + `is_deleted` 两列

| 列 | 为什么加 | 脚本 |
| ---- | ---- | ---- |
| `note TEXT` | 清单要求 PATCH 能改「备注」，两张表都没有备注列 | `db/migrate-day22.sql` |
| `is_deleted BOOLEAN NOT NULL DEFAULT false` | 软删除（余力加练）：只标记、不真删 | `db/migrate-day22-soft-delete.sql` |

```bash
# Git Bash：直接把文件内容喂给 --sql
tcb db execute -e ross-d2gimwy406e0d6812 --sql "$(cat db/migrate-day22.sql)"
tcb db execute -e ross-d2gimwy406e0d6812 --sql "$(cat db/migrate-day22-soft-delete.sql)"
```

> ⚠️ PowerShell / cmd 下 `"$(cat ...)"` 这种写法会把含**括号**的 SQL 截断（踩过：`Argument list too long`）。
> 改用 node 直传 argv，或把每条 `ALTER` 单独粘进 SQL 编辑器 / 控制台。
>
> 两个脚本都幂等（`ADD COLUMN IF NOT EXISTS`）、顺序无关、可重复执行；
> 只加列、不改既有列、不加约束 → 对种子数据与 Day 18 写入接口零影响。`db/schema.sql` 已同步补上这四列。

---

## 3. 部署步骤（实测命令）

```bash
cd C:/Users/XH/WorkBuddy/2026-09-20-13-17-06/28days

# 1. 结构变更（两个脚本都要跑，幂等）
tcb db execute -e ross-d2gimwy406e0d6812 --sql "$(cat db/migrate-day22.sql)"
tcb db execute -e ross-d2gimwy406e0d6812 --sql "$(cat db/migrate-day22-soft-delete.sql)"

# 2. 打包（build-functions.mjs 里 FUNCTIONS 已加 matches / news）
node scripts_cloudbase/build-functions.mjs

# 3. 部署云函数（--httpFn 开 HTTP 访问服务）
tcb fn deploy matches   --httpFn --dir .cloudbase-build/matches   --force -e ross-d2gimwy406e0d6812
tcb fn deploy news      --httpFn --dir .cloudbase-build/news      --force -e ross-d2gimwy406e0d6812
tcb fn deploy favorites --httpFn --dir .cloudbase-build/favorites --force -e ross-d2gimwy406e0d6812
#   ↑ favorites 是软删除的配套改动（复活已软删的资讯），必须一起重新部署

# 4. 部署网关路由（cloudbaserc.json 的 gateway.routes 已加两条）
tcb deploy --only gateway -e ross-d2gimwy406e0d6812

# 5. 重新构建并上传静态托管（checkup.html / js / css 有改动）
node scripts_cloudbase/build-publish.mjs
tcb hosting deploy .cloudbase-publish -e ross-d2gimwy406e0d6812 --safe
```

> 本次（补做软删除）用的是一键脚本 `_day22_tmp/deploy-soft-delete.cjs`：
> 组装 → 部署 3 个函数 → 部署静态托管，一次跑完。网关路由没变，**不需要**重跑第 4 步。

> ⚠️ `scf_bootstrap` 必须 **LF 换行**、监听 **9000** 端口。
> ⚠️ 公网接口部署后需等约 **40–60 秒**冷启动，别立刻断言失败。

---

## 4. 验证（板块③ 四类操作闭环）

### 4.1 本地全分支回归 — `_day22_tmp/test-branches.cjs`

本地起两个云函数（7101 / 7102），覆盖 400 / 404 / 405 / 500 各分支 + 安全阀 + 软删除：

```
42 PASS / 0 FAIL
```

关键断言：

| 场景 | 期望 | 结果 |
| ---- | ---- | ---- |
| PATCH 不存在的 id | 404 +「未找到该比赛记录」 | ✅ |
| DELETE 不存在的 id | 404 +「未找到该比赛记录」 | ✅ |
| PATCH 空 body（无可改字段） | 400，列出可改字段 | ✅ |
| `status` 填非法值 | 400，列出五选一 | ✅ |
| 「已结束」但缺比分 | 400，提示必须一并提交比分 | ✅ |
| PUT 方法 | 405 | ✅ |
| **无过滤条件 PATCH** | 底座拒绝（安全阀） | ✅ |
| **无过滤条件 DELETE** | 底座拒绝（安全阀） | ✅ |
| news 标题 31 字 | 400，中文提示超出上限 | ✅ |
| **软删后 SQL 直查行仍在、`is_deleted = true`** | 数据没丢 | ✅ |
| **接口回执 `mode=soft` / `recoverable=true`** | 语义明说 | ✅ |
| **`restoreById` 后可再 GET 到（200）** | 删错了能找回 | ✅ |
| 收尾 SQL 真删临时行 | 库里不留垃圾 | ✅ |

### 4.2 公网闭环 — `_day22_tmp/verify-public.cjs`

在公网网关上真跑一遍四类操作：

```
POST 造数 → GET 读回 → PATCH 改 → GET 确认改后值 → DELETE 删 → GET 得 404
→ SQL 直查（行还在、被标记）→ 恢复标记 → GET 又 200 → SQL 真删收尾
28 PASS / 0 FAIL
```

**软删除三条自证**（三条同时成立才算软删除）：

| 条 | 验什么 | 实测 |
| - | ---- | ---- |
| ① 查询跳过 | 删后 `GET ?id=` | `404 NOT_FOUND`（列表里也不再出现） |
| ② 数据没丢 | `SELECT` 直查 | 行仍在，`is_deleted = true` |
| ③ 可以找回 | 标记改回 `false` | `GET` 又 200，值还是 PATCH 改过的新值 |

### 4.3 数据库 SELECT 复核（不靠接口自报）

```sql
-- 改之后
SELECT id,status,home_score,away_score,note,updated_at FROM matches WHERE id='20991231-day22-shot';
-- → status='已结束'  home_score=112  away_score=108  note 写入  updated_at 刷新

-- 删之后（软删除：**这里不是 0 行**）
SELECT id, is_deleted FROM matches WHERE id='20991231-day22-shot';
-- → 1 行，is_deleted = true            ← 数据没丢

SELECT count(*) FROM matches WHERE id='20991231-day22-shot' AND is_deleted = false;
-- → 0                                  ← 查询侧看不见（所以 GET 才是 404）

-- 整表：删一条不会少 1，只是「已删除行数」+1
SELECT count(*) AS 总行数, count(*) FILTER (WHERE is_deleted) AS 已删除行数 FROM matches;
```

### 4.4 数据无残留

```
matches    = 9    （is_deleted = true 的行：0）
news_items = 16   （is_deleted = true 的行：0）
```

（均已回到操作前原状。注意清理用的是 **SQL 真删** —— 软删除的接口调用清不掉数据。）

---

## 5. 今日截图（清单要求：两张）

| 图 | 文件 | 内容 |
| -- | ---- | ---- |
| ① | `docs/day22-1-patch-before-after.png` | 检查台「修改与删除」面板的**改动对比表**：改前 / 改后两列，变化格高亮（状态、主队比分、客队比分、备注共 4 格）+ 接口返回的 `before`/`after` JSON |
| ② | `docs/day22-2-delete-gone.png` | DELETE 回传的**被标记整行 JSON** + **软删除回执**（`mode=soft`、`recoverable=true`）+ 页面自动复查 GET 的 **404 中文提示**「未找到该比赛记录（id=…）」——「查询侧已消失」与「数据仍在库里」两件事同框 |
| 附 | `docs/day22-3-delete-confirm-dialog.png` | 前端**二次确认弹窗**「确定要删除这条记录吗？」，警示文案已按软删除**如实改写**（不再写「没有回收站、也无法撤销」——那句话现在是假的） |

> 三张图都是**页面自证**：在公网 `checkup.html` 上用真实浏览器操作新加的「④ 修改与删除」面板完成，不是手工造的图。截图脚本：`_day22_tmp/shots2.cjs`、`shots3.cjs`。

---

## 6. 待办（本日未做，明确记下）

| 项 | 说明 | 做法预留 |
| ---- | ---- | ---- |
| ~~软删除 `is_deleted`~~ | ✅ **余力加练当日已补做** —— 见 §8 | — |
| 批量操作 | 清单明确「今日不做」 | — |
| 用户系统 | 清单明确「今日不做」 | — |
| 写接口鉴权 | 体验版暂无，`PATCH`/`DELETE` 仍 `enableAuth:false` | 靠白名单 + id 校验 + 底座安全阀兜底 |
| 硬删除的对外入口 | 软删除之后**没有**「真删」的接口（有意为之：真删不该随手可得） | 需要时走 SQL / 服务端脚本（`repo.deleteById`） |
| 软删除行的部分索引 | 目前几十行，全表扫描比走索引还快 | 数据量上来再加 `CREATE INDEX ... WHERE is_deleted = false` |

---

## 7. 回归检查（有没有误伤）

| 检查 | 结果 |
| ---- | ---- |
| `/api/hot`（Day 17） | ✅ 仍正常 |
| `POST` / `GET /api/favorites`（Day 18） | ✅ 仍正常。本次为软删除配套改了它的「已存在」分支（命中的是已软删资讯时**复活**它）；新增字段 `meta.restored`，原 `meta.created` 语义不变 —— **不破坏兼容** |
| `/api/health`（Day 15） | ✅ 仍正常 |
| 检查台原有 ①②③ 面板 | ✅ 未动；原「④ 跨域」改为「⑤」 |
| 各云函数是否互相干扰 | ✅ 各自独立目录，共用 `shared/` 只读引用 |

---

## 8. 余力加练：软删除（`is_deleted`）落地

### 8.1 一句话

> 「删除」不再是**减法**。接口只把 `is_deleted` 置 `true`，查询一律带 `is_deleted = false` 过滤 ——
> 于是「**GET 查不到**」和「**数据还在库里**」同时成立。删错了调 `restoreById(id)`，数据原样回来。

### 8.2 三层改动

| 层 | 改了什么 |
| ---- | ---- |
| 结构 | `db/migrate-day22-soft-delete.sql`：两表各加 `is_deleted BOOLEAN NOT NULL DEFAULT false`（幂等，已执行）；`db/schema.sql` 同步 |
| 数据访问层 | `findById` / 列表查询加 `is_deleted = false`；新增 `softDeleteById`（标记）、`restoreById`（找回）；真删 `deleteById` 降级为维护通道（接口不再调用） |
| 接口层 | `DELETE` 分支改调 `softDeleteById`；响应加 `mode:"soft"` / `recoverable:true` / `restoreHint` |
| 前端 | 确认弹窗警示文案改写；删除结果区展示软删除回执 |
| 配套 | `favorites` 的「已存在」分支对已软删资讯做**复活** |

### 8.3 一个必须想清楚的地方：**不是所有查询都该跳过**

这一条是本次加练最值钱的部分 —— 「统一加个过滤」在这里是错的：

| 查询 | 跳过已删行？ | 为什么 |
| ---- | ---- | ---- |
| `findById`（PATCH/DELETE 的前置校验、删后复查 GET） | ✅ **跳过** | 删了就该查不到；「DELETE 后 GET 不再返回」这条完成标准靠它成立 |
| `listRecent`（收藏列表） | ✅ **跳过** | 删掉的收藏不该继续展示 |
| `countByDigestDate`（生成当天第 N 条序号） | ❌ **不跳过** | 软删的行**仍占着主键**（形如 `20261009-n01`）。跳过会让序号从小值重算 → 生成的 id 撞主键 |
| `findBySourceUrl`（按原文链接防重） | ❌ **不跳过** | `source_url` 上有全表唯一约束。跳过就变成「查不到 → 去插 → 撞唯一约束」的怪错 |

### 8.4 软删除的代价（必须知道，不然会踩）

1. **接口的「删除」≠「清干净」**：数据还在表里、还占着主键。清测试数据必须走 SQL —— 本日两个验证脚本都因此改了收尾方式。
2. **重复删除返回 404 而不是 200**：条件带 `is_deleted = false`，对已删行再删命中 0 行 → `404 无需删除`。幂等，但别指望「删两次都成功」。
3. **前端必须跟着说实话**：弹窗原来写「没有回收站、也无法撤销」——加上软删除后这句就成了假的，本日一并改掉。**文案和数据模型是一个东西的两面**，模型变了文案不改就是骗人。
4. **收藏线会撞上一个说不通的状态**：已软删的文章再被收藏时，若只回「已在收藏中」，用户会陷入「说有、可我把列表翻遍了也没看见」。→ 本日让 `favorites` 把命中的软删行**复活**，并为它单独做了验证（见 §7）。

### 8.5 验证结果

| 项 | 结果 |
| ---- | ---- |
| 本地回归新增断言 | ✅ 4 条（行仍在库 / 回执字段 / `restoreById` / 恢复后 GET 200） |
| 公网闭环新增断言 | ✅ 4 条（同上，真打公网网关） |
| 截图 | ✅ `docs/day22-2-delete-gone.png` 内含软删除回执；新增 SQL 直查证据见运行日志 |
| 数据 | ✅ 验证后两表行数 9 / 16，`is_deleted = true` 的行数为 0 |
