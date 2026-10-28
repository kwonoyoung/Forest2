/* 트리샘 EcoLenses — 사진 색 분석 엔진 (AI 없이 브라우저에서 계산)
   입력: {data, width, height} (ImageData 형식), 촬영 방식 mode = 'tree' | 'leaf' | 'sky'
   모든 수치는 사진 색을 바탕으로 한 '추정값'입니다. */
(function (root) {
  'use strict';

  const CLS = { OTHER: 0, GREEN: 1, YELLOW: 2, BROWN: 3, SKY: 4, SPOT: 5 };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  /* 픽셀 하나를 분류합니다. 순서가 중요합니다: 하늘 → 녹색 → 노랑 → 갈색 */
  function classify(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), delta = mx - mn, lum = lumOf(r, g, b);
    // 하늘: 파란 기운이 강하거나, 매우 밝고 채도가 낮은 흰 하늘
    if ((b > r * 1.08 && b >= g * 0.98 && lum > 105 && b > 120) || (lum > 205 && delta < 28)) return CLS.SKY;
    // 녹색 잎
    if ((g > r * 1.06 && g > b * 1.04 && g > 55 && delta > 18) || (g > 85 && g - r > 12 && g - b > 8)) return CLS.GREEN;
    // 노란 잎: 빨강≈초록, 파랑이 확실히 낮음
    if (r > 120 && g > 105 && Math.abs(r - g) < 0.22 * Math.max(r, g) && b < 0.68 * Math.min(r, g)) return CLS.YELLOW;
    // 갈색·건조색
    if (r > 75 && g > 45 && b < 110 && r >= g * 1.05 && g >= b * 1.05 && delta > 20) return CLS.BROWN;
    return CLS.OTHER;
  }

  /* 촬영 품질: 밝기, 노출, 흐림(라플라시안 분산) */
  function quality(gray, w, h) {
    const n = w * h;
    let sum = 0, over = 0, under = 0;
    for (let i = 0; i < n; i++) { const v = gray[i]; sum += v; if (v > 245) over++; else if (v < 18) under++; }
    const mean = sum / n / 255;
    // 라플라시안 분산 (가장자리 1픽셀 제외)
    let ls = 0, l2 = 0, cnt = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
        ls += lap; l2 += lap * lap; cnt++;
      }
    }
    const sharp = cnt ? l2 / cnt - (ls / cnt) ** 2 : 0;
    const issues = [];
    if (Math.min(w, h) < 200) issues.push('사진 해상도가 낮습니다. 더 크게 찍어 주세요.');
    if (mean < 0.18) issues.push('사진이 너무 어둡습니다. 밝은 곳에서 다시 찍어 주세요.');
    if (mean > 0.85) issues.push('사진이 너무 밝습니다. 해를 등지고 찍어 주세요.');
    if (over / n > 0.25 && mean <= 0.85) issues.push('밝게 날아간 부분이 많습니다(역광 의심). 해를 등지고 찍어 주세요.');
    if (under / n > 0.35) issues.push('검게 묻힌 부분이 많습니다. 그늘을 피해 찍어 주세요.');
    if (sharp < 45) issues.push('사진이 흐립니다. 초점을 맞추고 흔들리지 않게 찍어 주세요.');
    return { mean, overRatio: over / n, underRatio: under / n, sharpness: sharp, ok: issues.length === 0, issues };
  }

  /* 잎 위의 반점 수: 잎(녹색·노랑) 사이에 박힌 작은 갈색·검은 얼룩 덩어리 */
  function countSpots(cls, gray, w, h) {
    const n = w * h, cand = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = cls[i];
      if (c === CLS.BROWN || (c === CLS.OTHER && gray[i] < 70)) cand[i] = 1;
    }
    const seen = new Uint8Array(n), stack = new Int32Array(n), spots = [];
    const minA = Math.max(3, Math.round(n * 0.00002)), maxA = Math.round(n * 0.006);
    for (let s = 0; s < n; s++) {
      if (!cand[s] || seen[s]) continue;
      let top = 0, area = 0, minx = w, miny = h, maxx = 0, maxy = 0, sx = 0, sy = 0;
      stack[top++] = s; seen[s] = 1;
      while (top) {
        const i = stack[--top], x = i % w, y = (i / w) | 0;
        area++; sx += x; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (area > maxA + 1) continue; // 너무 큰 덩어리는 끝까지 셀 필요 없음
        const nb = [i - 1, i + 1, i - w, i + w];
        for (let k = 0; k < 4; k++) {
          const j = nb[k];
          if (j < 0 || j >= n) continue;
          if ((k === 0 && x === 0) || (k === 1 && x === w - 1)) continue;
          if (cand[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
        }
      }
      if (area < minA || area > maxA) continue;
      // 주변 테두리가 대부분 잎이어야 '잎 위의 반점'으로 인정
      const pad = 2, x0 = Math.max(0, minx - pad), x1 = Math.min(w - 1, maxx + pad), y0 = Math.max(0, miny - pad), y1 = Math.min(h - 1, maxy + pad);
      let ring = 0, leaf = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (x > minx - 1 && x < maxx + 1 && y > miny - 1 && y < maxy + 1) continue;
        ring++; const c = cls[y * w + x]; if (c === CLS.GREEN || c === CLS.YELLOW) leaf++;
      }
      if (ring && leaf / ring >= 0.55) spots.push({ x: sx / area, y: sy / area, r: Math.max(maxx - minx, maxy - miny) / 2 + 2 });
    }
    return spots;
  }

  /* 점검 상태 추천 (트리샘 점검일지의 양호·보통·주의·위험) */
  function recommend(m, mode, q) {
    const reasons = [];
    if (!q.ok) reasons.push('촬영 품질이 낮아 판단이 정확하지 않을 수 있습니다.');
    if (mode !== 'sky' && m.plantRatio < 0.08) {
      return { status: null, label: '판단 보류', reasons: reasons.concat('사진에서 잎이 거의 보이지 않습니다. 잎이나 수관이 잘 보이게 다시 찍어 주세요.') };
    }
    let level = 0; // 0 양호, 1 보통, 2 주의, 3 위험
    const bump = (lv, why) => { if (lv > level) level = lv; reasons.push(why); };
    const brownOfPlant = m.plantRatio ? m.brown / m.plantRatio : 0;
    const yellowOfPlant = m.plantRatio ? m.yellow / m.plantRatio : 0;
    if (brownOfPlant > 0.45) bump(3, '식물 부분의 갈변·건조색이 매우 많습니다.');
    else if (brownOfPlant > 0.25) bump(2, '식물 부분에 갈변·건조색이 눈에 띕니다.');
    if (yellowOfPlant > 0.35) bump(2, '노랗게 변한 잎이 많습니다(물·영양 부족 또는 단풍 확인).');
    else if (yellowOfPlant > 0.18) bump(1, '노란 잎이 일부 보입니다.');
    if (mode === 'leaf') {
      if (m.spots >= 15) bump(3, '잎 반점이 많습니다. 병해충 여부를 확인해 주세요.');
      else if (m.spots >= 5) bump(2, '잎에 반점이 여럿 있습니다.');
      else if (m.spots >= 2) bump(1, '잎에 작은 반점이 보입니다.');
    }
    if (mode === 'sky' && m.canopyCover != null) {
      if (m.canopyCover < 0.25) bump(2, '수관 피복률이 낮습니다. 잎이 적거나 가지가 고사했을 수 있습니다(계절 확인).');
      else if (m.canopyCover < 0.45) bump(1, '수관 피복률이 다소 낮습니다.');
    }
    if (m.score < 35) bump(2, '추정 활력도가 낮습니다.');
    else if (m.score < 55) bump(1, '추정 활력도가 보통 수준입니다.');
    if (level === 0) reasons.push('색으로 본 상태에서 뚜렷한 이상 신호가 없습니다.');
    const labels = ['양호', '보통', '주의', '위험'];
    return { status: labels[level], label: labels[level], reasons };
  }

  /* 메인 분석 */
  function analyze(img, mode) {
    mode = mode || 'tree';
    const { data, width: w, height: h } = img, n = w * h;
    const cls = new Uint8Array(n), gray = new Float32Array(n);
    let green = 0, yellow = 0, brown = 0, sky = 0, ls = 0, l2 = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const lum = lumOf(r, g, b); gray[i] = lum; ls += lum; l2 += lum * lum;
      const c = classify(r, g, b); cls[i] = c;
      if (c === CLS.GREEN) green++; else if (c === CLS.YELLOW) yellow++; else if (c === CLS.BROWN) brown++; else if (c === CLS.SKY) sky++;
    }
    const q = quality(gray, w, h);
    const gr = green / n, ye = yellow / n, br = brown / n, sk = sky / n;
    const bright = ls / n / 255;
    const variance = Math.sqrt(Math.max(0, l2 / n - (ls / n) ** 2)) / 128;
    // 녹색 지수(ExG 평균): 2G - R - B 를 0~1로 정규화. 교과서에 나오는 식생 지수의 하나
    let exg = 0;
    for (let p = 0; p < data.length; p += 4) { const s = data[p] + data[p + 1] + data[p + 2] || 1; exg += (2 * data[p + 1] - data[p] - data[p + 2]) / s; }
    exg = exg / n; // -1 ~ 2

    const spots = mode === 'leaf' ? countSpots(cls, gray, w, h) : [];
    // 하늘 방향 사진에서는 '하늘이 아닌 부분'이 잎·가지가 가린 비율(수관 피복률)
    const canopyCover = mode === 'sky' ? 1 - sk : null;
    // 식물 부분 비율: 하늘을 뺀 면적 중 녹색+노랑+갈색
    const nonSky = Math.max(1e-6, 1 - sk);
    const plantRatio = mode === 'sky' ? (green + yellow + brown) / n : gr + ye + br;

    let veg, dry, yel;
    if (mode === 'sky') { veg = clamp(gr / nonSky * 1.3, 0, 1); dry = clamp(br / nonSky * 1.25, 0, 1); yel = clamp(ye / nonSky * 1.2, 0, 1); }
    else { veg = clamp(gr * 1.45, 0, 1); dry = clamp(br * 1.25, 0, 1); yel = clamp(ye * 1.2, 0, 1); }
    const light = 1 - clamp(Math.abs(bright - 0.52) / 0.52, 0, 1);
    let vit = veg * 0.55 + (1 - dry) * 0.2 + (1 - yel) * 0.08 + light * 0.12 + clamp(variance, 0, 1) * 0.05;
    if (mode === 'leaf') vit -= clamp(spots.length / 40, 0, 0.15);
    if (mode === 'sky' && canopyCover != null) vit = vit * 0.7 + canopyCover * 0.3;
    vit = clamp(vit, 0, 1);
    const score = clamp(Math.round(vit * 100), 5, 98);

    const metrics = { green: gr, yellow: ye, brown: br, sky: sk, brightness: bright, vitality: vit, score, exg, spots: spots.length, canopyCover, plantRatio };
    return { mode, width: w, height: h, cls, spotList: spots, quality: q, metrics, recommendation: recommend(metrics, mode, q) };
  }

  /* 분석 지도: 분류 결과를 색으로 칠한 RGBA 배열 */
  const LAYER_COLORS = { 1: [46, 160, 67], 2: [242, 196, 15], 3: [214, 82, 40], 4: [66, 133, 244] };
  function overlayPixels(result, base, alpha) {
    const { cls, width: w, height: h } = result, out = new Uint8ClampedArray(w * h * 4);
    alpha = alpha == null ? 0.62 : alpha;
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const c = LAYER_COLORS[cls[i]];
      const r = base[p], g = base[p + 1], b = base[p + 2];
      if (c) { out[p] = r * (1 - alpha) + c[0] * alpha; out[p + 1] = g * (1 - alpha) + c[1] * alpha; out[p + 2] = b * (1 - alpha) + c[2] * alpha; }
      else { const v = lumOf(r, g, b) * 0.45; out[p] = v; out[p + 1] = v; out[p + 2] = v; }
      out[p + 3] = 255;
    }
    return out;
  }

  /* 측정 도구 계산 */
  const GROWTH = { fast: 2.5, medium: 4, slow: 5, veryslow: 7 }; // ISA 생장계수(흉고직경 인치 × 계수 = 추정 나이) 단순화
  function trunkFromGirth(girthCm) { return girthCm > 0 ? girthCm / Math.PI : null; } // 흉고직경 cm
  function estimateAge(dbhCm, group) { const f = GROWTH[group]; return dbhCm && f ? Math.round(dbhCm / 2.54 * f) : null; }
  // 교육용 일반 수목 탄소 추정식 (USDA 계열): 생중량(lb)=0.25·D²·H (D<11in) 또는 0.15·D²·H, 뿌리 포함 ×1.2, 건중량 72.5%, 탄소 50%
  function estimateCarbon(dbhCm, heightM) {
    if (!dbhCm || !heightM) return null;
    const D = dbhCm / 2.54, H = heightM * 3.28084;
    const green = (D < 11 ? 0.25 : 0.15) * D * D * H * 1.2;
    const dryKg = green * 0.725 * 0.453592;
    const carbonKg = dryKg * 0.5;
    return { dryKg, carbonKg, co2Kg: carbonKg * 3.6663 };
  }
  function treeHeight(distanceM, angleDeg, eyeM) {
    if (!(distanceM > 0) || !(angleDeg > 0 && angleDeg < 89)) return null;
    return distanceM * Math.tan(angleDeg * Math.PI / 180) + (eyeM || 0);
  }

  const api = { CLS, classify, analyze, quality, countSpots, recommend, overlayPixels, trunkFromGirth, estimateAge, estimateCarbon, treeHeight, GROWTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EcoAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
