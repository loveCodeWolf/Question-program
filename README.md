# 刷题系统 — 全栈 Cloudflare 建站完整指南

> 基于 Cloudflare Workers + Pages + D1 的全栈刷题系统，手机端优先。
> 题库内容：治安管理处罚法相关，共 **1809 题**（判断511 + 单选748 + 多选550）

---

## 📦 项目架构总览

```
┌─────────────────────────────────────────────────┐
│                  用户浏览器                        │
│   https://quiz-app-b3k.pages.dev                  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│          Cloudflare Pages（前端静态文件）            │
│   index.html / practice.html / exam.html         │
│   wrong-collect.html / css/ / js/               │
└──────────────────┬──────────────────────────────┘
                   │ /api/* 请求
                   ▼ (Service Binding: QUIZ_WORKER)
┌─────────────────────────────────────────────────┐
│       Cloudflare Workers（后端 API）               │
│   19 个接口：题库/题目/错题/收藏/斩题/笔记/考试       │
└──────────────────┬──────────────────────────────┘
                   │ env.DB 绑定
                   ▼
┌─────────────────────────────────────────────────┐
│       Cloudflare D1（SQLite 数据库）               │
│   7 张表：question_bank / questions / user_wrong │
│   user_collect / user_master / user_note / exam   │
└─────────────────────────────────────────────────┘
```

### 请求流程

```
浏览器访问 quiz-app-b3k.pages.dev 
  ↓
Cloudflare DNS 解析 → 指向 Cloudflare Pages
  ↓
Pages 返回静态文件（index.html / practice.html 等）
  ↓
前端 JS 发 API 请求到 /api/xxx
  ↓
Pages Functions（functions/api/[[path]].js）拦截到 /api/* 请求
  ↓
通过 Service Binding（env.QUIZ_WORKER）转发给 Worker
  ↓
Worker 执行业务逻辑，查询 D1 数据库
  ↓
返回 JSON → Pages → 浏览器
```

**整个流程都在同一个域名下，不会跨域，无需 CORS 配置。**

---

## 📂 项目目录结构

```
F:\git_project\Question-program\
│
├── wrangler.toml              # Cloudflare Workers 配置文件
├── package.json                # 项目依赖 + 部署脚本
├── CLAUDE.md                   # 项目规划文档
├── README.md                   # 本文件
│
├── worker/
│   └── src/
│       └── index.js            # Worker 后端 API（19个接口，ESModule 格式）
│
├── frontend/                   # Pages 静态前端
│   ├── index.html              # 首页（题库切换 + 四大入口 + 刷题模式）
│   ├── practice.html           # 刷题核心页（判断/单选/多选）
│   ├── wrong-collect.html      # 四合一 Tab 页（错题/收藏/斩题/笔记/易错）
│   ├── exam.html               # 模拟考试（计时 + 自动判分）
│   ├── css/
│   │   └── main.css            # 全局样式（移动端自适应）
│   └── js/
│       └── api.js              # API 接口封装 + 本地缓存
│
├── functions/                  # Pages Functions（路由代理）
│   └── api/
│       └── [[path]].js         # 捕获 /api/* 请求 → 转发到 Worker
│
├── database/
│   ├── init.sql                # D1 建表 SQL（7 张表 + 4 个索引）
│   ├── seed.sql                # 1809 题数据 INSERT 语句（2MB）
│   └── questions.json          # 完整 JSON 数据
│
├── scripts/
│   └── parse-docx.js           # docx 解析器（新治管法 + 题库汇总）
│
├── 新治管法题目.docx             # 源文件1：新治安管理处罚法（545题）
└── 题库汇总(包含2024年省厅新增题库).docx  # 源文件2：综合题库（1264题）
```

---

## 🔧 开发过程详解

### 第一步：文档解析（Phase 0）

**目标**：将两个 Word 文档（docx）解析为结构化 JSON + SQL。

```js
// scripts/parse-docx.js 核心逻辑
const mammoth = require("mammoth");

// 1. 用 mammoth 提取 docx 纯文本
const { value } = await mammoth.extractRawText({ buffer: docxBuffer });

// 2. 按题号分割（支持 "数字." 和 "数字、" 两种格式）
const questions = value.split(/\n(?=\d+[.、])/);

// 3. 用正则提取答案（兼容多种格式）
//    "答案：对/错" | "【答案】X" | "【正确答案:】X"
//    "解析：..." | "【解析】..."
const answerRegex = /(?:答案[:：]|【答案[:：]?】|【正确答案[:：]?】)\s*([^\n]+)/;
const analysisRegex = /(?:解析[:：]|【解析[:：]?】)\s*([^\n]+)/;

// 4. 答案归一化
//    "正确/√/Yes" → "对"，"错误/×/No" → "错"
//    多选去重排序："A, B, C" → "ABC"
```

**关键点**：
- 两种 docx 格式不同（`答案：` vs `【答案】`），但用一个正则通吃
- 过滤规则：无答案且无解析的题目跳过（共跳过 33 条）
- 输出 `database/questions.json` + `database/seed.sql`

### 第二步：设计数据库（D1）

**D1 是 Cloudflare 的 SQLite 兼容数据库**，直接在 Cloudflare 边缘运行。

```sql
-- database/init.sql 7张表
CREATE TABLE question_bank (...);   -- 题库信息
CREATE TABLE questions (...);       -- 题目（含 options JSON）
CREATE TABLE user_wrong (...);      -- 用户错题
CREATE TABLE user_collect (...);    -- 用户收藏
CREATE TABLE user_master (...);     -- 斩题记录
CREATE TABLE user_note (...);       -- 笔记
CREATE TABLE user_exam (...);       -- 考试记录
```

**JSON 字段示例**（`questions.options`）：
```json
// 单选题
{"A":"选项A","B":"选项B","C":"选项C","D":"选项D"}
// 判断题（空对象）
{}
```

### 第三步：编写后端 API（Workers）

**Cloudflare Workers 是边缘计算平台**，用 JavaScript 写的函数在全球 300+ 节点运行。

```js
// ESModule 格式
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const db = env.DB;  // D1 绑定
    
    // 路由模式：手动判断 pathname
    if (url.pathname === "/api/bank/list" && method === "GET") {
      const result = await db.prepare("SELECT * FROM question_bank").all();
      return Response.json(result.results);
    }
  }
};
```

**19 个 API 接口**：

| 分类 | 接口 | 方法 | 功能 |
|------|------|------|------|
| 题库 | `/api/bank/list` | GET | 所有题库列表 |
| | `/api/bank` | GET | 单个题库信息 |
| | `/api/bank/count` | GET | 题库总题数 |
| 题目 | `/api/question/seq` | GET | 顺序取单题 |
| | `/api/question/random` | GET | 随机抽题 |
| 错题 | `/api/user/wrong` | POST | 标记错题 |
| | `/api/user/wrong-list` | GET | 错题列表 |
| 收藏 | `/api/user/collect` | POST | 收藏/取消 |
| | `/api/user/collect-list` | GET | 收藏列表 |
| 斩题 | `/api/user/master` | POST | 斩题标记 |
| | `/api/user/master-list` | GET | 斩题列表 |
| 笔记 | `/api/user/note` | POST | 保存笔记 |
| | `/api/user/note-list` | GET | 笔记列表 |
| 易错 | `/api/user/easy-wrong` | GET | 高频错题 |
| 考试 | `/api/exam/submit` | POST | 提交判分 |
| | `/api/exam/records` | GET | 考试记录 |
| 状态 | `/api/user/question-status` | GET | 单题综合状态 |

### 第四步：开发前端（Pages）

**Cloudflare Pages 是静态网站托管**，支持 HTML/CSS/JS + Functions。

**前端架构**：
- **无框架依赖**：原生 ES Module，`<script type="module">`
- **移动端优先**：480px 最大宽，卡片式设计，触摸优化
- **5 个页面**：首页、刷题、错题中心、考试、设置

```html
<!-- ES Module 引入 -->
<script type="module">
  import { getBankList, getBankCount } from "./js/api.js";
  
  // 所有 API 调用走相对路径（由 Pages Functions 代理）
  const BASE_API = "";  // 空字符串 = 同域名
</script>
```

### 第五步：配置 Pages Functions 代理

**Pages Functions 是 Pages 上的后端函数**，可以拦截请求做转发。

```
functions/
  api/
    [[path]].js     # 双括号是 Pages 的通配符语法
```

```js
// [[path]].js 捕获 /api/* 所有请求
export async function onRequest(context) {
  const { request, env } = context;
  // 通过 Service Binding 转发给 Worker
  return env.QUIZ_WORKER.fetch(request);
}
```

**为什么要这样做？**
- 前端 `BASE_API = ""`，API 请求走同域名 `/api/xxx`
- 浏览器看到的是同一个域名，不需要处理跨域
- Worker 和 Pages 内部通信，不经过公网

### 第六步：数据导入

```bash
# 1. 建表
npx wrangler d1 execute quiz-db --file database/init.sql --remote

# 2. 导数据（seed.sql 约 2MB）
npx wrangler d1 execute quiz-db --file database/seed.sql --remote
```

> 如果文件太大超出 D1 限制（约 1MB），需要分批导入。

---

## 🚀 部署完整流程

### 1. 安装工具

```bash
npm install --save-dev wrangler
npx wrangler login  # 浏览器授权
```

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create quiz-db
# 输出 database_id，复制到 wrangler.toml
```

### 3. 建表 + 导数据

```bash
npx wrangler d1 execute quiz-db --file database/init.sql --remote
npx wrangler d1 execute quiz-db --file database/seed.sql --remote
```

### 4. 部署 Worker

```bash
npx wrangler deploy
# 输出：https://quiz-worker.xxx.workers.dev
```

### 5. 部署 Pages

```bash
npx wrangler pages deploy frontend/ --project-name quiz-app --branch main
# 输出：https://xxx.quiz-app.pages.dev
```

### 6. 配置 Service Binding（前端的pages服务这个绑定是非常重要的，不然访问不到后端的服务）

**Cloudflare Dashboard → Workers & Pages → quiz-app → Settings → Functions → Service Bindings**

| 字段 | 值 |
|------|------|
| Variable name | `QUIZ_WORKER` |
| Service | `quiz-worker` |

### 7. 绑定自定义域名

**Dashboard → quiz-app → Custom domains → Add custom domain**

输入你的域名（如 `test.liyekai.dpdns.org`），Cloudflare 会自动配置 DNS。

### 部署后的文件结构（线上）

```
Pages（静态文件）                    Worker（API）
  /index.html                        /api/bank/list
  /practice.html                     /api/question/seq
  /exam.html                         /api/user/collect
  /wrong-collect.html               /api/exam/submit
  /css/main.css                      ...
  /js/api.js
  /api/*（由 [[path]].js 代理到 Worker）
```

---

## ☁️ Cloudflare 服务详解

### Workers（计算）

Workers 是 Cloudflare 的**边缘函数计算平台**。你的 JS 代码在全球 300+ 数据中心运行，离用户最近。

**特点**：
- ESModule 格式（`export default { fetch() }`）
- 自动扩展，无需管理服务器
- 冷启动极快（毫秒级）
- 支持绑定 D1/R2/KV 等资源

**限制**：
- 免费版每天 10 万次请求
- 函数执行超时 30 秒（免费）/ 60 秒（付费）
- 代码包最大 1MB

### Pages（托管）

Pages 是 Cloudflare 的**静态网站托管平台**，类似 GitHub Pages + Vercel。

**特点**：
- 支持 Git 自动部署（连接 GitHub 仓库后，推送即部署）
- 支持 Functions（后端逻辑）
- 支持自定义域名 + HTTPS
- 全球 CDN 加速

### Pages Functions（代理层）

Pages Functions 是 Pages 项目中的**后端函数**，可以处理动态请求。

**文件命名规则**：
- `functions/api/[[path]].js` — 捕获 `/api/` 下的所有路径
- `functions/api/hello.js` — 只匹配 `/api/hello`
- `functions/[[catchall]].js` — 匹配所有路径（用于 SPA 路由）

### D1（数据库）

D1 是 Cloudflare 的 **SQLite 兼容的关系型数据库**，直接在全球边缘运行。

**特点**：
- SQLite 语法（列名小写蛇形）
- 支持 JOIN、索引、事务
- 每个 Worker 请求共享连接池
- 免费版 5GB 存储

### Service Binding（服务连接）

Service Binding 允许**一个 Cloudflare 服务直接调用另一个**，不走公网。

```
Pages Functions         Worker
env.QUIZ_WORKER  ─────>  fetch(request)
    │                       │
    │                   env.DB（D1）
    │                       │
    └─────────────────── 返回 Response
```

本质：Pages Functions 的 `env.QUIZ_WORKER.fetch(request)` 直接调用 Worker 的 `fetch` 方法。

---

## 🔄 更新部署流程

修改代码后重新部署：

```bash
# 更新 Worker
npx wrangler deploy

# 更新 Pages（前端）
npx wrangler pages deploy frontend/ --project-name quiz-app --branch main --commit-dirty=true
```

或者配置好 GitHub 集成后，推送代码到 main 分支就自动部署 Pages。

---

## 🧩 后续开发拓展

### 短期优化

| 功能 | 说明 |
|------|------|
| 答题统计 | 在首页展示总正确率、错题率图表 |
| 搜索题目 | 按关键词搜索题目（D1 支持 LIKE） |
| 导出错题 | 将错题导出为 PDF/TXT |
| 夜间模式 | 增加暗色主题 CSS |
| 刷题提醒 | 每日刷题打卡 |
| 排行榜 | 模拟考试分数排名（需要用户系统） |

### 中期功能

| 功能 | 说明 |
|------|------|
| 用户登录 | 接入微信扫码 / 手机号登录 |
| 多题库切换 | 不同试卷选择（已有基础） |
| 学习计划 | 设定每日刷题目标 |
| AI 解析 | 调用 Workers AI 解释题目 |
| 数据分析 | 用 D1 SQL 分析薄弱知识点 |

### 架构扩展

```
用户登录 → 接入 Cloudflare Access 或 Auth0
文件上传 → Cloudflare R2（兼容 S3）
实时推送 → Cloudflare WebSocket（Durable Objects）
AI 辅助 → Workers AI（Llama / 通义千问）
CDN 加速 → Cloudflare Cache（静态资源）
```

---

## 💡 常用命令速查

```bash
# 本地开发
npx wrangler dev                       # 启动本地服务器
npx wrangler dev --remote              # 使用远程数据库

# 部署
npx wrangler deploy                    # 部署 Worker
npx wrangler pages deploy ./frontend   # 部署 Pages

# D1 数据库
npx wrangler d1 list                   # 列出所有数据库
npx wrangler d1 info quiz-db           # 查看数据库信息
npx wrangler d1 execute quiz-db --command "SELECT COUNT(*) FROM questions" --remote
npx wrangler d1 execute quiz-db --file ./database/init.sql --remote

# 日志调试
npx wrangler tail                      # 实时查看 Worker 日志
npx wrangler tail --status error       # 只看错误日志

# 授权
npx wrangler whoami                    # 查看当前登录账号
npx wrangler logout                    # 退出登录
```

---

## 📚 关键概念总结

| 概念 | 类比 | 作用 |
|------|------|------|
| **Workers** | 服务器代码（Node.js 即服务） | 处理 API 请求，查询数据库 |
| **Pages** | 网页托管（Vercel/Netlify） | 存放 HTML/CSS/JS 静态文件 |
| **Pages Functions** | API 路由层 | 拦截请求，转发给 Worker |
| **D1** | 数据库（SQLite） | 存储题库和用户数据 |
| **Service Binding** | 内部连接 | 让 Pages 直接调用 Worker |
| **wrangler.toml** | 项目配置 | Worker 名称、绑定资源、兼容性设置 |
| **wrangler** | CLI 工具 | 登录、部署、调试、数据库管理 |

---

## 🎯 建站的核心理念

```
用户访问 → DNS 解析 → CDN 加速 → 
文件请求（Pages 返回静态页面）+ 
API 请求（Pages Functions → Worker → D1）
         → 响应 JSON → 前端渲染

所有步骤都在 Cloudflare 内部完成，
一个平台搞定 DNS + CDN + 计算 + 存储
```

这就是 **全栈边缘计算** —— 前端和后端都在 Cloudflare 上，不需要自己管服务器。
