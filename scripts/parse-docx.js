/**
 * parse-docx.js — 解析两个 docx 题库文件，输出合并后的 JSON + SQL
 *
 * 支持两种格式：
 *   格式A（新治管法题目.docx）：答案：X  /  解析：...
 *   格式B（题库汇总.docx）：    【答案】X  /  【解析】...
 *
 * 规则：既无答案也无解析的题目 → 跳过
 *
 * 用法: node scripts/parse-docx.js
 */

const mammoth = require("mammoth");
const fs = require("fs");
const path = require("path");

// ======== 配置 ========
const FILES = [
  {
    path: path.join(__dirname, "..", "新治管法题目.docx"),
    bankId: 1,
    bankName: "新治安管理处罚法（汇总）",
  },
  {
    path: path.join(__dirname, "..", "题库汇总(包含2024年省厅新增题库).docx"),
    bankId: 2,
    bankName: "题库汇总（含2024省厅新增）",
  },
];

const OUTPUT_JSON = path.join(__dirname, "..", "database", "questions.json");
const OUTPUT_SQL = path.join(__dirname, "..", "database", "seed.sql");

// ======== 正则（同时兼容多种格式） ========
// 答案：匹配 "答案：X" / "【答案】X" / "【答案:】X" / "【正确答案】X" 等
const RE_ANSWER =
  /(?:答案[：:]\s*|【[^】]*?[答案][^】]*?】\s*)(.+?)(?=\s*(?:解析[：:]|【解析】|$))/;

// 解析：匹配 "解析：..." / "【解析】..." / "【解析:】..." 等
const RE_ANALYSIS = /(?:解析[：:]\s*|【[^】]*?解析[^】]*?】\s*)(.+)/s;

// 统一清除末尾的答案/解析标记（从题干/正文中剥离）
function removeAnswerAnalysisMarkers(text) {
  // 按行处理，去掉包含答案/解析的行或末尾标记
  let result = text;
  // 去掉 "【答案】X" 到行尾 或 "答案：X" 到行尾
  result = result.replace(/(?:答案[：:]\s*|【[^】]*?】\s*)(?:对|错|√|×|[A-D][A-D\s,，、]*)(?=\s*$|\s*[【\n]?)/g, "");
  // 去掉 "解析：..." 或 "【解析】..." 到行尾
  result = result.replace(/(?:解析[：:]\s*|【[^】]*?解析[^】]*?】\s*).*$/s, "");
  // 去掉单独的 "【答案】" 或 "【解析】" 类空标记
  result = result.replace(/【[^】]*?[答案析][^】]*?】/g, "");
  return result.trim();
}

// 答案归一化：处理各种格式变体为标准答案
function normalizeAnswer(answer) {
  if (!answer) return "";

  let a = answer.trim();

  // 去掉中文/英文逗号、空格、顿号（多选题答案分隔符）
  a = a.replace(/[，,、\s]+/g, "");

  // 去掉多余标点符号后缀和前导冒号
  a = a.replace(/^[：:]+/, "").replace(/[。，、：；？！.。，、:;!?]+$/, "");

  // 统一判断题答案
  if (/^(对|√|正确|是|Yes)$/i.test(a)) return "对";
  if (/^(错|×|错误|否|No)$/i.test(a)) return "错";

  // 多选题答案：只保留字母，去重、排序
  const letters = a.replace(/[^A-Da-d]/g, "").toUpperCase();
  if (letters.length > 1) {
    // 去重并保持顺序
    return [...new Set(letters.split(""))].sort().join("");
  }

  // 单选题：单个字母
  if (/^[A-D]$/.test(letters)) return letters;

  // 其他情况返回原值（案例分析题等）
  return a;
}

// 题目起始（数字开头）
const RE_Q_START = /^(\d+)[.、]\s*/;

// 选项匹配：A.B.C.D. 或 A．B．C．D．
const RE_OPTIONS = /[A-D][.．]/g;

// ======== 读取 docx ========
async function extractRawText(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

// ======== 将段落拼接成完整题目列表 ========
function splitIntoQuestions(paragraphs) {
  const questions = [];
  let current = [];
  let currentNum = null;

  for (const line of paragraphs) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(RE_Q_START);
    if (match) {
      // 遇到新题号，先把之前的存起来
      if (current.length > 0 && currentNum !== null) {
        questions.push({ num: currentNum, text: current.join("\n") });
      }
      currentNum = parseInt(match[1]);
      current = [trimmed];
    } else {
      if (currentNum !== null) {
        current.push(trimmed);
      }
    }
  }
  // 最后一题
  if (current.length > 0 && currentNum !== null) {
    questions.push({ num: currentNum, text: current.join("\n") });
  }

  return questions;
}

// ======== 解析单题（统一处理两种格式） ========
function parseQuestion(q, bankId, bankName) {
  const { num, text } = q;

  // ---- 提取答案 & 解析（同时兼容两种格式） ----
  let answer = null;
  let analysis = null;

  const ansMatch = text.match(RE_ANSWER);
  if (ansMatch) answer = ansMatch[1].trim();

  const anaMatch = text.match(RE_ANALYSIS);
  if (anaMatch) analysis = anaMatch[1].trim();

  // 答案归一化
  if (answer) answer = normalizeAnswer(answer);

  // 过滤：无答案 且 无解析 → 跳过
  if (!answer && !analysis) {
    return null;
  }

  // ---- 判断题型 ----
  let questionType = "single"; // 默认
  let title = text;
  const options = {};

  // 提取题干（去掉题号前缀）
  title = title.replace(RE_Q_START, "").trim();

  // 去除答案/解析标记后的正文（用于提取选项）
  let bodyForOptions = text;
  bodyForOptions = removeAnswerAnalysisMarkers(bodyForOptions);
  bodyForOptions = bodyForOptions.replace(RE_Q_START, "").trim();

  // 判断题型
  if (answer === "对" || answer === "错" || answer === "√" || answer === "×") {
    questionType = "judge";
  } else if (answer && answer.length >= 2 && /^[A-D]+$/.test(answer)) {
    // 多选题答案如 ABCD、ABC 等
    questionType = "multi";
    // 提取选项
    extractOptions(bodyForOptions, options);
  } else if (answer && /^[A-D]$/.test(answer)) {
    questionType = "single";
    extractOptions(bodyForOptions, options);
  } else {
    // 有答案但格式不明确，尝试从正文判断
    if (answer && /^[A-D]+$/.test(answer)) {
      questionType = answer.length > 1 ? "multi" : "single";
      extractOptions(bodyForOptions, options);
    }
  }

  // 修复题干：去掉答案/解析残留
  title = removeAnswerAnalysisMarkers(title);
  title = title.replace(RE_Q_START, "").trim();

  // 如果题干过长，可能混入了选项行，截取到第一个选项前
  const optionMatch = title.match(/\s*[A-D][.．]/);
  if (optionMatch && optionMatch.index > 5) {
    title = title.substring(0, optionMatch.index).trim();
  }

  return {
    bank_id: bankId,
    bank_name: bankName,
    sort_index: num,
    title,
    question_type: questionType,
    options: Object.keys(options).length > 0 ? JSON.stringify(options) : "{}",
    standard_answer: answer || "",
    analysis: analysis || "",
  };
}

// ======== 提取选项 A/B/C/D ========
function extractOptions(text, options) {
  // 匹配 A.xxx B.xxx C.xxx D.xxx （支持 . 和 ．）
  const optRegex = /([A-D])\s*[.．]\s*([^A-D]*?)(?=(?:[A-D]\s*[.．])|$)/g;
  let match;
  while ((match = optRegex.exec(text)) !== null) {
    const key = match[1];
    let val = match[2].trim();
    // 去掉尾部的答案/解析等残留
    val = removeAnswerAnalysisMarkers(val)
    if (val) {
      options[key] = val;
    }
  }

  // 如果上述正则没匹配到，用简单分割
  if (Object.keys(options).length === 0) {
    const lines = text.split("\n");
    for (const line of lines) {
      const optMatch = line.match(/^\s*([A-D])\s*[.．]\s*(.+)/);
      if (optMatch) {
        options[optMatch[1]] = optMatch[2].trim();
      }
    }
  }
}

// ======== 主流程 ========
async function main() {
  const allQuestions = [];
  let totalSkipped = 0;

  for (const file of FILES) {
    console.log(`\n========== 正在解析: ${file.bankName} ==========`);
    console.log(`文件路径: ${file.path}`);

    if (!fs.existsSync(file.path)) {
      console.warn(`  ⚠ 文件不存在，跳过: ${file.path}`);
      continue;
    }

    const rawText = await extractRawText(file.path);
    const paragraphs = rawText.split("\n");
    console.log(`  总段落数: ${paragraphs.length}`);

    const rawQuestions = splitIntoQuestions(paragraphs);
    console.log(`  识别到题目数: ${rawQuestions.length}`);

    let parsed = 0;
    let skipped = 0;

    for (const q of rawQuestions) {
      // 过滤明显不是题目的内容（纯数字行、太短的等）
      if (q.text.length < 5) {
        skipped++;
        continue;
      }

      const result = parseQuestion(q, file.bankId, file.bankName);
      if (result) {
        allQuestions.push(result);
        parsed++;
      } else {
        skipped++;
      }
    }

    console.log(`  解析成功: ${parsed} 题`);
    console.log(`  跳过: ${skipped} 题（无答案且无解析 或 非题目内容）`);
    totalSkipped += skipped;
  }

  console.log(`\n========== 汇总 ==========`);
  console.log(`总题数: ${allQuestions.length}`);
  console.log(`总跳过: ${totalSkipped}`);

  // ---- 统计 ----
  const types = {};
  for (const q of allQuestions) {
    types[q.question_type] = (types[q.question_type] || 0) + 1;
  }
  console.log(`题型分布:`, types);

  const withAnalysis = allQuestions.filter((q) => q.analysis).length;
  const withAnswer = allQuestions.filter((q) => q.standard_answer).length;
  console.log(`有解析: ${withAnalysis} 题`);
  console.log(`有答案: ${withAnswer} 题`);

  // ---- 输出 JSON ----
  const outDir = path.dirname(OUTPUT_JSON);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(allQuestions, null, 2), "utf-8");
  console.log(`\n✅ JSON 已输出: ${OUTPUT_JSON}`);

  // ---- 输出 SQL（按 bank_id 分批 INSERT） ----
  let sql = `-- ========================================\n`;
  sql += `-- 刷题系统 seed.sql — 自动生成于 ${new Date().toISOString()}\n`;
  sql += `-- 来源：${FILES.map((f) => f.bankName).join(" + ")}\n`;
  sql += `-- 总题数: ${allQuestions.length}\n`;
  sql += `-- ========================================\n\n`;

  // 清空旧数据
  sql += `DELETE FROM questions;\n`;
  sql += `DELETE FROM question_bank;\n`;
  sql += `DELETE FROM user_wrong;\n`;
  sql += `DELETE FROM user_collect;\n`;
  sql += `DELETE FROM user_master;\n`;
  sql += `DELETE FROM user_note;\n`;
  sql += `DELETE FROM user_exam;\n\n`;

  for (const file of FILES) {
    if (!fs.existsSync(file.path)) continue;
    sql += `-- ${file.bankName}\n`;
    sql += `INSERT INTO question_bank(bank_id, bank_name, total_questions, create_time) VALUES(${file.bankId}, '${file.bankName}', ${allQuestions.filter((q) => q.bank_id === file.bankId).length}, datetime('now'));\n\n`;
  }

  // 分批 INSERT（每批 50 条）
  const BATCH_SIZE = 50;
  for (let i = 0; i < allQuestions.length; i += BATCH_SIZE) {
    const batch = allQuestions.slice(i, i + BATCH_SIZE);
    sql += `INSERT INTO questions(bank_id, title, question_type, options, standard_answer, analysis, sort_index) VALUES\n`;
    const valueLines = batch.map((q) => {
      const title = q.title.replace(/'/g, "''");
      const analysis = q.analysis.replace(/'/g, "''");
      const options = q.options;
      const answer = q.standard_answer.replace(/'/g, "''");
      return `(${q.bank_id}, '${title}', '${q.question_type}', '${options}', '${answer}', '${analysis}', ${q.sort_index})`;
    });
    sql += valueLines.join(",\n");
    sql += ";\n\n";
  }

  fs.writeFileSync(OUTPUT_SQL, sql, "utf-8");
  console.log(`✅ SQL 已输出: ${OUTPUT_SQL}  (${allQuestions.length} 条 INSERT)`);
}

main().catch(console.error);
