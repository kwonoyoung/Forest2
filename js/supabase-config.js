(() => {
const FOREST_SUPABASE_URL = 'https://jacvltitwrxyfoasjcwq.supabase.co';
const FOREST_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rzPK7YDpZxKJgBeJ64Z2qw_4uH1qbfW';

function getDemoVisitor() {
  try {
    const storedDemoVisitor = localStorage.getItem('forest_demo_visitor');
    if (storedDemoVisitor) return storedDemoVisitor;
    const newVisitor = crypto.randomUUID();
    localStorage.setItem('forest_demo_visitor', newVisitor);
    return newVisitor;
  } catch (error) {
    return crypto.randomUUID();
  }
}

const demoVisitor = getDemoVisitor();
window.forestDemoVisitor = demoVisitor;

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  console.error('[TreeSam] Supabase 라이브러리를 불러오지 못했습니다.');
  window.forestSupabase = null;
  window.forestSupabaseRecovery = { enabled: false, reason: 'supabase-library-missing' };
  return;
}

const rawClient = window.supabase.createClient(
  FOREST_SUPABASE_URL,
  FOREST_SUPABASE_PUBLISHABLE_KEY,
  {
    global: { headers: { 'x-demo-visitor': demoVisitor } },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

/*
 * Forest2 데이터 조회 복구 계층
 * 1) 기존 공개 View를 먼저 조회한다.
 * 2) View가 없거나 권한/스키마 문제로 실패한 경우에만 원본 테이블로 재시도한다.
 * 3) 저장·수정·삭제 요청은 기존 원본 테이블 로직을 그대로 사용한다.
 *
 * 이렇게 하면 정상적인 공개 View가 살아 있을 때는 기존 보안/표시 구조를 유지하고,
 * View 장애가 발생했을 때만 RLS가 허용하는 범위 안에서 원본 테이블 조회를 시도한다.
 */
const originalFrom = rawClient.from.bind(rawClient);
const readRelationFallback = {
  demo_trees_public: 'demo_trees',
  demo_tree_management_logs_public: 'demo_tree_management_logs'
};

function createFallbackQuery(primaryRelation, fallbackRelation) {
  const calls = [];
  let executed = null;

  async function buildAndRun(relation) {
    let query = originalFrom(relation);
    for (const [method, args] of calls) {
      if (!query || typeof query[method] !== 'function') {
        throw new Error('지원하지 않는 Supabase 조회 메서드: ' + String(method));
      }
      query = query[method](...args);
    }
    return await query;
  }

  async function execute() {
    if (executed) return executed;
    executed = (async () => {
      let primaryResult;
      try {
        primaryResult = await buildAndRun(primaryRelation);
      } catch (error) {
        primaryResult = { error };
      }

      if (!primaryResult || !primaryResult.error) {
        window.forestSupabaseRecovery.lastRead = {
          source: primaryRelation,
          fallbackUsed: false,
          at: new Date().toISOString()
        };
        return primaryResult;
      }

      console.warn(
        '[TreeSam] 공개 조회 경로 실패. 원본 테이블로 재시도합니다:',
        primaryRelation,
        primaryResult.error
      );

      let fallbackResult;
      try {
        fallbackResult = await buildAndRun(fallbackRelation);
      } catch (error) {
        fallbackResult = { error };
      }

      window.forestSupabaseRecovery.lastRead = {
        source: fallbackRelation,
        primary: primaryRelation,
        fallbackUsed: true,
        primaryError: primaryResult.error?.message || String(primaryResult.error || ''),
        fallbackError: fallbackResult?.error?.message || (fallbackResult?.error ? String(fallbackResult.error) : ''),
        at: new Date().toISOString()
      };

      if (!fallbackResult?.error) {
        console.info('[TreeSam] 데이터 조회 복구 성공:', primaryRelation, '→', fallbackRelation);
      } else {
        console.error('[TreeSam] 데이터 조회 복구 실패:', fallbackRelation, fallbackResult.error);
      }

      return fallbackResult;
    })();
    return executed;
  }

  const proxy = new Proxy({}, {
    get(target, property) {
      if (property === 'then') {
        return (resolve, reject) => execute().then(resolve, reject);
      }
      if (property === 'catch') {
        return reject => execute().catch(reject);
      }
      if (property === 'finally') {
        return callback => execute().finally(callback);
      }
      if (property === Symbol.toStringTag) return 'TreeSamFallbackQuery';
      return (...args) => {
        calls.push([property, args]);
        return proxy;
      };
    }
  });

  return proxy;
}

rawClient.from = function(relation) {
  const fallbackRelation = readRelationFallback[relation];
  if (!fallbackRelation) return originalFrom(relation);
  return createFallbackQuery(relation, fallbackRelation);
};

window.forestSupabase = rawClient;
window.forestSupabaseRecovery = {
  enabled: true,
  visitor: demoVisitor,
  mappings: Object.assign({}, readRelationFallback),
  lastRead: null
};
})();
