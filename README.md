# 每日体坛速览

28days 计划项目：一个每天汇总体坛要闻、赛程比分与定时推送的速览页面。

> **2026-09-22（Day 4）**：产品由《每日资讯速览》聚焦转型为《每日体坛速览》，目标用户、功能范围与验收标准见 [PRD.md](PRD.md)。

## 当前版本

- **每日速览**（`index.html`）：聚合三个平台的热榜——**腾讯体育 · 虎扑 · 央视体育**。数据来自 CloudBase 数据库，由每日同步任务写入。
- **赛程比分**（`matches.html`）：NBA、英超比赛列表，可切换昨天 / 今天 / 明天，点击卡片展开详情。
- **资讯列表 / 详情**（`news.html` / `news-detail.html`）、**联赛板块**（`league.html`）：见各页说明。
- **接口检查台**（`checkup.html`）：一个页面看接口健康状态、核心表真实数据、并做一次写入测试（Day 20 新增）。

> **数据来源（Day 17 起）**：热搜数据由 `scripts_cloudbase/fetch-hot.ps1` 每日从三平台官网抓取、写入 CloudBase PostgreSQL，
> 前端通过云函数接口读取。**页面不再依赖本地 `data/*.json`**（它现在只在接口不可用时作为备用数据）。
> Day 17 起 `/api/hot` 走公网真库；Day 18 起 `/api/favorites` 可写入；Day 20 起前端全面切换到公网接口。
>
> 赛程 / 资讯 / 联赛三块目前仍读本地 `data/*.json`（对应接口 `/api/news`、`/api/matches`、`/api/leagues/:id` 尚在开发中）。
- 定时推送（F3）未开发，属后续天任务；录入工具 `tools/entry.html` 待补建。

## 运行方式

页面需要通过本地服务器访问——页面用 fetch 读取数据，直接双击 HTML 文件打开会被浏览器拦截。

**推荐用项目自带的 `serve.mjs`**（Day 20 起它带 `/api/*` 同源代理，本地也能看到**真实数据库数据**）：

```bash
node serve.mjs 8001
# 浏览器打开 http://localhost:8001/
```

> 端口可换；8000 被占用时换 8001。`serve.mjs` 会把 `/api/*` 请求转发到公网接口网关
> （体验版不允许把 `localhost` 加进 CORS 白名单，所以本地只能走同源代理）。

**不代理也能跑**：用任意静态服务器（如 `python -m http.server 8000`）起页面也可以，
但那样 `/api/*` 打不到接口，页面会**降级显示本地 `data/*.json` 备用数据**（页面会显式提示「接口暂时不可用」）。

> 提示：改动文件后页面没变化时，按 `Ctrl+F5` 强制刷新（浏览器会缓存旧文件）。

## 项目结构

```
28days/
├── index.html          # P1 首页：三平台热搜（虎扑/腾讯/央视）
├── matches.html        # P2 赛程比分页
├── news.html           # P3 资讯列表页（?cat=足球|篮球|综合）
├── news-detail.html    # P4 资讯详情页（?id=...）
├── league.html         # P5 联赛板块页（?lg=nba|cba|ucl|epl）
├── checkup.html        # 【Day 20】接口检查台（health / 核心表数据 / 写入测试 / 【Day 22】改与删）
├── digest.html         # 旧四板块速览页（Day 8 版迁出，暂无导航入口）
├── tools/entry.html    # 本地 JSON 录入表单
├── css/                # 分页样式：style / home / news / league / checkup
├── js/                 # 分页逻辑：home / matches / news / news-detail / league / theme / app / checkup
│   └── api-config.js   # 【Day 20】接口地址唯一出处（本地走相对路径、线上走网关绝对地址）
├── data/               # 备用数据（接口不可用时的降级）：hot / news / matches / {nba,cba,ucl,epl}.json
│                       #   【Day 22】字段已全站统一为 camelCase（此前 matches/news/hot 是蛇形）
├── serve.mjs           # 本地预览服务（【Day 20】新增 /api/* 同源代理）
│
├── cloudfunctions/     # 【Day 15】CloudBase 云函数
│   ├── health/         #   健康检查函数（GET /api/health）
│   ├── api/            #   【Day 17】业务读接口（GET /api/hot）
│   ├── favorites/      #   【Day 18】收藏写入 / 读回（POST·GET /api/favorites；【Day 22】加软删除复活）
│   ├── matches/        #   【Day 22】赛程表改删（GET·PATCH·DELETE /api/matches；删除为**软删除**）
│   ├── news/           #   【Day 22】资讯表改删（GET·PATCH·DELETE /api/news；删除为**软删除**）
│   └── shared/         #   【Day 19】跨函数共用数据访问层（零依赖，调 PG 的 HTTP API）
│       ├── pg.js               # 连接底座 + 【Day 22】安全阀（拒绝无过滤条件改删）
│       ├── httpKit.js          # 【Day 22】接口层共用零件（包络/日志/body/id 校验/405/500）
│       ├── matchesRepository.js    # 【Day 22】赛程表读写（【Day 22】加 softDeleteById / restoreById）
│       └── newsItemsRepository.js  # 【Day 19】资讯表读写（【Day 22】加改删 + 软删除）
├── scripts_cloudbase/  # 【Day 15】部署脚本
│   ├── fetch-hot.ps1       # 【Day 17】三平台热搜同步抓取
│   ├── run-fetch-hot.ps1   # 【Day 17】ASCII 启动器（绕开 PS 5.1 中文编码坑）
│   ├── test-api-local.cjs  # 【Day 17】接口分支本地验证
│   ├── build-publish.mjs   # 【Day 20】组装静态托管发布目录
│   ├── build-functions.mjs # 【Day 20】组装云函数自包含部署目录（修 ../shared 打包坑）
│   ├── fetch-leagues.py    # 【Day 21】英超/欧冠/CBA 真数据抓取 → db/league_data.sql
│   ├── build-nba.py        # 【Day 22】NBA 真数据抓取 → data/nba.json
│   ├── build-nba-news.py   # 【Day 22】NBA 真数据 → data/matches.json / data/news.json
│   └── build-nba-db.py     # 【Day 22】NBA 真数据 → db/league_data_nba.sql（入库用）
├── db/                 # 【Day 16】数据库脚本
│   ├── schema.sql          #   建表（10 张表）
│   ├── seed.sql            #   种子数据（⚠️ 会 TRUNCATE 四张 league_* 表，见 api-contract §3.8）
│   ├── hot_sync.sql        # 【Day 17】热搜同步产物（脚本生成，可重复执行）
│   ├── league_data.sql     # 【Day 21】英超/欧冠/CBA 真数据（【Day 22】末尾补赛季回填）
│   ├── league_data_nba.sql # 【Day 22】NBA 真数据入库（脚本生成；约 530KB，需切段执行）
│   ├── migrate-day22.sql   # 【Day 22】给 matches / news_items 各加 note 列（幂等）
│   ├── migrate-day22-soft-delete.sql   # 【Day 22 余力加练】两表各加 is_deleted 软删除标记（幂等）
│   └── migrate-day22-league-season.sql # 【Day 22】league_* 四表补 season / zone 并放宽唯一键（幂等）
├── cloudbaserc.json    # 【Day 15】CloudBase CLI 部署配置
├── api-contract.md     # 【Day 15 建，Day 16 表结构定稿，Day 20 补跨域，Day 22 补改删 + 软删除 + §3.8 联赛赛季维度】接口契约
├── docs/
│   ├── cloudbase-deploy-day15.md  # 【Day 15】部署手册
│   ├── cloudbase-deploy-day17.md  # 【Day 17】读接口部署与真库验证
│   ├── cloudbase-deploy-day18.md  # 【Day 18】写接口部署
│   ├── cloudbase-deploy-day20.md  # 【Day 20】切公网接口 + 跨域确认 + 检查台
│   ├── cloudbase-deploy-day22.md  # 【Day 22】PATCH / DELETE 上线 + 四类操作闭环 + 软删除（§8）
│   ├── dataflow.svg / structure.svg / views.md / usability-test-day14.md
├── skills/tiyu-daily/  # 录入用 Skill
├── research.md / PRD.md / TECH_DESIGN.md / AGENTS.md  # 项目文档
└── .env                # 本地调试密钥（已 gitignore，永不提交）
```

## 部署到公网（云开发 CloudBase）

第 2 周前的页面是本地预览（`node serve.mjs`）。从 **Day 15** 起接入腾讯云开发，公网可访问：

- 云函数：`/api/health`（健康检查，Day 15）· `/api/hot`（三平台热搜，Day 17）· `/api/favorites`（收藏写入/读回，Day 18）· `/api/matches`（赛程读 + **改/删**，Day 22）· `/api/news`（资讯读 + **改/删**，Day 22）
- 静态托管：上面那些 `.html` + `css/` + `js/` + `data/`

> **Day 22 起数据操作闭环**：读（GET）· 增（POST `/api/favorites`）· 改（PATCH）· 删（DELETE）四类全部可用，在接口检查台的「④ 修改与删除」面板可自助操作。

| 页面 | 公网地址 |
| ---- | ---- |
| 首页 | https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/index.html |
| 接口检查台 | https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/checkup.html |

完整步骤见 [day15](docs/cloudbase-deploy-day15.md) · [day17](docs/cloudbase-deploy-day17.md) · [day18](docs/cloudbase-deploy-day18.md) · [day20](docs/cloudbase-deploy-day20.md) · **[day22](docs/cloudbase-deploy-day22.md)**，接口约定见 [api-contract.md](api-contract.md)。

### 重新部署（Day 20 起的标准流程）

```bash
# 0) 结构变更（只加列、幂等；两个脚本都跑，顺序无关）
tcb db execute -e ross-d2gimwy406e0d6812 --sql "$(cat db/migrate-day22.sql)"
tcb db execute -e ross-d2gimwy406e0d6812 --sql "$(cat db/migrate-day22-soft-delete.sql)"

# 1) 静态托管：先组装发布目录（只含 html/css/js/data），再上传
node scripts_cloudbase/build-publish.mjs
tcb hosting deploy .cloudbase-publish -e ross-d2gimwy406e0d6812 --safe

# 2) 云函数：必须先组装「自包含」目录（含 shared/），否则线上函数启动即挂
node scripts_cloudbase/build-functions.mjs
tcb fn deploy api       --httpFn --dir .cloudbase-build/api       -e ross-d2gimwy406e0d6812 --force
tcb fn deploy favorites --httpFn --dir .cloudbase-build/favorites -e ross-d2gimwy406e0d6812 --force
# 【Day 22】新增两个函数（build-functions.mjs 的 FUNCTIONS 已含）
tcb fn deploy matches   --httpFn --dir .cloudbase-build/matches   -e ross-d2gimwy406e0d6812 --force
tcb fn deploy news      --httpFn --dir .cloudbase-build/news      -e ross-d2gimwy406e0d6812 --force
tcb deploy --only gateway -e ross-d2gimwy406e0d6812
```

> ⚠️ `"$(cat ...)"` 这种写法只在 Git Bash 里稳；**PowerShell / cmd 会把含括号的 SQL 截断**（踩过 `Argument list too long`）。
> 那种环境下改用 node 直传 argv，或把每条 `ALTER` 单独粘进 SQL 编辑器。

> ⚠️ **新增路由必须同时改两处**：`cloudbaserc.json` 的 `functions[]`（函数清单）与 `gateway.routes[]`（路由→函数），
> 然后 `tcb deploy --only gateway`。只部署函数不配路由 → 请求在网关层就 404（Day 18 结论：一个路由一个函数）。
> 反过来，**只改函数代码（路由不变）就不需要重跑 gateway**。

> ⚠️ **不要直接 `tcb fn deploy api`**：CloudBase CLI 打包时压缩包根目录 = 函数目录本身，
> `cloudfunctions/shared/` 会落在包外 → 函数启动报 `Cannot find module '../shared/pg'` → 公网返回 443 空响应。
> `build-functions.mjs` 会把 `shared/` 拷进函数目录并改写 `require` 路径。详见 [day20 手册 §3.2](docs/cloudbase-deploy-day20.md)。
>
> 部署成功后公网接口要等 **约 40–60 秒**冷启动才恢复，别急着重推。

### 跨域（CORS）

由 CloudBase 网关按「跨域安全域名白名单」处理，云函数**不写** CORS 头：

- 白名单已含本项目静态托管域名（`ross-…tcloudbaseapp.com`），**没有 `*`**；查看：`tcb cors list -e <envId>`
- 白名单**外**的 Origin 服务端也回 200，但**不带** `Access-Control-Allow-Origin` 头（浏览器侧才拦）→ 判断依据看**响应头**
- 本地 `localhost` **加不进**白名单（体验版限制）→ 本地用 `serve.mjs` 的 `/api/*` 同源代理绕过

### 云函数访问数据库的方式（Day 17 定案）

体验版（个人版）**不支持 PostgreSQL 的 TCP 直连**（内网互联不开放、公网直连打不开），
且 HTTP 云函数不能云端装 npm 依赖。因此云函数**零依赖**，用 Node 原生 `https`
调 CloudBase PG 的 **HTTP API（PostgREST）**：

```
https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/<table>?<查询参数>
Authorization: Bearer <服务端 API Key>
```

服务端 API Key 通过云函数**环境变量** `CB_API_KEY` 注入，**不进代码、不进仓库**。

## 数据库（Day 16 起）

第 3 周把示例数据搬进 CloudBase 云开发 **PostgreSQL**（库 `postgres-emxo9nse`，schema `public`）：

- `db/schema.sql`——建 10 张表（主键 / 外键 / CHECK 约束 / 字段注释），可重复执行；
- `db/seed.sql`——先清后插的种子数据，每张核心表 ≥5 行，可重复执行；
- `db/hot_sync.sql`——**【Day 17】三平台热搜同步数据**，由 `scripts_cloudbase/fetch-hot.ps1` 生成；
- 表结构、关联字段与接口的对应关系，见 [api-contract.md](api-contract.md) 第 3 节。

### 每日热搜同步（Day 17 起）

真实热搜数据来自三平台官网（虎扑 / 腾讯体育 / 央视体育），只取「标题 + 链接 + 热度」，
不存正文。同步命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts_cloudbase/run-fetch-hot.ps1
$sql = Get-Content db\hot_sync.sql -Raw -Encoding UTF8
tcb db execute -e ross-d2gimwy406e0d6812 --sql $sql
```

控制台 / CLI 的执行方式与 select 验证语句，见契约 §3.5。

## 数据更新方式

**热搜（`hot_items`，Day 17 起为真实数据）**：由 `scripts_cloudbase/fetch-hot.ps1` 每日抓取三平台官网后写入数据库，页面自动读到新数据。

**资讯 / 赛程 / 联赛（`news_items` / `matches` / `league_*`）**：对应接口尚未实现，前端暂读 `data/*.json` 备用数据。改法：

1. 用文本编辑器打开 `data/news.json` 或 `data/matches.json`；
2. 按现有条目的字段结构修改或追加（字段定义见 [TECH_DESIGN.md](TECH_DESIGN.md) 第 4 节：标题 ≤30 字、摘要 ≤60 字、只有 `status` 为 `published` 的条目会显示）；
3. 保存后刷新浏览器即可看到变化——页面按「今天日期 + 已发布」纯前端过滤；
4. 后续将改用本地录入表单 `tools/entry.html` 自动生成 JSON（TECH_DESIGN v1.3 录入方案），不再手写字段。

**验证数据是不是真的从库里来的**：打开[接口检查台](https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/checkup.html)，
看三块绿标 + 做一次写入测试；或按 [day20 手册 §4](docs/cloudbase-deploy-day20.md) 的清单逐项核对。

## 安全说明

- `.env` 文件存放本地密钥与配置（如未来的新闻 API Key）。
- 该文件已被 `.gitignore` 忽略，**永远不会上传到 GitHub**。
- 云函数的数据库密钥走**云函数环境变量** `CB_API_KEY`，**不进代码、不进仓库**；前端页面**不持有任何密钥**。
- `.cloudbase-build/`（云函数部署目录）、`.cloudbase-publish/`（静态发布目录）同样已 gitignore。
