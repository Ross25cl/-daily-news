# Day 17 部署手册 · 读取接口 GET /api/hot 上线

| 项目 | 内容 |
| ---- | ---- |
| 文档名称 | 读接口部署手册（真实热搜入库 → /api/hot 上线 → 真库验证） |
| 撰写日期 | 2026-10-05（Day 17｜第 3 周） |
| 对应任务 | 板块② 接真实热搜数据 · 板块① GET 读接口 · 板块③ 部署 · 板块④ 真库验证 |
| 今日边界 | **不做**：业务写入接口（收藏写入属 Day 18）、改表结构 |
| 完成标准 | ① 公网 `GET /api/hot` 返回当日真实热搜 `{ok:true,data:[...]}` ② 控制台改一行数据、刷新后返回跟着变 |

---

## 0. 今天的关键发现：数据怎么从云函数到数据库

这一步决定今天的实现方式，先说结论：

> **CloudBase 体验版（个人版）不能用 TCP 直连 PostgreSQL，云函数只能走 HTTP API（PostgREST）。**

理由（查官方文档 + 社区 issue 确认）：

| 路径 | 体验版能否走通 | 说明 |
| ---- | ---- | ---- |
| PG 协议直连（`pg` 驱动 + 连接串） | ❌ | 内网互联个人版不支持；公网直连开关打不开 |
| HTTP API（PostgREST） | ✅ | 走 `https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/<table>` |
| SDK（`@cloudbase/node-sdk`） | ✅ | 但 HTTP 云函数不能云端装依赖 |

叠加第二个硬约束：**HTTP 云函数不支持云端自动装依赖**（Day 15 已踩过，`installDependency` 不生效）。

所以最终方案：**零依赖云函数 + Node 原生 `https` 调 HTTP API**。不需要任何 npm 包。

> 这正好也满足清单要求「SQL 必须参数化」：本层根本不拼 SQL —— 查询条件走 PostgREST 的查询参数（`?platform=eq.hupu`），由平台侧编译成参数化 SQL；用户输入只允许通过白名单校验后使用。

---

## 1. 板块② · 真实热搜数据入库（已完成）

### 1.1 三个数据源（官网公开页面，只取标题+链接）

| 平台 | 页面 | 提取方式 | 实测条数 |
| ---- | ---- | ---- | ---- |
| 虎扑 | `https://bbs.hupu.com/topic-hot` | `li.bbs-sl-web-post-body` → `a.p-title`；热度用回复数 | 49 |
| 腾讯体育 | `https://sports.qq.com/` | 内嵌 JSON `type1502` → title/createTime/isVideo | 7 |
| 央视体育 | `https://sports.cctv.com/` | `a[href*="/YYYY/MM/DD/"]` 新闻链接 | 7 |

**数据合规**（PRD 9.1 / tiyu-daily Skill 1.2）：只存「标题 + 原文链接 + 平台内热度」，**不存正文、不存图片**。

### 1.2 一键同步

在项目根目录 PowerShell 里执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts_cloudbase/run-fetch-hot.ps1
```

产物：`db/hot_sync.sql`（UTF-8 无 BOM，可重复执行——先按平台 DELETE 再 INSERT）。

> ⚠️ **为什么需要 `run-fetch-hot.ps1` 这个启动器**（踩坑记录）：
> Windows PowerShell 5.1 读**无 BOM 的 `.ps1`** 时按 ANSI(GBK) 解析，脚本里的中文会全部乱码、语法报错。
> `fetch-hot.ps1` 里中文注释多（这是好事，要给人看），所以配一个**纯 ASCII 启动器**，
> 由它用显式 UTF-8 读取正文再执行。以后凡是"带中文的 .ps1"，都走这个模式。

### 1.3 灌进数据库

```powershell
$sql = Get-Content db\hot_sync.sql -Raw -Encoding UTF8
tcb db execute -e ross-d2gimwy406e0d6812 --sql $sql
```

实测结果（2026-10-05 23:30）：

```
platform | 条数 | 最小名次 | 最大名次
 cctv5   |  7   |    1     |    7
 hupu    |  49  |    1     |    49
 tencent |  7   |    1     |    7
```

共 63 条真实数据，替换掉 Day 16 的 24 条种子。

---

## 2. 板块①③ · 获取 API Key 并部署 /api/hot

### 2.1 ⚠️ 这一步需要你本人操作（我代不了）

创建 API Key 需要扫码登录控制台。

1. 打开 **CloudBase 控制台** → 顶部选中环境 `ross-d2gimwy406e0d6812`
2. 左下角 **环境管理** → 中间菜单 **API Key 配置**
3. 页面上半部分是「客户端 Publishable Key」（今天**不用**这个）
4. 在下半部分 **服务端 API Key** 区域，点 **创建 API Key**
5. 填名称（例如 `tiyu-daily-server`），确认创建
6. **立即复制完整 Key**——明文只展示一次，关掉弹窗就再也看不到

> 安全红线（AGENTS.md 第五节 3）：这个 Key 有本环境读写权限，
> **绝不写进代码、绝不提交仓库**。下面的步骤把它注入到云函数环境变量里。

### 2.2 把 Key 注入云函数环境变量

在控制台配置（推荐，不会落盘）：

> 云函数 → `api` → 配置 → **环境变量** → 新增：
> - `CB_API_KEY` = 你刚复制的完整 Key
> - `CB_ENV_ID` = `ross-d2gimwy406e0d6812`（`cloudbaserc.json` 已声明，可覆盖）

### 2.3 部署

```powershell
# 规范启动脚本换行（Windows 上 git 会转 CRLF，会导致函数启动失败）
node scripts_cloudbase/normalize-eol.mjs

# 部署 api 云函数（HTTP 型）
tcb fn deploy api --httpFn -e ross-d2gimwy406e0d6812

# 关键：把 /api/hot 路由落到网关（只部署函数不配路由会 404）
tcb deploy --only gateway -e ross-d2gimwy406e0d6812
```

成功标志：

```
✔ 函数 api 部署成功
✔ 部署完成：1 个资源成功
   网关 /api/hot
   访问地址：https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com/api/hot
```

> **访问地址以命令输出为准**，不要自己拼。

### 2.4 ⚠️ 实测踩坑（2026-10-05 部署时全部踩到，逐条记下）

| # | 现象 | 根因 | 解法 |
| -- | ---- | ---- | ---- |
| 1 | 函数部署成功，但 `tcb fn detail api` 里 **环境变量是 None** | `cloudbaserc.json` 里字段名写成了 `environmentVariables`，CLI 认的是 **`envVariables`** | 改成 `envVariables`，重新 `tcb fn deploy` |
| 2 | 公网 `/api/hot` 返回 `INVALID_PATH`（网关层，未进函数） | 只跑了 `tcb fn deploy`，**没配网关路由** | 补 `tcb deploy --only gateway` |
| 3 | 用 `--path /api/hot` 试图建路由，路由表里 Resource type = **`SCF`**，访问报 `FUNCTIONS_PARAM_INVALID` | `--path` 建的是普通 SCF 型路由，**不是 Web 型（WEB_SCF）** | 删掉该路由（`tcb routes delete "*" -e <envId> -p /api/hot`），改用 `tcb deploy --only gateway`（读 `cloudbaserc.json` 的 `gateway.routes`，落成 WEB_SCF） |
| 4 | 路由通了、函数也执行了，但函数内 `path === '/api/hot'` 判断失败，返回「接口不存在：/」 | **网关转发时会剥掉路由前缀**：外部访问 `/api/hot`，函数内 `req.url` 是 `"/"` | 路由判断兼容 `'/api/hot'` / `'/hot'` / `'/'`（Day 15 的 health 已这么做，见其 `path === '/api/health' \|\| path === '/'`） |
| 5 | 公网页面显示的还是旧示例数据（`最近更新 09-25 22:30`） | 前端用相对路径 `/api/hot`，打到静态托管域名自身（无此路由）→ 404 → 降级本地 `data/hot.json` | 前端改用**绝对地址**直连函数网关域名（见 §3.5） |
| 6 | 不同域调用是否要自己写 CORS？ | — | **不用**。实测 CloudBase 网关自动处理 CORS：带 `Origin` 的预检返回 204 且回显 `access-control-allow-origin`，函数无需加头 |

> **核对路由类型的命令**：`tcb routes list -e <envId>`，看 `Resource type` 一列。
> 正确的 Web 型应为 **`WEB_SCF`**，和 `/api/health` 一致；出现 `SCF` 就是踩了坑 3。

---

## 3. 板块④ · 真库验证（今天截图 1）

### 3.1 打接口

浏览器新窗口打开（**地址栏 + 返回内容一起截**）：

```
https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com/api/hot
```

应看到：

```json
{
  "ok": true,
  "data": {
    "platforms": [
      { "id": "hupu", "name": "虎扑", "desc": "步行街 24 小时榜", "items": [ ... ] },
      { "id": "tencent", "name": "腾讯体育", "desc": "首页要闻热榜", "items": [ ... ] },
      { "id": "cctv5", "name": "央视体育", "desc": "官方要闻", "items": [ ... ] }
    ]
  },
  "meta": { "count": 63, "updatedAt": "..." }
}
```

**验收要点**：图里要能看到**真实热搜条目**（比如「梅德韦杰夫击球打中观众被判负」这种今天真实发生的事），不是 Day 16 那种「湖人加时险胜凯尔特人」示例数据。

### 3.2 加练项：查询参数（余力加练）

| 请求 | 预期 |
| ---- | ---- |
| `/api/hot?platform=hupu` | 只返回虎扑一个平台 |
| `/api/hot?platform=hupu&limit=3` | 虎扑只返回前 3 条 |
| `/api/hot?platform=weibo` | `400` · `{"ok":false,"error":{"code":"BAD_REQUEST","message":"platform 取值无效…"}}` |

### 3.3 证明"读的是真数据库"（完成标准 ③）

1. 浏览器打开 `/api/hot?platform=hupu&limit=3`，记下第 1 条的标题
2. 控制台 → 数据库 → SQL 编辑器，执行：

```sql
UPDATE public.hot_items
SET    title = '【真库验证】这条是我在控制台改的'
WHERE  platform = 'hupu' AND rank = 1;
```

3. 刷新浏览器（`Ctrl+F5`），第 1 条标题**应立刻变成**「【真库验证】这条是我在控制台改的」
4. **截图 2**：控制台 SQL 执行结果 + 刷新后的接口返回，同框
5. 验证完改回去（可选）：

```sql
UPDATE public.hot_items
SET    title = '看了好多天蓝白和罗粉互相咬，有个问题没搞明白'
WHERE  platform = 'hupu' AND rank = 1;
```

> 这一步是整个 Day 17 最有价值的一步——它把「接口」「数据库」「页面」三者串成一条链，
> 证明数据是**活的**，不是写死在代码里的。

### 3.4 前端联调：首页改调真实接口（Day 17 做）

`js/home.js` 的 `loadHot()` 改为：**先调 `GET /api/hot`，失败才降级 `data/hot.json`**（保证接口挂了页面也不白屏）。

接口返回 `{ ok, data:{platforms}, meta:{updatedAt} }`，前端渲染层要的是 `{ platforms, updated_at }`，在 `fetchHotFromAPI()` 里做适配。

**接口地址必须写绝对地址**（踩坑 5）：

```js
const FUNC_ORIGIN = 'https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com';
function apiHotURL() { return FUNC_ORIGIN + '/api/hot'; }
```

原因：前端在静态托管域名（`xxx.tcloudbaseapp.com`），接口在云函数网关域名（`xxx.app.tcloudbase.com`），**两者不同域**；相对路径会打到静态托管自身、拿不到接口。跨域由网关自动回 CORS 头，前端不用特殊处理。

前端改动后需重新部署静态托管（`tcb hosting deploy .cloudbase-publish -e <envId> --safe`），并注意 CDN 缓存（验证时加 `?v=时间戳` 或 `Cache-Control: no-cache`）。

### 3.5 排查顺序（卡住时）

| 现象 | 先查什么 |
| ---- | ---- |
| 500 +「服务端未配置 API Key」 | 云函数环境变量 `CB_API_KEY` 没配或没生效，配完**要重新部署**；另检查 `cloudbaserc.json` 字段名是不是 `envVariables` |
| 500 +「数据库返回 HTTP 401」 | Key 错了/过期了，重新创建 |
| 500 +「数据库返回 HTTP 404」 | 表名或 schema 不对，确认 `public.hot_items` 存在 |
| 404 `INVALID_PATH`（网关报，未进函数） | 路由没落地 → `tcb deploy --only gateway` |
| 400 `FUNCTIONS_PARAM_INVALID` | 路由类型错了（`SCF` 而非 `WEB_SCF`），删掉重建（踩坑 3） |
| 200 但「接口不存在：/」 | 函数路由没兼容网关剥前缀（踩坑 4） |
| 返回 200 但 `items` 全是空 | 库里没数据，回 1.3 重新灌 |
| 页面显示的是示例数据不是真实数据 | 前端走相对路径降级了（踩坑 5），改绝对地址 |
| 函数部署成功但访问超时 | `scf_bootstrap` 被转成 CRLF 了，跑 `normalize-eol.mjs` 后重部署 |

---

## 4. 今天还差什么

| # | 事项 | 状态 |
| - | ---- | ---- |
| 1 | **创建 API Key** | ✅ 已创建（用户提供） |
| 2 | **注入环境变量** | ✅ 已注入 `CB_API_KEY` + `CB_ENV_ID`（`cloudbaserc.json` → `envVariables`） |
| 3 | **部署 + 网关路由** | ✅ 函数 + `WEB_SCF` 路由均已落地 |
| 4 | **公网验证** | ✅ 5 分支全过（200/200/200/400/405） |
| 5 | **真库验证** | ✅ 控制台改 `hupu-1.heat` 198→999999，接口跟着变，已还原 |
| 6 | **两张截图** | ✅ 接口返回（含地址栏）+ 公网页面真实数据 |
| 7 | **提交 + 推送** | ⏳ 等零核对文件清单后执行 |

---

## 5. 本地验证记录（已做）

`scripts_cloudbase/test-api-local.cjs` 用 Node 原生 http 起服务打真实请求，覆盖分支：

```
PASS  platform 非白名单 → 400 BAD_REQUEST
PASS  未知路径 → 404 NOT_FOUND
PASS  POST → 405 METHOD_NOT_ALLOWED
PASS  无 API Key 时合法请求 → 500 且中文说明
PASS  limit 非法值被兜底（不报 400）
结果：全部通过 (5/5)
```
