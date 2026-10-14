# 回滚手册

| 项目 | 内容 |
| ---- | ---- |
| 文档名称 | 《每日体坛速览》回滚手册（Runbook） |
| 撰写日期 | 2026-10-14（Day 26｜第 4 周） |
| 适用版本 | v1.0 及之后（版本标记规范见 [发布清单](release-checklist-v1.0.md) §1） |
| 今日边界 | **只做实操**：静态托管回退。云函数回退与数据恢复**只写步骤、不实操**（本手册 §3 / §4 标了「未演练」） |
| 前提 | 发布时**存了上一版产物快照**（`.releases/<上一版>/`）。没存 → 见 §2.3 的抢救路径 |

---

## 0. 一句话

> **静态托管的回滚 = 把上一版的产物重新传回去。** 不改代码、不动数据库、不重启函数。
> 所以它**快、可逆、没有数据风险** —— 这也是「真出事敢不敢用」的答案：敢，因为它不会让情况更糟。

回滚分三层，**本次只演练第一层**：

| 层 | 对象 | 本次状态 | 做什么 |
| -- | ---- | -------- | ------ |
| L1 静态托管 | 页面（html/css/js/data） | ✅ **已真实演练** | 重部署上一版产物（§2） |
| L2 云函数 | 5 个 HTTP 接口 | ⏸ **未演练**，只写步骤 | 版本流量切回 / 回灌旧代码（§3） |
| L3 数据库 | PostgreSQL `postgres-emxo9nse` | ⏸ **未演练**，只写步骤 | 用 `db/*.sql` 重建（§4） |

---

## 1. 触发条件

### 1.1 判断表：什么情况**必须**回滚（余力加练）

先看这张表再动手。**判据是「用户能不能正常用」，不是「我觉不觉得难看」。**

| # | 现象 | 严重度 | 处置 | 判据 |
| - | ---- | ------ | ---- | ---- |
| 1 | 首页/任一主页面**白屏**、打不开、5xx | **P0** | **立即回滚** | 用户完全用不了 |
| 2 | 页面 404 掉了它引用的 js/css（如 `api-error.js`），核心交互全挂 | **P0** | **立即回滚** | 功能不可用 |
| 3 | 五条接口全部 5xx／页面全量降级到"接口暂时不可用" | **P0** | 先查接口（可能属 L2），**L1 若无变更则不回滚 L1** | 别拿错层级的药 |
| 4 | 数据明显错（比分/积分榜/热搜错位、张冠李戴） | **P1** | 回滚到数据正确的上一版；或热修 data | 用户会信错信息 |
| 5 | 跨域失效：线上页面调不到接口（浏览器报 CORS） | **P1** | 先查 CORS 白名单（Day 20 §1.3），不是页面问题 | 回滚也治不了 |
| 6 | 只影响某个窄屏/某浏览器的布局错乱 | **P2** | **不回滚**，记下来下次带修 | 能用，只是难看 |
| 7 | 线上是旧版（部署没生效/缓存） | **P3** | 强刷 + 重跑 `verify`，**不回滚** | 不是回滚问题 |
| 8 | 刚发布后 40–60 秒内接口 443 空响应 | **P3** | **等冷启动**，不要连推 | Day 20 §3.3 已记 |
| 9 | 线上多出旧文件（如回退后残留 `js/api-error.js`） | **P4** | 无害，择机 `tcb hosting delete` 点名删 | 旧页面不引用它 |

### 1.2 三条**不要回滚**的情况（回滚会让事情更糟）

1. **数据库已按新结构写入数据**：L1 回退不会撤销数据。旧版页面读新结构的数据，可能出现字段对不上 —— 这时要的不是回滚，是往前修。
2. **问题在浏览器缓存**：`verify` 说线上和快照一致，而你看到的不一致 → 是缓存，别回滚。
3. **只有一处文案/一个图标**：热修一处比整站回退更快、风险更小。

### 1.3 决策时限（依据：演练实测）

| 现象 | 决定时限 | 理由 |
| ---- | -------- | ---- |
| P0 | **5 分钟内**决定 | 实测 L1 回退全程 **约 1 分钟**（见[演练记录](day26-rollback-drill.md)），比开会讨论快 |
| P1 | 30 分钟内 | 先确认是数据问题还是代码问题 |

> 回退动作本身很快，**慢的从来是"决定要不要回"**。所以这张表的价值不是让你更快回退，是让你更早停止犹豫。

---

## 2. L1 静态托管回退（本次已演练 ✅）

### 2.1 前置：确认要退到哪一版

```bash
node scripts_cloudbase/release.mjs list        # 看本地存了哪些版本快照
cat .releases/v0.9/release.json               # 看这版对应哪个提交
```

### 2.2 标准回退（推荐路径，约 1 分钟）

```bash
cd C:/Users/XH/WorkBuddy/2026-09-20-13-17-06/28days

# 1) 回退（脚本先自检快照没坏，再上传）
node scripts_cloudbase/release.mjs deploy v0.9
#    等价于： tcb hosting deploy .releases/v0.9 -e <envId> --safe --verify

# 2) 确认线上真的变成旧版了
node scripts_cloudbase/release.mjs verify v0.9      # 期望：29→28 个文件里，
                                                    # v1.0 新增的 js/api-error.js 会报 MISSING（线上没有它）→ 这才是对的
```

> ⚠️ **回退时 `verify` 报"取不到 js/api-error.js"不是故障，是预期**：v0.9 本来就没有这个文件。
> 判断"回退成功"看的是：**manifest 里 v0.9 自己的 28 个文件是否全部一致**。

### 2.3 抢救路径：快照丢了怎么办（无快照时）

静态托管没有版本管理，所以**没有"控制台点一下回退"**这种后路。只能靠代码重建：

```bash
# 1) 上一版的提交号哪来？—— 发布清单 §1 或 git 历史
git log --oneline --decorate -20

# 2) 把那个提交导出成干净工作树，再构建
mkdir -p _rollback_tmp && git archive <上一版提交号> | tar -x -C _rollback_tmp
(cd _rollback_tmp && node scripts_cloudbase/build-publish.mjs)

# 3) 上传
tcb hosting deploy _rollback_tmp/.cloudbase-publish -e ross-d2gimwy406e0d6812 --safe
```

**这条路径慢得多（多一步导出+构建），且依赖"当时那个提交能跑通构建"。** 所以正常流程必须存快照。

### 2.4 回退之后清理旧版多余文件（可选）

不加 `--prune` 时，回退**不会删除新版多出来的文件**（例如 `js/api-error.js`）。它无害，但要干净就点名删：

```bash
tcb hosting list -e ross-d2gimwy406e0d6812          # 先看线上有什么
tcb hosting delete js/api-error.js -e ross-d2gimwy406e0d6812
```

> 🚫 **绝对不要**在托管根路径上跑 `--prune`：根目录下还有 `__auth/`、`cloud-admin/` 这些**系统文件**，
> 不在我们的发布目录里，会被当成"多余文件"删掉。要清就点名清。

---

## 3. L2 云函数回退（⏸ 今日未演练，步骤备查）

静态托管是"传文件"，云函数改的是**运行中的代码**，两者完全不同 —— 云函数回退有两条路：

### 3.1 现状（本次实测）

```
tcb fn list-function-versions api -e <envId>
→ 只有一行 $LATEST
```

**5 个函数都只有 `$LATEST`，从未 `publish-version`。**
含义：**现在没有"已发布版本"可以切流量回去**，所谓"回退"目前只有 §3.3 那条路。

### 3.2 正常路径：版本 + 流量切回（需要事先 `publish-version`）

```bash
# —— 发布时（应当做的，本次未做）——
tcb fn publish-version api -e <envId>     # 把当时的代码固化成版本 1、2、3…
tcb fn list-function-versions api -e <envId>

# —— 出事时：把网关流量切回旧版本 ——
tcb fn get-route api -e <envId>                        # 先看当前流量怎么分的
tcb fn config-route api <旧版本号> 100 -e <envId>       # 100% 流量给旧版本
```

**优点**：秒级生效、不动代码、可灰度（`新版本 10 + 旧版本 90`）。**前提**：发布时固化过版本。

### 3.3 兜底路径：直接回灌旧代码（现在唯一可用的）

```bash
# 1) 从 git 取旧版函数代码
git archive <上一版提交号> cloudfunctions scripts_cloudbase | tar -x -C _rollback_tmp

# 2) 必须重新组装「自包含目录」——shared/ 不拷进去线上函数启动即挂（Day 20 §3.2）
(cd _rollback_tmp && node scripts_cloudbase/build-functions.mjs)

# 3) 逐个重部署，然后重配网关
tcb fn deploy api --httpFn --dir _rollback_tmp/.cloudbase-build/api -e <envId> --force
tcb deploy --only gateway -e <envId>
```

> ⚠️ 三个坑（都是踩过的）：① 必须用 `build-functions.mjs` 组装，直接 `tcb fn deploy api` 会 443 空响应；
> ② 新增路由要**同时**改 `cloudbaserc.json` 的 `functions[]` 与 `gateway.routes[]`；③ 部署后等 **40–60 秒**冷启动。

### 3.4 建议（等零拍板）

发布 v1.0 时**顺手 `publish-version` 五个函数**，成本一次命令，换来"秒级回退"的后路。本次未做，属遗留。

---

## 4. L3 数据恢复（⏸ 今日未演练，步骤备查）

**没有一键还原。** CloudBase 体验版的 `tcb db backup` 是 **MySQL 专用**，本项目是 **PostgreSQL**。

| 要恢复什么 | 用什么 | 代价 |
| ---------- | ------ | ---- |
| 表结构 | `db/schema.sql`（幂等） | 会按基线重建，注意是 `DROP … CREATE` 写法 |
| 种子数据 | `db/seed.sql` | ⚠️ **会 `TRUNCATE` 四张 `league_*` 表** |
| 联赛真数据 | `db/league_data*.sql`、`db/migrate-day22*.sql` | 大文件需**切段执行**（单条 `--sql` 超 ~32KB 报 `Argument list too long`） |
| 热搜 | `db/hot_sync.sql` | **只有最新一天**，历史不可追 |

> ⚠️ **数据恢复是不可逆操作里最重的一类**：`seed.sql` 里带 `TRUNCATE`，跑之前一定先确认"这张表的数据能不能不要"。
> 判断口径见 [api-contract §3.8](../api-contract.md)。
>
> 因为体验版没有自动备份，**数据库这一层目前只能"重建"，不能"还原到某个时间点"** —— 这是 v1.0 已知缺口，不假装已解决。

---

## 5. 回滚后验证（三层共用，按顺序做）

| # | 检查项 | 命令 / 动作 | 通过标准 |
| - | ------ | ----------- | -------- |
| R1 | 线上 == 目标版本 | `release.mjs verify <版本>` | 该版本 manifest 内**全部**一致（新版新增文件报 MISSING 正常） |
| R2 | 首页能打开、不白屏 | 打开 `/index.html`（`?v=时间戳` 强刷） | 渲染出「每日体坛速览」 |
| R3 | 回退**确实生效了**（不是缓存骗人） | 看版本特有标记：v0.9 的 `index.html` **不引用** `js/api-error.js` | 与目标版本一致 |
| R4 | 接口仍通 | `/api/health` 等五条 200 | `ok === true` |
| R5 | 页面不降级 | 首页无橙色「接口暂时不可用」条 | 无 |
| R6 | 用户路径走一遍 | 首页 → 赛程 → 资讯 → 联赛，各点一下 | 都能用 |

> R3 是**回滚演练与"看着像好了"的分界线**：只看首页能打开，分不清是真回退了还是 CDN 还在发旧缓存。
> 必须找一个**版本间有差异的标记**来判。

---

## 6. 本次演练实测（一句话）

> 退回 v0.9 → 验证 → 恢复 v1.0 → 再验证，**全程约 ▢ 分钟**，其中"部署"本身只占几秒，
> 时间主要花在**下载校验**和**等人眼看页面**上。逐步骤耗时见 [day26-rollback-drill.md](day26-rollback-drill.md)。

---

## 7. 常见坑速查

| 现象 | 原因 | 处置 |
| ---- | ---- | ---- |
| 回退后 `verify` 报 `js/api-error.js` MISSING | v0.9 本来没这个文件 | 正常，看 v0.9 自己的 28 个文件是否全一致 |
| 回退后页面看着还是新版 | CDN 缓存 | 加 `?v=时间戳` 强刷，再跑 `verify` |
| 回退后线上仍有新版文件 | 没加 `--prune` | 无害；要干净用 `tcb hosting delete` 点名删 |
| 想用 `--prune` 一把清干净 | 会误删 `__auth/`、`cloud-admin/` | **不要** |
| 函数重部署后接口 443 空响应 | 没用 `build-functions.mjs` 组装 | 见 §3.3（Day 20 §3.2） |
| 函数部署成功但访问超时 | `scf_bootstrap` 被 git 转成 CRLF | `node scripts_cloudbase/normalize-eol.mjs` 后重部署 |
| 找不到上一版的提交号 | — | `git log --oneline --decorate`，或看 `.releases/<版本>/release.json` |
| 部署 CLI 报 `Argument list too long` | SQL 单条过大 / 在 PowerShell 里 `$(cat)` 被截断 | 切段执行，或用 Git Bash |

---

**发布怎么办？** → [发布清单 release-checklist-v1.0.md](release-checklist-v1.0.md)
**本次演练花了多久？** → [演练记录 day26-rollback-drill.md](day26-rollback-drill.md)
