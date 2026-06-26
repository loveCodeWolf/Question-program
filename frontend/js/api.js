/**
 * api.js — 刷题系统前端接口封装
 * Workers 接口域名前缀，部署后修改 BASE_API
 */
const BASE_API = ""; // 部署后改为你的 Pages 域名，如 "https://xxx.pages.dev"

// 用户 ID（localStorage 持久化）
function getUid() {
  let uid = localStorage.getItem("quiz_uid");
  if (!uid) {
    uid = "u_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("quiz_uid", uid);
  }
  return uid;
}

async function fetchApi(path, options = {}) {
  const url = BASE_API + path;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return res.json();
}

// ---- 题库 ----

export function getBankCount(bankId) {
  return fetchApi(`/api/bank/count?bankId=${bankId}`);
}

// ---- 题目 ----

export function getSeqQuestion(bankId, idx) {
  return fetchApi(`/api/question/seq?bankId=${bankId}&idx=${idx}`);
}

export function getRandomQuestions(bankId, num) {
  return fetchApi(`/api/question/random?bankId=${bankId}&num=${num}`);
}

// ---- 错题 ----

export function markWrong(qId) {
  return fetchApi(`/api/user/wrong`, {
    method: "POST",
    body: JSON.stringify({ uid: getUid(), qId }),
  });
}

export function getWrongList(bankId) {
  return fetchApi(`/api/user/wrong-list?uid=${getUid()}&bankId=${bankId}`);
}

// ---- 收藏 ----

export function toggleCollect(qId, isCollect) {
  return fetchApi(`/api/user/collect`, {
    method: "POST",
    body: JSON.stringify({ uid: getUid(), qId, isCollect }),
  });
}

export function getCollectList(bankId) {
  return fetchApi(`/api/user/collect-list?uid=${getUid()}&bankId=${bankId}`);
}

export function checkCollected(qId) {
  return fetchApi(`/api/user/check-collect?uid=${getUid()}&qId=${qId}`);
}

// ---- 斩题 ----

export function toggleMaster(qId, isMaster) {
  return fetchApi(`/api/user/master`, {
    method: "POST",
    body: JSON.stringify({ uid: getUid(), qId, isMaster }),
  });
}

export function getMasterList(bankId) {
  return fetchApi(`/api/user/master-list?uid=${getUid()}&bankId=${bankId}`);
}

// ---- 笔记 ----

export function saveNote(qId, content) {
  return fetchApi(`/api/user/note`, {
    method: "POST",
    body: JSON.stringify({ uid: getUid(), qId, content }),
  });
}

export function getNoteList(bankId) {
  return fetchApi(`/api/user/note-list?uid=${getUid()}&bankId=${bankId}`);
}

export function getNote(qId) {
  return fetchApi(`/api/user/note-get?uid=${getUid()}&qId=${qId}`);
}

// ---- 易错题 ----

export function getEasyWrong(bankId) {
  return fetchApi(`/api/user/easy-wrong?uid=${getUid()}&bankId=${bankId}`);
}

// ---- 用户状态 ----

export function getQuestionStatus(qId) {
  return fetchApi(`/api/user/question-status?uid=${getUid()}&qId=${qId}`);
}

// ---- 模拟考试 ----

export function submitExam(bankId, answers) {
  return fetchApi(`/api/exam/submit`, {
    method: "POST",
    body: JSON.stringify({ uid: getUid(), bankId, answers }),
  });
}

export function getExamRecords() {
  return fetchApi(`/api/exam/records?uid=${getUid()}`);
}

// ---- 本地缓存工具（刷题状态） ----

const PROGRESS_KEY = "quiz_progress_";

export function saveProgress(bankId, idx) {
  try {
    localStorage.setItem(PROGRESS_KEY + bankId, String(idx));
  } catch (e) { /* ignore */ }
}

export function loadProgress(bankId) {
  try {
    return parseInt(localStorage.getItem(PROGRESS_KEY + bankId)) || 1;
  } catch {
    return 1;
  }
}
