(() => {
  const FOREST_SUPABASE_URL = 'https://jacvltitwrxyfoasjcwq.supabase.co';
  // 공개(publishable) 키: 브라우저에 노출되도록 설계된 키입니다. 실제 권한은 DB 접근 규칙(RLS)이 결정합니다.
  const FOREST_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rzPK7YDpZxKJgBeJ64Z2qw_4uH1qbfW';

  // 이전 체험판 방식과의 호환용 식별값입니다. 권한 판단에는 사용하지 않으며,
  // 업로드 폴더 이름과 이전 DB 규칙(점검일지 등록 시 확인)에만 쓰입니다.
  function getDemoVisitor() {
    try {
      const stored = localStorage.getItem('forest_demo_visitor');
      if (stored) return stored;
      const created = crypto.randomUUID();
      localStorage.setItem('forest_demo_visitor', created);
      return created;
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

  window.forestSupabase = window.supabase.createClient(
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
})();
