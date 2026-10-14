# Day 25 验证记录：发布前检查 Skill（verify-project）

> 日期：2026-10-13　起点提交：`9af8adb`（Day 24）
> 交付物：`skills/verify-project/`（`SKILL.md` + `check.mjs` + `fixtures/bad/`）
> 一句话：25 项检查对当前项目实跑全绿；把 20 项能静态判定的都**故意做坏一遍**，逐项都被查出来（0 虚报通过）。

---

## 一、这一天的学习问题：你故意弄坏哪一项来验证 Skill 不会虚报通过？

答案不是「弄坏一项」，而是 **把 20 项能静态判定的全部做坏一遍**，要求检查器逐项必须变红。

做法借的是本项目 Day 23 密钥扫描器已经踩熟的套路 ——「规则自检」：
每条规则先拿自己的样例跑一遍，跑不中就不下结论（退出码 2）。

于是 `skills/verify-project/fixtures/bad/` 是一个**故意做坏的样本项目**：

| 坏在哪 | 对应检查项 |
| --- | --- |
| 前端写了裸相对 `fetch('/api/hot')` | A1 |
| `api-config.js` 拿静态托管域名当接口地址 | A2 |
| 网关地址三处不一致（`api-config.js` / `league.js` / `news.js`） | A3 |
| 队徽指向腾讯防盗链图源 | A4 |
| `seed.sql` 有 `TRUNCATE` 而 README 无警示 | B1 |
| `schema.sql` 缺 `source_url` 唯一约束 | B2 |
| 收藏只做了一层防重（无 23505 兜底） | B3 |
| `countByDigestDate` 过滤了 `is_deleted` | B4 |
| `schema.sql` 用 `AUTO_INCREMENT`（MySQL 方言） | C1 |
| `migrate` 加了 `is_deleted` 但基线没同步 | C2 |
| `hot_sync.sql` 里也做清表 | C3 |
| `matches.html` 少加载 `js/api-error.js`，且 `api-error.js` 没导出 `ApiError` | D1 |
| `httpKit.js` 把 `err.message` 拼进响应文案 | D2 |
| `pg.js` 改/删没有 `eq.` 安全阀 | D5 |
| CSS 给带 `hidden` 的 `.search-clear` 写了 `display` 却不写 `:not([hidden])` | E1 |
| HTML 引了不存在的 `js/nope.js` | E2 |
| `data/news.json` 是坏 JSON | E3 |
| `cloudbaserc.json` 写成 `environmentVariables` | F1 |
| 路由指向 `function:ghost`，且 `news` 函数没有路由 | F2 |
| `build-functions.mjs` 的 `FUNCTIONS` 漏了 `news` | F3 |

另外 5 项（A5 公网 CORS、D3 密钥扫描、D4 Git 密钥隔离、F4 网关路由类型、G1 公网接口）
在坏样本里没有对应环境，**必须报 SKIP** —— 若它们报了 PASS，说明判据是空转的。

---

## 二、第一轮实跑（v1，未修正）

### 全量（对当前项目）

`PASS 21 · FAIL 2 · SKIP 2 · 共 25 项`，退出码 1 —— **其中 2 个 FAIL 全是误报**：

| 项 | 报 FAIL 的原因 | 性质 |
| --- | --- | --- |
| C3 | 把 `db/schema.sql` 开头的 `DROP TABLE IF EXISTS … CASCADE`（建表基线的幂等写法）当成「导入脚本清表」 | **误报** |
| D1 | 把零依赖的 `tools/entry.html`（不调接口、不引 `js/` 任何脚本）也要求加载错误文案库 | **误报** |

同时 A5、G1 报 SKIP。这两项本该能跑（公网是通的），排查后发现 **网关域名正则写错了**：

```
第一版  /https:\/\/[a-z0-9-]+\.app\.tcloudbase\.com/
实际域名 ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com
                                   ↑ 中间还有一层地域，第一版匹配不到
```

一个都匹配不到 → `gatewayUrl()` 返回 `null` → A5 / G1 被静默降级成 SKIP（**漏报 = 检查项被架空**）。

### 自检（对坏样本）

`期望 20 项 FAIL · 实际 FAIL 19 项 · PASS 1 · SKIP 5`
**虚报通过 1 项：A3** —— 同一个正则错导致「网关域名去重后 0 个值」→ `0 <= 1` → 误判 PASS。
退出码 2（自检失败，结论作废），符合设计预期：**它自己先炸了，而不是给一个假的绿。**

### 另外一处

`main()` 无条件调用 `selfTestVerdict()` —— 全量模式也打印了自检结论。属实现 bug。

---

## 三、修正内容（对应上面 3 错 1 bug）

| 改动 | 说明 |
| --- | --- |
| `GATEWAY_RE` → `/https:\/\/[a-z0-9.-]+\.app\.tcloudbase\.com/g` | 修漏报；同时救回 A5 / G1 / F4 |
| C3 检查范围收窄 | 排除 `seed.sql` / `schema.sql` / `migrate-*.sql`，只查「数据导入脚本」 |
| D1 检查范围收窄 | 只要求「加载了 `js/` 脚本的页面」引 `api-error.js` |
| `main()` 分流 | 仅 `--self-test` 打印自检结论；全量模式按有无 FAIL 返回 0 / 1 |

> 记法：**发现误报先改判据，别改项目去迁就检查器**（已写进 `SKILL.md` 第六节维护约定）。

---

## 四、第二轮实跑（修正后）

### 全量（对当前项目）

```
结果  PASS 25 · FAIL 0 · SKIP 0 · 共 25 项   （14.7s）
判定  ✅ 全部通过，可以发布
```

其中 3 项是真跑的 LIVE 检查，不是静态推断：

| 项 | 实测 |
| --- | --- |
| A5 | 白名单 Origin（`ross-…tcloudbaseapp.com`）→ 回 `access-control-allow-origin`；`https://evil.example.com` → **仍 200 但不回该头**（已验证 3 轮稳定） |
| F4 | `tcb routes list` 5 条 `/api` 路由全部 `WEB_SCF`，无 SCF 型误建 |
| G1 | `/api/health`、`/api/hot`、`/api/news`、`/api/matches`、`/api/favorites` 均 200 且 `ok === true` |

### 自检（对坏样本）

```
期望 20 项 FAIL · 实际 FAIL 20 项 · PASS 0 · SKIP 5
期望 5 项 SKIP · 实际 SKIP 5 项
20/20 项坏样本被逐条查出来，0 项虚报通过
判定  ✅ 自检通过
```

---

## 五、真实注入验证：故意把项目弄坏一处，看它红不红

自检跑的是「样本项目」。为排除「只在样本里灵」的可能，又对**真实项目**注入了一处历史上的真坑
（Day 17 ① 最费时间的那条）：

```
注入：cloudbaserc.json 的 "envVariables" → "environmentVariables"（4 处）
运行：PASS 24 · FAIL 1 · SKIP 0 · 共 25 项，退出码 1
      ✖ FAIL F1  cloudbaserc.json 必须写 envVariables（写成 environmentVariables 会被 CLI 静默忽略）
            证据  函数 5 个，其中声明 envVariables 的 0 个
            证据  发现错误字段名 environmentVariables（CLI 不报错、静默忽略 → 变量为 None）
还原：sha 前 765ebfeb7a472bf6 → 还原后 765ebfeb7a472bf6   ✅ 字节一致
      git status --porcelain cloudbaserc.json →「」        ✅ 工作区干净
```

**恰好 1 项 FAIL、其余 24 项不受影响** —— 说明判据既不漏报也不误伤。还原用内存写回 + sha 比对，
不依赖 `git checkout`，脚本无论成败都在 `finally` 里还原。

---

## 六、截图

| 文件 | 内容 |
| --- | --- |
| [day25-verify-injected-fail.png](day25-verify-injected-fail.png) | **主截图**：注入 1 处缺陷 → F1 被查出 → 已还原（含 sha / git status 校验） |
| [day25-verify-report.png](day25-verify-report.png) | 对当前项目全量实跑：25 项全过，含每项的执行命令、通过标准、证据 |
| [day25-verify-selftest.png](day25-verify-selftest.png) | 自检：20 项坏样本逐条报 FAIL，0 项虚报通过 |

---

## 七、本次未做（Day 25 范围外）与留待零拍板

1. **不做成自动化流水线**（今日明确不做）：`check.mjs` 是发布前手动跑一次的门禁，不接 CI、不做部署钩子。
2. **接口地址仍散落在 5 个文件**：`js/api-config.js`（Day 20 定的唯一出处）之外，`app.js` / `league.js` /
   `matches.js` / `news-detail.js` / `news.js` 各自写死了同一个网关地址。A3 校验「值去重后恰好 1 个」→ 通过，
   **当前无实际风险**；但将来换网关地址要改 6 处。是否收口，等零定。
3. **`run-sql-chunked.cjs` 未入库**：它被 `_day*_tmp/` 规则挡在仓库外（目前只在 `_day22_tmp/` 里）。
   检查清单把它称作「可复用脚本」，但换台机器 clone 下来拿不到。本次未动。
