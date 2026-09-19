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
 * 2026-09 데이터 조회 복구
 * 대시보드는 기존에 demo_trees_public / demo_tree_management_logs_public 뷰를
 * 조회했지만 실제 저장·수정·삭제는 demo_trees / demo_tree_management_logs를 사용한다.
 * 공개 뷰가 삭제되었거나 권한이 변경되면 목록 전체가 로드되지 않으므로,
 * 조회 요청만 기존 원본 테이블로 자동 연결한다.
 * 쓰기 대상 테이블명은 변경하지 않는다.
 */
const originalFrom = rawClient.from.bind(rawClient);
const readRelationFallback = {
  demo_trees_public: 'demo_trees',
  demo_tree_management_logs_public: 'demo_tree_management_logs'
};

rawClient.from = function(relation) {
  const resolvedRelation = readRelationFallback[relation] || relation;
  if (resolvedRelation !== relation) {
    console.info('[TreeSam] 데이터 조회 경로 복구:', relation, '→', resolvedRelation);
  }
  return originalFrom(resolvedRelation);
};

window.forestSupabase = rawClient;
window.forestSupabaseRecovery = {
  enabled: true,
  visitor: demoVisitor,
  mappings: Object.assign({}, readRelationFallback)
};
})();
