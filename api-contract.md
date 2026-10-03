# 每日体坛速览 · 接口契约（API Contract）

| 项目 | 内容 |
| ---- | ---- |
| 文档名称 | 接口契约（api-contract） |
| 撰写日期 | 2026-10-03（Day 15｜第 3 周） |
| 依据 | 前端第 2 周实际页面（`index.html` / `matches.html` / `news.html` / `news-detail.html` / `league.html`）+ `TECH_DESIGN.md` 第 5 节 |
| 文档地位 | **第 3 周建表与写接口的唯一依据**。今天只登记占位，不实现。 |
| 实现时点 | Day 16–17 建表、Day 18–19 写读接口、Day 20 配跨域 |
| 今日不实现 | 所有 `/api/*` 业务接口，均为占位；今天唯一实际部署的是 `/api/health` |

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
| 1 | `/api/hot` | GET | `index.html` | ⏳ 占位 |
| 2 | `/api/news` | GET | `index.html` / `news.html` / `news-detail.html` | ⏳ 占位 |
| 3 | `/api/news/:id` | GET | `news-detail.html` | ⏳ 占位 |
| 4 | `/api/matches` | GET | `matches.html` | ⏳ 占位 |
| 5 | `/api/leagues/:id` | GET | `league.html` | ⏳ 占位 |
| 6 | `/api/subscribe` | POST | （第 4 周订阅功能） | ⏳ 占位（暂不实现） |
| 7 | `/api/unsubscribe` | GET | （人工退订，暂不做页面） | ⏳ 占位（暂不实现） |

> 表 1–5 是前端**当前页面直接依赖**的读接口，是 Day 16–19 的重点。
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

### 2.1 `GET /api/hot` ⏳ 占位

| 项 | 内容 |
| -- | ---- |
| 用途 | 首页三平台热搜榜（虎扑 / 腾讯体育 / 央视体育） |
| 服务页面 | `index.html` |
| 请求参数 | `platform`（选填）：`hupu` / `tencent` / `cctv5`，省略则返回全部三个；`limit`（选填，默认 10）：每个平台返回条数 |
| 对应数据 | `data/hot.json` |
| 对应表 | `hot_items`（Day 16 建） |

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

## 3. 数据表设计草案（Day 16 建表依据）

> 今天**只登记**，不建。字段与第 2 节接口一一对应，id 规则不变。

| 表名 | 来源数据 | 主键 | 关键字段 |
| ---- | ---- | ---- | ---- |
| `hot_items` | `data/hot.json` | `id` | `platform` / `rank` / `title` / `heat` / `url` / `tag` / `is_video` / `fetched_at` |
| `news_items` | `data/news.json` | `id` | `title` / `summary` / `section` / `league` / `source_name` / `source_url` / `digest_date` / `status` / `created_at` |
| `matches` | `data/matches.json` | `id` | `league` / `home_team` / `away_team` / `match_time` / `status` / `home_score` / `away_score` / `round` / `venue` / `data_source` / `updated_at` |
| `league_schedule` | `data/{lg}.json` → `schedule` | `id` | `league_id` / `date` / `time` / `status` / `home_team` / `away_team` / `home_score` / `away_score` / `round` / `venue` |
| `league_standings` | `→ standings` | `id` | `league_id` / `rank` / `team_name` / `wins` / `losses` / `draws` / `played` / `points` / `points_diff` / `win_rate` / `goals_for` / `goals_against` |
| `league_players` | `→ players` / `scorers` | `id` | `league_id` / `rank` / `player_name` / `team_name` / `points` / `rebounds` / `assists` / `apps` / `goals` / `rating` |
| `league_brackets` | `→ bracket` / `race` | `id` | `league_id` / `season` / `payload_json`（结构复杂，整体存 JSON） |
| `push_log` | — | `id` | `digest_date` / `sent_at` / `recipient_count` / `status` / `failure_note` |
| `subscribers` | GitHub Secrets | `id` | `email` / `status` / `subscribed_at` / `unsubscribe_token` / `last_sent_at` |

> 说明：`league_brackets` 的晋级图/争冠形势结构嵌套较深（halves→rounds→matches），**不适合拆成关系表**，整体存 JSON 字段即可。

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

## 5. 今天（Day 15）已完成 vs 未完成

| 项 | 状态 |
| -- | ---- |
| `/api/health` 云函数代码 + 配置 | ✅ 已写、已本地实测（4 条断言全过） |
| CloudBase 环境开通 | ✅ 已完成（`ross-d2gimwy406e0d6812`，体验版） |
| `/api/health` 公网部署 | ✅ 已部署，公网实测返回 `{"ok":true,"service":"Daily Sports Express"}` |
| 网关路由 `/api/health` | ✅ 已落地（`tcb deploy --only gateway`） |
| 前端静态托管部署 | ✅ 已部署，24 个文件上传成功，主要页面实测 200 |
| 本契约 8 个接口 | ✅ 已登记（1 个已实现 + 7 个占位） |
| 数据库建表 | ❌ 今日不做（Day 16） |
| 真实业务接口 | ❌ 今日不做（Day 18–19） |
| 跨域配置 | ❌ 今日不做（Day 20） |

**仍待办（不阻塞今日完成标准）**：同伴手机验证前端公网地址；三张截图归档（云函数返回 / 前端页面 / 控制台环境信息）。
