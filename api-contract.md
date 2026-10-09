# 每日体坛速览 · 接口契约（API Contract）

| 项目 | 内容 |
| ---- | ---- |
| 文档名称 | 接口契约（api-contract） |
| 撰写日期 | 2026-10-03（Day 15｜第 3 周）；**2026-10-04（Day 16）更新：表结构定稿并已建表**；**2026-10-05（Day 17）更新：`/api/hot` 已实现**；**2026-10-06（Day 18）更新：`/api/favorites` 写入接口已实现，前端接入接口层**；**2026-10-07（Day 20）更新：跨域实测确认（白名单精确匹配、无 `*`），前端接口地址收口到 `js/api-config.js`，新增接口检查台 `checkup.html`**；**2026-10-09（Day 22）更新：`PATCH`/`DELETE` 上线（`/api/matches`、`/api/news`），增删改查四类操作闭环** |
| 依据 | 前端第 2 周实际页面（`index.html` / `matches.html` / `news.html` / `news-detail.html` / `league.html`）+ `TECH_DESIGN.md` 第 5 节 |
| 文档地位 | **第 3 周建表与写接口的唯一依据**。接口 Day 17 起逐个落地；**第 3 节的表结构 Day 16 已定稿，且与线上库逐字一致**。 |
| 实现时点 | Day 16 建表 ✅ · Day 17 `/api/hot` ✅ · **Day 18 `/api/favorites` ✅** · Day 19 后端分层重构（读接口顺延）· **Day 20 跨域实测确认 + 前端接口地址收口 + 接口检查台 ✅** · **Day 22 `PATCH` / `DELETE` 上线 ✅** |
| 今日不实现 | 批量操作（清单明确「今日不做」）；用户系统；`/api/news`、`/api/matches` 的**列表**读接口仍为占位（本日只提供按 id 取单条，供改删验证）。另：**软删除 `is_deleted` 属清单的余力加练，本日已补做**（做法见 §2.11） |

---

## 0. 全局约定

### 0.1 基础信息

| 项 | 值 |
| -- | -- |
| 基础路径 | `/api` |
| 响应格式 | `application/json; charset=utf-8` |
| 时间格式 | 日期 `YYYY-MM-DD`；时间 `YYYY-MM-DD HH:mm`（北京时间）；时间戳用 ISO 8601 |
| 命名风格 | **camelCase**（对齐 Day 10 起各联赛 JSON 已统一的字段名） |
| 鉴权 | 第 3 周读接口**公开**（`enableAuth: false`）；**Day 18 的 `POST /api/favorites` 同样公开**（体验版暂无写鉴权，靠字段校验 + 唯一约束兜底），第 4 周再议。**Day 22 的 `PATCH` / `DELETE` 沿用同一口径：公开 + `enableAuth:false`**，安全靠「字段白名单 + id 存在性校验 + 底座拒绝无过滤条件改删」三层；**真正的写鉴权仍是待办**（见 §5 未完成项） |

**已部署环境（Day 15 实测）**：

| 项 | 值 |
| -- | -- |
| 环境名称 / ID | `ross` / `ross-d2gimwy406e0d6812` |
| 地域 | `ap-shanghai`（上海） |
| 云函数入口 | `https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com/api/health` |
| 前端静态托管 | `https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/` |

> 后续各 `/api/*` 接口将挂在同一网关域名下（`.../api/news`、`.../api/matches` 等）。

> ⚠️ 命名风格说明：老文件 `data/news.json` / `data/matches.json` 用的是蛇形（`digest_date` / `home_team`）。Day 10 起新建的联赛 JSON 已统一为 camelCase。**契约统一采用 camelCase**。

> 📌 **Day 18 实际执行口径（与原计划有出入，以本节为准）**：Day 18 迁移前端时**只接响应包络，字段名暂不改**。原因是 `/api/news`、`/api/matches`、`/api/leagues/:id` 三个读接口本日仍未实现，前端接上去也只能走本地 JSON 兜底，改名既测不出效果又要动 100+ 处取值。因此**蛇形→驼峰的改名推迟到各读接口真正上线那天（Day 19 起），跟着对应文件一起改**。本日已落地的两个接口（`/api/hot`、`/api/favorites`）本来就用 camelCase，不受影响。

> ✅ **Day 22 补完（改名已落地，口径就此收口）**：Day 18 留的这笔账本日结清——**全部静态 JSON 与读取端统一为 camelCase**。改动 11 个键、共 99 处：
> - **数据文件（7）**：`data/{matches,news,hot,nba,cba,epl,ucl}.json`
> - **读取端（6）**：`js/{matches,news,news-detail,app,home,league}.js`
> - **生成端（3）**：`tools/entry.html`、`scripts_cloudbase/build-nba-news.py`、`scripts_cloudbase/build-nba.py`、`scripts_cloudbase/fetch-leagues.py`（仅其 `build_json` 分支）
> - **不动的**：`cloudfunctions/shared/*Repository.js` 与所有 SQL 里的蛇形是**数据库列名**（契约 0.1 的另一半），保持 snake_case。**「库存蛇形 / 接口与静态 JSON 出驼峰」现在真正全站一致。**
> - 顺带修掉一个隐藏问题：此前 `js/matches.js` 对**接口**与**本地 JSON** 用的是同一套蛇形字段名，而接口本来就返回驼峰 → 走接口那条路会因为字段名对不上被判「缺字段」全部过滤掉。统一之后两条路径才真正等价。

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

> 📌 **Day 22 补充：`404` 的两种语义要分清**。同一个 `404 NOT_FOUND` 在改删接口里出现两次，含义不同：
>
> | 场景 | 何时返回 | 前端该怎么理解 |
> | ---- | ---- | ---- |
> | **id 不存在** | PATCH / DELETE / GET 一开始查不到这条 | 「**这条已经没了**」——删除场景下这是**成功之后**的正常结果，不是报错 |
> | **并发中被别人删掉** | 先查到了、落库时命中 0 行 | 「**刚好被别人删了**」——重试一次即可，`message` 里会写「可能刚刚被删除」 |
>
> 两者都用 `404`，是为了让调用方只需判断「这条还在不在」；`message` 里的中文说明用来区分细节。

### 0.4 跨域（CORS）——Day 20 实测确认

| 项 | 结论 |
| -- | ---- |
| 谁在处理 | **网关层自动处理**，云函数里**不写**任何 CORS 头 |
| 放行规则 | 按「跨域安全域名白名单」**精确匹配**；白名单内回显 `access-control-allow-origin: <该域名>`，预检 `OPTIONS` 返回 `204` |
| 白名单内容 | 本项目静态托管域名 `ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com` + 若干腾讯云官方域名（`tcb cors list -e <envId>`） |
| 通配符 | **没有 `*`**，符合「只允许自己的域名」的要求 |
| ⚠️ 判断依据 | 白名单**外**的 Origin，服务端**也返回 200**，但**不带 ACAO 头**（浏览器侧才拦）。所以「curl 打能通」≠「跨域配好了」，要看**响应头** |
| ⚠️ 本地开发 | 体验版套餐**不允许**往白名单加 `localhost`（`tcb cors add` 报「当前套餐无法执行此操作」）。本地改用 `serve.mjs` 的 `/api/*` **同源代理**，页面代码与线上一致 |

> 前端因此**必须用绝对地址**打网关域名（见 §4）；本地则由 `js/api-config.js` 切回相对路径、交给本地代理。
> 详见 `docs/cloudbase-deploy-day20.md`。

---

## 1. 接口总览

| # | 路径 | 方法 | 服务页面 | 今日状态 |
| - | ---- | ---- | ---- | ---- |
| 0 | `/api/health` | GET | — | ✅ **已部署**（Day 15） |
| 1 | `/api/hot` | GET | `index.html` | ✅ **已实现**（Day 17） |
| 2 | `/api/news` | GET | `index.html` / `news.html` / `news-detail.html` | ⏳ 占位（Day 22 已提供**按 id 取单条**做改删验证） |
| 3 | `/api/news/:id` | GET | `news-detail.html` | ⏳ 占位（Day 22 以 `GET /api/news?id=` 形态先行可用） |
| 4 | `/api/matches` | GET | `matches.html` | ⏳ 占位（Day 22 已提供**按 id 取单条**做改删验证） |
| 5 | `/api/leagues/:id` | GET | `league.html` | ⏳ 占位 |
| 6 | `/api/favorites` | **POST** | `news-detail.html`（收藏按钮） | ✅ **已实现**（Day 18） |
| 7 | `/api/favorites` | **GET** | （收藏列表，暂无页面） | ✅ **已实现**（Day 18） |
| 8 | `/api/subscribe` | POST | （第 4 周订阅功能） | ⏳ 占位（暂不实现） |
| 9 | `/api/unsubscribe` | GET | （人工退订，暂不做页面） | ⏳ 占位（暂不实现） |
| 10 | `/api/news` | **PATCH** | `checkup.html`（接口检查台） | ✅ **已实现**（Day 22） |
| 11 | `/api/news` | **DELETE** | `checkup.html`（接口检查台） | ✅ **已实现**（Day 22） |
| 12 | `/api/matches` | **PATCH** | `checkup.html`（接口检查台） | ✅ **已实现**（Day 22） |
| 13 | `/api/matches` | **DELETE** | `checkup.html`（接口检查台） | ✅ **已实现**（Day 22） |

> 表 1–5 是前端**当前页面直接依赖**的读接口，是 Day 16–19 的重点。
> **6–7 是 Day 18 新增的收藏线**（同一路径的两个方法）：`POST` 写一条、`GET` 读回来，详情页的「收藏这条」按钮走的就是 6。
> 📌 **路由与函数的关系**（Day 18 结论，2026-10-06 修订）：**不同路径必须各登记一条网关路由**；同一条路由可以用一个函数服务，靠 `req.method` 区分方法、靠 `req.url` 区分后缀。
> 网关是**前缀匹配**：命中路由后，**剥掉路由那段前缀，剩余部分原样保留在函数内 `req.url`**。
> （例：路由 `/api/news` 收到请求 `/api/news/20260929-n01` → 函数内 `req.url` 为 `/20260929-n01`；收到 `/api/news` → 为 `/`。）
> ⚠️ Day 18 曾误记为「函数内恒为 `/`、拿不到原始路径」——那是测试请求恰好把前缀剥干净造成的错判，详见 `docs/data-source-status.md` §5.1。
> 表 8–9 属订阅线，按 `TECH_DESIGN` 第 11 节仍走人工流程，此处仅登记。

> 🔎 **接口自检页（Day 20 新增）**：`checkup.html` — 「接口检查台」。
> 一个页面同时看 `/api/health` 状态、`hot_items` / `news_items` 真实数据（含**真实抓取时间**）、
> 以及一次 `POST /api/favorites` 写入测试（提交后自动读回验证）。
> 页顶直接显示当前 `API_ORIGIN` 与页面域名，一眼看出请求打的是不是公网地址。
> 公网地址：`https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/checkup.html`

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

> 📌 **`meta.updatedAt` 的语义（Day 20 修正）**：以前取的是**渲染时刻**（`new Date()`），
> 现在改为读 `hot_items.fetched_at` 的**最大值**——即「这批数据是什么时候从官网抓的」。
> 页面上的「最近更新」因此显示的是**真实抓取时间**，而不是用户打开页面的时间。
> 取不到时才退回当前时刻。实现见 `cloudfunctions/shared/hotItemsRepository.js` 的 `latestFetchedAt()`。

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

### 2.8 `POST /api/favorites` ✅ 已实现（Day 18）

| 项 | 内容 |
| -- | ---- |
| 用途 | **收藏写入**：把详情页的一条资讯写进核心表 `news_items`，同一条不允许重复入库 |
| 请求体 | JSON，7 个字段全必填（见下表） |
| 成功响应 | `200`（首次写入 `meta.created: true`；重复提交也返回 `200`，`meta.created: false`） |
| 错误 | 400 `BAD_REQUEST` 字段缺失/格式错；405 `METHOD_NOT_ALLOWED` 非 POST/GET；500 `INTERNAL_ERROR` |
| 写入表 | `public.news_items`（核心表，**不新建 favorites 表**） |
| 部署 | 独立云函数 `favorites`，网关路由 `/api/favorites` → `function:favorites` |

**请求体字段**：

| 字段 | 类型 | 必填 | 约束 | 说明 |
| ---- | ---- | :--: | ---- | ---- |
| `title` | string | ✔ | 长度 ≤ 30 | 标题 |
| `summary` | string | ✔ | 长度 ≤ 60 | 一句话摘要 |
| `section` | string | ✔ | 白名单：`头条` / `转会伤病` / `热议` / `明日看点` | 所属板块 |
| `league` | string | ✔ | 非空 | 联赛 / 项目 |
| `sourceName` | string | ✔ | 非空 | 来源名称 |
| `sourceUrl` | string | ✔ | 必须 `http(s)://` 开头，**且全表唯一** | 原文链接，防重依据 |
| `digestDate` | string | ✔ | `YYYY-MM-DD`，且必须是真实存在的日期 | 归属日期（原「所属计划日」） |

> 未列出的字段由服务端生成：`status` 固定 `published`，`createdAt` 取写入时刻，`id` 按 `YYYYMMDD-nNN` 生成（如 `20261006-n02`）。

**成功响应示例（首次写入）**：

```json
{
  "ok": true,
  "data": {
    "id": "20261006-n02",
    "title": "国乒包揽男女单打冠军",
    "summary": "……",
    "section": "头条",
    "league": "综合",
    "sourceName": "央视体育",
    "sourceUrl": "https://sports.cctv.com/2026/10/06/xxx.html",
    "digestDate": "2026-10-06",
    "status": "published",
    "createdAt": "2026-10-06T11:47:10.943594+08:00"
  },
  "meta": { "created": true, "message": "收藏成功" }
}
```

**防重复（本接口的重点）** —— 两层，都是「**返回已存在**」而不是报错：

| 层 | 触发场景 | 机制 | 返回 |
| -- | ---- | ---- | ---- |
| 1 | 同一篇文章被重复收藏 | 写入前按 `source_url` 查一次 | `200` + `meta.created: false` + `message:"这篇文章已在收藏中"` |
| 2 | 两个请求同时到达（并发） | 写入时撞上 `news_items_source_url_uniq` 唯一索引（SQLSTATE `23505`） | 捕获后回查该行，同样返回 `200` + `created:false` |

> **DB 侧约束**：`news_items` 上有唯一索引 `news_items_source_url_uniq (source_url)`（见 §3.3）。两层防重合起来保证：**同一 `sourceUrl` 在表里永远只有 0 或 1 行**。
>
> 「同一天发布重复的速览」由第 1 层覆盖——同一天的重复条目指向同一篇原文，`sourceUrl` 相同即被挡下。

**缺字段的错误响应（中文列清缺了什么）**：

```json
{
  "ok": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "缺少必填字段：摘要 summary、板块 section、联赛 league、来源名称 sourceName、原文链接 sourceUrl、归属日期 digestDate。请补齐后重新提交。"
  }
}
```

> 校验**一次性收集全部问题**再返回，不是缺一个报一个——省得用户来回试。

### 2.9 `GET /api/favorites` ✅ 已实现（Day 18）

| 项 | 内容 |
| -- | ---- |
| 用途 | **读回收藏**：验证写入的数据能被读出来（Day 18 验收用的就是它） |
| 请求参数 | `limit`（默认 20，上限 50）、`offset`（默认 0） |
| 成功响应 | `200` · `data` 为条目数组（字段同 2.8 的 `data`） |
| `meta` | `{ count, limit, offset, updatedAt }` |
| 排序 | `created_at` 倒序（最新收藏在前） |
| 错误 | 400 `BAD_REQUEST` 参数非法；405 `METHOD_NOT_ALLOWED` |

> **与 `POST` 同函数**：`/api/favorites` 的 `POST` 与 `GET` 由**同一个云函数**处理，靠 HTTP 方法分支（`POST` → 写，`GET`/`HEAD` → 读，其它 → 405）。这是 §1 那条「同路径不同方法必须拆函数」的**例外说明**：**方法不同可以同函数，路径不同才必须拆**。

### 2.10 `PATCH /api/matches` ✅ 已实现（Day 22）

| 项 | 内容 |
| -- | ---- |
| 用途 | **改一条比赛记录**（清单「赛事状态、最终比分、备注」；另含改队名/轮次/场地） |
| 请求体 | JSON：`id`（必填）+ 至少一个可改字段；也接受 `PATCH /api/matches/<id>`（路径带 id） |
| 成功响应 | `200`，`data` 同时返回 **`before` 与 `after` 两组值**（前端据此画改动对比，今日截图靠它） |
| 对应表 | `public.matches` |
| 部署 | 独立云函数 `matches`，网关路由 `/api/matches` → `function:matches` |
| 安全阀（**本接口的重点**） | 数据底座 `pg.updateRows` **拒绝无 `eq.` 过滤条件的 UPDATE**——少写条件直接报错，而不是把整张表刷成同一个值 |

**可改字段白名单**（`cloudfunctions/shared/matchesRepository.js` 的 `PATCHABLE`）：

| 字段 | 类型 | 约束 | 对应清单里的说法 |
| ---- | ---- | ---- | ---- |
| `status` | string | 五选一：未开始 / 进行中 / 已结束 / 延期 / 取消 | **赛事状态** |
| `homeScore` / `awayScore` | number \| null | 0–999 整数；`null` = 清空 | **最终比分** |
| `homeTeam` / `awayTeam` | string | 非空 | 「标题」（展示标题由主客队拼成） |
| `round` | string | ≤200 字，可空 | 「标题」/ 赛程说明 |
| `venue` | string | ≤200 字，可空 | 「摘要」（场地） |
| `note` | string | ≤200 字，可空 | **备注**（Day 22 新增列） |

> **不可改**：`id`（主键）、`league`（赛程归属）、`matchTime`（时间）、`dataSource`（溯源凭据——改了就没法核对比分来源）。提交这些字段不会报错，但会被**忽略**，并在 `meta.ignored` 里明确列出来（不静默吞掉用户意图）。

**关于「标题 / 内容摘要」**：`matches` 表按 Day 16 的设计**没有 `title` / `summary` 列**（它是赛程表，一行是一场比赛）。清单点名的「标题 / 摘要」在赛程语境下就是「主客队 + 比分 / 状态」的展示串，所以：
- 由字段**现算**，不落库：`title` = `<主队> vs <客队>（<状态>）`，`summary` = `<联赛> · <轮次> · <时间>，<比分>，<场地>`
- 响应里一并返回这两个拼好的字段，前端可直接展示
- 「改标题」的语义 = 改 `homeTeam` / `awayTeam` / `round` 这几个真实列

> 「新闻标题 / 内容摘要」这两类**真正对应到列**的字段在 `news_items` 表上，见 §2.11。

**成功响应示例**（把一场「进行中 58:52」改成「已结束 112:108」）：

```json
{
  "ok": true,
  "data": {
    "before": {
      "id": "20991231-day22-shot", "league": "NBA",
      "homeTeam": "凯尔特人", "awayTeam": "湖人",
      "matchTime": "2099-12-31T07:30:00", "status": "进行中",
      "homeScore": 58, "awayScore": 52, "round": "季前赛",
      "venue": "TD 花园", "dataSource": "NBA官网", "note": "第三节进行中"
    },
    "after": {
      "id": "20991231-day22-shot", "league": "NBA",
      "homeTeam": "凯尔特人", "awayTeam": "湖人",
      "matchTime": "2099-12-31T07:30:00", "status": "已结束",
      "homeScore": 112, "awayScore": 108, "round": "季前赛",
      "venue": "TD 花园", "dataSource": "NBA官网",
      "note": "Day22 PATCH：状态由「进行中」改为「已结束」，补最终比分",
      "updatedAt": "2026-10-09T19:01:13.15+08:00"
    },
    "title": "凯尔特人 vs 湖人（已结束）",
    "summary": "NBA · 季前赛 · 2099-12-31 07:30，112:108，TD 花园"
  },
  "meta": {
    "id": "20991231-day22-shot",
    "changed": ["status", "homeScore", "awayScore", "note"],
    "ignored": [],
    "message": "已修改 4 个字段",
    "updatedAt": "2026-10-09T19:01:13.15+08:00"
  }
}
```

**错误返回**：

| 状态 | code | 场景 | `message` 示例 |
| ---- | ---- | ---- | ---- |
| 400 | `BAD_REQUEST` | body 不是合法 JSON | 「请求体不是合法 JSON，请检查格式…」 |
| 400 | `BAD_REQUEST` | `id` 形态非法 | 「id 不合法：…（应为 3–64 位的字母/数字/短横线）」 |
| 400 | `BAD_REQUEST` | 一个可改字段都没提交 | 「没有可修改的字段。请至少提交以下之一：…」 |
| 400 | `BAD_REQUEST` | 字段取值越界（一次性列全） | 「字段 status（赛事状态）取值无效：「打完了」不在允许范围内…」 |
| **404** | `NOT_FOUND` | **id 不存在**（改之前先查一次就拦下） | 「未找到该比赛记录（id=xxx）。」 |
| 404 | `NOT_FOUND` | 并发中被别人删掉 | 「未找到该比赛记录（id=xxx），可能刚刚被删除。」 |
| 405 | `METHOD_NOT_ALLOWED` | 方法不是 GET/HEAD/PATCH/DELETE | — |

**两条业务约束（与 DB CHECK 对齐，在接口层先拦成人话）**：

1. `status` 改成「已结束」时，`homeScore` 与 `awayScore` **必须都有值**（DB 侧约束 `matches_finished_need_score` 同名）。拦截时校验的是「**改完之后**」的最终态——所以会把请求值与库里原值合并后再看，避免「库里已有比分、这次只改状态」被误拦。
2. 校验**一次性收集全部问题**再返回（与 Day 18 的 favorites 一致），不是改一个报一个。

---

### 2.11 `DELETE /api/matches` ✅ 已实现（Day 22 · **软删除**）

| 项 | 内容 |
| -- | ---- |
| 用途 | **删一条比赛记录** —— **软删除**：只把 `is_deleted` 置 `true`，数据留在表里；查询跳过它（余力加练，Day 22 已落地） |
| 请求参数 | `id` 两种给法：① 请求体 `{"id":"..."}`；② 路径 `DELETE /api/matches/<id>`（body 优先） |
| 成功响应 | `200`，`data.deleted` 回传**被标记的那一整行**（留档），`data.verifiedGone: true`，`data.mode: "soft"`，`data.recoverable: true` |
| `meta` | `{ id, message, deletedAt }` |
| 对应表 | `public.matches`（行**不离开**这张表） |

**「删除为什么比新增更容易出事」——本接口设的五道闸**（今日掌握项）：

| # | 层 | 闸门 | 防的是什么 |
| - | ---- | ---- | ---- |
| ① | 路径/方法 | 只认 `DELETE /api/matches`，写错方法先被 `405` 挡下 | 误触发 |
| ② | **数据底座** | `pg.deleteRows` / `pg.updateRows` **拒绝无 `eq.` 过滤条件的写** | **少写 WHERE 导致清表**（最致命的一种） |
| ③ | 接口层 | 先 `findById` → 不存在直接 `404`，**压根不发删除请求**；定位用 `id=eq.<id>`，永远只可能命中 0 或 1 行 | 删错行 / 无效删除 |
| ④ | 前端 | 检查台给**二次确认弹窗**「确定要删除这条记录吗？」（清单要求 5） | 人手误点 |
| ⑤ | **存储层** | **软删除**：根本不是真删，只把 `is_deleted` 置 `true` | **删错了回不来**（不可逆这件事本身） |

> ② ③ 是**代码里的确认**，④ 是**人手上的确认**，⑤ 是**留给自己的后路**——前四道防「别删错」，第五道管「删错了还能回来」。这就是「在哪加了确认」的答案。

**软删除三条自证**（三条同时成立才算软删除，只验一条都不够）：

| 条 | 验什么 | 怎么验 | 期望 |
| - | ---- | ---- | ---- |
| ① 查询跳过 | 删完查询侧看不见它 | `GET /api/matches?id=<id>` | `404 NOT_FOUND`（列表里也不再出现） |
| ② 数据没丢 | 行仍在库里，只是被标记 | `SELECT count(*) FILTER (WHERE is_deleted) FROM matches WHERE id='<id>'` | `1`（不是 0） |
| ③ 可以找回 | 把标记改回来它就回来 | 服务端 `repo.restoreById(id)` | 该行重新出现在 `GET` 里，字段值一个没少 |

**「删除」与「清干净」不是一回事**（软删除的代价，必须知道）：接口的 `DELETE` 只打标记，
所以**不能用它来清测试数据** —— 数据会一直留着、还占着主键。真要清掉只能走 SQL
（`repo.deleteById` 是那条维护通道）。本日的验证脚本因此都改成「先跑接口、最后 SQL 真删」。

**删除后自查（不靠「返回 200」当证据）**：标记语句执行完，接口**再 `findById` 查一次**，把结果写进 `data.verifiedGone` 与 `meta.message`：
- 查不到 → `verifiedGone: true`，message 说明「已软删除…数据仍保留在库中…查询已跳过它；复查确认已查不到」
- 还能查到 → `verifiedGone: false`，message「…但复查仍能查到，请再试一次」（把异常摆在明面上，不假装成功）

> 注意这里验的是「**查询侧看不见**」，不是「行没了」。这两件事在软删除下**必须分开说**，
> 否则就成了「接口说删了、库里却还在」的假证据。

**成功响应示例**：

```json
{
  "ok": true,
  "data": {
    "deleted": {
      "id": "20991231-day22-shot", "league": "NBA",
      "homeTeam": "凯尔特人", "awayTeam": "湖人",
      "matchTime": "2099-12-31T07:30:00", "status": "已结束",
      "homeScore": 112, "awayScore": 108, "round": "季前赛",
      "venue": "TD 花园", "dataSource": "NBA官网",
      "note": "Day22 PATCH：状态由「进行中」改为「已结束」，补最终比分",
      "updatedAt": "2026-10-09T19:01:13.15+08:00"
    },
    "verifiedGone": true,
    "mode": "soft",
    "recoverable": true,
    "restoreHint": "服务端调用 repo.restoreById(id) 即可恢复该条（无对外接口）"
  },
  "meta": {
    "id": "20991231-day22-shot",
    "message": "已软删除该比赛记录：数据仍保留在库中（仅标记 is_deleted = true），查询已跳过它；复查确认已查不到。",
    "deletedAt": "2026-10-09T19:04:00.00+08:00"
  }
}
```

**错误返回**：

| 状态 | code | 场景 | `message` 示例 |
| ---- | ---- | ---- | ---- |
| 400 | `BAD_REQUEST` | body 不是合法 JSON | 「请求体不是合法 JSON，请检查格式（应为 {"id":"20260924-nba-01"}）。」 |
| 400 | `BAD_REQUEST` | `id` 形态非法 | 「id 不合法：…」 |
| **404** | `NOT_FOUND` | **id 不存在** | 「未找到该比赛记录（id=xxx），无需删除。」 |
| 404 | `NOT_FOUND` | 并发中被别人删掉 | 「未找到该比赛记录（id=xxx），可能刚刚被删除。」 |

**为什么先查再删**（而不是直接删、看命中行数）：直接删也能知道命中几行，但**拿不到被删内容**，返回体里就没法让调用方确认「删掉的到底是哪一条」。先查一次既多一句人话（404 说清 id），又能把被删记录原样回传留档。代价是多一次查询——对一天百来行的表完全不值得优化。

**✅ 软删除已落地（Day 22 余力加练）**：本接口**不真删数据**，只把 `is_deleted` 置 `true`，查询一律带 `is_deleted = false` 过滤，`repo.restoreById(id)` 可把标记改回来。改动清单：

| 层 | 改动 |
| ---- | ---- |
| 结构 | `db/migrate-day22-soft-delete.sql`：`matches` / `news_items` 各加 `is_deleted BOOLEAN NOT NULL DEFAULT false`（幂等，已在线上执行）；`db/schema.sql` 同步补列 |
| 数据访问层 | `matchesRepository` / `newsItemsRepository`：`findById` 与列表查询加 `is_deleted = false`；新增 `softDeleteById`（标记）、`restoreById`（找回）；真删 `deleteById` 降级为维护通道（接口不再调用） |
| 接口层 | `DELETE` 分支改调 `softDeleteById`；响应加 `data.mode: "soft"` / `data.recoverable: true` / `data.restoreHint` |
| 前端 | 检查台弹窗警告文案改为如实描述（不再写「无法撤销」）；删除结果区展示软删除回执 |
| 例外 | `news_items` 上两处**故意不过滤**：`countByDigestDate`（跳过会让序号重算 → 撞主键）、`findBySourceUrl`（`source_url` 唯一键，含已删行才能与约束一致） |
| 配套 | `favorites` 的「已存在」分支对已软删行做**复活**，避免出现「说有这条、列表里却看不到」 |

**真删（维护通道）**：软删除会留下「永远查不到、却一直占着主键」的行。
要彻底清掉只能走 SQL / 服务端脚本（`repo.deleteById` 或直接 `DELETE FROM`）——
**不要指望接口的 `DELETE` 清数据**，它只是打标记。

---

### 2.12 `PATCH /api/news` + `DELETE /api/news` ✅ 已实现（Day 22 · `DELETE` 为**软删除**）

与 §2.10 / §2.11 **同款设计**，只是换到资讯表、字段白名单不同。路径 `/api/news` 与 `/api/favorites` 是两条路由 → 独立云函数 `news`。

| 项 | `PATCH /api/news` | `DELETE /api/news` |
| -- | ---- | ---- |
| 用途 | 改一条资讯（**标题 / 摘要 / 备注 / 发布状态**） | 删一条资讯（**软删除**：只打 `is_deleted` 标记，行留在表里；查询与列表都跳过） |
| 请求体 | `id` + 至少一个可改字段 | `id`（或路径 `DELETE /api/news/<id>`） |
| 成功响应 | `200` · `data: { before, after }` + `meta.changed/ignored` | `200` · `data: { deleted, verifiedGone, mode:"soft", recoverable:true, restoreHint }` |
| 对应表 | `public.news_items` | 同左（行不离开这张表） |
| 部署 | 云函数 `news`，网关路由 `/api/news` → `function:news` | 同左（同函数按方法分流） |

**可改字段白名单**（`newsItemsRepository.PATCHABLE`）：

| 字段 | 类型 | 约束 | 对应清单里的说法 |
| ---- | ---- | ---- | ---- |
| `title` | string | 非空，**≤30 字** | **新闻标题** |
| `summary` | string | 非空，**≤60 字** | **内容摘要** |
| `note` | string | ≤200 字，可空 | **备注**（Day 22 新增列） |
| `status` | string | 二选一：`draft` / `published` | 发布状态 |

> **不可改**：`id`（主键）、`sourceUrl`（**防重键 + 溯源凭据**，改它会破坏 Day 18 定下的防重语义）、`digestDate`（归属日）、`createdAt`（写入时刻）、`section` / `league` / `sourceName`（快照字段）。同上：忽略而非报错，`meta.ignored` 里列出来。

**错误返回**（与 matches 同构）：

| 状态 | code | 场景 | `message` 要点 |
| ---- | ---- | ---- | ---- |
| 400 | `BAD_REQUEST` | `id` / 字段校验失败（一次性列全） | 「字段 title（新闻标题）超出 30 字上限：当前 32 字，请精简标题。」 |
| **404** | `NOT_FOUND` | **id 不存在** | 「**未找到该体坛速览记录**（id=xxx）。」← 清单要求 3 点名要的中文说明 |
| 404 | `NOT_FOUND` | 并发中被删 | 「…可能刚刚被删除。」 |

> 标题 / 摘要的超长拦截是**在接口层先给中文提示**，比让 PG 回 `23514 violates check constraint` 友好得多（DB 侧的约束仍然在，双保险）。

---

## 3. 数据表设计（Day 16 定稿并已建表）

> **状态**：Day 15 只登记草案、不建；**Day 16 定稿并已建表**——CloudBase PostgreSQL 17，库 `postgres-emxo9nse` / schema `public`，10 张表全部建成、种子各 ≥5 行（实测见 §3.5）。
> **唯一权威**：建表语句 [`db/schema.sql`](db/schema.sql)、种子数据 [`db/seed.sql`](db/seed.sql)。本节与两个脚本保持一致；以后改结构先改脚本、再回写本节。

### 3.1 命名约定（数据库与接口是两套风格）

| 层 | 风格 | 例子 | 为什么 |
| -- | ---- | ---- | ---- |
| **数据库列** | `snake_case` | `source_name`、`digest_date`、`home_team` | 与现有 `data/news.json`、`data/matches.json` **一字不差**，迁移零改名 |
| **接口输出** | `camelCase` | `sourceName`、`digestDate`、`homeTeam` | 契约 0.1；与 Day 10 起各联赛 JSON 一致 |

> 两套风格的映射在**接口层**完成（结果重命名），**数据库侧不改名**。
>
> **Day 18 执行说明**：本日只有 `/api/hot`（Day 17 已做）与 `/api/favorites`（本日新增）两个接口上线，映射写在各自的云函数里（`cloudfunctions/api/index.js`、`cloudfunctions/favorites/index.js`）。`/api/news`、`/api/matches`、`/api/leagues/:id` 三个读接口的映射等它们实现时再写。

### 3.2 表清单与关联

| # | 表名 | 来源数据 | 主键 | 关联 |
| - | ---- | ---- | ---- | ---- |
| 1 | `leagues` | `data/{lg}.json` 头部字段 | `id` | **维度表**，被 5–8 引用 |
| 2 | `hot_items` | `data/hot.json` | `id` | — |
| 3 | `news_items` | `data/news.json` | `id` | 靠 `league` 与 `matches` 对齐 |
| 4 | `matches` | `data/matches.json` | `id` | 靠 `league` 与 `news_items` 对齐 |
| 5 | `league_schedule` | `→ schedule` | `id` | `league_id → leagues.id`（**Day 22 起带 `season`**） |
| 6 | `league_standings` | `→ standings` | `id` | `league_id → leagues.id`（**Day 22 起带 `season` + `zone`**） |
| 7 | `league_players` | `→ players` / `scorers` | `id` | `league_id → leagues.id`（**Day 22 起带 `season`**） |
| 8 | `league_brackets` | `→ bracket` / `race` / `playoffs` | `id` | `league_id → leagues.id`（**Day 22 增加 `playoffs`**） |
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
**`UNIQUE(source_url)`** —— 唯一索引 `news_items_source_url_uniq`（**Day 18 新增**）：同一篇文章只允许入库一次，是 `POST /api/favorites` 防重的底层保证（见 §2.8）

**4. `matches`**
`id` TEXT PK · `league` TEXT NN · `home_team` / `away_team` TEXT NN · `match_time` TIMESTAMP NN · `status` TEXT NN `CHECK(未开始/进行中/已结束/延期/取消)` · `home_score` / `away_score` INT · `round` / `venue` TEXT · `data_source` TEXT NN · `updated_at` TIMESTAMPTZ NN
约束：`status='已结束'` 时两个比分必须非空（防「状态说打完、比分为空」）

**5. `league_schedule`**
`id` TEXT PK · `league_id` TEXT NN **FK→leagues** · **`season` TEXT NN DEFAULT `''`（Day 22 新增）** · `match_date` DATE NN · `match_time` TEXT · `status` TEXT NN `CHECK(五种)` · `home_team` / `away_team` TEXT NN · `home_score` / `away_score` INT · `round` / `venue` TEXT

**6. `league_standings`**
`id` TEXT PK · `league_id` TEXT NN **FK** · **`season` TEXT NN DEFAULT `''`（Day 22 新增）** · **`zone` TEXT（Day 22 新增：篮球「东部/西部」，足球留空）** · `rank` INT NN · `team_name` TEXT NN · `played` INT · `wins` INT NN · `draws` INT · `losses` INT NN · `goals_for` / `goals_against` INT · `points` INT · `points_diff` TEXT · `win_rate` TEXT
`UNIQUE(league_id, season, zone, rank)`（**Day 22 放宽**：原为 `(league_id, rank)`，会把 NBA 东部第 1 与西部第 1 判为冲突）

**7. `league_players`**
`id` TEXT PK · `league_id` TEXT NN **FK** · **`season` TEXT NN DEFAULT `''`（Day 22 新增）** · `board` TEXT NN `CHECK(players/scorers)` · `rank` INT NN · `player_name` / `team_name` TEXT NN · `points` / `rebounds` / `assists` NUMERIC(5,1) · `apps` INT · `goals` INT · `rating` NUMERIC(3,1)
`UNIQUE(league_id, season, board, rank, player_name)`（Day 21 放宽加 `player_name`——真实射手榜名次大量并列；**Day 22 再并入 `season`**）

**8. `league_brackets`**
`id` TEXT PK · `league_id` TEXT NN **FK** · `season` TEXT NN · `kind` TEXT NN `CHECK(bracket/race/playoffs)`（**Day 22 增加 `playoffs`**：NBA 季后赛对阵既非晋级树也非争冠形势） · `payload_json` JSONB NN · `updated_at` TIMESTAMPTZ NN
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

### 3.6 Day 22 结构变更：给两张核心表加 `note` 与 `is_deleted` 列

**① `note`（PATCH 要能改「备注」）**：清单要求 PATCH 能改「**备注**」，但 `matches` 与 `news_items` 按 Day 16 的设计都没有备注列 → Day 22 补上。迁移脚本 [`db/migrate-day22.sql`](db/migrate-day22.sql)，**幂等**（`ADD COLUMN IF NOT EXISTS`，可重复执行）：

```sql
ALTER TABLE public.matches    ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.news_items ADD COLUMN IF NOT EXISTS note TEXT;
COMMENT ON COLUMN public.matches.note    IS '运营备注（Day 22 新增）：人工补充说明，允许为空';
COMMENT ON COLUMN public.news_items.note IS '运营备注（Day 22 新增）：人工补充说明，允许为空';
```

**② `is_deleted`（软删除，余力加练）**：迁移脚本 [`db/migrate-day22-soft-delete.sql`](db/migrate-day22-soft-delete.sql)，同样幂等：

```sql
ALTER TABLE public.matches    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.news_items ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
```

> 为什么是 `NOT NULL DEFAULT false` 而不是可空：可空就得写 `IS NOT TRUE` 这种三值逻辑，
> 容易漏；`NOT NULL DEFAULT false` 让过滤条件永远是干净的一句 `is_deleted = false`，
> 而且**存量行不需要回填**（加列时默认值直接生效）。
> **暂不建索引**：两张表都是几十行量级，全表扫描比走索引还快；等数据量上来再加部分索引
> `... WHERE is_deleted = false`。

执行（**两个脚本都要跑**，顺序无关）：

```bash
tcb db execute -e ross-d2gimwy406e0d6812 --sql "$(cat db/migrate-day22.sql)"
tcb db execute -e ross-d2gimwy406e0d6812 --sql "$(cat db/migrate-day22-soft-delete.sql)"
```

> ⚠️ 上面这种 `"$(cat ...)"` 写法只在 Git Bash 里稳；**PowerShell / cmd 会把含括号的 SQL 截断**
> （踩过：`Argument list too long` / 报语法错）。PowerShell 下请改用 node 直传 argv，
> 或把每条 `ALTER` 单独粘进 SQL 编辑器。

> 只加列、不改既有列、不加约束 → 对 Day 16 的种子数据与 Day 18 的写入接口**零影响**（新列为 `NULL` / `false`，`INSERT` 不带它就取默认值）。两个脚本均已在线上执行成功。
> `db/schema.sql` 已同步补上这四列 —— 新环境一次建表就带它们，不用再跑迁移。

### 3.7 Day 22 改删接口的验证方法（清单要求 6）

**A. curl 命令**（macOS / Linux / Git Bash；Windows PowerShell 把 `\` 换成 `` ` `` 或写成一行）：

```bash
BASE=https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com

# ---- PATCH：改一条比赛（状态进行中 → 已结束，补比分） ----
curl -X PATCH "$BASE/api/matches" \
  -H 'Content-Type: application/json' \
  -d '{"id":"20260924-nba-01","status":"已结束","homeScore":112,"awayScore":108,"note":"手工改一条试试"}'

# ---- GET：按 id 读回，确认改后值已生效 ----
curl "$BASE/api/matches?id=20260924-nba-01"

# ---- DELETE：删掉它 ----
curl -X DELETE "$BASE/api/matches" \
  -H 'Content-Type: application/json' \
  -d '{"id":"20260924-nba-01"}'

# ---- GET：再读一次，应返回 404（这就是「删掉之后 GET 不再返回」） ----
curl -i "$BASE/api/matches?id=20260924-nba-01"

# ---- 资讯表同款（把路径换成 /api/news，字段换成 title/summary/note/status） ----
curl -X PATCH "$BASE/api/news" \
  -H 'Content-Type: application/json' \
  -d '{"id":"20260929-n01","title":"改后的标题","note":"Day22 备注"}'
curl -i "$BASE/api/news?id=20260929-n01"
```

PowerShell 版（同一件事）：

```powershell
$base = 'https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com'

Invoke-RestMethod -Method Patch -Uri "$base/api/matches" -ContentType 'application/json' `
  -Body '{"id":"20260924-nba-01","status":"已结束","homeScore":112,"awayScore":108}'

Invoke-RestMethod -Method Delete -Uri "$BASE/api/matches" -ContentType 'application/json' `
  -Body '{"id":"20260924-nba-01"}'
```

> Postman 同理：新建请求 → 选 PATCH/DELETE → `Body` 选 `raw` + `JSON` → 粘贴上面的 JSON；`GET` 用 `Params` 加一行 `id`。

**B. 用数据库 `SELECT` 验证「真的改了 / 真的删了」**（不靠接口自报）：

> ⚠️ **软删除之后，这段的期望值变了，别照旧抄**：`DELETE` 跑完，
> `SELECT count(*)` **不是 0** —— 行还在库里。要验的是**两句话同时为真**：
> 「带过滤查是 0 行」+「不带过滤查还是 1 行且 `is_deleted = true`」。

```sql
-- 改之前：记下这一行的值
SELECT id, status, home_score, away_score, note, updated_at
FROM   matches WHERE id = '20260924-nba-01';

-- 跑完 PATCH 后再查：status / 比分 / note / updated_at 都应变成新值
SELECT id, status, home_score, away_score, note, updated_at
FROM   matches WHERE id = '20260924-nba-01';

-- 跑完 DELETE 后再查（**软删除**）：
--   不带过滤 → 仍是 1 行，is_deleted = true   ← 数据没丢
SELECT id, is_deleted FROM matches WHERE id = '20260924-nba-01';

--   带接口用的那条过滤 → 0 行              ← 查询侧看不见（所以 GET 才 404）
SELECT count(*) FROM matches WHERE id = '20260924-nba-01' AND is_deleted = false;

-- 整表行数：删一条**不会**少 1（行没走），只是「已删除行数」+1
SELECT count(*) AS 总行数,
       count(*) FILTER (WHERE is_deleted) AS 已删除行数
FROM   matches;

-- 找回：把标记改回去，它立刻重新出现在查询里
UPDATE matches SET is_deleted = false WHERE id = '20260924-nba-01';

-- 真要彻底清掉（软删除不会自己消失，只能这样清）
DELETE FROM matches WHERE id = '20260924-nba-01';
```

CLI 一步到位：

```bash
tcb db execute -e ross-d2gimwy406e0d6812 \
  --sql "SELECT id,status,home_score,away_score,note FROM matches WHERE id='20260924-nba-01'"
```

**C. 本次实测结果（Day 22 验收）**

| 项 | 结果 |
| -- | ---- |
| 本地全分支回归（两个云函数，42 条断言） | ✅ **42 PASS / 0 FAIL**（含 400/404/405/500 各分支、安全阀「无过滤条件拒绝改删」、**软删除 5 条**） |
| 公网闭环（POST 造数 → GET → PATCH → GET → DELETE → GET 404） | ✅ **28 PASS / 0 FAIL** |
| PATCH 后 SELECT 复核 | ✅ `status` 由「进行中」→「已结束」，比分 58:52 → 112:108，`note` 写入，`updated_at` 刷新 |
| DELETE 后 SELECT 复核（**软删除**） | ✅ 不带过滤：1 行且 `is_deleted = true`（数据没丢）· 带过滤：0 行（查询侧看不见）——**两句同时成立才算软删除** |
| 找回验证 | ✅ `restoreById` 之后再 `GET` 又 200，且值仍是 PATCH 改过的新值 |
| 数据无残留 | ✅ 验证后 `matches` = 9 行、`news_items` = 16 行，两表 `is_deleted = true` 的行数均为 **0**（回到操作前原状） |
| 前端二次确认弹窗 | ✅ 截图见 `docs/day22-3-delete-confirm-dialog.png` |

**截图**（清单要求「两张：PATCH 后的数据变化 + DELETE 后该条不再返回」）：

| 图 | 文件 | 内容 |
| -- | ---- | ---- |
| ① | `docs/day22-1-patch-before-after.png` | 检查台「修改与删除」面板的**改动对比表**（改前 / 改后两列，变化格高亮）+ 接口返回的 `before`/`after` |
| ② | `docs/day22-2-delete-gone.png` | 删除接口回传的**被删整行 JSON** + 页面自动复查 GET 的 **404 中文提示**（「未找到该比赛记录」）——该条已消失的直接证据 |
| 附 | `docs/day22-3-delete-confirm-dialog.png` | 前端**二次确认弹窗**「确定要删除这条记录吗？」，含「删除之后这条数据就从库里消失了，没有回收站、也无法撤销」的警示 |

> 三张图都是**页面自证**：在公网 `checkup.html` 上用真实浏览器操作新加的「④ 修改与删除」面板完成，不是手工造的图。

### 3.8 Day 22 追加：联赛四表补「赛季 / 分区」维度 + 四个联赛真数据全量入库

**背景（两件事撞到一起）**

1. 联赛页（`league.html`）的 Tab 是**按赛季切换**的——NBA 有 `25-26`（已完整）与 `26-27`（进行中）两季，排行还分东部/西部。但 Day 16 建表时按「单赛季 + 单一榜单」设计，`league_schedule` / `league_standings` / `league_players` **都没有 `season` 列**，`league_standings` 的 `UNIQUE(league_id, rank)` 还会把「东部第 1 与西部第 1」判成冲突。
2. NBA 真数据只在静态 `data/nba.json`（1826 场赛程 / 东西部排行 / 晋级图 / 季后赛），**没进库**；同时核查发现英超/欧冠/CBA 的真数据（`db/league_data.sql`）**也不在库里**——线上 `league_*` 一直是 Day 16 的种子示例（每联赛 5 行），Day 21 的库重置（`seed.sql` 会 `TRUNCATE`）把先前导入冲掉了。

**A. 结构变更** — [`db/migrate-day22-league-season.sql`](db/migrate-day22-league-season.sql)（幂等，已在线上执行）

```sql
ALTER TABLE league_schedule  ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT '';
ALTER TABLE league_standings ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT '';
ALTER TABLE league_standings ADD COLUMN IF NOT EXISTS zone   TEXT;   -- 东部 / 西部，足球留空
ALTER TABLE league_players   ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT '';
-- 唯一键放宽（原键会把真实数据拒掉）
ALTER TABLE league_standings DROP CONSTRAINT IF EXISTS league_standings_rank_uniq;
ALTER TABLE league_standings ADD  CONSTRAINT league_standings_rank_uniq
  UNIQUE (league_id, season, zone, rank);
ALTER TABLE league_players   DROP CONSTRAINT IF EXISTS league_players_rank_uniq;
ALTER TABLE league_players   ADD  CONSTRAINT league_players_rank_uniq
  UNIQUE (league_id, season, board, rank, player_name);
-- kind 增加 playoffs
ALTER TABLE league_brackets  DROP CONSTRAINT IF EXISTS league_brackets_kind_check;
ALTER TABLE league_brackets  ADD  CONSTRAINT league_brackets_kind_check
  CHECK (kind IN ('bracket', 'race', 'playoffs'));
-- 存量行回填赛季
UPDATE league_schedule  SET season = '26-27' WHERE season = '';
UPDATE league_standings SET season = '26-27' WHERE season = '';
UPDATE league_players   SET season = '26-27' WHERE season = '';
```

> `season` 用 `''`（而非 `NULL`）当「未知」哨兵，是为了让它能进 `UNIQUE` 约束——PG 里 `NULL` 在唯一键中互不相等，会让约束失去意义。

**B. 四个联赛真数据入库**（执行顺序不能颠倒）

| 步骤 | 脚本 | 内容 |
| -- | ---- | ---- |
| 1 | `db/migrate-day22-league-season.sql` | 加 season/zone 列、放宽唯一键、回填存量（必须先跑，后面两个脚本都依赖 `season` 列） |
| 2 | `db/league_data.sql` | 恢复英超（40 场）/ 欧冠（36 场）/ CBA（30 场）真数据；末尾「§9 赛季回填」把其 `26-27` 赛季补上 |
| 3 | `db/league_data_nba.sql` | NBA 真数据：赛程 **1826** 场（25-26 = 1463 / 26-27 = 363）、排行 **30** 行（25-26 东西部各 15）、晋级图 + 季后赛对阵 **2** 行、`matches` 的 NBA 段 **13** 条 |

- 两个 `*_data*.sql` 都**先按联赛清空再插入**，可重复执行。
- 生成器：`scripts_cloudbase/fetch-leagues.py`（英超/欧冠/CBA）与 **`scripts_cloudbase/build-nba-db.py`（NBA，Day 22 新建）**；后者读 `data/nba.json` + `data/matches.json` 产出 `db/league_data_nba.sql`。
- ⚠️ **执行方式**：`league_data_nba.sql` 约 530KB，超过 `tcb db execute --sql` 单次 argv 上限（~32KB，Windows 报 `Argument list too long`）→ 必须**按语句边界切段执行**（本次用 `_day22_tmp/run-sql-chunked.cjs`，28 段）。
- ⚠️ **`seed.sql` 会 `TRUNCATE` 这四张表** → 重跑 seed 后必须重跑本表 B 的三个脚本，否则四个联赛又退回 5 行示例。这是**当前已知的脆弱点**（seed 不是「可叠加」的）。

**C. 顺手修掉的一处不一致**

`db/league_data.sql` 由 `fetch-leagues.py` 生成，而生成器此前**不产出 `season`**——加列后它插入的行会走 `DEFAULT ''`，赛季信息静默丢失。本次把生成器（`build_sql`）与已生成的快照一起补上赛季回填，避免「重跑生成器 → 赛季丢失」。

---

## 4. 前端改造对照（Day 18 已执行）

前端原来 `fetch` 的是本地文件，现在改成先打接口、失败降级本地示例数据：

| 现在（接口） | 降级（本地） | 涉及文件 | Day 18 状态 |
| ---- | ---- | ---- | ---- |
| `GET /api/hot` | `data/hot.json` | `js/home.js` | ✅ Day 17 已接 |
| `GET /api/news` | `data/news.json` | `js/news.js`、`js/news-detail.js`、`js/app.js` | ✅ 已接（接口未实现，实际走降级） |
| `GET /api/matches` | `data/matches.json` | `js/matches.js` | ✅ 已接（接口未实现，实际走降级） |
| `GET /api/leagues/:id` | `data/<lg>.json` | `js/league.js` | ✅ 已接（接口未实现，实际走降级） |
| `POST /api/favorites` | —（写操作无降级） | `js/news-detail.js` | ✅ Day 18 新增：详情页「收藏这条」按钮 |

**⚠️ 地址必须用绝对域名，不能用 §0.1 里那种相对路径 `/api/xxx`**（本节原文如此写，Day 18 实测纠正；**Day 20 已把这个地址收口到 `js/api-config.js`**）：

```js
// js/api-config.js —— 接口地址的唯一出处（Day 20 新建）
// 本地预览 → API_ORIGIN = ''            → 请求 /api/xxx，由 serve.mjs 同源代理转发
// 线上托管 → API_ORIGIN = 'https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com'
```

```js
const FUNC_ORIGIN = window.API_ORIGIN;   // ← 各页面统一取这个，不再各自写死域名
```

原因：前端托管在**静态托管域名**（`...tcloudbaseapp.com`），接口在**云函数网关域名**（`...app.tcloudbase.com`），**两者不同域**。用相对路径会打到静态托管自身、拿不到接口（404 → 一律降级）；本地预览（`serve.mjs` / `127.0.0.1`）也没有 `/api` 路由。所以统一写死函数网关地址，跨域由 CloudBase 网关自动回 CORS 头（Day 17 实测已生效、**Day 20 实测确认白名单无 `*`**）。将来若把接口挂到同域自定义路径，可改回相对路径。

**统一取数写法**（5 个文件同一套，见 `js/news.js` 顶部注释）：

```js
async function fetchFromAPI(path) {
  const res = await fetch(FUNC_ORIGIN + path, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const body = await res.json();
  if (!body || body.ok !== true) throw new Error((body?.error?.message) || '接口返回异常');
  return body.data;          // ← 包络解一层：原来裸数组，现在取 body.data
}
```

> 响应包络从「裸数组/裸对象」变成 `{ok, data, meta}`，前端取值处加一层 `res.data`——这是 Day 18 的主要改动量，**5 个文件全部完成**。
>
> **字段改名未做**，理由见 §0.1 的 Day 18 执行口径说明。所以现在 `news.js` 等文件里仍是 `it.digest_date`、`m.home_team`；等对应读接口上线那天跟着一起改。

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
| 公网部署 + 真库验证 | ✅ 已完成（`docs/cloudbase-deploy-day17.md`） |
| `/api/favorites` | ❌ 顺延至 Day 18 |
| 跨域配置 | ❌ Day 20 |

**Day 18（第 3 周第 4 天）**

| 项 | 状态 |
| -- | ---- |
| `POST /api/favorites` 写入接口 | ✅ `cloudfunctions/favorites/index.js`（零依赖，HTTP API 方式访问 PG） |
| `GET /api/favorites` 读回接口 | ✅ 同函数，按 HTTP 方法分支 |
| 网关路由 `/api/favorites` | ✅ 已写入 `cloudbaserc.json`（→ `function:favorites`） |
| `news_items` 唯一索引 | ✅ `news_items_source_url_uniq (source_url)`（线上已建） |
| 必填校验 + 中文错误信息 | ✅ 一次性收集全部缺失字段再返回 |
| 防重复（两层） | ✅ 预查 + 唯一索引兜底，均返回 `200` + `created:false` |
| 真库写入 + 读回验证 | ✅ 行数 9→10，`GET /api/favorites` 读回该行；重复提交行数不变 |
| 前端接入接口层（5 文件） | ✅ 换绝对域名 + 解包络 + 本地降级（字段名暂不改，见 §0.1） |
| 详情页收藏按钮 | ✅ `js/news-detail.js` + `css/news.css`，真实浏览器点击验证通过 |
| 服务端日志 | ✅ 单行 JSON（`[api] {...}`），加练项 |
| `PATCH` / `DELETE` | ❌ 第 4 周 |
| 跨域配置 | ❌ Day 20 |

**Day 19（第 3 周第 5 天）**

| 项 | 状态 |
| -- | ---- |
| 后端分层重构（查库代码从接口文件拆进 `shared/`） | ✅ `cloudfunctions/shared/{pg,hotItemsRepository,…}.js` |
| 分层文档 | ✅ `docs/layers-day19.md` + `layers-day19.svg` |
| 提交 | ⏳ 本地 `27a8031`，**未推送**（远端仍 `e47237a`） |

**Day 20（第 3 周第 6 天）**

| 项 | 状态 |
| -- | ---- |
| 跨域可用性确认（白名单 / 无 `*` / 预检 204） | ✅ 实测确认，白名单含自有静态托管域名 |
| 本地域名加白名单 | ❌ 体验版限制，改用 `serve.mjs` `/api/*` 同源代理 |
| 前端从 mock 切真实接口 | ✅ `js/api-config.js` 统一出口；`js/home.js` 改读 `API_ORIGIN` |
| 页面去 mock 字样 + 三平台副标题 | ✅ 页脚说明改写；`<h1>` 下加副标题 |
| 「最近更新」显示真实抓取时间 | ✅ 后端 `latestFetchedAt()` + 前端格式化 |
| 接口检查台页 | ✅ `checkup.html` / `css/checkup.css` / `js/checkup.js` |
| 静态托管重新构建上传 | ✅ `build-publish.mjs` → 28 个文件；新增 `build-functions.mjs` 修 `../shared` 打包坑 |
| 公网逐项验证 | ✅ 12 项清单全过（`docs/cloudbase-deploy-day20.md` §4） |
| `/api/news`、`/api/matches`、`/api/leagues/:id` 读接口 | ⏳ 仍占位 |
| `PATCH` / `DELETE` | ❌ 第 4 周 |
| 提交 | ⏳ 本地，**未推送**（等零确认；与 Day 19 一起上） |

**Day 22（第 4 周第 3 天）**

| 项 | 状态 |
| -- | ---- |
| `note` 列迁移（`matches` + `news_items`） | ✅ `db/migrate-day22.sql`（幂等），线上已执行 |
| `PATCH /api/matches` | ✅ `cloudfunctions/matches/index.js` + `shared/matchesRepository.js` |
| `DELETE /api/matches` | ✅ 同函数（按方法分流） |
| `PATCH /api/news` | ✅ `cloudfunctions/news/index.js` + `shared/newsItemsRepository.js` |
| `DELETE /api/news` | ✅ 同函数 |
| `GET /api/matches?id=` / `GET /api/news?id=` | ✅ 按 id 取单条（供改删验证；列表读仍占位） |
| 接口层共用零件 | ✅ `shared/httpKit.js`（包络 / 日志 / body 解析 / id 校验 / 405 / 统一 500） |
| **安全阀：拒绝无过滤条件的改删** | ✅ `shared/pg.js` —— 少写 `eq.` 条件直接报错，防误改/误删整表 |
| id 不存在的中文说明 | ✅ 404 +「未找到该比赛记录 / 未找到该体坛速览记录」 |
| 删除后复查 | ✅ `data.verifiedGone` + `meta.message`，不靠返回 200 当证据 |
| 前端二次确认弹窗 | ✅ `checkup.html` 原生 `<dialog>`，改前/改后对比表一并加上 |
| 网关路由 | ✅ `/api/matches`→`function:matches`、`/api/news`→`function:news`（均 `enableAuth:false`） |
| 公网部署 | ✅ 两个云函数已部署，5 条路由均 `WEB_SCF` |
| 本地全分支回归 | ✅ 42 PASS / 0 FAIL（含软删除 5 条） |
| 公网四类操作闭环 | ✅ 28 PASS / 0 FAIL（POST→GET→PATCH→GET→DELETE→GET 404 + 软删除 4 条） |
| 改删真实生效（SELECT 复核） | ✅ 见 §3.7 C |
| **软删除（`is_deleted`）** | ✅ 已补做（余力加练）：标记 + 查询跳过 + `restoreById` 找回 + `favorites` 复活配套（§2.11） |
| **联赛四表补 `season` / `zone`** | ✅ §3.8 A（`db/migrate-day22-league-season.sql`，线上已执行；唯一键同步放宽） |
| **四个联赛真数据全量入库** | ✅ §3.8 B（NBA 赛程 1826 + 排行 30 + 晋级图/季后赛 2 + matches 13；英超/欧冠/CBA 106 场恢复） |
| **静态 JSON 字段统一为 camelCase** | ✅ §0.1：7 个 `data/*.json` + 6 个读取端 JS + 3 个生成端脚本（共 99 处） |
| 批量操作 | ❌ 清单明确「今日不做」 |
| 用户系统 | ❌ 清单明确「今日不做」 |
| 提交 | ✅ 已推送（两个提交，均归 Day 22）：`b0993c2` 改删接口 + 软删除；`1e16da5` 联赛板块接入 NBA 真实数据。**追加改动待零确认后再推** |

**仍待办（不阻塞完成标准）**：Day 15 的同伴手机验证与三张截图归档；Day 16 的控制台「表数据页」截图；Day 19 与 Day 20 的推送。

> ⚠️ **运维提醒（Day 22 追加）**：`db/seed.sql` 会对四张 `league_*` 表 `TRUNCATE`。重跑 seed 之后，必须按 §3.8 B 的顺序重跑三个脚本，否则四个联赛会退回各 5 行示例数据。
