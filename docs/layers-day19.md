# 后端目录结构说明（Day 19 分层重构后）

> 本文回答一个问题：**拆完之后，「查数据库」这段代码从哪移到了哪？**
> 答案：从两个云函数的 `index.js` 里，移到了 `cloudfunctions/shared/` 下的
> repository 文件（按业务表各一个）与连接底座 `pg.js`。

---

## 1. 重构后的目录结构

```
cloudfunctions/
├── api/                        # 【接口层】GET /api/hot
│   ├── index.js                #   只做：路由 · 参数校验 · 状态码 · 响应包络 · 日志
│   ├── package.json
│   └── scf_bootstrap
├── favorites/                  # 【接口层】POST + GET /api/favorites
│   ├── index.js                #   只做：路由 · 入参校验 · 防重流程编排 · 响应包络
│   ├── package.json
│   └── scf_bootstrap
├── health/                     # 【接口层】GET /api/health（Day 15，无数据库访问）
│   ├── index.js
│   ├── package.json
│   └── scf_bootstrap
└── shared/                     # 【Day 19 新建】数据访问层
    ├── pg.js                   #   ③ 连接底座：怎么连库（HTTPS/鉴权/超时/错误包装）
    ├── hotItemsRepository.js   #   ② 热搜表：怎么查 hot_items
    └── newsItemsRepository.js  #   ② 资讯表：怎么读写 news_items
```

## 2. 三层各自负责什么

| 层 | 文件 | 只负责 | 明确不负责 |
|---|---|---|---|
| ① 接口层 | `*/index.js` | 接请求、参数校验、调函数、返响应、日志 | 不认识表名/列名，不发 HTTPS |
| ② 数据访问层 | `shared/*Repository.js` | 表名/列名、查询条件、行↔字段映射、主键规则 | 不认识 req/res、不知道状态码 |
| ③ 连接底座 | `shared/pg.js` | 怎么连库（环境变量、API Key、HTTPS、超时） | 不认识任何业务表 |

**一句话的分层边界**：接口层描述「对外行为」，数据访问层描述「怎么取数」。

## 3. 「查数据库」这段代码的迁移对照

| 重构前的位置（Day 17/18） | 重构后搬到了哪 |
|---|---|
| `api/index.js` 里的 `ENV_ID / API_KEY / REST_HOST / REST_BASE` 常量 | `shared/pg.js`（唯一一份） |
| `api/index.js` 里的 `queryTable()` 函数 | `shared/pg.js` → 拆成 `selectRows()`（读）/ `insertRow()`（写） |
| `api/index.js` `handleHot` 里的 `queryTable('hot_items', {...})` 调用 | `shared/hotItemsRepository.js` → `findByPlatform(platform, limit)` |
| `api/index.js` `handleHot` 里的 `rows.map(r => ({rank:Number(...), ...}))` | `shared/hotItemsRepository.js` → `toItemJSON(row)` |
| `favorites/index.js` 里的 `FAV_TO_DB / DB_TO_FAV / FAV_COLUMNS` | `shared/newsItemsRepository.js` → `TO_DB / TO_API / COLUMNS` |
| `favorites/index.js` 里的 `queryTable()` 与 `insertRow()` | `shared/pg.js`（同一份，两个函数共用） |
| `favorites/index.js` 里的 `toFavoriteJSON()` | `shared/newsItemsRepository.js` → `toJSON()` |
| `favorites/index.js` 里的 `makeId()` | `shared/newsItemsRepository.js` → `makeId()` |
| `favorites/index.js` 里各处 `queryTable(news_items, ...)` | `shared/newsItemsRepository.js` → `findBySourceUrl / countByDigestDate / listRecent` |

## 4. 为什么 repository 要按「表」分文件

本项目上线的两条业务线各盯一张核心表：

- `/api/hot` → `hot_items` → `hotItemsRepository.js`
- `/api/favorites` → `news_items` → `newsItemsRepository.js`

按表分文件的好处：**一张表的查询规则只有一个出处**。
后续 `/api/news`、`/api/news/:id` 也要读 `news_items`，直接复用
`newsItemsRepository.js`，不必再抄一份查询。表结构变了只改一个文件。

## 5. 部署注意

`shared/` 是三个云函数的**共同依赖目录**（跨函数引用 `../shared/xxx.js`）。
CloudBase 部署时是**按函数目录打包**的，因此部署前需确保 `shared/`
与该函数一起上传。本项目用 `-r` 参数以项目根为根目录部署（见
`docs/cloudbase-deploy-day15.md`），`shared/` 会被一并带上去。

> 若某次部署后函数报 `Cannot find module '../shared/pg.js'`，
> 说明 `shared/` 没被打进包里 —— 检查部署命令的根目录参数，不要改成进
> 函数目录内部再部署。

## 6. 示意图

分层结构见 [`docs/layers-day19.svg`](./layers-day19.svg)。

## 7. 回归验证结果（Day 19）

| 接口 | 方法 | 验证结果 |
|---|---|---|
| `GET /api/health` | GET | 200 `{"ok":true,"service":"Daily Sports Express"}` |
| `GET /api/hot` | GET | 200，3 个平台（hupu/tencent/cctv5），条目形状 `{rank,title,heat,url,tag,video}` |
| `GET /api/hot?platform=hupu&limit=3` | GET | 200，1 个平台，≤3 条 |
| `GET /api/hot?platform=weibo` | GET | 400 `BAD_REQUEST` |
| `POST /api/hot` | POST | 405 `METHOD_NOT_ALLOWED` |
| `GET /api/favorites?limit=3` | GET | 200，10 字段形状与契约一致 |
| `POST /api/favorites`（合法） | POST | 200，`meta.created:true` |
| `POST /api/favorites`（重复 sourceUrl） | POST | 200，`meta.created:false`，id 与首次相同 |
| `PUT /api/favorites` | PUT | 405 `METHOD_NOT_ALLOWED` |

本地分支回归 14/14 通过，含真连库 17/17 通过。
