/**
 * quiz-worker — 刷题系统后端 API
 * Cloudflare Workers ESModule 格式
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const db = env.DB;
    const method = request.method;

    // CORS 跨域头
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let result;

      // ==================== 题库接口 ====================

      // 1. 获取题库信息
      if (url.pathname === "/api/bank" && method === "GET") {
        const bankId = url.searchParams.get("bankId");
        result = await db.prepare("SELECT * FROM question_bank WHERE bank_id = ?").bind(bankId).first();
        return jsonResponse(result, corsHeaders);
      }

      // 2. 获取题库总题数
      if (url.pathname === "/api/bank/count" && method === "GET") {
        const bankId = url.searchParams.get("bankId");
        const { total } = await db.prepare("SELECT COUNT(*) total FROM questions WHERE bank_id = ?").bind(bankId).first();
        return jsonResponse({ total }, corsHeaders);
      }

      // 3. 顺序取单题（按 sort_index）
      if (url.pathname === "/api/question/seq" && method === "GET") {
        const bankId = url.searchParams.get("bankId");
        const idx = url.searchParams.get("idx");
        const q = await db.prepare("SELECT * FROM questions WHERE bank_id = ? AND sort_index = ?").bind(bankId, idx).first();
        if (!q) return jsonResponse({ error: "题目不存在" }, corsHeaders, 404);
        q.options = JSON.parse(q.options || "{}");
        return jsonResponse(q, corsHeaders);
      }

      // 4. 随机抽题
      if (url.pathname === "/api/question/random" && method === "GET") {
        const bankId = url.searchParams.get("bankId");
        const num = Math.min(Number(url.searchParams.get("num")) || 20, 200);
        const list = await db.prepare("SELECT * FROM questions WHERE bank_id = ? ORDER BY RANDOM() LIMIT ?").bind(bankId, num).all();
        const data = list.results.map(formatQuestion);
        return jsonResponse(data, corsHeaders);
      }

      // ==================== 用户错题 ====================

      // 5. 标记错题（做错新增/次数+1）
      if (url.pathname === "/api/user/wrong" && method === "POST") {
        const { uid, qId } = await request.json();
        if (!uid || !qId) return jsonResponse({ code: 1, msg: "参数缺失" }, corsHeaders, 400);
        const exist = await db.prepare("SELECT wrong_times FROM user_wrong WHERE uid=? AND q_id=?").bind(uid, qId).first();
        if (exist) {
          await db.prepare("UPDATE user_wrong SET wrong_times=wrong_times+1, last_time=datetime('now') WHERE uid=? AND q_id=?").bind(uid, qId).run();
        } else {
          await db.prepare("INSERT INTO user_wrong(uid,q_id,wrong_times,last_time) VALUES (?,?,1,datetime('now'))").bind(uid, qId).run();
        }
        return jsonResponse({ code: 0, msg: "ok" }, corsHeaders);
      }

      // 6. 个人错题列表
      if (url.pathname === "/api/user/wrong-list" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const bankId = url.searchParams.get("bankId");
        const list = await db.prepare(`
          SELECT q.*, uw.wrong_times, uw.last_time
          FROM user_wrong uw
          JOIN questions q ON uw.q_id = q.q_id
          WHERE uw.uid=? AND q.bank_id=?
          ORDER BY uw.last_time DESC
        `).bind(uid, bankId).all();
        return jsonResponse(list.results.map(formatQuestion), corsHeaders);
      }

      // ==================== 收藏 ====================

      // 7. 收藏/取消收藏
      if (url.pathname === "/api/user/collect" && method === "POST") {
        const { uid, qId, isCollect } = await request.json();
        if (!uid || !qId) return jsonResponse({ code: 1, msg: "参数缺失" }, corsHeaders, 400);
        if (isCollect) {
          await db.prepare("INSERT OR IGNORE INTO user_collect(uid,q_id,create_time) VALUES (?,?,datetime('now'))").bind(uid, qId).run();
        } else {
          await db.prepare("DELETE FROM user_collect WHERE uid=? AND q_id=?").bind(uid, qId).run();
        }
        return jsonResponse({ code: 0 }, corsHeaders);
      }

      // 8. 收藏列表
      if (url.pathname === "/api/user/collect-list" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const bankId = url.searchParams.get("bankId");
        const list = await db.prepare(`
          SELECT q.*, uc.create_time as collect_time
          FROM user_collect uc
          JOIN questions q ON uc.q_id = q.q_id
          WHERE uc.uid=? AND q.bank_id=?
          ORDER BY uc.create_time DESC
        `).bind(uid, bankId).all();
        return jsonResponse(list.results.map(formatQuestion), corsHeaders);
      }

      // 9. 检查是否已收藏
      if (url.pathname === "/api/user/check-collect" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const qId = url.searchParams.get("qId");
        const row = await db.prepare("SELECT 1 FROM user_collect WHERE uid=? AND q_id=?").bind(uid, qId).first();
        return jsonResponse({ collected: !!row }, corsHeaders);
      }

      // ==================== 斩题 ====================

      // 10. 斩题标记
      if (url.pathname === "/api/user/master" && method === "POST") {
        const { uid, qId, isMaster } = await request.json();
        if (!uid || !qId) return jsonResponse({ code: 1, msg: "参数缺失" }, corsHeaders, 400);
        if (isMaster) {
          await db.prepare("INSERT OR IGNORE INTO user_master(uid,q_id,create_time) VALUES (?,?,datetime('now'))").bind(uid, qId).run();
        } else {
          await db.prepare("DELETE FROM user_master WHERE uid=? AND q_id=?").bind(uid, qId).run();
        }
        return jsonResponse({ code: 0 }, corsHeaders);
      }

      // 11. 斩题列表
      if (url.pathname === "/api/user/master-list" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const bankId = url.searchParams.get("bankId");
        const list = await db.prepare(`
          SELECT q.*
          FROM user_master um
          JOIN questions q ON um.q_id = q.q_id
          WHERE um.uid=? AND q.bank_id=?
          ORDER BY um.create_time DESC
        `).bind(uid, bankId).all();
        return jsonResponse(list.results.map(formatQuestion), corsHeaders);
      }

      // 12. 检查斩题状态
      if (url.pathname === "/api/user/check-master" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const qId = url.searchParams.get("qId");
        const row = await db.prepare("SELECT 1 FROM user_master WHERE uid=? AND q_id=?").bind(uid, qId).first();
        return jsonResponse({ mastered: !!row }, corsHeaders);
      }

      // ==================== 笔记 ====================

      // 13. 保存笔记
      if (url.pathname === "/api/user/note" && method === "POST") {
        const { uid, qId, content } = await request.json();
        if (!uid || !qId) return jsonResponse({ code: 1, msg: "参数缺失" }, corsHeaders, 400);
        if (content) {
          await db.prepare("INSERT OR REPLACE INTO user_note(uid,q_id,content,update_time) VALUES (?,?,?,datetime('now'))").bind(uid, qId, content).run();
        } else {
          await db.prepare("DELETE FROM user_note WHERE uid=? AND q_id=?").bind(uid, qId).run();
        }
        return jsonResponse({ code: 0 }, corsHeaders);
      }

      // 14. 获取笔记列表
      if (url.pathname === "/api/user/note-list" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const bankId = url.searchParams.get("bankId");
        const list = await db.prepare(`
          SELECT q.*, un.content as note_content, un.update_time
          FROM user_note un
          JOIN questions q ON un.q_id = q.q_id
          WHERE un.uid=? AND q.bank_id=?
          ORDER BY un.update_time DESC
        `).bind(uid, bankId).all();
        return jsonResponse(list.results.map(formatQuestion), corsHeaders);
      }

      // 15. 获取单题笔记
      if (url.pathname === "/api/user/note-get" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const qId = url.searchParams.get("qId");
        const row = await db.prepare("SELECT content FROM user_note WHERE uid=? AND q_id=?").bind(uid, qId).first();
        return jsonResponse({ content: row ? row.content : "" }, corsHeaders);
      }

      // ==================== 易错题 ====================

      // 16. 个人高频错题（按错误次数排序）
      if (url.pathname === "/api/user/easy-wrong" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const bankId = url.searchParams.get("bankId");
        const list = await db.prepare(`
          SELECT q.*, uw.wrong_times
          FROM user_wrong uw
          JOIN questions q ON uw.q_id = q.q_id
          WHERE uw.uid=? AND q.bank_id=?
          ORDER BY uw.wrong_times DESC
          LIMIT 50
        `).bind(uid, bankId).all();
        return jsonResponse(list.results.map(formatQuestion), corsHeaders);
      }

      // ==================== 模拟考试 ====================

      // 17. 提交考试判分
      if (url.pathname === "/api/exam/submit" && method === "POST") {
        const { uid, bankId, answers } = await request.json();
        if (!uid || !answers) return jsonResponse({ code: 1, msg: "参数缺失" }, corsHeaders, 400);
        let score = 0;
        const wrongList = [];
        // 批量查询
        for (const item of answers) {
          const q = await db.prepare("SELECT standard_answer, question_type FROM questions WHERE q_id=?").bind(item.qId).first();
          if (!q) continue;
          const userAns = (item.ans || "").trim();
          const stdAns = (q.standard_answer || "").trim();
          if (q.question_type === "multi") {
            // 多选题：答案字母排序后比较
            const sortStr = (s) => s.replace(/[^A-D]/g, "").split("").sort().join("");
            if (sortStr(userAns) === sortStr(stdAns)) {
              score++;
            } else {
              wrongList.push(item.qId);
            }
          } else {
            if (userAns === stdAns) {
              score++;
            } else {
              wrongList.push(item.qId);
            }
          }
        }
        const total = answers.length;
        await db.prepare(`
          INSERT INTO user_exam(uid,bank_id,score,total,create_time,wrong_list)
          VALUES (?,?,?,?,datetime('now'),?)
        `).bind(uid, bankId, score, total, JSON.stringify(wrongList)).run();
        // 自动记录错题
        for (const qId of wrongList) {
          const exist = await db.prepare("SELECT wrong_times FROM user_wrong WHERE uid=? AND q_id=?").bind(uid, qId).first();
          if (exist) {
            await db.prepare("UPDATE user_wrong SET wrong_times=wrong_times+1, last_time=datetime('now') WHERE uid=? AND q_id=?").bind(uid, qId).run();
          } else {
            await db.prepare("INSERT INTO user_wrong(uid,q_id,wrong_times,last_time) VALUES (?,?,1,datetime('now'))").bind(uid, qId).run();
          }
        }
        return jsonResponse({ score, total, wrongList }, corsHeaders);
      }

      // 18. 考试记录
      if (url.pathname === "/api/exam/records" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const list = await db.prepare("SELECT * FROM user_exam WHERE uid=? ORDER BY create_time DESC LIMIT 20").bind(uid).all();
        return jsonResponse(list.results, corsHeaders);
      }

      // 19. 检查用户状态（单题）
      if (url.pathname === "/api/user/question-status" && method === "GET") {
        const uid = url.searchParams.get("uid");
        const qId = url.searchParams.get("qId");
        const [wrong, collected, mastered, note] = await Promise.all([
          db.prepare("SELECT wrong_times FROM user_wrong WHERE uid=? AND q_id=?").bind(uid, qId).first(),
          db.prepare("SELECT 1 FROM user_collect WHERE uid=? AND q_id=?").bind(uid, qId).first(),
          db.prepare("SELECT 1 FROM user_master WHERE uid=? AND q_id=?").bind(uid, qId).first(),
          db.prepare("SELECT content FROM user_note WHERE uid=? AND q_id=?").bind(uid, qId).first(),
        ]);
        return jsonResponse({
          wrongTimes: wrong ? wrong.wrong_times : 0,
          collected: !!collected,
          mastered: !!mastered,
          noteContent: note ? note.content : "",
        }, corsHeaders);
      }

      return jsonResponse({ error: "接口不存在" }, corsHeaders, 404);
    } catch (err) {
      console.error(err);
      return jsonResponse({ code: 1, msg: "服务器错误: " + err.message }, corsHeaders, 500);
    }
  }
};

// ======== 工具函数 ========

function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function formatQuestion(q) {
  try {
    q.options = typeof q.options === "string" ? JSON.parse(q.options) : q.options;
  } catch {
    q.options = {};
  }
  return q;
}
