(() => {
const FOREST_SUPABASE_URL = 'https://jacvltitwrxyfoasjcwq.supabase.co';
const FOREST_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rzPK7YDpZxKJgBeJ64Z2qw_4uH1qbfW';

const storedDemoVisitor = localStorage.getItem('forest_demo_visitor');
const demoVisitor = storedDemoVisitor || crypto.randomUUID();
if (!storedDemoVisitor) localStorage.setItem('forest_demo_visitor', demoVisitor);
window.forestDemoVisitor = demoVisitor;

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
