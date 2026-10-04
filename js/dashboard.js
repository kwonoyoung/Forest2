/* 트리샘 수목 관리 대시보드
 * 화면 모드
 *  - auth   : 로그인하지 않은 상태 → 로그인/회원가입 화면
 *  - app    : 로그인 상태 → 수목 관리 화면 (등록·수정·삭제·점검일지·QR·엑셀)
 *  - public : ?tree=<id> 로 들어온 QR 방문자 → 공개 항목만 보이는 화면
 */
(() => {
  'use strict';

  const client = window.forestSupabase;
  const visitor = window.forestDemoVisitor;
  const $ = id => document.getElementById(id);

  const MB = 1024 * 1024;
  const LIMITS = { image: 8 * MB, video: 10 * MB, videoSeconds: 10, audio: 20 * MB };
  const PAGE_SIZE = 20;
  const PHOTO_BUCKET = 'demo-tree-photos';
  const AUDIO_BUCKET = 'demo-tree-audio';
  const PUBLIC_TREE_COLUMNS = 'id,asset_no,name,property_type,property_item,photo_url,audio_url,audio_name';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SCRIPTS = {
    xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    qrcode: 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
  };

  const state = {
    mode: 'loading',
    user: null,
    trees: [],
    logs: [],
    filter: 'all',
    visible: PAGE_SIZE,
    loadingPromise: null,
    reloadQueued: false,
    loadedOnce: false,
    detailTreeId: '',
    savingTree: false,
    savingLog: false,
    authMode: 'login', // login | signup | reset | recovery
    pendingDetailId: new URLSearchParams(location.search).get('detail') || ''
  };
  const pending = { photo: null, locationPhoto: null, audio: null, logPhoto: null };
  const objectUrls = { photo: '', locationPhoto: '', audio: '', logPhoto: '' };

  /* ---------- 공통 도우미 ---------- */
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  // 한국 시간(기기 시간) 기준 날짜. toISOString()은 UTC라 오전 9시 전에는 하루 전 날짜가 됩니다.
  const localDate = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const money = v => (v == null || v === '' ? '-' : Number(v).toLocaleString('ko-KR') + '원');
  const sortLogs = (a, b) => String(b.inspection_date).localeCompare(String(a.inspection_date)) || String(b.created_at).localeCompare(String(a.created_at));
  const logsOf = treeId => state.logs.filter(l => l.tree_id === treeId).sort(sortLogs);
  const latestLog = treeId => logsOf(treeId)[0] || null;
  const treeStatus = tree => (latestLog(tree.id)?.inspection_status) || '미점검';
  const needsInspection = tree => ['주의', '위험', '미점검'].includes(treeStatus(tree));
  const isVideoUrl = url => /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(String(url || ''));

  let toastTimer = 0;
  function show(message, type = 'error') {
    const el = $('status');
    el.textContent = message;
    el.className = 'status show ' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'status'; }, type === 'error' ? 10000 : 5000);
  }
  $('status').addEventListener('click', () => { $('status').className = 'status'; });

  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => { delete scriptCache[src]; reject(new Error('스크립트를 불러오지 못했습니다: ' + src)); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }

  function describeError(error) {
    const message = String(error?.message || error || '');
    if (/failed to fetch|network|load failed|abort|timeout/i.test(message)) {
      return '데이터 서버에 연결할 수 없습니다. 인터넷 연결을 확인하거나 잠시 후 다시 시도해 주세요.';
    }
    if (/row-level security|permission denied|not allowed/i.test(message)) {
      return '권한이 없습니다. 로그인 상태를 확인해 주세요.';
    }
    if (/exceeded the maximum allowed size|payload too large/i.test(message)) return '파일 용량이 너무 큽니다.';
    if (/mime type|invalid_mime/i.test(message)) return '지원하지 않는 파일 형식입니다.';
    return message || '알 수 없는 오류';
  }

  function setMode(mode) {
    state.mode = mode;
    document.body.dataset.mode = mode;
  }

  /* ---------- 모달 ---------- */
  let lastFocus = null;
  const modalClosers = {};
  function openModal(id) {
    lastFocus = document.activeElement;
    const bg = $(id);
    bg.classList.add('open');
    document.body.classList.add('modal-open');
    const target = bg.querySelector('input:not([type=hidden]):not([readonly]):not([type=file]),select,textarea') || bg.querySelector('button');
    if (target) setTimeout(() => target.focus(), 0);
  }
  function closeModal(id) {
    $(id).classList.remove('open');
    if (!document.querySelector('.modal-bg.open')) document.body.classList.remove('modal-open');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  document.addEventListener('keydown', e => {
    const open = [...document.querySelectorAll('.modal-bg.open')].pop();
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      (modalClosers[open.id] || (() => closeModal(open.id)))();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = [...open.querySelectorAll('a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select,textarea,audio[controls],video[controls]')]
        .filter(el => el.offsetParent !== null || el.type === 'file');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- 로그인 ---------- */
  const AUTH_TEXT = {
    login: { title: '관리자 로그인', lead: '수목 정보를 등록·수정하려면 로그인해 주세요.', submit: '로그인', toggle: '처음이신가요? 회원가입', password: true },
    signup: { title: '회원가입', lead: '이메일과 비밀번호(6자 이상)를 입력하세요. 가입 후 수목 정보를 등록·수정할 수 있습니다.', submit: '가입하기', toggle: '이미 계정이 있으신가요? 로그인', password: true },
    reset: { title: '비밀번호 재설정', lead: '가입한 이메일로 비밀번호 재설정 링크를 보내드립니다.', submit: '재설정 메일 보내기', toggle: '로그인으로 돌아가기', password: false },
    recovery: { title: '새 비밀번호 설정', lead: '새로 사용할 비밀번호(6자 이상)를 입력하세요.', submit: '비밀번호 변경', toggle: '로그인으로 돌아가기', password: true }
  };
  function setAuthMode(mode) {
    state.authMode = mode;
    const t = AUTH_TEXT[mode];
    $('authTitle').textContent = t.title;
    $('authLead').textContent = t.lead;
    $('authSubmit').textContent = t.submit;
    $('authModeToggle').textContent = t.toggle;
    $('authPasswordLabel').style.display = t.password ? '' : 'none';
    $('authEmail').closest('label').style.display = mode === 'recovery' ? 'none' : '';
    $('authResetToggle').style.display = mode === 'login' ? '' : 'none';
    $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    authMessage('');
  }
  function authMessage(text, type = 'error') {
    const el = $('authMessage');
    el.textContent = text;
    el.className = 'auth-message ' + (text ? type : '');
  }
  function translateAuthError(error) {
    const m = String(error?.message || error || '');
    if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않습니다.';
    if (/email not confirmed/i.test(m)) return '이메일 인증이 아직 완료되지 않았습니다. 가입 확인 메일의 링크를 먼저 눌러 주세요.';
    if (/already registered|already been registered/i.test(m)) return '이미 가입된 이메일입니다. 로그인해 주세요.';
    if (/password.*(at least|short)|weak/i.test(m)) return '비밀번호는 6자 이상으로 입력해 주세요.';
    if (/signups not allowed|signup.*disabled/i.test(m)) return '현재 회원가입이 막혀 있습니다. 관리자에게 문의해 주세요.';
    if (/rate limit|too many/i.test(m)) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    if (/invalid.*email|unable to validate email/i.test(m)) return '이메일 주소 형식을 확인해 주세요.';
    return describeError(error);
  }

  $('authModeToggle').addEventListener('click', async () => {
    const leavingRecovery = state.authMode === 'recovery';
    setAuthMode(state.authMode === 'login' ? 'signup' : 'login');
    if (leavingRecovery) {
      const { data } = await client.auth.getSession();
      applySession(data.session);
    }
  });
  $('authResetToggle').addEventListener('click', () => setAuthMode('reset'));
  $('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    const mode = state.authMode;
    if (mode !== 'recovery' && !email) return authMessage('이메일을 입력해 주세요.');
    if (AUTH_TEXT[mode].password && password.length < 6) return authMessage('비밀번호는 6자 이상으로 입력해 주세요.');
    const button = $('authSubmit');
    button.disabled = true;
    authMessage('처리 중입니다…', 'ok');
    const redirectTo = location.origin + location.pathname;
    try {
      if (mode === 'login') {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        authMessage('');
      } else if (mode === 'signup') {
        const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          authMessage('이미 가입된 이메일입니다. 로그인해 주세요.');
        } else if (!data.session) {
          authMessage('가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요. (메일이 안 보이면 스팸함도 확인해 주세요.)', 'ok');
        }
      } else if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        authMessage('재설정 링크를 보냈습니다. 메일의 링크를 눌러 새 비밀번호를 정해 주세요.', 'ok');
      } else if (mode === 'recovery') {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        show('비밀번호를 변경했습니다.', 'ok');
        setAuthMode('login');
        const { data } = await client.auth.getSession();
        applySession(data.session);
      }
    } catch (error) {
      authMessage(translateAuthError(error));
    } finally {
      button.disabled = false;
    }
  });
  $('logoutButton').addEventListener('click', async () => {
    await client.auth.signOut();
    show('로그아웃했습니다.', 'ok');
  });

  function applySession(session) {
    if (state.mode === 'public') return;
    if (state.authMode === 'recovery') { setMode('auth'); return; }
    const user = session?.user || null;
    const changed = (user?.id || '') !== (state.user?.id || '');
    state.user = user;
    if (!user) {
      state.trees = [];
      state.logs = [];
      state.loadedOnce = false;
      document.querySelectorAll('.modal-bg.open').forEach(m => m.classList.remove('open'));
      document.body.classList.remove('modal-open');
      setMode('auth');
      return;
    }
    $('userEmail').textContent = user.email || '';
    setMode('app');
    if (changed || (!state.loadedOnce && !state.loadingPromise)) loadData();
  }

  /* ---------- 데이터 불러오기 ---------- */
  function loadData() {
    if (state.loadingPromise) {
      state.reloadQueued = true;
      return state.loadingPromise;
    }
    state.loadingPromise = (async () => {
      let ok;
      do {
        state.reloadQueued = false;
        ok = await fetchAll();
      } while (ok && state.reloadQueued);
      return ok;
    })().finally(() => { state.loadingPromise = null; });
    return state.loadingPromise;
  }

  async function fetchAll() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    if (!state.loadedOnce) $('treeGrid').innerHTML = '<div class="card loading" role="status">데이터를 불러오는 중입니다.</div>';
    $('addButton').disabled = true;
    $('downloadRegisterButton').disabled = true;
    try {
      if (!client) throw new Error('데이터 연결 프로그램을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
      const [treeResult, logResult] = await Promise.all([
        client.from('demo_trees').select('*').order('asset_no').abortSignal(controller.signal),
        client.from('demo_tree_management_logs').select('*').order('inspection_date', { ascending: false }).abortSignal(controller.signal)
      ]);
      if (treeResult.error) throw treeResult.error;
      if (logResult.error) throw logResult.error;
      state.trees = treeResult.data || [];
      state.logs = logResult.data || [];
      state.loadedOnce = true;
      renderAll();
      if (state.detailTreeId && $('detailModal').classList.contains('open')) {
        if (state.trees.some(t => t.id === state.detailTreeId)) renderDetails(state.detailTreeId);
        else closeModal('detailModal');
      }
      if (state.pendingDetailId) {
        const id = state.pendingDetailId;
        state.pendingDetailId = '';
        history.replaceState(null, '', location.pathname);
        if (state.trees.some(t => t.id === id)) showDetails(id);
      }
      return true;
    } catch (error) {
      console.error('[TreeSam] 대시보드 데이터 로딩 실패:', error);
      state.trees = [];
      state.logs = [];
      state.loadedOnce = false;
      $('stats').querySelectorAll('b').forEach(el => { el.textContent = '—'; });
      $('urgentList').innerHTML = '<div class="urgent-empty">데이터 연결 후 긴급관리 수목을 확인할 수 있습니다.</div>';
      $('treeGrid').innerHTML = '<div class="card empty" role="alert"><p>' + esc(describeError(error)) + '</p><button type="button" class="secondary" id="retryLoadButton">다시 불러오기</button></div>';
      $('retryLoadButton').addEventListener('click', () => loadData());
      return false;
    } finally {
      clearTimeout(timer);
      $('addButton').disabled = false;
      $('downloadRegisterButton').disabled = false;
    }
  }

  /* ---------- 목록 그리기 ---------- */
  function renderAll() { updateStats(); renderUrgent(); renderTrees(); }

  function updateStats() {
    const counts = { 양호: 0, 보통: 0, 주의: 0, 위험: 0, 미점검: 0 };
    state.trees.forEach(t => { const s = treeStatus(t); counts[s] = (counts[s] || 0) + 1; });
    $('total').textContent = state.trees.length;
    $('good').textContent = counts.양호;
    $('normal').textContent = counts.보통;
    $('warning').textContent = counts.주의;
    $('danger').textContent = counts.위험;
    $('uninspected').textContent = counts.미점검;
    $('needInspection').textContent = state.trees.filter(needsInspection).length;
  }

  function renderUrgent() {
    const priority = { 위험: 0, 주의: 1, 미점검: 2 };
    const list = state.trees.filter(needsInspection)
      .sort((a, b) => priority[treeStatus(a)] - priority[treeStatus(b)] || String(a.asset_no).localeCompare(String(b.asset_no)))
      .slice(0, 6);
    $('urgentList').innerHTML = list.length
      ? list.map(t => '<article class="urgent-item"><button type="button" data-urgent-id="' + esc(t.id) + '">' + esc(t.name) + '<small>대장번호 ' + esc(t.asset_no) + '</small></button><span class="badge ' + esc(treeStatus(t)) + '">' + esc(treeStatus(t)) + '</span></article>').join('')
      : '<div class="urgent-empty">현재 주의·위험·미점검 수목이 없습니다.</div>';
  }

  function setStatusFilter(filter) {
    state.filter = filter;
    state.visible = PAGE_SIZE;
    document.querySelectorAll('.stat[data-filter]').forEach(card => {
      const selected = card.dataset.filter === filter;
      card.classList.toggle('active', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
    renderTrees();
  }

  function filteredTrees() {
    const q = $('search').value.trim().toLowerCase();
    return state.trees.filter(t => {
      const status = treeStatus(t);
      const matchesStatus = state.filter === 'all' || (state.filter === '점검필요' ? needsInspection(t) : status === state.filter);
      const text = [t.asset_no, t.name, t.property_type, t.property_item, t.property_classification].join(' ').toLowerCase();
      return matchesStatus && text.includes(q);
    });
  }

  function mediaHtml(url, alt, cls) {
    if (!url) return '';
    return isVideoUrl(url)
      ? '<video class="' + (cls === 'card' ? 'tree-photo-video' : '') + '" src="' + esc(url) + '" controls playsinline preload="none" aria-label="' + esc(alt) + ' 영상"></video>'
      : '<img class="' + (cls === 'card' ? 'tree-photo' : '') + '" src="' + esc(url) + '" alt="' + esc(alt) + ' 사진" loading="lazy" decoding="async">';
  }

  function audioUrlBlock(url, attr) {
    return '<div class="audio-url"><label>나무이야기 음성파일 주소</label><div class="audio-url-row"><input value="' + esc(url) + '" readonly aria-label="나무이야기 음성파일 주소"><button type="button" ' + attr + '="copy-audio" data-url="' + esc(url) + '">복사</button></div></div>';
  }

  function renderTrees() {
    const list = filteredTrees();
    if (!list.length) {
      $('treeGrid').innerHTML = '<div class="card empty">' + (state.trees.length ? '해당 조건의 수목이 없습니다.' : '등록된 수목이 없습니다. "＋ 새 수목 추가"로 첫 수목을 등록해 보세요.') + '</div>';
      return;
    }
    const shown = list.slice(0, state.visible);
    const cards = shown.map(t => {
      const status = treeStatus(t);
      const id = esc(t.id);
      const audio = t.audio_url ? '<audio controls preload="none" src="' + esc(t.audio_url) + '"></audio>' + audioUrlBlock(t.audio_url, 'data-action') : '';
      return '<article class="card tree">'
        + (t.photo_url ? mediaHtml(t.photo_url, t.name, 'card') : '<div class="tree-photo placeholder" role="img" aria-label="등록된 사진 및 영상 없음">🌳</div>')
        + '<div class="tree-top"><div><h3>' + esc(t.name) + '</h3><p>대장번호 ' + esc(t.asset_no) + '</p></div><span class="badge ' + esc(status) + '">' + esc(status) + '</span></div>'
        + '<div class="data"><div><span>재산종류</span><b>' + esc(t.property_type || '-') + '</b></div><div><span>재산종목</span><b>' + esc(t.property_item || '-') + '</b></div><div><span>취득금액</span><b>' + esc(money(t.acquisition_amount)) + '</b></div><div><span>현재금액</span><b>' + esc(money(t.current_amount)) + '</b></div></div>'
        + audio
        + '<div class="tree-buttons">'
        + '<button class="primary" type="button" data-action="detail" data-id="' + id + '">관리용 상세정보</button>'
        + '<button type="button" data-action="qr" data-id="' + id + '">QR코드</button>'
        + '<button type="button" data-action="log" data-id="' + id + '">＋ 점검일지</button>'
        + '<button type="button" data-action="edit" data-id="' + id + '">수정</button>'
        + '<button class="danger-button" type="button" data-action="delete" data-id="' + id + '">삭제</button>'
        + '</div></article>';
    }).join('');
    const more = list.length > shown.length
      ? '<div class="more"><button type="button" class="secondary" data-action="more">더 보기 (' + shown.length + ' / ' + list.length + ')</button></div>'
      : '';
    $('treeGrid').innerHTML = cards + more;
  }

  /* ---------- 상세정보 ---------- */
  function showDetails(id) {
    if (!state.trees.some(t => t.id === id)) return;
    state.detailTreeId = id;
    renderDetails(id);
    if (!$('detailModal').classList.contains('open')) openModal('detailModal');
  }

  function renderDetails(id) {
    const t = state.trees.find(x => x.id === id);
    if (!t) return;
    const treeLogs = logsOf(id);
    $('detailTitle').textContent = t.name + ' 관리용 상세정보';
    const hasGps = t.latitude != null && t.longitude != null;
    const map = hasGps ? '<a class="map-link" href="https://www.google.com/maps?q=' + encodeURIComponent(t.latitude + ',' + t.longitude) + '" target="_blank" rel="noopener">지도에서 위치 열기 ↗</a>' : '-';
    const grid = items => '<div class="detail-grid">' + items.map(([label, value, raw]) => '<div class="detail-item"><span>' + esc(label) + '</span><b>' + (raw ? value : esc(value || '-')) + '</b></div>').join('') + '</div>';

    const locationBlock = '<h3 class="section-title">위치정보</h3>' + grid([
      ['학교·기관명', t.organization_name],
      ['상세 위치', t.detailed_location],
      ['GPS 위도·경도', hasGps ? t.latitude + ', ' + t.longitude : ''],
      ['학교 배치도상의 위치', t.school_map_location],
      ['지도', map, true]
    ]) + (t.location_photo_url ? '<div class="detail-media"><div><strong>위치사진</strong><img src="' + esc(t.location_photo_url) + '" alt="' + esc(t.name) + ' 위치 사진" loading="lazy"></div></div>' : '');

    const propertyBlock = '<h3 class="section-title">재산정보</h3>' + grid([
      ['대장번호', t.asset_no], ['명칭', t.name], ['재산종류', t.property_type], ['재산종목', t.property_item],
      ['재산구분', t.property_classification], ['취득일자', t.acquisition_date],
      ['취득금액', money(t.acquisition_amount)], ['현재금액', money(t.current_amount)]
    ]);

    const media = (t.photo_url || t.audio_url)
      ? '<div class="detail-media">'
        + (t.photo_url ? '<div><strong>수목 사진 및 영상</strong>' + mediaHtml(t.photo_url, t.name, 'detail') + '</div>' : '<div></div>')
        + (t.audio_url ? '<div><strong>나무이야기</strong><p>' + esc(t.audio_name || '등록 음원') + '</p><audio controls preload="none" src="' + esc(t.audio_url) + '"></audio>' + audioUrlBlock(t.audio_url, 'data-detail-action') + '</div>' : '')
        + '</div>'
      : '';

    const journal = treeLogs.length
      ? treeLogs.map((l, index) => '<article class="log">'
        + '<div class="log-top"><b>' + (treeLogs.length - index) + '차 점검 · ' + esc(l.inspection_date) + '</b><span class="badge ' + esc(l.inspection_status) + '">' + esc(l.inspection_status) + '</span></div>'
        + '<p><b>점검자:</b> ' + esc(l.inspector) + '</p>'
        + '<p><b>점검조치:</b> ' + esc(l.inspection_action || '-') + '</p>'
        + '<p><b>특이사항:</b> ' + esc(l.notes || '-') + '</p>'
        + (l.state_photo_url ? '<div class="log-state-photo"><b>나무상태사진</b><img src="' + esc(l.state_photo_url) + '" alt="' + esc(l.inspection_date) + ' 나무상태사진" loading="lazy"></div>' : '')
        + '<div class="log-actions"><button type="button" data-detail-action="edit-log" data-tree-id="' + esc(id) + '" data-log-id="' + esc(l.id) + '">수정</button><button type="button" class="delete-log" data-detail-action="delete-log" data-tree-id="' + esc(id) + '" data-log-id="' + esc(l.id) + '">삭제</button></div>'
        + '</article>').join('')
      : '<div class="empty">등록된 점검일지가 없습니다.</div>';

    $('detailContent').innerHTML = locationBlock + propertyBlock + media
      + '<section class="journal"><div class="journal-head"><h3>점검일지 · 총 ' + treeLogs.length + '건</h3><button type="button" class="primary" data-detail-action="add-log" data-id="' + esc(id) + '">＋ 점검일지 추가</button></div><div class="log-list">' + journal + '</div></section>';
  }

  /* ---------- 파일 선택·검사 ---------- */
  function fileKind(file) {
    const ext = (file.name.includes('.') ? file.name.split('.').pop() : '').toLowerCase();
    const type = file.type || '';
    if (type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif') return 'heic';
    if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
    if (type.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video';
    if (type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio';
    return 'other';
  }
  const HEIC_MESSAGE = 'HEIC 형식 사진은 다른 기기에서 보이지 않아 등록할 수 없습니다. "촬영" 버튼으로 바로 찍거나, 아이폰 설정 > 카메라 > 포맷에서 "높은 호환성"을 선택한 뒤 다시 시도해 주세요.';

  function videoDuration(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(v.duration);
      v.onerror = reject;
      v.src = url;
    });
  }

  function setObjectUrl(key, file) {
    if (objectUrls[key]) URL.revokeObjectURL(objectUrls[key]);
    objectUrls[key] = file ? URL.createObjectURL(file) : '';
    return objectUrls[key];
  }

  function setMediaPreview(url, isVideo) {
    const box = $('photoPreview');
    box.innerHTML = isVideo
      ? '<video src="' + esc(url) + '" controls playsinline preload="metadata"></video>'
      : '<img src="' + esc(url) + '" alt="선택한 수목 사진 미리보기">';
    box.classList.add('show');
  }

  async function selectPhoto(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const kind = fileKind(file);
    const reject = message => { show(message); input.value = ''; };
    if (kind === 'heic') return reject(HEIC_MESSAGE);
    if (kind !== 'image' && kind !== 'video') return reject('사진 또는 영상 파일만 등록할 수 있습니다.');
    if (kind === 'image' && file.size > LIMITS.image) return reject('사진은 8MB 이하만 등록할 수 있습니다.');
    if (kind === 'video' && file.size > LIMITS.video) return reject('영상은 10MB 이하만 등록할 수 있습니다. 화질을 낮추거나 더 짧게 촬영해 주세요.');
    const url = setObjectUrl('photo', file);
    if (kind === 'video') {
      try {
        const duration = await videoDuration(url);
        if (!Number.isFinite(duration) || duration > LIMITS.videoSeconds + 0.05) {
          setObjectUrl('photo', null);
          return reject('영상은 10초 이내만 등록할 수 있습니다.');
        }
      } catch (error) {
        setObjectUrl('photo', null);
        return reject('영상 재생시간을 확인할 수 없습니다. 다른 영상 파일을 선택해 주세요.');
      }
    }
    pending.photo = file;
    setMediaPreview(url, kind === 'video');
    $('photoHelp').textContent = '선택됨: ' + file.name + ' · ' + (file.size / MB).toFixed(2) + 'MB';
  }

  function selectImage(input, key, previewId, helpId, label) {
    const file = input.files && input.files[0];
    if (!file) return;
    const kind = fileKind(file);
    const reject = message => { show(message); input.value = ''; };
    if (kind === 'heic') return reject(HEIC_MESSAGE);
    if (kind !== 'image') return reject(label + '은(는) 이미지 파일만 등록할 수 있습니다.');
    if (file.size > LIMITS.image) return reject(label + '은(는) 8MB 이하만 등록할 수 있습니다.');
    pending[key] = file;
    $(previewId).src = setObjectUrl(key, file);
    $(previewId).classList.add('show');
    $(helpId).textContent = '선택됨: ' + file.name + ' · ' + (file.size / MB).toFixed(2) + 'MB';
  }

  function selectAudio(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const kind = fileKind(file);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (kind !== 'audio' && ext !== 'webm') { show('MP3, WAV 등 음성 파일만 등록할 수 있습니다.'); input.value = ''; return; }
    if (file.size > LIMITS.audio) { show('음성 파일은 20MB 이하만 등록할 수 있습니다.'); input.value = ''; return; }
    pending.audio = file;
    $('audioPreview').src = setObjectUrl('audio', file);
    $('audioPreview').classList.add('show');
    $('audioHelp').textContent = '선택됨: ' + file.name + ' · ' + (file.size / MB).toFixed(2) + 'MB';
  }

  const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };
  function extension(file, fallback) {
    const dot = file.name.lastIndexOf('.');
    const fromName = dot > 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    return fromName || MIME_EXT[file.type] || fallback;
  }

  async function upload(bucket, file, fallback) {
    const path = visitor + '/' + crypto.randomUUID() + '.' + extension(file, fallback);
    const result = await client.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (result.error) throw result.error;
    return { bucket, path, url: client.storage.from(bucket).getPublicUrl(path).data.publicUrl };
  }

  // 저장소 파일 삭제: 실패해도 데이터 작업은 이미 끝났으므로 기록만 남깁니다.
  async function removeFiles(bucket, paths) {
    const list = paths.filter(Boolean);
    if (!list.length) return true;
    const { error } = await client.storage.from(bucket).remove(list);
    if (error) console.warn('[TreeSam] 파일 정리 실패 (' + bucket + '):', list, error);
    return !error;
  }

  /* ---------- 수목 등록·수정 ---------- */
  function resetTreeUploads(t = {}) {
    pending.photo = null; pending.locationPhoto = null; pending.audio = null;
    ['photo', 'locationPhoto', 'audio'].forEach(k => setObjectUrl(k, null));
    ['cameraInput', 'galleryInput', 'locationCameraInput', 'locationGalleryInput', 'audioInput'].forEach(id => { $(id).value = ''; });
    if (t.photo_url) {
      setMediaPreview(t.photo_url, isVideoUrl(t.photo_url));
      $('photoHelp').textContent = '현재 사진·영상 · 새 파일을 선택하면 교체됩니다.';
    } else {
      $('photoPreview').innerHTML = '';
      $('photoPreview').classList.remove('show');
      $('photoHelp').textContent = '사진 최대 8MB · 영상 10초 이내, 최대 10MB';
    }
    if (t.location_photo_url) {
      $('locationPhotoPreview').src = t.location_photo_url;
      $('locationPhotoPreview').classList.add('show');
      $('locationPhotoHelp').textContent = '현재 위치 사진 · 새 사진을 선택하면 교체됩니다.';
    } else {
      $('locationPhotoPreview').removeAttribute('src');
      $('locationPhotoPreview').classList.remove('show');
      $('locationPhotoHelp').textContent = '수목 주변이 식별되는 위치 사진 · 최대 8MB';
    }
    if (t.audio_url) {
      $('audioPreview').src = t.audio_url;
      $('audioPreview').classList.add('show');
      $('audioHelp').textContent = '현재 음원: ' + (t.audio_name || '등록 음원') + ' · 새 파일을 선택하면 교체됩니다.';
    } else {
      $('audioPreview').removeAttribute('src');
      $('audioPreview').classList.remove('show');
      $('audioHelp').textContent = 'MP3, WAV, M4A, AAC, OGG, WEBM · 최대 20MB · QR코드 방문자도 들을 수 있습니다.';
    }
  }

  function fillTreeForm(t = {}) {
    $('treeId').value = t.id || '';
    $('assetNo').value = t.asset_no || '';
    $('treeName').value = t.name || '';
    $('propertyType').value = t.property_type || '';
    $('propertyItem').value = t.property_item || '';
    $('propertyClassification').value = t.property_classification || '';
    $('acquisitionDate').value = t.acquisition_date || '';
    $('acquisitionAmount').value = t.acquisition_amount ?? '';
    $('currentAmount').value = t.current_amount ?? '';
    $('organizationName').value = t.organization_name || '';
    $('detailedLocation').value = t.detailed_location || '';
    $('latitude').value = t.latitude ?? '';
    $('longitude').value = t.longitude ?? '';
    $('schoolMapLocation').value = t.school_map_location || '';
    resetTreeUploads(t);
  }

  function openTreeModal(id = '') {
    const t = state.trees.find(x => x.id === id);
    fillTreeForm(t || {});
    $('modalTitle').textContent = t ? '수목 정보 수정' : '새 수목 추가';
    openModal('treeModal');
  }
  function closeTreeModal() {
    if (state.savingTree) return;
    closeModal('treeModal');
    $('treeForm').reset();
    fillTreeForm();
  }
  modalClosers.treeModal = closeTreeModal;

  function setTreeBusy(busy, label) {
    state.savingTree = busy;
    $('saveButton').disabled = busy;
    $('treeCancel').disabled = busy;
    $('saveButton').textContent = busy ? (label || '저장 중…') : '저장하기';
  }

  const textOrNull = id => $(id).value.trim() || null;
  const numberOrNull = id => ($(id).value === '' ? null : Number($(id).value));

  $('treeForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.savingTree) return;
    if (!$('assetNo').value.trim() || !$('treeName').value.trim()) { show('대장번호와 명칭은 꼭 입력해 주세요.'); return; }
    const id = $('treeId').value;
    const current = state.trees.find(t => t.id === id);
    // 저장 도중 취소·파일 변경이 있어도 영향을 받지 않도록 시작 시점의 파일을 고정합니다.
    const files = { photo: pending.photo, locationPhoto: pending.locationPhoto, audio: pending.audio };
    const payload = {
      asset_no: $('assetNo').value.trim(),
      name: $('treeName').value.trim(),
      property_type: textOrNull('propertyType'),
      property_item: textOrNull('propertyItem'),
      property_classification: textOrNull('propertyClassification'),
      acquisition_date: $('acquisitionDate').value || null,
      acquisition_amount: numberOrNull('acquisitionAmount'),
      current_amount: numberOrNull('currentAmount'),
      organization_name: textOrNull('organizationName'),
      detailed_location: textOrNull('detailedLocation'),
      latitude: numberOrNull('latitude'),
      longitude: numberOrNull('longitude'),
      school_map_location: textOrNull('schoolMapLocation')
    };
    const uploaded = [];
    setTreeBusy(true);
    try {
      if (files.photo) {
        setTreeBusy(true, '사진·영상 올리는 중…');
        const u = await upload(PHOTO_BUCKET, files.photo, fileKind(files.photo) === 'video' ? 'mp4' : 'jpg');
        uploaded.push(u);
        payload.photo_url = u.url; payload.photo_path = u.path;
      }
      if (files.locationPhoto) {
        setTreeBusy(true, '위치 사진 올리는 중…');
        const u = await upload(PHOTO_BUCKET, files.locationPhoto, 'jpg');
        uploaded.push(u);
        payload.location_photo_url = u.url; payload.location_photo_path = u.path;
      }
      if (files.audio) {
        setTreeBusy(true, '음성파일 올리는 중…');
        const u = await upload(AUDIO_BUCKET, files.audio, 'mp3');
        uploaded.push(u);
        payload.audio_url = u.url; payload.audio_path = u.path; payload.audio_name = files.audio.name;
      }
      setTreeBusy(true, '저장 중…');
      const result = id
        ? await client.from('demo_trees').update(payload).eq('id', id).select('id').single()
        : await client.from('demo_trees').insert({ ...payload, visitor_token: visitor }).select('id').single();
      if (result.error) throw result.error;
      if (current) {
        if (files.photo) await removeFiles(PHOTO_BUCKET, [current.photo_path]);
        if (files.locationPhoto) await removeFiles(PHOTO_BUCKET, [current.location_photo_path]);
        if (files.audio) await removeFiles(AUDIO_BUCKET, [current.audio_path]);
      }
      setTreeBusy(false);
      closeTreeModal();
      show(id ? '수목 정보를 수정했습니다.' : '새 수목을 등록했습니다.', 'ok');
      await loadData();
    } catch (error) {
      for (const u of uploaded) await removeFiles(u.bucket, [u.path]);
      show('저장하지 못했습니다: ' + describeError(error));
    } finally {
      if (state.savingTree) setTreeBusy(false);
    }
  });

  function registerCurrentLocation() {
    if (!navigator.geolocation) { show('이 기기에서는 위치정보 기능을 지원하지 않습니다.'); return; }
    const button = $('currentLocationButton');
    const restore = () => { button.disabled = false; button.innerHTML = '<span aria-hidden="true">📍</span> 현재 위치 등록'; };
    button.disabled = true;
    button.textContent = '위치 확인 중…';
    navigator.geolocation.getCurrentPosition(p => {
      $('latitude').value = p.coords.latitude.toFixed(7);
      $('longitude').value = p.coords.longitude.toFixed(7);
      show('현재 위치를 입력했습니다. 저장하기를 누르면 함께 저장됩니다.', 'ok');
      restore();
    }, e => {
      show(e.code === 1 ? '브라우저 설정에서 위치 권한을 허용해 주세요.' : '현재 위치를 확인하지 못했습니다. GPS 상태를 확인해 주세요.');
      restore();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  /* ---------- 수목 삭제 ---------- */
  async function deleteTree(id) {
    const t = state.trees.find(x => x.id === id);
    if (!t || !confirm(t.name + '(' + t.asset_no + ') 수목 정보와 점검일지를 삭제할까요?\n삭제한 내용은 복구할 수 없습니다.')) return;
    const statePhotoPaths = state.logs.filter(l => l.tree_id === id).map(l => l.state_photo_path);
    const { data, error } = await client.from('demo_trees').delete().eq('id', id).select('id');
    if (error) { show('삭제하지 못했습니다: ' + describeError(error)); return; }
    if (!data || !data.length) {
      // 권한 부족 등으로 실제로 지워지지 않은 경우: 파일도 지우지 않습니다.
      show('삭제하지 못했습니다. 권한이 없거나 이미 삭제된 수목입니다.');
      await loadData();
      return;
    }
    const filesOk = (await Promise.all([
      removeFiles(PHOTO_BUCKET, [t.photo_path, t.location_photo_path, ...statePhotoPaths]),
      removeFiles(AUDIO_BUCKET, [t.audio_path])
    ])).every(Boolean);
    show(filesOk ? '수목 정보와 사진·음원·점검일지를 삭제했습니다.' : '수목 정보는 삭제했지만 일부 사진·음원 파일을 정리하지 못했습니다.', 'ok');
    await loadData();
  }

  /* ---------- 점검일지 ---------- */
  function resetLogPhoto() {
    pending.logPhoto = null;
    setObjectUrl('logPhoto', null);
    $('logPhotoCameraInput').value = '';
    $('logPhotoGalleryInput').value = '';
    $('logPhotoPreview').removeAttribute('src');
    $('logPhotoPreview').classList.remove('show');
    $('logPhotoHelp').textContent = '점검 당시 나무 상태를 촬영하거나 선택하세요 · 최대 8MB';
  }

  function openLogModal(treeId, logId = '') {
    const t = state.trees.find(x => x.id === treeId);
    const log = logId ? state.logs.find(x => x.id === logId && x.tree_id === treeId) : null;
    if (!t || (logId && !log)) return;
    resetLogPhoto();
    $('logTreeId').value = treeId;
    $('logId').value = log?.id || '';
    $('logModalTitle').textContent = t.name + (log ? ' 점검일지 수정' : ' 점검일지 추가');
    $('logInspectionDate').value = log?.inspection_date || localDate();
    $('logInspector').value = log?.inspector || '';
    $('logInspectionStatus').value = log?.inspection_status || '양호';
    $('logInspectionAction').value = log?.inspection_action || '';
    $('logInspectionNotes').value = log?.notes || '';
    if (log?.state_photo_url) {
      $('logPhotoPreview').src = log.state_photo_url;
      $('logPhotoPreview').classList.add('show');
      $('logPhotoHelp').textContent = '새 사진을 선택하면 기존 나무상태사진이 교체됩니다.';
    }
    $('logSaveButton').textContent = log ? '수정사항 저장' : '점검일지 저장';
    openModal('logModal');
  }
  function closeLogModal() {
    if (state.savingLog) return;
    closeModal('logModal');
    $('logForm').reset();
    resetLogPhoto();
    $('logInspectionDate').value = localDate();
  }
  modalClosers.logModal = closeLogModal;

  function setLogBusy(busy, label) {
    state.savingLog = busy;
    $('logSaveButton').disabled = busy;
    $('logCancel').disabled = busy;
    if (busy) $('logSaveButton').textContent = label || '저장 중…';
    else $('logSaveButton').textContent = $('logId').value ? '수정사항 저장' : '점검일지 저장';
  }

  $('logForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.savingLog) return;
    const treeId = $('logTreeId').value;
    const logId = $('logId').value;
    const current = logId ? state.logs.find(l => l.id === logId) : null;
    if (!$('logInspectionDate').value || !$('logInspector').value.trim()) { show('점검일자와 점검자는 꼭 입력해 주세요.'); return; }
    const photo = pending.logPhoto;
    const payload = {
      tree_id: treeId,
      inspection_date: $('logInspectionDate').value,
      inspector: $('logInspector').value.trim(),
      inspection_status: $('logInspectionStatus').value,
      inspection_action: textOrNull('logInspectionAction'),
      notes: textOrNull('logInspectionNotes')
    };
    if (!logId) payload.visitor_token = visitor;
    let uploadedPhoto = null;
    setLogBusy(true);
    try {
      if (logId && !current) throw new Error('수정할 점검일지를 찾지 못했습니다.');
      if (photo) {
        setLogBusy(true, '상태사진 올리는 중…');
        uploadedPhoto = await upload(PHOTO_BUCKET, photo, 'jpg');
        payload.state_photo_url = uploadedPhoto.url;
        payload.state_photo_path = uploadedPhoto.path;
      }
      setLogBusy(true, '저장 중…');
      const result = logId
        ? await client.from('demo_tree_management_logs').update(payload).eq('id', logId).select('id').single()
        : await client.from('demo_tree_management_logs').insert(payload).select('id').single();
      if (result.error) throw result.error;
      if (uploadedPhoto && current?.state_photo_path) await removeFiles(PHOTO_BUCKET, [current.state_photo_path]);
      setLogBusy(false);
      closeLogModal();
      show(logId ? '점검일지를 수정했습니다.' : '점검일지를 저장했습니다.', 'ok');
      await loadData();
      showDetails(treeId);
    } catch (error) {
      if (uploadedPhoto) await removeFiles(PHOTO_BUCKET, [uploadedPhoto.path]);
      show('점검일지를 저장하지 못했습니다: ' + describeError(error));
    } finally {
      if (state.savingLog) setLogBusy(false);
    }
  });

  async function deleteLog(treeId, logId) {
    const log = state.logs.find(l => l.id === logId && l.tree_id === treeId);
    if (!log || !confirm(log.inspection_date + ' 점검일지를 삭제할까요? 삭제한 기록은 복구할 수 없습니다.')) return;
    const { data, error } = await client.from('demo_tree_management_logs').delete().eq('id', logId).select('id');
    if (error || !data || !data.length) {
      show('점검일지를 삭제하지 못했습니다: ' + (error ? describeError(error) : '권한이 없거나 이미 삭제된 기록입니다.'));
      return;
    }
    await removeFiles(PHOTO_BUCKET, [log.state_photo_path]);
    show('점검일지를 삭제했습니다.', 'ok');
    await loadData();
  }

  /* ---------- QR코드 ---------- */
  function publicTreeUrl(id) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('tree', id);
    return url.toString();
  }

  async function showQr(id) {
    const t = state.trees.find(x => x.id === id);
    if (!t) return;
    const url = publicTreeUrl(id);
    $('qrTitle').textContent = t.name + ' QR코드';
    $('qrUrl').value = url;
    $('qrCode').innerHTML = '<span>QR코드를 만드는 중…</span>';
    openModal('qrModal');
    try {
      await loadScript(SCRIPTS.qrcode);
      $('qrCode').innerHTML = '';
      new QRCode($('qrCode'), { text: url, width: 200, height: 200, colorDark: '#174b3b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
    } catch (error) {
      $('qrCode').innerHTML = '<span>QR코드 기능을 불러오지 못했습니다.</span>';
    }
  }

  async function copyText(text, message) {
    try { await navigator.clipboard.writeText(text); show(message, 'ok'); }
    catch (error) { window.prompt('아래 내용을 복사하세요.', text); }
  }

  /* ---------- 엑셀 ---------- */
  async function downloadTreeRegister() {
    if (!state.trees.length) { show('다운로드할 수목 정보가 없습니다.'); return; }
    const button = $('downloadRegisterButton');
    button.disabled = true;
    button.textContent = '엑셀 준비 중…';
    try {
      await loadScript(SCRIPTS.xlsx);
      const headers = ['대장번호', '명칭', '재산종류', '재산종목', '재산구분', '취득일자', '취득금액', '현재금액', '최근점검상태', '최근점검일', '학교·기관명', '상세 위치'];
      const rows = state.trees.map(t => {
        const log = latestLog(t.id);
        return [
          String(t.asset_no || ''), t.name || '', t.property_type || '', t.property_item || '', t.property_classification || '',
          t.acquisition_date ? new Date(t.acquisition_date + 'T00:00:00') : null,
          t.acquisition_amount == null ? null : Number(t.acquisition_amount),
          t.current_amount == null ? null : Number(t.current_amount),
          log ? log.inspection_status : '미점검',
          log ? log.inspection_date : '',
          t.organization_name || '', t.detailed_location || ''
        ];
      });
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows], { cellDates: true });
      sheet['!cols'] = [16, 18, 14, 14, 14, 13, 15, 15, 14, 13, 20, 28].map(wch => ({ wch }));
      sheet['!autofilter'] = { ref: 'A1:L' + (rows.length + 1) };
      for (let r = 2; r <= rows.length + 1; r++) {
        if (sheet['F' + r]) sheet['F' + r].z = 'yyyy-mm-dd';
        if (sheet['G' + r]) sheet['G' + r].z = '#,##0';
        if (sheet['H' + r]) sheet['H' + r].z = '#,##0';
      }
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, '수목관리대장');
      book.Props = { Title: '수목관리대장', Subject: '입목죽 재산정보', Author: '트리샘' };
      XLSX.writeFile(book, '수목관리대장_' + localDate() + '.xlsx', { compression: true, cellDates: true });
      show('전체 수목 ' + rows.length + '건을 엑셀 파일로 저장했습니다.', 'ok');
    } catch (error) {
      show('엑셀 파일을 만들지 못했습니다: ' + describeError(error));
    } finally {
      button.disabled = false;
      button.textContent = '수목관리대장 다운로드';
    }
  }

  /* ---------- QR 방문자 공개 화면 ---------- */
  async function showPublicTree(id) {
    setMode('public');
    document.title = '트리샘 · 나무 이야기';
    const view = $('publicView');
    const fail = message => {
      view.innerHTML = '<div class="card public-card"><h1>수목 정보를 열 수 없습니다</h1><p>' + esc(message) + '</p><div class="public-actions"><a class="secondary" href="../">트리샘 첫 화면</a></div></div>';
    };
    if (!client) return fail('데이터 연결 프로그램을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    if (!UUID_RE.test(id)) return fail('QR코드 주소가 올바르지 않습니다.');
    try {
      const [treeResult, logResult] = await Promise.all([
        client.from('demo_trees_public').select(PUBLIC_TREE_COLUMNS).eq('id', id).maybeSingle(),
        client.from('demo_tree_management_logs_public').select('inspection_status,inspection_date,created_at').eq('tree_id', id)
          .order('inspection_date', { ascending: false }).order('created_at', { ascending: false }).limit(1)
      ]);
      if (treeResult.error) throw treeResult.error;
      const t = treeResult.data;
      if (!t) return fail('QR코드에 연결된 수목을 찾을 수 없습니다. 삭제되었거나 주소가 바뀌었을 수 있습니다.');
      const status = (!logResult.error && logResult.data && logResult.data[0]?.inspection_status) || '미점검';
      document.title = t.name + ' · 트리샘';
      const photo = t.photo_url
        ? (isVideoUrl(t.photo_url)
          ? '<video src="' + esc(t.photo_url) + '" controls playsinline preload="metadata" aria-label="' + esc(t.name) + ' 영상"></video>'
          : '<img src="' + esc(t.photo_url) + '" alt="' + esc(t.name) + ' 사진">')
        : '<div class="tree-photo placeholder" role="img" aria-label="등록된 사진 없음">🌳</div>';
      const story = t.audio_url
        ? '<section class="public-story"><h2>나무이야기</h2><p>' + esc(t.audio_name || '나무이야기 음성') + '</p><audio controls preload="metadata" src="' + esc(t.audio_url) + '"></audio></section>'
        : '<section class="public-story"><h2>나무이야기</h2><p>아직 등록된 이야기가 없습니다.</p></section>';
      view.innerHTML = '<article class="card public-card">' + photo
        + '<h1>' + esc(t.name) + '</h1>'
        + '<p>' + esc(t.property_item || t.property_type || '입목죽') + ' · 대장번호 ' + esc(t.asset_no) + '</p>'
        + '<span class="badge ' + esc(status) + '">현재 상태 ' + esc(status) + '</span>'
        + story
        + '<p class="public-note">QR코드 방문자를 위한 공개 화면입니다. 재산 금액, 위치, 점검일지는 관리자만 볼 수 있습니다.</p>'
        + '<div class="public-actions"><a class="secondary" href="../">트리샘 소개</a><a class="primary" href="./?detail=' + encodeURIComponent(t.id) + '">관리자 로그인 후 상세정보</a></div>'
        + '</article>';
    } catch (error) {
      console.error('[TreeSam] 공개 수목 조회 실패:', error);
      fail(describeError(error));
    }
  }

  /* ---------- 이벤트 연결 ---------- */
  $('stats').addEventListener('click', e => {
    const card = e.target.closest('.stat[data-filter]');
    if (card) setStatusFilter(card.dataset.filter);
  });
  let searchTimer = 0;
  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.visible = PAGE_SIZE; renderTrees(); }, 150);
  });
  $('addButton').addEventListener('click', () => openTreeModal());
  $('showNeedsButton').addEventListener('click', () => setStatusFilter('점검필요'));
  $('downloadRegisterButton').addEventListener('click', downloadTreeRegister);
  $('urgentList').addEventListener('click', e => {
    const b = e.target.closest('[data-urgent-id]');
    if (b) showDetails(b.dataset.urgentId);
  });
  $('treeCancel').addEventListener('click', closeTreeModal);
  $('logCancel').addEventListener('click', closeLogModal);
  $('detailClose').addEventListener('click', () => { state.detailTreeId = ''; closeModal('detailModal'); });
  modalClosers.detailModal = () => { state.detailTreeId = ''; closeModal('detailModal'); };
  $('qrClose').addEventListener('click', () => closeModal('qrModal'));
  $('copyQrUrl').addEventListener('click', () => copyText($('qrUrl').value, '공개용 수목 주소를 복사했습니다.'));
  $('downloadQr').addEventListener('click', () => {
    const source = $('qrCode').querySelector('canvas') || $('qrCode').querySelector('img');
    if (!source) return;
    const link = document.createElement('a');
    link.download = ($('qrTitle').textContent || '수목') + '.png';
    link.href = source.tagName === 'CANVAS' ? source.toDataURL('image/png') : source.src;
    link.click();
  });
  $('cameraInput').addEventListener('change', e => selectPhoto(e.target));
  $('galleryInput').addEventListener('change', e => selectPhoto(e.target));
  $('locationCameraInput').addEventListener('change', e => selectImage(e.target, 'locationPhoto', 'locationPhotoPreview', 'locationPhotoHelp', '위치 사진'));
  $('locationGalleryInput').addEventListener('change', e => selectImage(e.target, 'locationPhoto', 'locationPhotoPreview', 'locationPhotoHelp', '위치 사진'));
  $('logPhotoCameraInput').addEventListener('change', e => selectImage(e.target, 'logPhoto', 'logPhotoPreview', 'logPhotoHelp', '나무상태사진'));
  $('logPhotoGalleryInput').addEventListener('change', e => selectImage(e.target, 'logPhoto', 'logPhotoPreview', 'logPhotoHelp', '나무상태사진'));
  $('audioInput').addEventListener('change', e => selectAudio(e.target));
  $('currentLocationButton').addEventListener('click', registerCurrentLocation);
  $('treeGrid').addEventListener('click', e => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const { action, id, url } = b.dataset;
    if (action === 'detail') showDetails(id);
    else if (action === 'qr') showQr(id);
    else if (action === 'log') openLogModal(id);
    else if (action === 'edit') openTreeModal(id);
    else if (action === 'delete') deleteTree(id);
    else if (action === 'copy-audio') copyText(url, '음성파일 주소를 복사했습니다.');
    else if (action === 'more') { state.visible += PAGE_SIZE; renderTrees(); }
  });
  $('detailContent').addEventListener('click', e => {
    const b = e.target.closest('button[data-detail-action]');
    if (!b) return;
    const { detailAction, id, url, treeId, logId } = b.dataset;
    if (detailAction === 'add-log') openLogModal(id);
    else if (detailAction === 'copy-audio') copyText(url, '음성파일 주소를 복사했습니다.');
    else if (detailAction === 'edit-log') openLogModal(treeId, logId);
    else if (detailAction === 'delete-log') deleteLog(treeId, logId);
  });

  /* ---------- 시작 ---------- */
  async function init() {
    $('logInspectionDate').value = localDate();
    const publicTreeId = new URLSearchParams(location.search).get('tree');
    if (publicTreeId) { await showPublicTree(publicTreeId); return; }
    if (!client) {
      setMode('auth');
      authMessage('데이터 연결 프로그램을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.');
      $('authSubmit').disabled = true;
      return;
    }
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setAuthMode('recovery');
        setMode('auth');
        return;
      }
      // 콜백 안에서 다른 Supabase 호출을 바로 기다리면 교착될 수 있어 다음 틱으로 넘깁니다.
      setTimeout(() => applySession(session), 0);
    });
    const { data } = await client.auth.getSession();
    applySession(data.session);
  }

  setAuthMode('login');
  init();
})();
