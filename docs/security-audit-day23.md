# Day 23 · 安全审计与错误处理自查清单

> 对象：《每日体坛速览》全仓库（工作区 115 个文本文件 + Git 全部 40 个提交的每个版本）
> 范围：硬编码密钥、裸报错、非法输入、`.gitignore` 完整性
> 原则：**先审计、后修复**；每条都给「怎么验」，任何人都能照着复跑一遍拿到同样的结论。
> 本次不做：复杂异常处理框架、改业务逻辑。

## 0. 结论一览

| # | 检查项 | 结论 | 一句话证据 |
|---|---|---|---|
| 1 | 仓库里没有硬编码密钥 | ✅ | 密钥扫描器 9 类规则 → 工作区 0 条 · 历史 0 行 |
| 2 | `.env` 不在仓库且被忽略 | ✅ | `git check-ignore -q .env` → 0（忽略）；`git status --ignored` 里是 `!! .env` |
| 3 | 接手的人知道要填哪几个变量 | ✅ | `.env.example` 进库、内容全是 `<占位>`，无真值 |
| 4 | 密钥只从环境变量读，不写死在代码里 | ✅ | `cloudbaserc.json` 用的是 `{{env.CB_API_KEY}}` 占位，不是值 |
| 5 | Git 历史里从未提交过真密钥 | ✅ | 40 个提交逐版本扫描 → 历史 0 行（**无需作废/轮换**） |
| 6 | 三类错误一律中文、不泄漏内部信息 | ✅ | 接口回归 24/24（不连库）· 42/42（连库） |
| 7 | 非法/畸形输入返回 400 中文，不再冒 500 | ✅ | 空体、缺字段、坏 id、畸形 `%` 转义 4 种输入均有 400 断言 |
| 8 | `.gitignore` 完整 | ✅ | 覆盖 `.env`、`node_modules/`、`.cloudbase-*`、`_day*_tmp/` |
| 9 | （加练）每条请求一行日志 | ✅ | `[api] {"event":"request","method":…,"path":…,"status":…,"ms":…}` |

---

## 1. 密钥（上线红线，优先级最高）

### 1.1 仓库里有没有硬编码密钥

**做法**：写了 `scripts_cloudbase/scan-secrets.mjs`，按「值」而不是按「变量名」判 —— 变量名叫 `API_KEY` 是正常的，值长得像真 Key 才是问题。9 条规则：JWT / CloudBase Key、GitHub 令牌、OpenAI 风格 Key、腾讯云 SecretId、阿里云 AccessKeyId、Slack 令牌、OpenSSH/PKCS 私钥块、硬编码 Bearer、硬编码口令赋值。

**验证**：

```bash
node scripts_cloudbase/scan-secrets.mjs
```

预期输出 `合计：工作区 0 条 · 历史 0 行`，退出码 0。

**为什么这个「0」可信**（这是本次最较真的一处）：第一版扫描器把 `git grep` 的报错也当成「没命中」吞掉了，跑出个漂亮的假 0。现在它会做两件事自证：

- **规则自检**：9 条规则各自拿一段自己的样例跑一遍，必须命中，否则报「结论不可信」（退出码 2）。
- **控制查询**：拿一个必然命中的模式（`[0-9]`）去扫历史，必须扫得到 —— 证明搜索通路是活的，历史里的 0 是真的没有，不是命令没跑起来。

> 小插曲：自检样例字符串本身就是密钥形态，一开始被扫描器自己命中（自报 11 条）。改成 `'eyJ'+'hbGciOiJ…'` 拼接后，源码里不再出现完整特征串，运行时值仍完整 —— 扫描器不能一边查密钥一边自己带一个。

### 1.2 `.env` 有没有进仓库

**验证**：

```bash
git check-ignore -q .env; echo $?      # → 0，表示「被忽略」
git status --porcelain --ignored | grep env   # → !! .env（忽略） / ?? .env.example（待提交）
```

本机确实存在 `.env`（1638 字节，含真 Key），但 git 看它是 `!!`（ignored），从未被 `add`。

### 1.3 接手的人知不知道要填什么 —— `.env.example` 进库

**踩的坑**：`.gitignore` 里写了 `.env.*`（本意是防 `.env.local` 之类），但这条会把 `.env.example` **一起**忽略掉，模板根本提交不进去。加了一条例外：

```gitignore
.env
.env.*
!.env.example     # Day 23 实测：少了这行，模板提交不进去
```

**验证**：`git check-ignore -q .env.example; echo $?` → 应为 `1`（不被忽略）。或直接看 `git status` 里 `.env.example` 是 `??`。

**内容审查**：`.env.example` 里 4 个变量全是 `<占位>` 写法（`TCB_ENV_ID=<环境 ID…>`、`CB_API_KEY=<粘贴完整 Key>`），没有任何真值 —— 它是要提交的，提交了也不能泄漏。

### 1.4 密钥怎么读（不在代码里写死）

| 位置 | 值从哪来 | 验证方法 |
|---|---|---|
| 云函数运行时（`shared/pg.js`） | 环境变量 `CB_API_KEY` / `CB_ENV_ID` | 缺 Key 时接口回 500 中文，且响应体不含变量名 —— 见 §2 的泄漏词断言 |
| 部署时（`cloudbaserc.json`） | `{{env.CB_API_KEY}}` / `{{env.TCB_ENV_ID}}` 占位，由 CLI 注入 | `grep -n "CB_API_KEY" cloudbaserc.json` → 看到的必须是 `{{env.…}}`，不是值 |
| 本地跑测试 | 本机 `.env`（被忽略） | `test-api-local.cjs --with-db` 读它 |

`cloudbaserc.json` 里 4 个函数（api/matches/news/favorites）虽然都各写了一遍 `CB_API_KEY` 映射，但映射的是 `{{env.CB_API_KEY}}` 这个**引用**，仓库里没有值。

### 1.5 Git 历史里有没有提交过真密钥

**做法**：扫描器对 40 个提交的**每个版本**（不是只扫当前 `HEAD`）跑一遍 9 类规则。

**结论**：工作区 0 条、历史 0 行 —— **历史上从未提交过真实密钥，因此无需作废/轮换**。

**万一将来发现真密钥，正确的处理顺序**（只删代码 = 没删干净，历史里还在）：

1. 先去服务商控制台**作废**该凭据、**重新生成**一把（这一步不可省，历史一旦推出去就等于公开）；
2. 把新值写进云函数环境变量（CloudBase 控制台 → 函数 → 环境变量）；
3. 把新值写进本机 `.env`（`.env` 本来就不进仓库，不用改）；
4. `git add` 改动（代码里若残留旧值，改成读环境变量）；
5. **重跑** `node scripts_cloudbase/scan-secrets.mjs` 确认回到 0；
6. 若旧值只出现在还没推的本地提交里，`git commit --amend` 就能抹掉；**已经推出去过的**，作废凭据是唯一有效的补救，改写历史（filter-repo）只是附加动作。

---

## 2. 三类错误统一中文

### 2.1 三类错误是什么

全项目对外只承认三种「出错」（定义在 `cloudfunctions/shared/httpKit.js` 的 `KINDS` / `PUBLIC_MESSAGE`）：

| 类别 | 触发场景 | 状态码 | code | 对外中文 |
|---|---|---|---|---|
| ① 输入错 | 用户传的参数/请求体不合规 | 400 | `BAD_REQUEST` | `输入有误：<错在哪、怎么改>` |
| ② 网络错 | 连不上上游数据服务（超时/断连/5xx） | 503 | `UPSTREAM_UNREACHABLE` | `暂时连不上数据服务，请稍后重试。` |
| ③ 服务端错 | 其它未预期异常（含我们自己配错） | 500 | `INTERNAL_ERROR` | `服务端开小差了，请稍后重试。` |

> 404 不在三类里：它是**具体业务结果**（这条记录不存在），语义明确，文案由各接口自己说。

### 2.2 铁律：响应体里绝不出现 `err.message`

改之前兜底写的是：

```
'服务端开小差了，请稍后重试。（' + err.message + '）'
```

那个括号里就是数据库原文、`getaddrinfo ENOTFOUND …`、甚至变量名 —— 用户看不懂，还可能把表名、SQL 片段带出去。现在内部错只进日志（`failUnexpected` 里的 `reason` 字段），响应体只放固定中文。

**验证**：

```bash
node scripts_cloudbase/test-api-local.cjs            # 不连库：预期 24/24
node _day22_tmp/test-branches.cjs                    # 连库：预期 42/0
```

其中专门的泄漏断言用的是一组「内部词」正则：

```
API Key | CB_API_KEY | 环境变量 | ENOTFOUND | getaddrinfo | PostgREST
| SELECT | INSERT | relation | stack | at Object. | node:internal
```

任何一条命中即判 FAIL，输出会写 `泄漏词命中：无`。

### 2.3 前端也要说人话

后端说中文还不够 —— 网络不通时 `fetch` 会**直接抛**，用户看到的是浏览器原生的 `TypeError: Failed to fetch`；后端返回 500 时，老代码各页各写 `throw new Error('HTTP ' + res.status)`，用户看到的是「HTTP 500」。

新增 `js/api-error.js`，两个入口覆盖两种失败点：

- `ApiError.fromResponse(status, body)`：拿到了响应但状态/包络不对 —— **优先原样用后端的中文**（它更具体，如「缺少必填字段：title」），后端没说才按状态兜底。
- `ApiError.fromError(err)`：`fetch` 直接抛 —— 命中浏览器原生网络错特征串（`Failed to fetch` / `NetworkError` / `Load failed` / `ERR_CONNECTION…`）就换成「网络连不上，请检查网络后重试。」，否则原样用（我们自己抛的 Error，message 本来就是中文）。

7 个页面（index / checkup / digest / news-detail / matches / league / news）在 `api-config.js` 之前加载它；7 个脚本里 24 处裸报错全部替换（替换脚本用断言式写法：先确认旧片段出现次数再写盘，防改漏）。

**验证（真实浏览器，非模拟）**：`_day23_tmp/front-check.mjs` 逐个打开 6 个页面，断言每页都加载了 `api-error.js`、`window.ApiError.fromResponse` 可用、页面照旧渲染真实数据；再在页面里直接调三个翻译函数，断言输出为中文。实测 **23/23 PASS**。

**验证（「接口坏掉」现场）**：`_day23_tmp/front-check2.mjs` 把 `serve.mjs` 的副本网关地址改成连不上的地址（仍跑 8231 端口），制造真实的代理失败：

- 代理兜底本身回中文：`502 {"ok":false,"error":{"code":"UPSTREAM_UNREACHABLE","message":"暂时连不上数据服务，请稍后重试。"}}`，且不含内部词（3/3 PASS）；
- 首页据此回落本地备用数据，提示条实际显示：

  > 提示：接口暂时不可用，本页显示的是本地备用数据（非实时）。**原因：暂时连不上数据服务，请稍后重试。**

  24 条备用数据照常渲染（不白屏），提示条不是 `Failed to fetch`、不含 `HTTP xxx`（6/6 PASS）。

---

## 3. 非法输入与畸形输入

改前的问题：畸形请求一路冒到最外层兜底，被当成 500「服务端开小差了」—— 责任说反了，用户也拿不到任何可操作信息。

| 输入 | 改前 | 改后 |
|---|---|---|
| `DELETE /api/matches` 无 id | 500 兜底 | `400 输入有误：缺少参数 id：请指明要操作哪一条记录（例如 "20260924-nba-01"）。` |
| `PATCH /api/news` id 形态不合法 | 400（已是中文） | 同上，统一前缀：`输入有误：参数 id 格式不合法：「bad id!」。…` |
| 空请求体 | 500 / 一句含糊的错 | `400 输入有误：请求体是空的。请提交 JSON，例如 {…}。` |
| 请求体不是合法 JSON | 500 | `400 输入有误：请求体不是合法 JSON，请检查格式（应为 {…}）。` |
| `DELETE /api/matches/%E4%B8`（畸形 `%` 转义） | `500（URI malformed）` | `400 输入有误：id 里的百分号转义不完整（收到「%E4%B8」），无法解析地址，请检查后重试。` |

最后一条是本次新收口的：`decodeURIComponent` 遇到不完整的百分号转义会抛 `URIError`，这是「**用户传的地址有问题**」，不是服务端的锅。新增 `idFromPathSuffix()` 就地拦下、交回 `inputError`；同时给 `createServer` 里的 `new URL(req.url)` 加了 `try/catch`（原来这行在 try 之外，`req.url` 畸形时异常没人接，请求会挂住或直接断连）。

**验证**：上面每一条都是 `test-api-local.cjs` 里的一条断言（`【输入错】…` 开头的行）。

---

## 4. `.gitignore` 完整性

| 应当忽略 | 规则 | 验证 |
|---|---|---|
| 环境变量 | `.env`、`.env.*`（+ `!.env.example`） | `git status --ignored \| grep env` |
| 依赖 | `node_modules/` | `git check-ignore -v node_modules/a.js` |
| 部署临时产物 | `.cloudbase-publish/`、`.cloudbase-backup/`、`.cloudbase-build/` | 同上 |
| 每日临时工作区 | `_day*_tmp/` | `git check-ignore -v _day23_tmp/x.js` |
| 系统/编辑器 | `.DS_Store`、`Thumbs.db`、`.vscode/`、`.idea/`、`.workbuddy-preview/` | 同上 |

**注意 `_day*_tmp/`**：今天所有验证脚本、改前代码树、截图中间产物都在 `_day23_tmp/`，靠这条规则挡在仓库外；正式截图归档到 `docs/` 才进库。**提交前应确认 `git status` 里没有 `_day23_tmp/` 下的文件。**

---

## 5. （加练）请求日志

`httpKit.createServer` 里新增一行请求日志，挂在 `res` 的 `finish`/`close` 上 —— 正常分支、405、兜底 500 都只落一行，不用在每个 `return` 前各写一遍（写漏是迟早的事）。只记时间、方法、路径、状态码、耗时；**不记请求体、不记请求头**，免得把 Key 或用户内容带进日志。

**验证**：

```bash
PORT=9011 node cloudfunctions/health/index.js &
curl -s -o /dev/null http://127.0.0.1:9011/api/health
curl -s -o /dev/null -X POST http://127.0.0.1:9011/api/health   # 405
```

应看到（每个请求一行）：

```
[api] {"ts":"2026-10-11T09:20:58.944Z","event":"request","method":"GET","path":"/api/health","status":200,"ms":5}
[api] {"ts":"2026-10-11T09:20:59.271Z","event":"request","method":"POST","path":"/api/health","status":405,"ms":1}
```

---

## 6. 一条命令复跑全部检查

```bash
cd <项目根>

# 1) 密钥：应为「工作区 0 条 · 历史 0 行」，退出码 0
node scripts_cloudbase/scan-secrets.mjs

# 2) .env 被忽略 / .env.example 不被忽略
git check-ignore -q .env           && echo "OK  .env 已忽略"
git check-ignore -q .env.example   || echo "OK  .env.example 可提交"

# 3) 三类错误（不连库 24 条 / 连库 42 条）
node scripts_cloudbase/test-api-local.cjs
node _day22_tmp/test-branches.cjs

# 4) 前端中文话术（真实浏览器，需先起本地预览）
node _day23_tmp/front-check.mjs
node _day23_tmp/front-check2.mjs
```

## 7. 遗留 / 明确未做

- **未加**复杂异常处理框架、**未改**业务逻辑（按今日范围）。
- 可选回补项「Day 22 降级未完成的 DELETE 接口」**已具备**：`matches` / `news` 两个函数的 `allowedMethods` 已含 `DELETE`，且 `checkup.html` 有带二次确认的删除入口 —— 无需回补。
- 密钥扫描器与前端实测脚本目前放在 `scripts_cloudbase/`（扫描器，进库）与 `_day23_tmp/`（实测脚本，不入库）；若要长期留用，可把实测脚本也收进 `scripts_cloudbase/`。
