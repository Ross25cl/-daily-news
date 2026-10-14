# 发布清单 · v1.0

| 项目 | 内容 |
| ---- | ---- |
| 文档名称 | 《每日体坛速览》v1.0 发布清单 |
| 撰写日期 | 2026-10-14（Day 26｜第 4 周） |
| 对应任务 | ① 确认可回退历史 · ② 发布 v1.0 |
| 今日边界 | **不做**云函数回退实操、不做数据恢复实操（两者只写进[回滚手册](rollback-runbook.md)备查） |
| 完成标准 | v1.0 公网可访问且检查全过；回滚演练有耗时记录；恢复后公网正常 |

---

## 0. 一句话

> v1.0 = **代码打 `v1.0` 标签 + 产物存 `.releases/v1.0/` + 静态托管上线**。
> 三样东西对齐同一个提交，任何一样丢了，另两样都能把它重建出来 —— 这就是本清单存在的意义。

发布对象：**静态托管**（`*.html` + `css/` + `js/` + `data/`，共 29 个文件）。
接口层（5 个 HTTP 云函数）本次**不改代码、不重部署** —— v1.0 相对线上一版没有接口层变更。

---

## 1. 版本标记（三件套，必须互相对得上）

| # | 标记 | 值 | 位置 |
| - | ---- | -- | ---- |
| 1 | **git 标签** | `v1.0`（附注标签） | 仓库，随 `git push --tags` 上 GitHub |
| 2 | **产物快照** | `.releases/v1.0/`（29 个文件 + `manifest.sha256` + `release.json`） | 本地，gitignore |
| 3 | **线上环境** | `ross-d2gimwy406e0d6812` / `ap-shanghai` | CloudBase 控制台 |

- **线上地址**：https://ross-d2gimwy406e0d6812-1499705719.tcloudbaseapp.com/index.html
- **接口网关**：`https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com/api/*`
- `release.json` 里记 `gitCommit` 字段 —— **快照 ↔ 提交**的对应关系就在这一行，回退时先看它。

> ⚠️ **上一版（v0.9）是线上现存的、提交 `87a897c` 的内容**（Day 22 加练：静态数据字段统一 camelCase），
> 部署于 2026-10-09。v1.0 与它的差异集中在 `js/api-error.js`（新增）、9 个 js、5 个 css、7 个 data。

---

## 2. 发布前验证项（全过才允许发布）

### 2.1 门禁（自动，一条命令）

```bash
node skills/verify-project/check.mjs      # 退出码 0 = 无 FAIL，才可以发
```

| 组 | 项数 | 治什么旧伤 |
| -- | ---- | ---------- |
| A 跨域与域名 | 5 | Day 17/20 的接口地址、防盗链图源 |
| B 重复写入与一致性 | 4 | Day 16 唯一约束、Day 23 收藏防重 |
| C 数据库执行 | 3 | Day 16 PG 方言、幂等迁移 |
| D 接口错误与安全 | 5 | Day 23 三类错误话术、密钥不落库 |
| E 页面与渲染纪律 | 3 | Day 24 `hidden` 属性失效、坏 JSON |
| F 环境变量与部署 | 4 | Day 17 `envVariables` 字段名、Day 18 路由 |
| G 公网可用性 | 1 | 接口真的活着 |

**本轮实测**：`PASS 25 · FAIL 0 · SKIP 0`，退出码 `0`。（Day 25 建这套门禁时的实跑记录见 [day25-verify-record.md](day25-verify-record.md)）

### 2.2 人工核对项（机器判不了的）

| # | 检查项 | 期望 | 本次实测 |
| - | ------ | ---- | -------- |
| M1 | 工作区干净（除本日新增文件） | `git status` 只有本日文件 | ✅ |
| M2 | 本地发布目录文件齐全 | 7 html + 5 css + 10 js + 7 data = **29** | ✅ |
| M3 | **上一版快照已存**（回退的前提） | `.releases/v0.9/` 存在且 `verify` 通过 | ✅ 28 文件逐字节一致 |
| M4 | 密钥不在发布产物里 | 发布目录内 grep 不到 `CB_API_KEY` 真实值 | ✅ |
| M5 | `.env` / `.releases/` / `.cloudbase-*` 已 gitignore | 不会误传 | ✅ |
| M6 | 数据库结构已是最新（无待跑迁移） | `db/migrate-*.sql` 全部跑过 | ✅ Day 22 迁移早已执行 |
| M7 | 备份完成（见 §5） | tag + 快照 + db 脚本都在 | ✅ |

> ⚠️ **M3 是这条清单里最容易被跳过、后果最重的一项**：静态托管没有版本管理，
> 上线前不存上一版，出事就**没有东西可以退回去**。

---

## 3. 发布步骤（可逐条复制）

```bash
cd C:/Users/XH/WorkBuddy/2026-09-20-13-17-06/28days

# 0) 发布前门禁：不过就不发
node skills/verify-project/check.mjs

# 1) 标记这一版（先提交、再打标签，保证 tag 指向的提交就是发布的提交）
git add -A && git commit -m "Day 26｜..."
git tag -a v1.0 -m "v1.0：首个正式发布"

# 2) 构建 + 落快照（产物 + sha256 清单，一次性生成）
node scripts_cloudbase/release.mjs snapshot v1.0
node scripts_cloudbase/release.mjs list

# 3) 部署（脚本会先自检快照与清单一致，再上传）
node scripts_cloudbase/release.mjs deploy v1.0
#    等价于： tcb hosting deploy .releases/v1.0 -e <envId> --safe --verify

# 4) 校验线上 == 快照（逐字节）
node scripts_cloudbase/release.mjs verify v1.0

# 5) 推代码与标签（代码层面的异地备份）
git push origin main && git push origin v1.0
```

### 关于 `--safe` 与 `--prune` 的选择

| 选项 | 作用 | v1.0 发布时用不用 |
| ---- | ---- | ----------------- |
| `--safe` | 发布前自动备份，上传或校验失败**自动回滚** | **用**（默认带上） |
| `--verify` | 发布后自动比对线上与本地 | **用** |
| `--prune` | 发布成功后**删除线上不属于本次发布的文件** | **不用** —— 见 §6 踩坑 |

---

## 4. 发布后验证（发布 ≠ 上线成功）

| # | 检查项 | 判定方式 | 本次实测 |
| - | ------ | -------- | -------- |
| P1 | 线上与快照逐字节一致 | `release.mjs verify v1.0` | ✅ 29/29 一致 |
| P2 | 首页可访问且不是白屏 | 打开 `/index.html`，标题「每日体坛速览」 | ✅ |
| P3 | 新版特有的东西真的上线了 | 二进制树里**多出** `js/api-error.js`；首页 `<script>` 引到它 | ✅ |
| P4 | 接口仍通（页面不降级） | 首页「最近更新」是库里的真实抓取时间，无橙色降级条 | ✅ |
| P5 | 检查台三块绿 | `/checkup.html` health / hot / news 全绿 | ✅ |
| P6 | 五条接口全 200 | `/api/health·hot·favorites·matches·news` | ✅ |
| P7 | 手机端不横向溢出 | 窄屏打开首页，无横向滚动条 | ✅ |

> P1 是**唯一能机器判死的**一项，其余靠人眼。所以发布后**先跑 P1，再去看页面**。
>
> ⚠️ 静态托管有 CDN 缓存，看页面时用 `?v=时间戳` 强刷，别被旧缓存骗了。

---

## 5. 代码与数据备份方式

### 5.1 代码

| 层 | 载体 | 恢复方式 |
| -- | ---- | -------- |
| 源码 | GitHub `Ross25cl/-daily-news`，main 分支 + `v1.0` 标签 | `git clone` / `git checkout v1.0` |
| 发布产物 | `.releases/<版本>/`（本地）+ `manifest.sha256` | 产物丢了也不怕：`git archive <tag>` → `release.mjs snapshot <版本>` 重建 |

> **产物是可重建的，所以产物快照不必进仓库**（`.releases/` 已 gitignore，避免把 540KB 的 `data/nba.json` 反复塞进历史）。
> 真正的备份是 **tag + 构建脚本**这两样。

### 5.2 数据

数据在 CloudBase **PostgreSQL**（库 `postgres-emxo9nse`，schema `public`）。**体验版没有自动备份**，靠脚本：

| 数据 | 备份物 | 说明 |
| ---- | ------ | ---- |
| 表结构 | `db/schema.sql` | 幂等，可重复执行 |
| 种子数据 | `db/seed.sql` | ⚠️ 会 `TRUNCATE` 四张 `league_*` 表，执行前看 [api-contract §3.8](../api-contract.md) |
| 联赛真数据 | `db/league_data*.sql`、`db/migrate-day22*.sql` | 各联赛构建脚本产出 |
| 热搜（每日增量） | `db/hot_sync.sql` | 每天由 `fetch-hot.ps1` 覆盖生成，**只保留最新一天的快照** |

> ⚠️ **两个必须说清楚的局限**：
> 1. `tcb db backup` 是 **MySQL 专用**，本环境是 **PostgreSQL**，用不了 —— 我们**没有**一键备份。
> 2. 热搜是每日覆盖式生成，`hot_sync.sql` **只有最新一天**；历史热搜没有独立归档。
>
> 这两条是 v1.0 的**已知缺口**，不假装已解决；对策写入[回滚手册](rollback-runbook.md) §触发条件。

### 5.3 发布前必须完成的三件备份

1. `git tag -a v1.0` 且已 push（代码侧）
2. `.releases/v1.0/` 已生成、`release.mjs verify` 通过（产物侧）
3. **上一版 `.releases/v0.9/` 已存**（回退侧 —— 最容易被漏的那件）

---

## 6. 踩坑备忘（本次真踩到的）

1. **静态托管没有版本管理。** `tcb hosting deploy --help` 原文写着 *"file upload only, no build, no version management"*。
   「回退」在产品层面不存在，必须自己存产物。这是本清单和[回滚手册](rollback-runbook.md)存在的根本原因。
2. **`--prune` 慎用。** 它按"当前目录"反向清理线上文件。托管根目录里还有 `__auth/`、`cloud-admin/` 这类**系统文件**
   （不在我们的发布目录里），一旦 `--prune` 作用在根路径，**它们会被当成"多余文件"删掉**。
   → 日常发布**不加 `--prune`**；确实要清多余文件时，用 `tcb hosting delete <精确路径>` 点名删。
3. **旧版多出来的文件不会自动消失。** 不加 `--prune` 时，v1.0 传上去后，`js/api-error.js` 这类**新版新增**的文件
   会留在线上；回退时它**不会被自动删掉**（旧版 `index.html` 不引用它，无害，但不是"干净的回退"）。要干净得手动点名删。
4. **tag 必须在提交之后打。** 先打 tag 再提交，tag 会指向"发布前"那个提交，`release.json` 里的 `gitCommit` 就对不上了。

---

## 7. 遗留

| # | 事项 | 状态 |
| - | ---- | ---- |
| 1 | 云函数只有 `$LATEST`，从未 `publish-version` | **本次不动**；写出对策进回滚手册，等零拍板是否补 |
| 2 | 热搜只保留最新一天 `hot_sync.sql` | 已知缺口，未修 |
| 3 | 接口地址仍散在 5 个 js 文件 | Day 25 已记录，等零定 |
| 4 | `digest.html` 孤页仍在线上 | 等零拍板去留 |

---

**回退怎么办？** → [回滚手册 rollback-runbook.md](rollback-runbook.md)
**本次演练花了多久？** → [演练记录 day26-rollback-drill.md](day26-rollback-drill.md)
