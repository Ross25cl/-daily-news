---
name: verify-project
description: 《每日体坛速览》的发布前检查清单 + 执行器。当需要在上线 / 推送 / 交付前对项目做一次整体自检（跨域与域名、重复写入与数据一致性、数据库执行、接口错误与安全、页面与渲染纪律、环境变量与部署、公网可用性），或要复盘「这个坑我们是不是踩过」时使用。产出逐项 PASS / FAIL / SKIP + 证据；自带一个「故意做坏的样本项目」用来自证不会虚报通过。
---

# 每日体坛速览 · 发布前检查（verify-project）

> **这个 Skill 是什么**：把本项目 Day 1–24 真实踩过的坑，固化成 **25 条可执行的检查项**。
> 发布前跑一遍，逐项给 `PASS / FAIL / SKIP` + 证据，避免旧坑重犯。
>
> **它不做什么**（Day 25 明确不做）：不做成 CI 流水线、不自动部署、不自动改代码。
> 它是一个**人（或 AI）在发布前手动跑一次**的门禁。

---

## 一、怎么跑

在项目根目录：

```bash
# ① 全量检查（默认对当前项目）
node skills/verify-project/check.mjs

# ② 自检：对「故意做坏的样本项目」跑，验证检查器不会虚报通过
node skills/verify-project/check.mjs --self-test

# ③ 机器可读（给脚本/后续流水线用）
node skills/verify-project/check.mjs --json

# ④ 检查别处的项目副本
node skills/verify-project/check.mjs --root <目录>
```

**退出码**：`0` = 无 FAIL；`1` = 有 FAIL；`2` = 自检失败（**结论不可信**，宁可炸也别报通过）。

**什么时候跑**：

| 场景 | 是否跑 |
| --- | --- |
| 改动云函数 / 网关路由 / `cloudbaserc.json` 之后，`tcb deploy` 之前与之后 | ✅ 跑 |
| 改前端页面、CSS、`data/*.json` 之后 | ✅ 跑 |
| 改 `db/*.sql`、跑过 `seed.sql` 之后 | ✅ 跑 |
| 只要推送就要跑一次（把 FAIL 一起报给零，别闷着推） | ✅ 跑 |
| 只改文档 / README | 不必跑 |

---

## 二、25 个检查项总表

| ID | 检查什么 | 执行命令（可单独手跑） | 通过标准 |
| --- | --- | --- | --- |
| **A1** | 前端没有裸相对接口调用 | `grep -rnE "fetch\(['\"\`]/api/" js *.html tools` | 命中 0 处（注释不算） |
| **A2** | 线上接口走网关绝对域名 | `grep -n "https://" js/api-config.js` | ≥1 个 `*.app.tcloudbase.com`，且不拿 `*.tcloudbaseapp.com` 当接口地址 |
| **A3** | 接口域名全局一致 | `grep -rhoE "https://[a-z0-9.-]+\.app\.tcloudbase\.com" js *.html \| sort -u` | 去重后恰好 1 个值 |
| **A4** | 不引用防盗链图源 | `grep -rn "sports3.gtimg.com" js data *.html` | 命中 0 处 |
| **A5** ★ | 公网 CORS 判据（看头不看码） | `curl -sS -D - -o /dev/null -H "Origin: <白名单域名>" <网关>/api/health` | 白名单 Origin 回 `access-control-allow-origin`；非白名单 Origin 仍 200 但**不回**该头 |
| **B1** | seed 的破坏性清表有书面警示 | `grep -in truncate db/seed.sql README.md api-contract.md` | seed 含 `TRUNCATE` 时，README 必须带 ⚠ 警示、api-contract 必须写明重放顺序 |
| **B2** | `source_url` 有唯一约束 | `grep -n "UNIQUE (source_url)" db/schema.sql` | 命中 ≥1 处 |
| **B3** | 收藏两层防重 | `grep -n "findBySourceUrl\|23505\|created: false" cloudfunctions/favorites/index.js` | 前置查询 + `23505` 兜底**都在** |
| **B4** | 软删除的两个例外没被「统一加过滤」 | `grep -A6 "function findBySourceUrl\|function countByDigestDate" cloudfunctions/shared/newsItemsRepository.js` | 两个函数体内 `is_deleted` 过滤条件数 = 0 |
| **C1** | 无 MySQL 方言 | `grep -rniE "auto_increment\|ENGINE *= *InnoDB" db` | 命中 0 处 |
| **C2** | `migrate-*.sql` 新增列已同步进基线 | `grep -h "ADD COLUMN IF NOT EXISTS" db/migrate-*.sql; grep -c season db/schema.sql` | 每个新增列名都能在 `db/schema.sql` 找到 |
| **C3** | 导入脚本不清表 | `grep -rniE "^[[:space:]]*(TRUNCATE\|DROP[[:space:]]+TABLE)" db` | 除 `seed.sql` / `schema.sql` / `migrate-*.sql` 外，命中 0 处 |
| **D1** | 错误文案收口 | `grep -L "js/api-error.js" *.html` | 凡加载 `js/` 脚本的页面都引 `js/api-error.js`，且它导出 `ApiError` |
| **D2** | 响应体不含后端错误原文 | `grep -rn "err.message" cloudfunctions` | 每处 `err.message` 都只在日志调用 / `reason:` / `dbBody` / `.test(` 路径上 |
| **D3** ★ | 密钥扫描 0 命中 | `node scripts_cloudbase/scan-secrets.mjs` | 退出码 0（工作区 + 全部 Git 历史） |
| **D4** | 密钥隔离 | `git log --all --name-status -- .env` | 输出为空；且 `.env.example` 被 git 跟踪 |
| **D5** | 改/删有 `eq.` 安全阀 | `grep -n "hasFilter\|eq\." cloudfunctions/shared/pg.js` | 存在「无 `eq.` 条件就拒绝」的分支 |
| **E1** | `hidden` 与 `display` 不打架 | `node skills/verify-project/check.mjs` | 凡带 `hidden` 的元素，其类的 `display` 规则选择器主体必须含 `:not([hidden])` |
| **E2** | 页面资源引用完整 | `grep -ohE '(src\|href)="(js\|css)/[^"]+"' *.html \| sort -u` | 引用的本地 js/css 文件全部存在 |
| **E3** | 兜底数据可解析 | `node -e "require('fs').readdirSync('data').forEach(...)"` | 每个 `data/*.json` 都能 `JSON.parse` 且非空 |
| **F1** | `envVariables` 字段名正确 | `grep -n "envVariables\|environmentVariables" cloudbaserc.json` | 合法 JSON；不含 `environmentVariables` |
| **F2** | 函数与路由一一对应 | `node -e "…cloudbaserc.json…"` | 每个路由 target 都能在 `functions[]` 找到，且每个函数都有路由 |
| **F3** | 构建脚本登记全 | `grep -n FUNCTIONS scripts_cloudbase/build-functions.mjs` | 所有云端函数都在 `FUNCTIONS` 数组里 |
| **F4** ★ | 网关路由是 WEB_SCF 型 | `tcb routes list -e <envId>` | 每条 `/api` 路由的 Resource type 都是 `WEB_SCF` |
| **G1** ★ | 公网接口可用 | `curl -s <网关>/api/health` … | 5 个接口均 HTTP 200 且 `ok === true` |

★ = 需要公网或 CLI，环境不具备时**报 SKIP**（不等于通过）。

---

## 三、三条判据纪律（每条都是踩出来的）

1. **SKIP 不等于 PASS。**
   「查不到 / 跑不起来 / 拿不到凭据」必须显式报 SKIP，不允许静默算通过。
   判据永远不用「条数为 0」，而用「**该有的东西在不在**」——本项目 Day 22 就出过
   「比对脚本匹配 0 条却说完全一致」的假结论。
2. **静态检查一律先剥注释再匹配。**
   注释里写着「不要用相对路径」「xxx.tcloudbaseapp.com 是静态托管域名」都是正常的，
   拿注释判 FAIL 就是误报。`stripJs / stripSql / stripCss / stripHtml` 四个剥离器是所有静态项的前置。
3. **判据看「有效对象」，不看字符串出现过。**
   CSS 里 `.related .news-card p { display:none }` 的主体是 `p`，不是 `.related`；
   拿整条选择器去匹配「带 hidden 的 .related」就是误报。E1 因此只取**选择器主体**（最后一段复合选择器）比对。

---

## 四、那 25 条分别治什么病（出处 Day）

| ID | 治的旧伤 |
| --- | --- |
| A1 / A2 / A3 | Day 17 ⑥ / Day 20：前端相对路径打到静态托管自身 → 页面显示「本地备用数据」 |
| A4 | Day 24：腾讯 `sports3.gtimg.com` 队徽 Referer 防盗链 → 浏览器 403 静默不显示（Node 直连却 200） |
| A5 | Day 20 板块①：白名单外的请求**也回 200** —— 判据必须看响应头有没有 ACAO |
| B1 | Day 21 真事故：`seed.sql` 的 `TRUNCATE` 冲掉联赛真数据，直到 Day 22 才发现 |
| B2 / B3 | Day 18：重复收藏必须「先查 + 23505 兜底」两层，只有一层并发时会冒 500 |
| B4 | Day 22：「统一给软删除加个过滤」在 `countByDigestDate` / `findBySourceUrl` 上是**错的** |
| C1 | Day 16：任务清单按 MySQL 写，实际环境是 PostgreSQL 17 |
| C2 | Day 22：`schema.sql` 声称已同步、其实没有 `note` 列 |
| C3 | Day 16/22：大 SQL 切段执行；导入脚本必须纯 INSERT，清表只能由 seed 干 |
| D1 | Day 23：三类错误收口到中文文案，7 个页面 24 处裸报错全部替换 |
| D2 | Day 23：原兜底把 `err.message` 拼进响应体，会把上游原文甚至环境变量名带出去 |
| D3 | Day 23：密钥扫描器第一版报「漂亮的假 0」（`git grep` fatal 被当成没命中） |
| D4 | Day 23：`.gitignore` 的 `.env.*` 把 `.env.example` 一起忽略了 |
| D5 | Day 22：PostgREST 的 `PATCH`/`DELETE` 不带条件会命中整表 |
| E1 | Day 24 真 Bug：`.search-clear{display:flex}` / `.breadcrumb{display:flex}` 压过 UA 的 `[hidden]{display:none}` |
| E2 | Day 24：`hidden` 属性的切换失效与资源引用，都是「线上才炸」的那类 |
| E3 | 前端会直读 `data/*.json` 兜底；文件坏了页面直接白屏 |
| F1 | Day 17 ①：`envVariables` 写成 `environmentVariables`，CLI **不报错、静默忽略** → 变量为 None（最费时间的一条） |
| F2 / F3 | Day 17 ② / Day 19 / Day 20：`tcb fn deploy` 不建网关路由；`shared/` 打包漏掉导致网关 443 空响应 |
| F4 | Day 17 ③：`tcb fn deploy --path` 建的是 SCF 型路由 → `FUNCTIONS_PARAM_INVALID` |
| G1 | Day 19：网关 443 + `content-length: 0` 最容易被误判成「部署成功」；部署后还要等 40–60 秒冷启动 |

---

## 五、自检：怎么证明它**不会虚报通过**

只有「跑出来是绿的」不算数 —— 得先证明**它坏的时候会红**。

`skills/verify-project/fixtures/bad/` 是一个**故意做坏的样本项目**：前端写了裸相对 `fetch('/api/…')`、
`api-config.js` 拿静态托管域名当接口地址、CSS 给带 `hidden` 的类写了 `display` 却不写 `:not([hidden])`、
`seed.sql` 有 `TRUNCATE` 而 README 没有警示、`schema.sql` 缺唯一约束与新增列、收藏只做了一层防重、
`cloudbaserc.json` 写成 `environmentVariables` 且路由对不上函数、云函数把 `err.message` 拼进响应文案、
`data/*.json` 里塞了一个坏 JSON……

```bash
node skills/verify-project/check.mjs --self-test
```

**期望**：20 个静态项全部 FAIL；只要**任何一项仍报 PASS**，就是漏报（虚报通过）→ 退出码 2，结论作废。
另外 5 个 LIVE / Git 项在坏样本里没有环境，应报 SKIP —— 若它们报了 PASS，说明判据是空转的。

> 这就是本日「你故意弄坏哪一项来验证 Skill 不会虚报通过」的答案：
> **不是弄坏一项，是把 20 项能静态判定的都做坏一遍，逐项要求它必须红。**

---

## 六、维护约定

- **新增检查项**：在 `check.mjs` 里 `check({...})` 追加，同时在 `fixtures/bad/` 补一个对应的坏样本，
  并把 `fixture` 标为 `'FAIL'`（或 `'SKIP'`）。**没配坏样本的检查项等于没被验证过。**
- **发现误报**（真项目明明是对的却报 FAIL）：先修判据，别改项目去迁就检查器。修完把原因写进对应检查项的注释。
- **发现漏报**（坏样本没被查出来）：一律记入本文件第五节的坏样本清单，并补进 `fixtures/bad/`。
- **不要**把 `check.mjs` 接成 CI 或写成自动部署钩子（Day 25 范围外）；它是发布前**手动**跑一次的门禁。

---

## 七、备注：本次实跑发现的两点（非阻塞，留给零拍板）

1. **接口地址仍散落在 5 个文件**：`js/api-config.js`（Day 20 定的唯一出处）+ `app.js` / `league.js` /
   `matches.js` / `news-detail.js` / `news.js` 各自写死了同一个网关地址。
   当前 A3 校验「值去重后恰好 1 个」→ 通过，没有实际风险；但将来换网关地址要改 6 处。
2. **`run-sql-chunked.cjs` 未入库**：它被 `_day*_tmp/` 的规则挡在仓库外（现在只在 `_day22_tmp/` 里）。
   清单里把它称作「可复用脚本」，但下一台机器 clone 下来拿不到。本次未动，等零定。
