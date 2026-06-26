-- ========================================
-- 刷题系统 D1 初始化建表 SQL
-- 在 CF D1 控制台 → 新建查询 中执行
-- ========================================

-- 题库表
CREATE TABLE IF NOT EXISTS question_bank (
  bank_id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_name TEXT NOT NULL,
  total_questions INTEGER DEFAULT 0,
  create_time TEXT,
  collect_total INTEGER DEFAULT 0
);

-- 题目表
CREATE TABLE IF NOT EXISTS questions (
  q_id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  question_type TEXT NOT NULL, -- single单选 multi多选 judge判断
  options TEXT NOT NULL DEFAULT '{}', -- JSON {"A":"内容","B":"内容"}
  standard_answer TEXT NOT NULL DEFAULT '',
  analysis TEXT DEFAULT '',
  sort_index INTEGER,
  global_error_rate REAL DEFAULT 0,
  FOREIGN KEY (bank_id) REFERENCES question_bank(bank_id)
);

-- 用户错题记录
CREATE TABLE IF NOT EXISTS user_wrong (
  uid TEXT NOT NULL,
  q_id INTEGER NOT NULL,
  wrong_times INTEGER DEFAULT 1,
  last_time TEXT,
  PRIMARY KEY (uid, q_id)
);

-- 用户收藏
CREATE TABLE IF NOT EXISTS user_collect (
  uid TEXT NOT NULL,
  q_id INTEGER NOT NULL,
  create_time TEXT,
  PRIMARY KEY (uid, q_id)
);

-- 斩题（已掌握）
CREATE TABLE IF NOT EXISTS user_master (
  uid TEXT NOT NULL,
  q_id INTEGER NOT NULL,
  create_time TEXT,
  PRIMARY KEY (uid, q_id)
);

-- 单题笔记
CREATE TABLE IF NOT EXISTS user_note (
  uid TEXT NOT NULL,
  q_id INTEGER NOT NULL,
  content TEXT,
  update_time TEXT,
  PRIMARY KEY (uid, q_id)
);

-- 模拟考试记录
CREATE TABLE IF NOT EXISTS user_exam (
  record_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  bank_id INTEGER,
  score INTEGER,
  total INTEGER,
  create_time TEXT,
  wrong_list TEXT -- JSON数组存错题id列表
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id, sort_index);
CREATE INDEX IF NOT EXISTS idx_user_wrong_uid ON user_wrong(uid);
CREATE INDEX IF NOT EXISTS idx_user_collect_uid ON user_collect(uid);
CREATE INDEX IF NOT EXISTS idx_user_exam_uid ON user_exam(uid);
