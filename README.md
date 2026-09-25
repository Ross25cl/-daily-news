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
├── index.html          # P1 每日速览页（首页）
├── matches.html        # P2 赛程比分页
├── css/style.css       # 共用样式（移动端优先）
├── js/app.js           # 首页逻辑：fetch 数据 → 渲染四板块 + 大类筛选
├── js/matches.js       # 赛程页逻辑：日期切换 → 渲染比赛卡片
├── data/news.json      # 速览条目数据（字段定义见 TECH_DESIGN 4.1）
├── data/matches.json   # 比赛数据（字段定义见 TECH_DESIGN 4.2）
├── docs/dataflow.svg   # 数据流图（TECH_DESIGN 第 6 节）
├── docs/structure.svg  # 项目结构图（Day 7 余力加练）
├── research.md / PRD.md / TECH_DESIGN.md / AGENTS.md  # 项目文档
└── .env                # 本地调试密钥（已 gitignore，永不提交）
```

## 数据更新方式（MVP 示例阶段）

1. 用文本编辑器打开 `data/news.json` 或 `data/matches.json`；
2. 按现有条目的字段结构修改或追加（字段定义见 [TECH_DESIGN.md](TECH_DESIGN.md) 第 4 节：标题 ≤30 字、摘要 ≤60 字、只有 `status` 为 `published` 的条目会显示）；
3. 保存后刷新浏览器即可看到变化——页面按「今天日期 + 已发布」纯前端过滤；
4. 后续将改用本地录入表单 `tools/entry.html` 自动生成 JSON（TECH_DESIGN v1.3 录入方案），不再手写字段。

## 安全说明

- `.env` 文件存放本地密钥与配置（如未来的新闻 API Key）。
- 该文件已被 `.gitignore` 忽略，**永远不会上传到 GitHub**。
