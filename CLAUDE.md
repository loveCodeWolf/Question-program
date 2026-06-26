# 刷题系统 — 项目规划文档

## 📱 项目定位

基于 **Cloudflare Pages + Workers + D1** 的全栈刷题系统，**手机端优先**（移动端适配是第一等公民）。

**题库内容**：治安管理处罚法相关，合并两个源文件（共 **1809 题**）：
1. `新治管法题目.docx` — 新治安管理处罚法（汇总）— **545 题**（判断184 + 单选229 + 多选132）
2. `题库汇总(包含2024年省厅新增题库).docx` — 综合题库（出入境、道交法等）— **1264 题**（判断327 + 单选519 + 多选418）

---

## 📂 目录结构

```
quiz-system/
├── frontend/                  # Pages 静态前端
│   ├── index.html            # 首页（题库信息 + 功能入口）
│   ├── practice.html         # 刷题页（顺序/随机）
│   ├── wrong-collect.html    # 错题/收藏/斩题/笔记（四合一Tab页）
│   ├── exam.html             # 模拟考试页
│   ├── css/
│   │   └── main.css          # 全局样式（移动端自适应）
│   └── js/
│       └── api.js            # Workers API 封装
├── worker/                    # Workers 后端
│   ├── wrangler.toml         # Worker 配置 + D1 绑定
│   └── src/
│       └── index.js          # 所有 API 路由
├── database/
│   ├── init.sql              # D1 建表 SQL
│   ├── seed.sql              # 合并后的题库 INSERT 语句
│   └── questions.json        # 解析输出的完整 JSON
├── scripts/
│   └── parse-docx.js         # 【核心】双格式解析器
├── wrangler.toml
├── package.json
└── CLAUDE.md
```

---

## 🗄️ 题库源文件 & 数据格式（关键！）

### 文件1：`新治管法题目.docx`
题型：判断题 + 单选题  
格式特点：`答案：对/错` / `答案：X`（冒号+空格），`解析：...`

**判断题**：
```
{N}.题干内容 答案：对/错 解析：{解析内容}
```
示例：
```
1.为方便自己农场通信，未经批准私自设置一台小型无线电通信基站...
答案：错
解析："未经批准设置无线电广播电台..."该条款以"是否批准"为核心判断...
```

**单选题**：
```
{N}.题干内容 A.{选项} B.{选项} C.{选项} D.{选项} 答案：{字母} 解析：{解析内容}
```
示例：
```
1.下列哪种行为，属于《治安管理处罚法》第三十二条第三项规定的违法行为？（）
A.张三经批准设置无线基站后...
B.李四未取得许可，私自设置无线电广播电台...
C.王五已取得无线电频率使用许可...
D.赵六因设备故障，临时关闭已批准设置的无线电台...
答案：B
解析：ACD选项中都已取得许可，且进行合规操作。
```

### 文件2：`题库汇总(包含2024年省厅新增题库).docx`
题型：单选题 + 多选题 + 判断题  
格式特点：`【答案】X` / `【正确答案:】X`（方括号+答案），`【解析】...`

**单选题**：
```
{N}、题干 A．选项 B．选项 C．选项 D．选项 【答案】X 【解析】{解析}
```
示例：
```
1、对违反出境入境管理行为处（ ）以下罚款的，出入境边防检查机关可以当场作出处罚决定。
A．200元 B．300元 C．500元 D．1000元
【答案】C
【解析】本题考察《中华人民共和国出境入境管理法》...
```

**多选题**（答案含多个字母）：
```
5、外国人有下列（）情形的，可以遣送出境。
A．被处限期出境，未在规定期限内离境的 B．有不准入境情形的 C．非法居留的 D．非法就业的
【答案】ABCD
【解析】本题考察《中华人民共和国出入境管理法》第六十二条...
```

**判断题**（同文件1不同格式）：
```
9、对外国人限制活动范围的期限不得超过60日...
【答案】对
【解析】本题考察...
```

> **注意**：实际 docx 中格式是混合的（`答案：` / `【答案】` / `【正确答案:】` 混用），解析脚本统一处理。

### 解析脚本策略 `scripts/parse-docx.js`

1. 用 `mammoth` 提取 docx 纯文本段落，按题号 (`数字.` 或 `数字、`) 切割为单题
2. **统一正则匹配答案/解析**（不分文件，同时兼容）：
   - 答案：`答案：X` / `答案:X` / `【答案】X` / `【答案:】X` / `【正确答案】X` / `【正确答案:】X`
   - 解析：`解析：...` / `【解析】...` / `【解析:】...`
3. **答案归一化**：
   - `正确/√/Yes` → `对`，`错误/×/No` → `错`
   - 多选题答案去逗号/空格/顿号，去重排序（`A, B, C` → `ABC`）
   - 去掉多余标点（`B。` → `B`）
4. **题型判断**：
   - 答案 `对/错` → `judge`（判断题）
   - 答案多字母如 `ABCD` → `multi`（多选题）
   - 答案单字母如 `A` → `single`（单选题）
   - 答案长文本 → `single`（案例分析题）
5. **过滤规则**：题目**必须至少包含「答案」或「解析」之一**才录入
6. 输出 `database/questions.json` + `database/seed.sql`

### 解析验证结果

- ✅ 总题数：**1809**
- ✅ 有答案：**1801** | 有解析：**1449**
- ✅ 题型分布：判断 **511** / 单选 **748** / 多选 **550**
- ✅ 残留异常答案：**0**
- ✅ 抽样验证全部通过（含边界案例：`【正确答案:】`、跨行答案、案例分析题等）

---

## 🎨 移动端设计原则

| 原则 | 实现方式 |
|------|----------|
| 视口锁定 | `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">` |
| 布局 | 单列流式，flex 布局，禁止横向滚动 |
| 点击区域 | ≥ 44×44px，`:active` 按压态反馈 |
| 字号 | 基础 16px（防 iOS 缩放），行高 1.6 |
| 选项样式 | 大圆角卡片式，选中时高亮变色 |
| 弹窗 | 居中 Modal（随机数量、考试确认等） |
| 防长按 | `user-select: none`，`-webkit-touch-callout: none` |

---

## 🧩 页面设计

### index.html（首页）
- 题库名称 + 元信息（创建时间、总题量、收藏人数）
- 四大入口卡片：错题 / 收藏 / 斩题 / 笔记
- 两大刷题模式：顺序练习 + 随机练习（弹窗选数量）
- 底部：易错题专区 + 模拟考试

### practice.html（刷题核心页）
- **题型自适应**：`question_type` 字段决定渲染方式
  - `judge` → 对/错两个大按钮
  - `single` → ABCD 四个选项卡片
  - `multi` → ABCD 多选（可勾选多个）
- **模式**：顺序刷题 `?type=seq` / 随机刷题 `?type=random`
- **交互流程**：展示题目 → 选择 → 对比答案 → 显示解析 → 下一题
- **辅助功能**：收藏（★/☆ 切换）、斩题、笔记、自动标记错题

### wrong-collect.html（四合一Tab页）
- 错题 / 收藏 / 斩题 / 笔记 四个 Tab
- 点击单题跳转到 practice.html 回顾

### exam.html（模拟考试）
- 计时器 + 自动交卷
- 逐题作答，可前后回看
- 提交判分 → 显示得分 + 错题列表

---

## 🔌 API 接口

| 接口 | 方法 | 参数 | 返回 |
|------|------|------|------|
| `/api/bank` | GET | bankId | 题库信息 |
| `/api/bank/count` | GET | bankId | `{total}` |
| `/api/question/seq` | GET | bankId, idx | 单题（含 options JSON） |
| `/api/question/random` | GET | bankId, num | 随机题目数组 |
| `/api/user/wrong` | POST | uid, qId | `{code:0}` |
| `/api/user/collect` | POST | uid, qId, isCollect | `{code:0}` |
| `/api/user/wrong-list` | GET | uid, bankId | 高频错题 |
| `/api/user/master` | POST | uid, qId | 斩题标记 |
| `/api/user/note` | POST | uid, qId, content | 笔记保存 |
| `/api/exam/submit` | POST | uid, answers, bankId | `{score, wrongList}` |

---

## 📦 D1 数据库表

| 表名 | 关键字段 |
|------|----------|
| `question_bank` | bank_id, bank_name, total_questions, create_time |
| `questions` | q_id, bank_id, title, question_type(`single`/`multi`/`judge`), options(JSON), standard_answer, analysis, sort_index |
| `user_wrong` | uid, q_id, wrong_times, last_time |
| `user_collect` | uid, q_id, create_time |
| `user_master` | uid, q_id |
| `user_note` | uid, q_id, content |
| `user_exam` | record_id, uid, score, create_time, wrong_list(JSON) |

**options 字段存储示例**：
```json
// 单选题
{"A":"选项A文本","B":"选项B文本","C":"选项C文本","D":"选项D文本"}
// 判断题（空对象，无需选项）
{}
```

---

## 🗺️ 开发路线图

### Phase 0：题库数据准备 ✅
- [x] `scripts/parse-docx.js` — 解析两个 docx，输出 1809 题 JSON + SQL
- [x] 验证：逐题对比源文件，确保题干/选项/答案/解析完整准确
- [x] 过滤：无答案且无解析的题目自动跳过（共跳过 33 条）
- [x] 答案归一化：兼容 `答案：` / `【答案】` / `【正确答案:】` 等多种格式
- [x] 生成 `database/seed.sql` + `database/questions.json`

### Phase 1：项目骨架 ✅
- [x] `worker/wrangler.toml` — Worker 配置 + D1 绑定
- [x] `worker/src/index.js` — 完整后端 API（19 个接口：题库/错题/收藏/斩题/笔记/考试）
- [x] `database/init.sql` — D1 建表（7 张表 + 索引）
- [x] D1 数据库建库、建表、导数据

### Phase 2：前端开发 ✅
- [x] `frontend/css/main.css` — 移动端框架（480px 最大宽、卡片式、触摸优化）
- [x] `frontend/js/api.js` — 接口封装 + 本地进度缓存
- [x] `frontend/index.html` — 首页（题库信息 + 四大入口 + 刷题模式 + 弹窗）
- [x] `frontend/practice.html` — 刷题核心（判断/单选/多选三种题型，收藏/斩题/笔记）
- [x] `frontend/wrong-collect.html` — 四合一（错题/收藏/斩题/笔记/易错 Tab）
- [x] `frontend/exam.html` — 模拟考试（计时 + 题号导航 + 自动判分 + 错题回顾）

### Phase 3：部署上线
- [ ] Workers 部署（`npx wrangler deploy`）
- [ ] Pages 部署（绑定 GitHub 仓库，输出目录 frontend）
- [ ] D1 数据库创建 + 导入 seed.sql
- [ ] Pages Functions 路由 `/api/*` → Worker

---
### Phase 4：启动
- npx wrangler deploy
- npx wrangler pages deploy frontend/ --project-name quiz-app --branch main --commit-dirty=true

---

## 📝 编码规范

- **前端**：ES Module，`<script type="module">`，无框架依赖
- **后端**：ESModule Workers，`export default { async fetch(request, env, ctx) }`
- **CSS**：BEM 命名，媒体查询 480px/768px
- **API**：统一 JSON `{code, msg, data}`
- **数据库**：小写蛇形字段名，options 存 JSON 字符串
- **docx 解析**：注意两种格式差异（`答案：` vs `【答案】`），不得截断解析内容；无答案且无解析的题目跳过
