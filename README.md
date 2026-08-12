# 剪藏知识库（Clippings Knowledge Hub）

将个人剪藏文件夹（AI 主题 Markdown 文章）构建为**杂志感、可查阅、可分享**的静态知识网站。
按**文件夹（作者）**与**标签**两个维度组织，支持全文检索、同页即时筛选与浅/深色主题切换。

## 站点结构

- `index.html` — 总览页：顶栏搜索 + 侧栏（作者 / 标签筛选）+ 杂志风大图卡片网格，点击任一维度即时下钻（URL 参数可分享）
- `articles/*.html` — 每篇文章独立全文页（含「查看原文」外链）
- `assets/data.js` — 文章元数据 + 正文纯文本（内联到页面，支持 `file://` 直接打开）
- `assets/data.json` — 同上内容的 JSON 版本（`fetch` 兜底用）
- `assets/style.css` / `assets/app.js` — 样式与交互
- `scripts/build.mjs` — 构建脚本（数据管道）
- `scripts/scan.mjs` — 标签 / 作者词汇扫描（辅助）
- `tags-report.json` — 标签清洗与合并记录

## 作者模型

- 作者 = Markdown 文件所在文件夹名
- 根目录下的 Markdown 文件统一归入「其他」
- 不再读取 frontmatter 中的 `作者` 字段

## 本地预览

支持两种方式：

### 直接双击打开

```bash
open /Users/han/Sites/WorkBuddy/剪藏网站/index.html
```

数据已内联到 `assets/data.js`，无需启动服务器。

### 本地 HTTP 服务

```bash
cd /Users/han/Sites/WorkBuddy/剪藏网站
python3 -m http.server 8099
# 浏览器访问 http://localhost:8099
```

## 重新构建

新增剪藏后重跑构建即可（依赖 gray-matter、marked，安装于受管 Node 工作区）：

```bash
node scripts/build.mjs
```

## 标签清洗规则（summary）

- **系统标签剔除**：`clippings`、`剪藏`
- **近义合并**（变体 → 规范名）：提示词←提示词工程/Prompt工程/Prompt/Prompt心法；
  AI视频←AI视频生成/AI视频创作；图像生成←图片生成；AI绘画←AI生图；
  Nano Banana←NanoBanana/Banana Pro；Agent←AI Agent；效率←办公效率；
  开源←开源项目；编程←AI编程；Gemini 3←Gemini 3.0 Pro；Skill←Claude Skill/Skill管理；
  视频制作←视频创作；大模型←大语言模型；短剧←AI短剧；剧本创作←编剧；即梦←即梦图片/即梦图片4.0
- **作者即标签去重**：标签与作者名完全同名的直接丢弃，避免与作者维度重复
- 完整映射见 `tags-report.json`

## 统计

- 文章：983 篇
- 作者：27 位（按文件夹）
- 标签：1539 个（侧栏默认展示出现 ≥3 次的常用标签，可展开全部）

## 技术说明

纯静态站点，无后端。前端搜索为轻量中文友好的子串加权算法（标题/作者/标签/摘要/正文），
无外部依赖、可离线运行。主题通过 CSS 变量 + `localStorage` 持久化。
卡片采用 IntersectionObserver 分块渲染，保证 900+ 篇文章滚动流畅。
