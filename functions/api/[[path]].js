/**
 * Pages Functions — 将 /api/* 请求代理到 Worker（service binding）
 *
 * 所有 /api/* 路径的请求都会通过此函数转发到 quiz-worker，
 * Worker 处理实际的业务逻辑并查询 D1 数据库。
 */
export async function onRequest(context) {
  const { request, env } = context;
  // 通过 service binding 将请求转发到 Worker
  return env.QUIZ_WORKER.fetch(request);
}
