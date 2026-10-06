# 每日体坛速览 · 接口契约（API Contract）

| 项目 | 内容 |
| ---- | ---- |
| 文档名称 | 接口契约（api-contract） |
| 撰写日期 | 2026-10-03（Day 15｜第 3 周）；**2026-10-04（Day 16）更新：表结构定稿并已建表**；**2026-10-05（Day 17）更新：`/api/hot` 已实现** |
| 依据 | 前端第 2 周实际页面（`index.html` / `matches.html` / `news.html` / `news-detail.html` / `league.html`）+ `TECH_DESIGN.md` 第 5 节 |
| 文档地位 | **第 3 周建表与写接口的唯一依据**。接口 Day 17 起逐个落地；**第 3 节的表结构 Day 16 已定稿，且与线上库逐字一致**。 |
| 实现时点 | Day 16 建表 ✅ · Day 17 `/api/hot` ✅ · Day 18–19 其余读接口 · Day 20 配跨域 |
| 今日不实现 | 业务写入接口（收藏写入属 Day 18）；其余 `/api/*` 读接口仍为占位 |

---

## 0. 全局约定

### 0.1 基础信息

| 项 | 值 |
| -- | -- |
| 基础路径 | `/api` |
| 响应格式 | `application/json; charset=utf-8` |
| 时间格式 | 日期 `YYYY-MM-DD`；时间 `YYYY-MM-DD HH:mm`（北京时间）；时间戳用 ISO 8601 |
| 命名风格 | **camelCase**（对齐 Day 10 起各联赛 JSON 已统一的字段名） |
| 鉴权 | 第 3 周读接口**公开**（`enableAuth: false`）；写接口暂不开放 |

**已部署环境（Day 15 实测）**：

| 项 | 值 |
| -- | -- |
| 环境名称 / ID | `ross` / `ross-d2gimwy406e0d6812` |
| 地域 | `ap-shanghai`（上海） |
| 云函数入口 | `https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com/api/health` |
| 前端静态托管 | `https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/` |

> 后续各 `/api/*` 接口将挂在同一网关域名下（`.../api/news`、`.../api/matches` 等）。

> ⚠️ 命名风格说明：老文件 `data/news.json` / `data/matches.json` 用的是蛇形（`digest_date` / `home_team`）。Day 10 起新建的联赛 JSON 已统一为 camelCase。**契约统一采用 camelCase**，Day 18 迁移前端时把旧字段一并改名，避免两套风格并存。

### 0.2 统一响应包络

沿用 `TECH_DESIGN` 第 5.2 节预留的形状：

**成功**：

```json
{
  "ok": true,
  "data": {},
  "meta": { "count": 0, "updatedAt": "2026-10-03T12:00:00+08:00" }
}
```

**失败**：

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "人类可读的说明"
  }
}
```

> `/api/health` 是唯一的例外：它返回极简结构 `{"ok": true, "service": "..."}`，不带 `data`（健康检查不需要业务数据，结构越简单越不容易误判）。

### 0.3 错误码表

| HTTP | code | 含义 | 前端应对 |
| ---- | ---- | ---- | ---- |
| 200 | — | 成功 | 正常渲染 |
| 400 | `BAD_REQUEST` | 参数缺失或格式错 | 提示 + 回退默认值 |
| 404 | `NOT_FOUND` | 资源不存在 | 显示空态（不报错） |
| 405 | `METHOD_NOT_ALLOWED` | 方法不允许 | 开发期错误，控制台警告 |
| 409 | `CONFLICT` | 冲突（如重复订阅） | 提示已存在 |
| 500 | `INTERNAL_ERROR` | 服务端异常 | 显示「加载失败，请重试」+ 重试按钮 |

---

## 1. 接口总览

| # | 路径 | 方法 | 服务页面 | 今日状态 |
| - | ---- | ---- | ---- | ---- |
| 0 | `/api/health` | GET | — | ✅ **已部署**（Day 15） |
| 1 | `/api/hot` | GET | `index.html` | ✅ **已实现**（Day 17） |
| 2 | `/api/news` | GET | `index.html` / `news.html` / `news-detail.html` | ⏳ 占位 |
| 3 | `/api/news/:id` | GET | `news-detail.html` | ⏳ 占位 |
| 4 | `/api/matches` | GET | `matches.html` | ⏳ 占位 |
| 5 | `/api/leagues/:id` | GET | `league.html` | ⏳ 占位 |
| 6 | `/api/subscribe` | POST | （第 4 周订阅功能） | ⏳ 占位（暂不实现） |
| 7 | `/api/unsubscribe` | GET | （人工退订，暂不做页面） | ⏳ 占位（暂不实现） |

> 表 1–5 是前端**当前页面直接依赖**的读接口，是 Day 16–19 的重点。
> `/api/favorites` 为 Day 18 新增（收藏线），届时在此表补充登记。
> 表 6–7 属订阅线，按 `TECH_DESIGN` 第 11 节仍走人工流程，此处仅登记。

---

## 2. 接口详情

### 2.0 `GET /api/health` ✅ 已实现

| 项 | 内容 |
| -- | ---- |
| 用途 | 健康检查：确认云函数链路通、返回 JSON |
| 请求参数 | 无 |
| 成功响应 | `200` |

```json
{
  "ok": true,
  "service": "Daily Sports Express"
}
```

| 错误 | 场景 | 返回 |
| ---- | ---- | ---- |
| 405 | 非 GET | `{"ok": false, "error": {"code": "METHOD_NOT_ALLOWED", "message": "仅支持 GET"}}` |

---

### 2.1 `GET /api/hot` ✅ 已实现（Day 17）

> **实现说明（Day 17）**：云函数 `cloudfunctions/api/index.js`，网关路由 `/api/hot`。
> 数据链路：浏览器 → 网关 → 云函数 → **CloudBase PG 的 HTTP API（PostgREST）** → `hot_items` 表。
> **为何不走 pg 直连**：体验版（个人版）不支持数据库 TCP 直连；且 HTTP 云函数不能云端装依赖，
> 故用零依赖 + Node 原生 `https` 调 HTTP API。查询条件全部走 PostgREST 参数，不拼 SQL。
> 数据由 `scripts_cloudbase/fetch-hot.ps1` 每日从三平台官网同步（Day 17 实测 63 条）。

| 项 | 内容 |
| -- | ---- |
| 用途 | 首页三平台热搜榜（虎扑 / 腾讯体育 / 央视体育） |
| 服务页面 | `index.html` |
| 请求参数 | `platform`（选填）：`hupu` / `tencent` / `cctv5`，省略则返回全部三个；`limit`（选填，默认 10）：每个平台返回条数（上限 50） |
| 对应数据 | `data/hot.json` |
| 对应表 | `hot_items`（Day 16 建，Day 17 起为三平台官网同步的真实数据） |

**成功响应** `200`：

```json
{
  "ok": true,
  "data": {
    "platforms": [
      {
        "id": "hupu",
        "name": "虎扑",
        "desc": "步行街热帖榜",
        "items": [
          {
            "rank": 1,
            "title": "湖人加时险胜凯尔特人，赛后更衣室视频曝光",
            "heat": 1523000,
            "url": "https://example.com/hupu-1",
            "tag": "NBA",
            "video": false
          }
        ]
      }
    ]
  },
  "meta": { "updatedAt": "2026-09-25T22:30:00+08:00" }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `platforms[].id` | string | ✓ | `hupu` / `tencent` / `cctv5` |
| `platforms[].name` | string | ✓ | 显示名 |
| `platforms[].desc` | string | — | 一句话描述 |
| `platforms[].items[].rank` | number | ✓ | 榜内排名，从 1 开始 |
| `platforms[].items[].title` | string | ✓ | 条目标题 |
| `platforms[].items[].heat` | number | ✓ | 热度值（前端格式化为「万」） |
| `platforms[].items[].url` | string | ✓ | 原文链接 |
| `platforms[].items[].tag` | string | — | 联赛/项目标签 |
| `platforms[].items[].video` | boolean | — | 是否视频条目（仅腾讯体育有） |

**错误返回**：

| 状态 | code | 场景 |
| ---- | ---- | ---- |
| 400 | `BAD_REQUEST` | `platform` 值不在白名单 |
| 404 | `NOT_FOUND` | 当天无热搜数据（前端显示整页空态） |

> 空态约定：某平台 `items: []` → 该平台显示「该平台今日暂无热搜数据」；`platforms: []` → 整页空态。前端已实现（`home.js`）。

---

### 2.2 `GET /api/news` ⏳ 占位

| 项 | 内容 |
| -- | ---- |
| 用途 | 资讯列表：首页「今日速览」四板块 + 资讯列表页（按大类） |
| 服务页面 | `index.html`（按日期）、`news.html`（按大类，不限日期） |
| 请求参数 | `date`（选填，`YYYY-MM-DD`）：只要当天的；`cat`（选填）：`足球`/`篮球`/`综合` 大类筛选；`section`（选填）：`头条`/`转会伤病`/`热议`/`明日看点`；`league`（选填）：精确联赛；`limit`（选填，默认全部）、`offset`（选填，默认 0） |
| 对应数据 | `data/news.json` |
| 对应表 | `news_items`（Day 16 建） |

**成功响应** `200`：

```json
{
  "ok": true,
  "data": [
    {
      "id": "20260929-n01",
      "title": "标题不超过三十字",
      "summary": "摘要不超过六十字，含背景或影响或后续安排。",
      "section": "头条",
      "league": "NBA",
      "sourceName": "虎扑",
      "sourceUrl": "https://example.com/a",
      "digestDate": "2026-09-29",
      "status": "published",
      "createdAt": "2026-09-29T09:35:00+08:00"
    }
  ],
  "meta": { "count": 8, "updatedAt": "2026-09-29T09:35:00+08:00" }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | string | ✓ | 规则 `YYYYMMDD-n01` |
| `title` | string | ✓ | ≤30 字 |
| `summary` | string | ✓ | ≤60 字，含背景/影响/后续之一 |
| `section` | string | ✓ | 四选一：头条 / 转会伤病 / 热议 / 明日看点 |
| `league` | string | ✓ | NBA / 英超 / 中超 / 欧冠 / 电竞 / 综合 |
| `sourceName` | string | ✓ | 来源名称 |
| `sourceUrl` | string | ✓ | 可访问 URL |
| `digestDate` | string | ✓ | `YYYY-MM-DD` |
| `status` | string | ✓ | `draft` / `published`；**接口只返回 published** |
| `createdAt` | string | ✓ | ISO 8601 |

**大类映射**（前端硬编码，接口可不处理）：篮球 = NBA/CBA；足球 = 英超/中超/欧冠；综合 = 电竞及其他。

**错误返回**：

| 状态 | code | 场景 |
| ---- | ---- | ---- |
| 400 | `BAD_REQUEST` | `date` 格式非 `YYYY-MM-DD`，或 `cat` 不在白名单 |
| 404 | `NOT_FOUND` | 该条件下无任何条目（前端显示空态） |

---

### 2.3 `GET /api/news/:id` ⏳ 占位

| 项 | 内容 |
| -- | ---- |
| 用途 | 资讯详情：单条完整信息 + 同联赛相关推荐 |
| 服务页面 | `news-detail.html` |
| 请求参数 | 路径参数 `id`；`related`（选填，默认 3）：相关推荐条数 |
| 对应数据 | `data/news.json`（单条） |
| 对应表 | `news_items` |

**成功响应** `200`：

```json
{
  "ok": true,
  "data": {
    "id": "20260929-n01",
    "title": "标题不超过三十字",
    "summary": "摘要不超过六十字，含背景或影响或后续安排。",
    "section": "头条",
    "league": "NBA",
    "sourceName": "虎扑",
    "sourceUrl": "https://example.com/a",
    "digestDate": "2026-09-29",
    "status": "published",
    "createdAt": "2026-09-29T09:35:00+08:00",
    "related": [
      { "id": "20260929-n03", "title": "同联赛另一条标题", "league": "NBA", "section": "转会伤病" }
    ]
  }
}
```

**错误返回**：

| 状态 | code | 场景 |
| ---- | ---- | ---- |
| 404 | `NOT_FOUND` | id 不存在，或该条为 draft（对用户不可见）→ 前端显示「找不到这条资讯」 |

> 内容边界（PRD 9.1）：接口**只返回已有字段**，不返回原文正文；完整内容走 `sourceUrl` 外链。

---

### 2.4 `GET /api/matches` ⏳ 占位

| 项 | 内容 |
| -- | ---- |
| 用途 | 赛程比分页：按昨天/今天/明天切换展示比赛 |
| 服务页面 | `matches.html` |
| 请求参数 | `date`（选填，`YYYY-MM-DD`）：某天比赛；`league`（选填）：NBA / 英超 / CBA / 欧冠；`status`（选填）：未开始 / 进行中 / 已结束 / 延期 / 取消 |
| 对应数据 | `data/matches.json` |
| 对应表 | `matches`（Day 16 建） |

**成功响应** `200`：

```json
{
  "ok": true,
  "data": [
    {
      "id": "20260924-nba-01",
      "league": "NBA",
      "homeTeam": "凯尔特人",
      "awayTeam": "湖人",
      "matchTime": "2026-09-24 07:30",
      "status": "已结束",
      "homeScore": 108,
      "awayScore": 112,
      "round": "季前赛",
      "venue": "TD Garden",
      "dataSource": "NBA官网（示例）",
      "updatedAt": "2026-09-24T11:00:00+08:00"
    }
  ],
  "meta": { "count": 9, "updatedAt": "2026-09-24T11:00:00+08:00" }
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | string | ✓ | `YYYYMMDD-<联赛>-01`，如 `20260924-nba-01` |
| `league` | string | ✓ | NBA / 英超 / CBA / 欧冠 |
| `homeTeam` / `awayTeam` | string | ✓ | 主/客队 |
| `matchTime` | string | ✓ | `YYYY-MM-DD HH:mm`（北京时间） |
| `status` | string | ✓ | 未开始 / 进行中 / 已结束 / 延期 / 取消 |
| `homeScore` / `awayScore` | number | 已结束后 ✓ | 与官方一致 |
| `round` / `venue` | string | — | 轮次 / 场地 |
| `dataSource` | string | ✓ | 比分来源（核对溯源） |
| `updatedAt` | string | ✓ | ISO 8601；比分更正须更新 |

**错误返回**：

| 状态 | code | 场景 |
| ---- | ---- | ---- |
| 400 | `BAD_REQUEST` | `date` 格式错，或 `league` 不在白名单 |
| 404 | `NOT_FOUND` | 该日无比赛 → 前端显示「当日无重点赛事」 |

---

### 2.5 `GET /api/leagues/:id` ⏳ 占位

| 项 | 内容 |
| -- | ---- |
| 用途 | 联赛板块页：一次取回该联赛的全部 Tab 数据（赛程/排行/季后赛/球员等） |
| 服务页面 | `league.html?lg=nba\|cba\|ucl\|epl` |
| 请求参数 | 路径参数 `id`：`nba` / `cba` / `ucl` / `epl`；`tab`（选填）：只取某个 Tab，省略则全部 |
| 对应数据 | `data/{nba,cba,ucl,epl}.json` |
| 对应表 | `league_schedule` / `league_standings` / `league_players` 等（Day 16 建） |

**成功响应** `200`（结构随联赛不同，下列为 NBA 示例）：

```json
{
  "ok": true,
  "data": {
    "leagueId": "nba",
    "leagueName": "NBA",
    "sport": "basketball",
    "emoji": "🏀",
    "desc": "美职篮",
    "tabs": ["schedule", "standings", "playoffs", "bracket", "players"],
    "schedule": [
      { "id": "nba-20260928-01", "date": "2026-09-28", "time": "07:30", "status": "已结束",
        "homeTeam": "凯尔特人", "awayTeam": "尼克斯", "homeScore": 112, "awayScore": 108,
        "round": "季前赛", "venue": "TD 花园" }
    ],
    "standings": [
      { "rank": 1, "teamName": "凯尔特人", "wins": 3, "losses": 0, "pointsDiff": "+24", "winRate": "100%" }
    ],
    "playoffs": [
      { "round": "西部半决赛 G4", "homeTeam": "雷霆", "awayTeam": "独行侠", "homeScore": 2,
        "awayScore": 1, "status": "进行中", "date": "2026-09-29 08:00", "note": "七战四胜制" }
    ],
    "players": [
      { "rank": 1, "playerName": "卢卡·东契奇", "teamName": "湖人", "points": 34.2, "rebounds": 8.9, "assists": 9.1 }
    ],
    "bracket": {
      "season": "25-26",
      "seasons": ["25-26", "24-25", "23-24"],
      "halves": []
    }
  },
  "meta": { "updatedAt": "2026-09-28T21:30:00+08:00" }
}
```

**各联赛 Tab 差异**（`tabs` 数组驱动，前端据此渲染子标签）：

| 联赛 | tabs | 特有字段 | 排行表列 |
| ---- | ---- | ---- | ---- |
| NBA | schedule / standings / playoffs / bracket / players | `playoffs` | 篮球列（胜/负/净胜/胜率） |
| CBA | 同 NBA | `playoffs` | 同 NBA |
| 欧冠 | schedule / standings / knockout / bracket / players | `knockout` | 足球列（赛/胜/平/负/进/失/积分） |
| 英超 | schedule / standings / scorers / players / race | `scorers` / `race` | 足球列 |

**字段说明（关键）**：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `sport` | string | `basketball` / `football`，决定排行表列与球员字段 |
| `tabs` | string[] | Tab 顺序与可见性由数据驱动 |
| `standings[].pointsDiff` | string | 篮球净胜分（带正负号字符串） |
| `standings[].winRate` | string | 篮球胜率（如 `"100%"`） |
| `standings[].points` | number | 足球积分 |
| `players[]` | object[] | 篮球：points/rebounds/assists；足球：apps/goals/assists/rating |
| `scorers[]` | object[] | 射手榜：playerName/goals/assists（仅英超） |
| `race.zones[]` | object[] | 争冠形势分区（仅英超）：name/color/desc/teams[] |
| `bracket.halves[].rounds[].matches[]` | object[] | 晋级图：a/b 为队伍或 `{winnerOf}` 引用；scoreA/scoreB 为系列赛大比分 |

**错误返回**：

| 状态 | code | 场景 |
| ---- | ---- | ---- |
| 400 | `BAD_REQUEST` | `id` 不在白名单（nba/cba/ucl/epl） |
| 404 | `NOT_FOUND` | 该联赛暂无数据 → 前端显示空提示 |

---

### 2.6 `POST /api/subscribe` ⏳ 占位（暂不实现）

| 项 | 内容 |
| -- | ---- |
| 用途 | 邮箱订阅每日速览（第 4 周才做） |
| 请求体 | `{"email": "a@b.com"}` |
| 成功响应 | `200` · `{"ok": true, "data": {"message": "订阅成功"}}` |
| 错误 | 400 `BAD_REQUEST` 邮箱格式错；409 `CONFLICT` 已订阅 |

> 按 `TECH_DESIGN` 第 11 节，MVP 阶段订阅走人工流程，此接口仅登记，**不在第 3 周实现**。

### 2.7 `GET /api/unsubscribe` ⏳ 占位（暂不实现）

| 项 | 内容 |
| -- | ---- |
| 用途 | 令牌退订（自动化，人多后启用） |
| 请求参数 | `token`（必填）：退订令牌 |
| 成功响应 | `200` · `{"ok": true, "data": {"message": "已退订"}}` |
| 错误 | 400 `BAD_REQUEST` 令牌无效 |

---

## 3. 数据表设计（Day 16 定稿并已建表）

> **状态**：Day 15 只登记草案、不建；**Day 16 定稿并已建表**——CloudBase PostgreSQL 17，库 `postgres-emxo9nse` / schema `public`，10 张表全部建成、种子各 ≥5 行（实测见 §3.5）。
> **唯一权威**：建表语句 [`db/schema.sql`](db/schema.sql)、种子数据 [`db/seed.sql`](db/seed.sql)。本节与两个脚本保持一致；以后改结构先改脚本、再回写本节。

### 3.1 命名约定（数据库与接口是两套风格）

| 层 | 风格 | 例子 | 为什么 |
| -- | ---- | ---- | ---- |
| **数据库列** | `snake_case` | `source_name`、`digest_date`、`home_team` | 与现有 `data/news.json`、`data/matches.json` **一字不差**，迁移零改名 |
| **接口输出** | `camelCase` | `sourceName`、`digestDate`、`homeTeam` | 契约 0.1；与 Day 10 起各联赛 JSON 一致 |

> 两套风格的映射在 **Day 18 的接口层**完成（`SELECT ... AS "sourceName"` 或结果重命名），**数据库侧不改名**。

### 3.2 表清单与关联

| # | 表名 | 来源数据 | 主键 | 关联 |
| - | ---- | ---- | ---- | ---- |
| 1 | `leagues` | `data/{lg}.json` 头部字段 | `id` | **维度表**，被 5–8 引用 |
| 2 | `hot_items` | `data/hot.json` | `id` | — |
| 3 | `news_items` | `data/news.json` | `id` | 靠 `league` 与 `matches` 对齐 |
| 4 | `matches` | `data/matches.json` | `id` | 靠 `league` 与 `news_items` 对齐 |
| 5 | `league_schedule` | `→ schedule` | `id` | `league_id → leagues.id` |
| 6 | `league_standings` | `→ standings` | `id` | `league_id → leagues.id` |
| 7 | `league_players` | `→ players` / `scorers` | `id` | `league_id → leagues.id` |
| 8 | `league_brackets` | `→ bracket` / `race` | `id` | `league_id → leagues.id` |
| 9 | `push_log` | —（订阅线） | `id` | — |
| 10 | `subscribers` | —（订阅线） | `id` | — |

**关联字段（今日掌握项）**

- 「两张核心表」= `news_items`（一条资讯一行）+ `matches`（一场比赛一行）。
- 二者靠 **`league`** 关联：资讯的联赛标签与比赛的联赛标签同域（NBA / 英超 / CBA / 欧冠），「某联赛今天有什么资讯、有什么比赛」就按它 join：
  ```sql
  SELECT m.league, count(DISTINCT m.id) AS 比赛数, count(DISTINCT n.id) AS 资讯数
  FROM   matches m JOIN news_items n ON n.league = m.league
  GROUP  BY m.league;
  ```
- 联赛页那四张表（5–8）靠 **`league_id`** 外键挂到 `leagues`，值是 `nba/cba/ucl/epl` 短标识。

### 3.3 各表字段（与 `db/schema.sql` 一致）

**1. `leagues`**（维度表）
`id` TEXT PK · `name` TEXT NN · `sport` TEXT NN `CHECK(basketball/football)` · `emoji` TEXT · `description` TEXT · `tabs` JSONB NN · `updated_at` TIMESTAMPTZ NN

**2. `hot_items`**
`id` TEXT PK · `platform` TEXT NN `CHECK(hupu/tencent/cctv5)` · `platform_name` TEXT NN · `platform_desc` TEXT · `rank` INT NN · `title` TEXT NN · `heat` BIGINT NN · `url` TEXT NN · `tag` TEXT · `is_video` BOOL NN · `fetched_at` TIMESTAMPTZ NN
`UNIQUE(platform, rank)`

**3. `news_items`**
`id` TEXT PK · `title` TEXT NN（≤30 字）· `summary` TEXT NN（≤60 字）· `section` TEXT NN `CHECK(头条/转会伤病/热议/明日看点)` · `league` TEXT NN · `source_name` TEXT NN · `source_url` TEXT NN · `digest_date` DATE NN · `status` TEXT NN `CHECK(draft/published)` · `created_at` TIMESTAMPTZ NN

**4. `matches`**
`id` TEXT PK · `league` TEXT NN · `home_team` / `away_team` TEXT NN · `match_time` TIMESTAMP NN · `status` TEXT NN `CHECK(未开始/进行中/已结束/延期/取消)` · `home_score` / `away_score` INT · `round` / `venue` TEXT · `data_source` TEXT NN · `updated_at` TIMESTAMPTZ NN
约束：`status='已结束'` 时两个比分必须非空（防「状态说打完、比分为空」）

**5. `league_schedule`**
`id` TEXT PK · `league_id` TEXT NN **FK→leagues** · `match_date` DATE NN · `match_time` TEXT · `status` TEXT NN `CHECK(五种)` · `home_team` / `away_team` TEXT NN · `home_score` / `away_score` INT · `round` / `venue` TEXT

**6. `league_standings`**
`id` TEXT PK · `league_id` TEXT NN **FK** · `rank` INT NN · `team_name` TEXT NN · `played` INT · `wins` INT NN · `draws` INT · `losses` INT NN · `goals_for` / `goals_against` INT · `points` INT · `points_diff` TEXT · `win_rate` TEXT
`UNIQUE(league_id, rank)`

**7. `league_players`**
`id` TEXT PK · `league_id` TEXT NN **FK** · `board` TEXT NN `CHECK(players/scorers)` · `rank` INT NN · `player_name` / `team_name` TEXT NN · `points` / `rebounds` / `assists` NUMERIC(5,1) · `apps` INT · `goals` INT · `rating` NUMERIC(3,1)
`UNIQUE(league_id, board, rank)`

**8. `league_brackets`**
`id` TEXT PK · `league_id` TEXT NN **FK** · `season` TEXT NN · `kind` TEXT NN `CHECK(bracket/race)` · `payload_json` JSONB NN · `updated_at` TIMESTAMPTZ NN
`UNIQUE(league_id, season, kind)`

**9. `push_log`**
`id` TEXT PK · `digest_date` DATE NN · `sent_at` TIMESTAMPTZ · `recipient_count` INT NN · `status` TEXT NN · `failure_note` TEXT

**10. `subscribers`**
`id` TEXT PK · `email` TEXT NN `UNIQUE` · `status` TEXT NN `CHECK(active/unsubscribed)` · `subscribed_at` TIMESTAMPTZ NN · `unsubscribe_token` TEXT NN `UNIQUE` · `last_sent_at` TIMESTAMPTZ

### 3.4 与 Day 15 草案的四处改动（改动都有理由）

| 处 | 草案 | 定稿 | 原因 |
| -- | ---- | ---- | ---- |
| `leagues` | 无 | **新增维度表** | 4 张 `league_*` 要外键父表；字段取自各 JSON 头部（id/name/sport/emoji/desc/tabs） |
| `league_schedule` | `date` / `time` | **`match_date` / `match_time`** | `date`、`time` 是 PG 类型关键字，作列名易踩坑；也与 `matches.match_time` 命名统一 |
| `league_players` | 无 `board` | **新增 `board`** | 英超同时有「球员数据榜」和「射手榜」两套榜单，必须区分 |
| `league_brackets` | 无 `kind` | **新增 `kind`** | 晋级图（NBA/CBA/欧冠）与争冠形势（英超 `race`）结构不同 |

### 3.5 建表 · 灌种 · 验证（Day 16 实测步骤）

**A. 控制台执行（推荐，脚本大也能贴）**

1. 打开 CloudBase 控制台 → 环境 `ross-d2gimwy406e0d6812` → **数据库 → SQL 编辑器**
2. 粘贴 [`db/schema.sql`](db/schema.sql) 全文 → 执行 → 应看到 10 行表名
3. 粘贴 [`db/seed.sql`](db/seed.sql) 全文 → 执行 → 末尾自检表打印每张表行数
4. 到「表管理」逐张点开，核对数据（**今日截图**就在这里取）

**B. CLI 执行（本机实测可用）**

```bash
# 单条查询
tcb db execute -e ross-d2gimwy406e0d6812 --sql "SELECT 1"

# 执行 schema.sql（18KB，命令行能过）
tcb db execute -e ross-d2gimwy406e0d6812 --sql "$(cat db/schema.sql)"

# seed.sql 有 40KB，超过命令行长度上限（实测报 Argument list too long），
# 按语句边界分段执行（本项目实测切 5 段，每段 <20KB）
```

**C. select 验证（每张表 ≥5 行）**

```sql
SELECT 'hot_items' AS t, count(*) FROM hot_items
UNION ALL SELECT 'news_items',       count(*) FROM news_items
UNION ALL SELECT 'matches',          count(*) FROM matches
UNION ALL SELECT 'league_schedule',  count(*) FROM league_schedule
UNION ALL SELECT 'league_standings', count(*) FROM league_standings
UNION ALL SELECT 'league_players',   count(*) FROM league_players
UNION ALL SELECT 'league_brackets',  count(*) FROM league_brackets
ORDER BY 1;
```

实测结果：`hot_items` 24 · `news_items` 8 · `matches` 9 · `league_schedule` 20 · `league_standings` 20 · `league_players` 25 · `league_brackets` 5（`leagues` 4 是维度表、`push_log`/`subscribers` 各 5）。

**D. 约束自测（都如期被拦下）**

| 动作 | 期望 | 实测 |
| ---- | ---- | ---- |
| 插不存在的 `league_id` | 外键报错 | ✅ `23503 violates foreign key constraint` |
| `hot_items` 同平台重复名次 | 唯一报错 | ✅ `23505 duplicate key value` |
| `news_items` 标题 31 字 | 长度报错 | ✅ `23514 violates check constraint` |
| 重跑 `seed.sql` | 不报错、不重复 | ✅ 五段全部重跑成功、行数不变 |

---

## 4. 前端改造对照（Day 18–19 迁移时用）

前端现在 `fetch` 的是本地文件，将来换成接口路径：

| 现在（静态） | 将来（接口） | 涉及文件 |
| ---- | ---- | ---- |
| `fetch('data/hot.json')` | `fetch('/api/hot')` | `js/home.js` |
| `fetch('data/news.json')` | `fetch('/api/news' + 查询串)` | `js/news.js`、`js/news-detail.js`、`js/app.js` |
| `fetch('data/matches.json')` | `fetch('/api/matches' + 查询串)` | `js/matches.js` |
| `fetch('data/' + lg + '.json')` | `fetch('/api/leagues/' + lg)` | `js/league.js` |

> 响应包络从「裸数组/裸对象」变成 `{ok, data, meta}`，前端取值处需加一层 `res.data`。这是 Day 18 的主要改动量。

---

## 5. 进度（Day 15 完成情况 + Day 16 更新）

**Day 15（第 3 周第 1 天）**

| 项 | 状态 |
| -- | ---- |
| `/api/health` 云函数代码 + 配置 | ✅ 已写、已本地实测（4 条断言全过） |
| CloudBase 环境开通 | ✅ 已完成（`ross-d2gimwy406e0d6812`，体验版） |
| `/api/health` 公网部署 | ✅ 已部署，公网实测返回 `{"ok":true,"service":"Daily Sports Express"}` |
| 网关路由 `/api/health` | ✅ 已落地（`tcb deploy --only gateway`） |
| 前端静态托管部署 | ✅ 已部署，24 个文件上传成功，主要页面实测 200 |
| 本契约 8 个接口 | ✅ 已登记（1 个已实现 + 7 个占位） |

**Day 16（第 3 周第 2 天）**

| 项 | 状态 |
| -- | ---- |
| 数据模型设计 | ✅ 10 张表（含新增 `leagues` 维度表），详见 §3 |
| `db/schema.sql` / `db/seed.sql` 入库 | ✅ 本次提交 |
| 线上建表（CloudBase PG 17 / schema `public`） | ✅ 10 张表全部建成 |
| 种子数据（每张核心表 ≥5 行） | ✅ hot 24 · news 8 · matches 9 · schedule 20 · standings 20 · players 25 · brackets 5 |
| `seed.sql` 重复执行不报错 | ✅ 重跑五段全部成功、行数不变 |
| 约束自测（外键 / 唯一 / 长度） | ✅ `23503` / `23505` / `23514` 三类都被正确拦下 |
| 真实业务接口 | ❌ Day 17–19 |
| 跨域配置 | ❌ Day 20 |

**Day 17（第 3 周第 3 天）**

| 项 | 状态 |
| -- | ---- |
| 真实热搜数据同步脚本 | ✅ `scripts_cloudbase/fetch-hot.ps1`（虎扑/腾讯体育/央视体育三源） |
| 真实数据入库 | ✅ 63 条（虎扑 49 · 腾讯 7 · 央视 7），替换 Day 16 的 24 条示例种子 |
| `GET /api/hot` 云函数 | ✅ `cloudfunctions/api/index.js`（零依赖，HTTP API 方式访问 PG） |
| 网关路由 `/api/hot` | ✅ 已写入 `cloudbaserc.json` |
| 本地分支验证 | ✅ 5 条断言全过（400 / 404 / 405 / 500 各分支） |
| 公网部署 + 真库验证 | ⏳ 待零创建 API Key 后执行（见 `docs/cloudbase-deploy-day17.md`） |
| `/api/favorites` | ❌ Day 18（读需先有收藏表，今日不做） |
| 跨域配置 | ❌ Day 20 |

**仍待办（不阻塞完成标准）**：Day 15 的同伴手机验证与三张截图归档；Day 16 的控制台「表数据页」截图；Day 17 的 API Key 创建与公网验证。
