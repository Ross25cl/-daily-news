# 每日体坛速览

28days 计划项目：一个每天汇总体坛要闻、赛程比分与定时推送的速览页面。

> **2026-09-22（Day 4）**：产品由《每日资讯速览》聚焦转型为《每日体坛速览》，目标用户、功能范围与验收标准见 [PRD.md](PRD.md)。

## 当前版本（Day 7 · MVP）

- **每日速览**（`index.html`）：四板块（今日头条 / 转会·伤病 / 热议话题 / 明日看点），支持顶部「篮球 / 足球 / 综合」大类筛选。
- **赛程比分**（`matches.html`）：NBA、英超比赛列表，可切换昨天 / 今天 / 明天，点击卡片展开详情。
- 当前为**示例数据阶段**：内容来自 `data/*.json`，仅用于验证功能；真实体育数据源第 2 周接入。
- 定时推送（F3）未开发，属后续天任务；录入工具 `tools/entry.html` 待补建。

## 运行方式

页面需要通过本地服务器访问——页面用 fetch 技术读取 JSON 数据，直接双击 HTML 文件打开会被浏览器拦截。

1. 在本项目目录打开终端（Windows：文件管理器进入本目录，在地址栏输入 `cmd` 回车）；
2. 运行：

   ```
   python -m http.server 8000
   ```

   提示「python 不是内部或外部命令」时，用完整路径：

   ```
   C:\Users\XH\.workbuddy\binaries\python\versions\3.13.12\python.exe -m http.server 8000
   ```

3. 浏览器打开：
   - 每日速览：`http://localhost:8000`
   - 赛程比分：`http://localhost:8000/matches.html`
4. 停止服务器：在终端按 `Ctrl+C`（或直接关闭窗口）。

> 提示：改动文件后页面没变化时，按 `Ctrl+F5` 强制刷新（浏览器会缓存旧文件）。

## 项目结构

```
28days/
├── index.html          # P1 首页：三平台热搜（虎扑/腾讯/央视）
├── matches.html        # P2 赛程比分页
├── news.html           # P3 资讯列表页（?cat=足球|篮球|综合）
├── news-detail.html    # P4 资讯详情页（?id=...）
├── league.html         # P5 联赛板块页（?lg=nba|cba|ucl|epl）
├── digest.html         # 旧四板块速览页（Day 8 版迁出，暂无导航入口）
├── tools/entry.html    # 本地 JSON 录入表单
├── css/                # 分页样式：style / home / news / league
├── js/                 # 分页逻辑：home / matches / news / news-detail / league / theme / app
├── data/               # 示例数据：hot / news / matches / {nba,cba,ucl,epl}.json
│
├── cloudfunctions/     # 【Day 15】CloudBase 云函数
│   └── health/         #   健康检查函数（GET /api/health）
├── scripts_cloudbase/  # 【Day 15】部署脚本（health 函数 / 静态托管 / 换行规范）
├── db/                 # 【Day 16】数据库脚本（schema.sql 建表 / seed.sql 种子）
├── cloudbaserc.json    # 【Day 15】CloudBase CLI 部署配置
├── api-contract.md     # 【Day 15 建，Day 16 表结构定稿】接口契约
├── docs/
│   ├── cloudbase-deploy-day15.md  # 【Day 15】部署手册
│   ├── dataflow.svg / structure.svg / views.md / usability-test-day14.md
├── skills/tiyu-daily/  # 录入用 Skill
├── research.md / PRD.md / TECH_DESIGN.md / AGENTS.md  # 项目文档
└── .env                # 本地调试密钥（已 gitignore，永不提交）
```

## 部署到公网（云开发 CloudBase）

第 2 周前的页面是本地预览（`node serve.mjs`）。从 **Day 15** 起接入腾讯云开发，公网可访问：

- 云函数：`/api/health`（健康检查）
- 静态托管：上面那些 `.html` + `css/` + `js/` + `data/`

完整步骤见 [docs/cloudbase-deploy-day15.md](docs/cloudbase-deploy-day15.md)，接口约定见 [api-contract.md](api-contract.md)。

## 数据库（Day 16 起）

第 3 周把示例数据搬进 CloudBase 云开发 **PostgreSQL**（库 `postgres-emxo9nse`，schema `public`）：

- `db/schema.sql`——建 10 张表（主键 / 外键 / CHECK 约束 / 字段注释），可重复执行；
- `db/seed.sql`——先清后插的种子数据，每张核心表 ≥5 行，可重复执行；
- 表结构、关联字段与接口的对应关系，见 [api-contract.md](api-contract.md) 第 3 节。

控制台 / CLI 的执行方式与 select 验证语句，见契约 §3.5。

## 数据更新方式（MVP 示例阶段）

1. 用文本编辑器打开 `data/news.json` 或 `data/matches.json`；
2. 按现有条目的字段结构修改或追加（字段定义见 [TECH_DESIGN.md](TECH_DESIGN.md) 第 4 节：标题 ≤30 字、摘要 ≤60 字、只有 `status` 为 `published` 的条目会显示）；
3. 保存后刷新浏览器即可看到变化——页面按「今天日期 + 已发布」纯前端过滤；
4. 后续将改用本地录入表单 `tools/entry.html` 自动生成 JSON（TECH_DESIGN v1.3 录入方案），不再手写字段。

## 安全说明

- `.env` 文件存放本地密钥与配置（如未来的新闻 API Key）。
- 该文件已被 `.gitignore` 忽略，**永远不会上传到 GitHub**。
