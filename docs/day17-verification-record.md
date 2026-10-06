# Day 17 公网验证记录 · `/api/hot` 上线核实

| 项目 | 内容 |
| ---- | ---- |
| 日期 | 2026-10-05 部署；**2026-10-06 补记核实** |
| 目的 | 补齐 Day 17「API Key 公网验证」的书面记录与证据 |
| 结论 | ✅ **Day 17 的验证在 10-05 当天已全部跑通**（见 [`cloudbase-deploy-day17.md`](./cloudbase-deploy-day17.md) §4 表格 1–6 项均为 ✅）。本文件是**事后核实与归档**，不是未完成事项。 |

---

## 0. 先说清楚这笔「旧账」到底是什么

Day 17 手册 §4「今天还差什么」里，第 1–6 项**当时就已是 ✅**，只有第 7 项「提交 + 推送」标注了 ⏳（等零确认后执行，当天已完成推送）。

后来被记成「Day 17 API Key 公网验证记录还挂着」，**实际是措辞遗留**——真实验证早已做完，缺的只是**把当时的验证结果单独归档成一份可查的记录**。本文件补的就是这一块。

---

## 1. 部署与配置核实（Day 17 完成项）

| 项 | 内容 | 状态 |
| -- | ---- | ---- |
| 服务端 API Key | 控制台 → 环境管理 → API Key 配置 → 服务端 API Key 创建 | ✅ 已创建 |
| 环境变量注入 | `cloudbaserc.json` → `favorites` / `api` 函数的 **`envVariables`**（注意不是 `environmentVariables`） | ✅ `CB_ENV_ID` + `CB_API_KEY` |
| 云函数部署 | `api` 函数（零依赖，Node 原生 https 访问 PG） | ✅ 已部署 |
| 网关路由 | `/api/hot` → `function:api`，类型 **`WEB_SCF`** | ✅ 已落地 |

> ⚠️ 路由类型必须是 `WEB_SCF`。用 `tcb fn deploy --path` 建出来的是 `SCF` 型 → 访问报 `FUNCTIONS_PARAM_INVALID`。
> 正确做法：只跑 `tcb deploy --only gateway`（读 `cloudbaserc.json` 的 `gateway.routes`）。

---

## 2. 公网验证结果（Day 17 当天实测）

接口地址：

```
https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com/api/hot
```

| # | 请求 | 期望 | 实测 |
| - | ---- | ---- | ---- |
| 1 | `GET /api/hot` | `200` + 三平台数据 | ✅ `200` |
| 2 | `GET /api/hot?platform=hupu&limit=5` | `200`，5 条虎扑 | ✅ `200` |
| 3 | `GET /api/hot?platform=weibo` | `400 BAD_REQUEST` | ✅ `400`（白名单外） |
| 4 | `GET /api/hot?limit=999` | `200`（兜底到上限 50） | ✅ `200` |
| 5 | `POST /api/hot` | `405 METHOD_NOT_ALLOWED` | ✅ `405` |

**真库验证（证明读的是真数据库，不是写死的）**：控制台把 `hupu-1` 的 `heat` 由 `198` 改成 `999999` → 刷新接口，返回值跟着变 → **改回 `198` 还原**。✅

---

## 3. 2026-10-06 复测（确认线上还活着）

Day 18 收尾时复测了一遍，全部仍然正常：

| 探测 | 结果 |
| ---- | ---- |
| `GET /api/health` | `200` · `{"ok":true,"service":"Daily Sports Express"}` |
| `GET /api/hot?platform=hupu&limit=2` | `200` · `{"ok":true,"data":{"platforms":[{"id":"hupu","name":"虎扑",…` |
| `GET /index.html`（静态托管） | `200` |
| `GET /matches.html` | `200` |
| `GET /news.html` | `200` |
| `GET /league.html?lg=nba` | `200` |

→ 公网入口、网关路由、静态托管**六项全 200**，Day 15 与 Day 17 的线上成果都还在。

---

## 4. 归档结论

| 项 | 状态 |
| -- | ---- |
| Day 17 API Key 创建 | ✅ 已完成（10-05） |
| Day 17 公网验证（5 分支） | ✅ 已完成（10-05） |
| Day 17 真库验证（改值 + 还原） | ✅ 已完成（10-05） |
| Day 17 验证记录归档 | ✅ **本文件补齐** |
| Day 17 提交 + 推送 | ✅ 已完成（`47de810`） |

**这笔旧账到此关闭**，不需要零做任何操作。

> 唯一的例外：Day 17 当时声称的「两张截图」（接口返回 + 公网页面真实数据）没有作为文件入库，仅在本手册里描述了内容。若要补截图，用第 2 节的 5 条命令在浏览器里重跑一遍即可复现（线上仍可用）。
