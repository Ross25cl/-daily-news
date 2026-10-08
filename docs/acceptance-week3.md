# 第 3 周验收表（Day 21）

| 项目     | 内容                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档名称   | 第 3 周验收表 + 演示提纲 + 同伴交叉验证                                                                                                                                   |
| 撰写日期   | 2026-10-08（Day 21｜第 3 周）                                                                                                                                   |
| 验收范围   | 第 3 周（Day 15–20）：数据库落地 → 读接口 → 写接口 → 后端分层 → 前端切公网接口                                                                                                        |
| 状态取值   | **只允许 PASS / FAIL / 未执行**（不使用「基本完成」）                                                                                                                       |
| 公网环境   | 静态托管 `https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com` ／ 接口网关 `https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com/api/*` |
| 本次验收时间 | 2026-10-08 17:34–17:45（北京时间）；同伴交叉验证 20:47                                                                                                                               |
| 提交起点   | 本地 = 远端 = `ca1988b`（Day 20）                                                                                                                                |

---

## 一、验收表

| # | 验收项                       | 怎么验证                                                                                                                                                                                                                 | 状态       | 证据                                                                                                                                                                                                                                                                                     |
| - | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | 建表和种子脚本可重复执行（有 select 证据） | ① 跑 `db/schema.sql`（`DROP TABLE IF EXISTS` + `CREATE`）→ 应回 10 张表名；② 跑 `db/seed.sql`（`TRUNCATE` + `INSERT`，因 40KB 超命令行上限按 5 段执行）→ 末段自带自检 SELECT，打印每张表行数；③ **紧接着把 `db/seed.sql` 再跑一遍** → 行数与第 1 遍逐字相同、无「表已存在 / 主键冲突」报错 | **PASS** | 本次实测两遍行数完全一致：`hot_items` 24 · `news_items` 8 · `matches` 9 · `league_schedule` 20 · `league_standings` 20 · `league_players` 25 · `league_brackets` 5 · `leagues` 4 · `push_log` 5 · `subscribers` 5。原始输出见 [§A](#a-1-可重复执行实测原始输出)。脚本：`db/schema.sql`、`db/seed.sql`                     |
| 2 | GET 接口公网可访问且返回真实数据库数据     | curl 打公网网关 `GET …/api/hot`，看条目 `url` 是否为**真实站点**（不是 `example.com`）、`meta.updatedAt` 是否为**抓取时间**而不是「此刻」                                                                                                               | **PASS** | `https://ross-…app.tcloudbase.com/api/hot` → **HTTP 200**；三平台 虎扑 10 / 腾讯体育 7 / 央视体育 7 条；首条 `rank=1, url=https://bbs.hupu.com/642763094.html`（真实站点）；`meta.updatedAt = 2026-10-05T23:30:58+08:00`。库内 `hot_items` **63 行**（虎扑 49 · 腾讯 7 · 央视 7），`max(fetched_at)` 同上。**演示前刷新**：2026-10-08 21:38 手动同步一次 → 现 `updatedAt = 2026-10-08T21:38:31+08:00`、库内 **48 行**（hupu 35 · tencent 7 · cctv5 6）；本格其余数字是**验收时点（10-08 17:5x）**的返回值。见 [§A](#a-2-公网-接口实测) |
| 3 | POST 接口完成真实写入并读回          | `POST …/api/favorites` 写一条 → **立刻** `GET …/api/favorites?limit=1`，看第 1 行是不是刚写的那条；再把**同一个 `sourceUrl`** POST 一次，看防重是否生效                                                                                               | **PASS** | POST → `200 {ok:true, meta.created:true}`，`data.id = 20261008-n01`；读回 `limit=1` 第 1 行即该条（`sourceUrl` 命中）；重复 POST → `200 meta.created:false`、`id` 仍是 `20261008-n01`（库里只有 1 行）。见 [§A](#a-3-post-真实写入并读回)                                                                                 |
| 4 | 数据访问层重构完成且接口行为不变          | 跑回归脚本 `node scripts_cloudbase/test-api-local.cjs --with-db`，看 Day 18 定下的用例在 Day 19 分层重构之后是否仍全过；再核契约（路径 / 字段名 / 状态码 / 包络）是否**零改动**                                                                                    | **PASS** | **18/18 全过**（含 400 / 404 / 405 / 500 各个分支 + 写入 / 重复 / 读回）。分层落地在 `cloudfunctions/shared/pg.js`（连接底座）、`hotItemsRepository.js`、`newsItemsRepository.js`；接口文件只剩「接请求—校验—调函数—返响应」。`api-contract.md` §1 / §2 重构前后无改动。见 [§A](#a-4-分层重构回归)                                                      |
| 5 | 检查台公网可访问                  | 浏览器打开 `…tcloudbaseapp.com/checkup.html`，看「健康状态 / 热搜表真实数据 / 资讯表真实数据」三块是否都是绿标                                                                                                                                          | **PASS** | 公网 `…/checkup.html` → **HTTP 200**（6683 字节 HTML）；真实浏览器打开后三块绿标（health 200 · `hot_items` 有数据并显示真实抓取时间 · `news_items` 有数据）。见 [§B](#b-公网检查台)                                                                                                                                               |
| 6 | 检查台/首页**同伴从自己设备**打开成功     | 把两个公网链接发给同伴，由他**用自己的手机或电脑**打开，回三行结论（可打开 / 可读写 / 无报错）                                                                                                                                                                 | PASS     | 同伴用自己的设备（**iQOO 13**）打开两个链接，**三行结论全为「是」**（可打开 / 可读写 / 无报错），见 [§C-2](#c-2-三行结论同伴回填)。**可复查旁证**：库内出现 `20261008-n03`（「检查台写入测试」，`created_at = 2026-10-08 20:47:16`）—— 晚于本轮验收（17:38–17:57），即在他方设备上点「写入测试」产生                                                                                                                                                                      |
| 7 | 响应形状与 api-contract.md 一致  | 对 4 个已实现接口**逐字段**比对：字段名是否 camelCase、类型对不对、有没有多余字段、该带不带 `data`、错误包络形状                                                                                                                                                 | **PASS** | **23/23 逐字段通过**（§2.0 health ／ §2.1 hot ／ §2.8 POST favorites ／ §2.9 GET favorites ／ §0.3 错误包络）。实测条目字段恰为契约那 10 个：`id, title, summary, section, league, sourceName, sourceUrl, digestDate, status, createdAt`，**无 snake_case 泄漏、无多余字段**。见 [§A](#a-5-响应形状逐字段比对)                           |
| 8 | 演示提纲已写出且四段可执行             | 提纲含「用户问题 → 核心流程 → 提示词改写 → 验证方式」四段；提纲里**每一步验证动作都实际跑过**（不是写出来好看）                                                                                                                                                       | **PASS** | 提纲见 [§D](#d-演示提纲3-5-分钟)。其中「验证方式」一段的三层做法（本地分支 18/18、公网真库读写、形状比对 23/23）本次均已实跑；「真人过一遍」已由同伴复核覆盖（第 6 项）。**剩余加练**：录 3 分钟演示视频                                                                                                                                                                             |

### 结论

- **8 项 PASS，0 项 FAIL，0 项未执行**。
- 第 6 项「同伴换设备打开」原为唯一未执行项，2026-10-08 20:47 由同伴完成复核，三项结论全为「是」（见 §C-2）。
- **没有一项标 FAIL**；也不存在「基本完成」这种状态。

### 卡住降级（本次没用上）

课程给的降级口径是「优先补齐**公网可访问 + 真实读写**两项证据，其余如实标记未执行」。  
这两项（第 2 / 3 / 5 项）本次**都拿到了 PASS**；第 6 项也在当晚由同伴复核通过。**没有任何一项需要标未执行**，所以全程未触发降级。

---

## §A 原始证据

### A-1 可重复执行实测（原始输出）

```
【第 1 次】执行 db/schema.sql  [SQL 19241 字节]
┌──────────────────┐
│    table_name    │
├──────────────────┤
│    hot_items     │   …（共 10 张：hot_items / league_brackets / league_players /
│ league_brackets  │      league_schedule / league_standings / leagues / matches /
│  league_players  │      news_items / push_log / subscribers）
└──────────────────┘
i 10 record(s), completed in 59 ms          ← 10 张表建成

【第 2 步】db/seed.sql 第 1 遍（5 段）
  第 1 段 1965 字节  → Affected rows: 4
  第 2 段 7599 字节  → Affected rows: 8
  第 3 段 4926 字节  → Affected rows: 20
  第 4 段 4902 字节  → Affected rows: 25
  第 5 段 21498 字节 → 自检 SELECT：
┌──────────────────┬──────┐
│       表名       │ 行数 │
├──────────────────┼──────┤
│    hot_items     │  24  │
│ league_brackets  │   5  │
│  league_players  │  25  │
│ league_schedule  │  20  │
│ league_standings │  20  │
│     leagues      │   4  │
│     matches      │   9  │
│    news_items    │   8  │
│     push_log     │   5  │
│   subscribers    │   5  │
└──────────────────┴──────┘

【第 3 步】db/seed.sql 第 2 遍（同 5 段）→ 全部 exit=0，自检 SELECT：
┌──────────────────┬──────┐
│    hot_items     │  24  │   ← 与第 1 遍逐字相同
│ league_brackets  │   5  │
│  league_players  │  25  │
│ league_schedule  │  20  │
│ league_standings │  20  │
│     leagues      │   4  │
│     matches      │   9  │
│    news_items    │   8  │
│     push_log     │   5  │
│   subscribers    │   5  │
└──────────────────┴──────┘
```

> **两遍行数完全一致 → 「可重复执行」成立。**  
> 跑完已把真实数据**原样还原**：`db/hot_sync.sql`（63 条真实热搜）+ `news_items` 快照（12 行，含 4 行历史测试行），  
> 还原后行数核对 = `hot_items 63 / news_items 12 / …`，与跑之前一致。
>
> ⚠️ 注意：`db/seed.sql` 会 `TRUNCATE` 全表，**重跑会把 `hot_items` 的 63 条真实热搜退回 24 条示例种子**。  
> 所以「验可重复执行」之后必须补跑 `db/hot_sync.sql`。这一点已写进 [§E 下周待办](#e-下周待办记录不入本周验收)。

### A-2 公网接口实测

```
GET  https://ross-…app.tcloudbase.com/api/health            → 200  {"ok":true,"service":"Daily Sports Express"}
GET  https://ross-…app.tcloudbase.com/api/hot               → 200  ok=true
       platforms = [hupu 虎扑 10 条, tencent 腾讯体育 7 条, cctv5 央视体育 7 条]
       meta      = {count: 24, updatedAt: "2026-10-05T23:30:58+08:00"}
       items[0]  = {rank:1, title:"看了好多天蓝白和罗粉互相咬，有个问题没搞明白",
                    heat:198, url:"https://bbs.hupu.com/642763094.html", tag:"综合", video:false}
GET  …/api/hot?platform=weibo                               → 400  BAD_REQUEST（白名单外参数被拦）
GET  …/api/favorites?limit=5                                → 200  ok=true

库内（tcb db execute）：
  hot_items  63 行 ── hupu 49 · tencent 7 · cctv5 7，max(fetched_at) = 2026-10-05 23:30:58+08
  news_items 12 行 ── published 11 · draft 1
```

> 以上是 **2026-10-08 17:5x 验收时点**的原始输出（不追改）。演示前 21:38 已手动同步一次热榜：`updatedAt` 现为 `2026-10-08T21:38:31+08:00`、`hot_items` 48 行。刷新用的两条命令见 §E 第 1 项。

### A-3 POST 真实写入并读回

```
POST …/api/favorites   （HTTP 200, 1.49s）
{
  "ok": true,
  "data": { "id": "20261008-n01", "title": "Day 21 验收写入测试",
            "section": "热议", "league": "综合", "sourceName": "Day21 验收",
            "sourceUrl": "https://example.com/day21-acceptance-1791452332",
            "digestDate": "2026-10-08", "status": "published",
            "createdAt": "2026-10-08T17:38:56.452664+08:00" },
  "meta": { "created": true, "message": "收藏成功" }
}

GET …/api/favorites?limit=1   → 读回第 1 行 = 上面那条（sourceUrl 命中）
                              meta = {count:1, limit:1, offset:0, updatedAt:"2026-10-08T09:38:57.790Z"}

同 sourceUrl 再 POST 一次    → 200  meta.created = false，id 仍为 20261008-n01（未产生第 2 行）
```

### A-4 分层重构回归

```
$ node scripts_cloudbase/test-api-local.cjs --with-db
PASS  GET /api/hot?platform=weibo → 400 BAD_REQUEST
PASS  GET /api/nope → 404 NOT_FOUND
PASS  POST /api/hot → 405 METHOD_NOT_ALLOWED
PASS  PUT /api/favorites → 405 METHOD_NOT_ALLOWED
PASS  POST /api/favorites 空 body → 400 且中文点名缺失字段
PASS  缺 sourceUrl → 400 且只点名 sourceUrl
PASS  digestDate 格式错 → 400 且提示 YYYY-MM-DD
PASS  digestDate 为不存在的日期 → 400
PASS  section 非白名单 → 400 且列出允许值
PASS  title 超 30 字 → 400 且报出当前字数
PASS  summary 超 60 字 → 400
PASS  sourceUrl 非 http(s) → 400
PASS  POST body 非合法 JSON → 400
PASS  GET /api/hot → meta.updatedAt 是真实抓取时间（与此刻相差 > 5 秒）
PASS  正常 POST → 200 ok:true + data 形状符合契约
PASS  重复 POST（同 sourceUrl）→ 200 且 meta.created:false，id 与首次相同
PASS  GET /api/favorites 能读回刚写入的记录
PASS  重复提交未产生第二行（同 sourceUrl 仅 1 条）
结果：全部通过 (18/18)
```

### A-5 响应形状逐字段比对

```
=== 响应形状 vs api-contract.md ===
PASS  §2.0 GET /api/health → {ok:true, service:string}
PASS  §0.2 health 是唯一例外：不带 data
PASS  §2.1 GET /api/hot → 200 ok:true
PASS  §2.1 data.platforms 是数组
PASS  §2.1 platforms[] 含 id/name/desc/items
PASS  §2.1 platform.id 在白名单
PASS  §2.1 items[] 含 rank/title/heat/url/tag/video
PASS  §2.1 items[] 类型：rank/heat=number, title/url=string, video=boolean
PASS  §2.1 meta.updatedAt 是字符串（ISO 8601）
PASS  §2.1 items[] 无多余字段
PASS  §2.9 GET /api/favorites → 200 ok:true
PASS  §2.9 data 是数组
PASS  §2.9 条目含契约 10 个字段（camelCase）
PASS  §2.9 无多余字段 / 无 snake_case 泄漏
PASS  §2.9 meta 含 count/limit/offset/updatedAt
PASS  §2.8 POST /api/favorites → 200 ok:true
PASS  §2.8 data 含契约 10 个字段
PASS  §2.8 id 规则 YYYYMMDD-nNN
PASS  §2.8 status 由服务端固定 published
PASS  §2.8 回显写入值（title/sourceUrl/section）
PASS  §2.8 meta 含 created:boolean + message:string
PASS  §0.2/§0.3 失败包络 {ok:false, error:{code,message}}
PASS  §0.3 失败响应不带 data
===== 形状比对结果 =====
全部通过 (23/23)
```

---

## §B 公网检查台

| 检查项  | 结果                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| URL  | `https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/checkup.html`                                            |
| HTTP | **200**（6683 字节 HTML）                                                                                                 |
| 首次访问 | 会先出现 CloudBase 测试域名&#x7684;**「风险提醒」**&#x62E6;截页（本身即「公网可达」的表现），点「确定访问」进入                                               |
| 三块绿标 | ① 健康状态 `GET /api/health` → 正常 200<br />② 核心表 `hot_items` → 有数据，并显示**真实抓取时间**（不是打开页面的时刻）<br />③ 核心表 `news_items` → 有数据 |
| 写入测试 | 表单 `POST /api/favorites` → 提交后自动读回，列表顶部出现新条目                                                                          |
| 页顶   | 显示当前 `API_ORIGIN` 与页面域名，一眼看出请求打的是公网地址而不是本地                                                                            |

> 佐证图：`docs/day20-public-checkup.png`（Day 20 的真实浏览器渲染截图，三块绿标可见）。  
> Day 21 未重复截图，理由：Day 20 之后 `checkup.html` / `js/checkup.js` 没有改动，本轮只做「是否仍可访问」的复核（HTTP 200 + 三接口 200）。

---

## §C 同伴交叉验证（已执行：三行全为「是」）

### C-1 发给同伴的话术（复制即用）

```
帮我看两个链接，手机或电脑都行，大概 1 分钟：

1）首页：https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/index.html
2）接口检查台：https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/checkup.html

第一次打开如果出现「风险提醒」页，点页面上的「确定访问」就能进。

麻烦回我三行（就三行）：
① 可打开：两个页面都打开了，首页能看到虎扑 / 腾讯体育 / 央视体育三块榜单 —— 是 / 否
② 可读写：检查台点一次「写入测试」，下面列表最上面出现新的一条 —— 是 / 否
③ 无报错：整个过程没有红字报错、没有白屏 —— 是 / 否
再补一句你用的设备（手机型号 / 电脑浏览器）。

打不开或显示空白的话，截图发我，我这边查。
```

### C-2 三行结论（同伴回填）

| 项     | 同伴结论                     |
| ----- | ------------------------ |
| ① 可打开 | **是**　两个页面都打开，首页三块榜单可见   |
| ② 可读写 | **是**　检查台点「写入测试」后列表顶部出现新条目 |
| ③ 无报错 | **是**　无红字报错、无白屏          |
| 设备    | **iQOO 13**（安卓）                |

> 状态：**已执行 → 三行全为「是」→ 本文第 6 项 PASS**。复核时间 2026-10-08 20:47，同伴设备 **iQOO 13**（安卓）。  
> **可复查旁证**：`news_items` 里 `20261008-n03`「检查台写入测试」，`created_at = 2026-10-08 20:47:16` —— 晚于本轮验收（17:38–17:57），即同伴在他自己设备上点「写入测试」真实入库的那一行。

---

## §D 演示提纲（3–5 分钟）

### 0:00–0:30 ① 用户问题

- **谁**：每天想看体育、但不愿意装三个 app 的人。
- **痛点**：虎扑 / 腾讯体育 / 央视体育各是一摊，赛程比分又散在别处；同一条新闻三个平台都推，还有已过期的。想「一页看完」就得自己来回切。
- **产品一句话**：《每日体坛速览》——打开就是一个页面：**三平台热搜聚合 + 今日速览 + 赛程比分 + 联赛板块**，不用注册，点开即看。
- **演示开场口令**：「先打开首页 —— 你看到的应该是**此刻**三个平台的真实热榜，不是写死的示例。」


### 0:30–2:00 ② 核心流程（当场走一遍）

| 步 | 走哪里                         | 看什么                                                |
| - | --------------------------- | -------------------------------------------------- |
| 1 | 首页                          | 三块榜单（虎扑 / 腾讯体育 / 央视体育）；标题旁的「最近更新」是**抓取时间**，证明数据是活的 |
| 2 | 点任一条 → 详情页                  | 「收藏这条」按钮 → 真的写进数据库                                 |
| 3 | 速览页                         | 按大类筛选（足球 / 篮球 / 综合）                                |
| 4 | 赛程页                         | 搜索框 + 6 个联赛筛选按钮                                    |
| 5 | 联赛板块页 `league.html?lg=nba`  | Tab（赛程 / 排行 / 季后赛 / 晋级图 / 球员）**由数据驱动**，不是写死的       |
| 6 | 收口：**接口检查台** `checkup.html` | 一页看 health 状态、看两张核心表真实数据、**当场点一次写入测试并读回**          |

- **数据链路一句话**：浏览器 → CloudBase 网关 → HTTP 云函数 → PostgreSQL。前后端契约写在 `api-contract.md`。

### 2:00–3:00 ③ 提示词改写（讲 AI 怎么从「许愿」变成「派活」）

| 阶段   | 提示词                                                                                      | 结果 / 为什么要改                                                                       |
| ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 反例   | 「帮我做个体育资讯网站」                                                                             | 产出结构随机：字段名一会儿 snake_case 一会儿 camelCase，错误提示五花八门，无法验收                             |
| 改写 1 | **先立契约再写码**：先产出 `api-contract.md`（路径 / 方法 / 字段名 / 状态码 / 统一响应包络），之后一切实现以契约为准              | 有了一份可对照的「唯一权威」，接口形状才能被逐字段验证（就是本次第 7 项）                                           |
| 改写 2 | **把环境约束写进提示词**：把「云函数直连数据库」改成「零依赖，用 Node 原生 `https` 调 HTTP API（PostgREST），查询条件走参数、不拼 SQL」 | 原要求实测跑不通（**体验版不支持 PostgreSQL TCP 直连** + **HTTP 云函数不能云端装依赖**）。不提这两个约束，AI 会一直往死路上撞 |
| 改写 3 | **加可判定的验收条件**：不说「做好看点」，改成「四态齐备（加载 / 成功 / 空 / 错误）」「字段必须 camelCase」「缺字段要**一次列全**并给中文提示」    | 每一条都能当场判真假，避免「基本完成」                                                              |
| 改写 4 | **把「验证」也交出去**：让 AI 自己写回归脚本与形状比对，改完必须跑绿                                                   | 于是有了 18 条分支用例 + 23 项形状断言；重构（第 4 项）才敢说「行为不变」                                      |

### 3:00–4:30 ④ 验证方式（三层，每层给数字）

| 层         | 做法                                                                                     | 本次数字                                                 |
| --------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| ① 本地分支测试  | `node scripts_cloudbase/test-api-local.cjs --with-db` —— 不连库也能验错误分支，连库则验写入/重复/读回       | **18 / 18 PASS**                                     |
| ② 公网 + 真库 | curl 打公网接口拿真实数据；**改库里的值 → 接口返回跟着变**；看写入前后行数                                            | `hot_items` 63 行真实数据；POST 后 `news_items` 一行 9→10 可复现 |
| ③ 契约形状比对  | 逐字段对 `api-contract.md`；跨域**看响应头不看状态码**（白名单外域名也回 200，但不带 `Access-Control-Allow-Origin`） | **23 / 23 PASS**                                     |
| 收尾        | 所有「完成」都附可复现的数字或链接                                                                      | 8 项 PASS / 0 项 FAIL / 0 项未执行                         |

### 4:30–5:00 收束 + 下周

- 一句话收束：「这一周的产出是**一条真的链路**——公网页面 → 网关 → 云函数 → 真库，写进去能读回来，形状对得上契约。」
- 下周：补齐 `/api/news`、`/api/matches`、`/api/leagues/:id` 三个读接口；`PATCH` / `DELETE`；热搜同步做成定时任务（现在要手动跑）。

---

## §E 下周待办（记录，不入本周验收）

| # | 事项                                                                                                     | 来源                            |
| - | ------------------------------------------------------------------------------------------------------ | ----------------------------- |
| 1 | 热搜同步**没有定时任务**：`scripts_cloudbase/run-fetch-hot.ps1` → 生成 `db/hot_sync.sql` → 手动 `tcb db execute` 灌库；缺任何一环数据就不动。**当前状态（2026-10-08 21:38 手动同步后）**：`hot_items` 48 行、最新 `fetched_at = 2026-10-08 21:38:31`，首页「最近更新」显示 `10-08 21:38`。待做：CloudBase 定时触发器自动跑（那样才不用每次手动刷）                    | Day 20 遗留                     |
| 2 | `db/seed.sql` 重跑会 `TRUNCATE` 掉真实热搜 → 重跑后必须补跑 `db/hot_sync.sql`（本次已按此还原）                                | Day 21 发现                     |
| 3 | `css/league.css` `.lg-table{min-width:420px}` 在 375px 手机横向溢出约 77px，右侧列被裁                               | Day 14 发现                     |
| 4 | `digest.html` 孤页（Day 8 迁出后无导航入口）                                                                       | Day 8 遗留                      |
| 5 | `/api/news`、`/api/matches`、`/api/leagues/:id` 仍是占位                                                     | Day 16 起                      |
| 6 | 库里现有 **8 行**验证用测试行（`news_items` 共 16 行 = 8 行种子 + 8 行测试：`20261006-n01~n04`、`20261007-n01`、`20261008-n01~n03`；后三行由 Day 21 验收 + 同伴复核写入） | Day 18/20/21 验证过程产生，零曾拍板「不用删」 |

### 过渡期：手动刷新热榜（本机实测可用）

绝对路径版 —— **任意目录都能跑，不用先 `cd`**：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\XH\WorkBuddy\2026-09-20-13-17-06\28days\scripts_cloudbase\run-fetch-hot.ps1"
$s = Get-Content "C:\Users\XH\WorkBuddy\2026-09-20-13-17-06\28days\db\hot_sync.sql" -Raw -Encoding UTF8
tcb db execute -e ross-d2gimwy406e0d6812 --sql $s
```

逐行粘进 PowerShell（**别把三行整块一次粘**，多行粘贴容易串行错位）；`tcb` 已在本机用户 PATH 里，不用写全路径。

2026-10-08 当天共刷 3 次（21:25 / 21:27 / 21:38，均为验证与演示前准备）。**每次刷完，本节与第 2 项证据里的时点要同步改**，否则文档会和线上数据对不上。以最后一次 21:38 为例：第一步约 4 秒（虎扑 35 · 腾讯 7 · 央视 6 = 48 条，写入 `db/hot_sync.sql`），第二步约 1 秒——之后接口 `updatedAt` 立刻变当天，首页「最近更新」同步。

---

## 附 · 本周（Day 15–20）改动索引

| Day | 主题                                      | 提交（本地）                                |
| --- | --------------------------------------- | ------------------------------------- |
| 15  | 首个云函数 + 前端页面上公网 + 接口契约登记                | `fda5e9c`                             |
| 16  | 数据模型定稿：10 张表建成 + 种子                     | `a853017`                             |
| 17  | `GET /api/hot` 读接口上公网 + 三平台真实热搜         | `47de810`                             |
| 18  | `POST/GET /api/favorites` 写入接口 + 前端接接口层 | `6783774`（+ 两笔归档 `08a147d`、`e47237a`） |
| 19  | 后端分层重构：查库代码拆进 `shared/`                 | `27a8031`                             |
| 20  | 前端从 mock 切公网接口 + 跨域确认 + 接口检查台           | `ca1988b`                             |
