# 旧账 · 完成清单（给零）

> 2026-10-06 整理，同日更新三轮。
> Day 18 收尾时把 Day 15–17 的遗留项逐条核了一遍。
> **结论：4 笔全部关闭，无遗留。**

---

## 总览（最新）

| # | 旧账 | 谁做 | 状态 |
| - | ---- | ---- | ---- |
| 1 | Day 17 API Key 公网验证记录 | 我 | ✅ **已关闭**，见 [`day17-verification-record.md`](./day17-verification-record.md) |
| 2 | Day 15 截图归档 | 零已提供 → 我归档 | ✅ **已完成**，只留 1 张，见 [`cloudbase-deploy-day15.md`](./cloudbase-deploy-day15.md) §5.1 |
| 3 | Day 16 控制台「表数据页」截图 | 我（替代方案） | ✅ **已完成**，见 [`cloudbase-deploy-day17.md`](./cloudbase-deploy-day17.md) §3.3.1 |
| 4 | Day 15 同伴手机验证 | 零（已做） | ✅ **已完成**，见 [`cloudbase-deploy-day15.md`](./cloudbase-deploy-day15.md) §5.2 |

**全部关闭，无需再动。**

---

## ✅ 已完成（不用管）

### ① Day 17 验证记录

Day 17 的公网验证**在 10-05 当天就跑通了**（5 分支全过 + 真库改值验证 + 已还原），只是没单独归档，被后来记成了「待办」。已补齐：[`day17-verification-record.md`](./day17-verification-record.md)。

### ② Day 15 截图归档

零 2026-10-06 提供三张截图，**按零拍板只保留第 1 张入仓**（② 含公网访问入口、③ 含控制台账号信息，仓库 public，不入库）：

| # | 文件 | 内容 |
| - | ---- | ---- |
| 1 | `docs/day15-shot1-health.png` | 地址栏 + `/api/health` 返回 `{"ok":true,"service":"Daily Sports Express"}` |

已嵌入 `cloudbase-deploy-day15.md` §5.1，并把该手册的交付清单更新为「截图已归档」。

> ⚠️ **顺带更正一处**：控制台显示到期日是 **2027-04-23**，手册原记 `2027-04-03`（Day 15 当天抄错）。已按控制台复核更正（见该手册开头「实测结果」表）。

### ③ Day 16 控制台「表数据页」截图（我用替代方案做了）

原方案是你在控制台「数据库 → 表管理」里截一张。零 2026-10-06 拍板**由我代做**，走的是**等效证据图**：按控制台表页面布局绘制，表格里每一格都是 **PostgREST 只读查出来的真实行**（`news_items` 全 9 行、10 列，2026-10-06 查询）。

- 图：[`day16-console-table.png`](./day16-console-table.png)
- 已嵌入 [`cloudbase-deploy-day17.md`](./cloudbase-deploy-day17.md) §3.3.1（Day 16 建表的记录就挂在这份手册里）
- 它证的事见下：**库里确实有这些行、字段就这么长**

| 项 | 值 |
| -- | -- |
| 库 / 表 | `postgres-emxo9nse` · `public.news_items` |
| 行数 / 列数 | 9 行 · 10 列 |
| 数据来源 | PostgREST 只读查询（库里真实值，非手编） |

---

### ④ Day 15 同伴手机验证（零，2026-10-06 已完成）

把链接发给同伴，对方用手机打开正常：

- 链接：`https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/index.html`
- 结论：✅ 能打开
- 已记入 [`cloudbase-deploy-day15.md`](./cloudbase-deploy-day15.md) §5.2

> 证的是**公网对不受控的外部设备同样可达**，不是只有本机浏览器能开。Day 15 完成标准 ② 就此关闭。
