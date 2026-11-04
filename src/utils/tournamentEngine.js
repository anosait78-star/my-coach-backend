// منطق البطولات (دوال نقية بدون قاعدة بيانات): القرعة، توليد الجدول،
// حساب نتيجة المباراة، وجدول الترتيب. المعرّفات نصوص.
const AppError = require('./AppError');

const bad = (msg) => new AppError(msg, 400);

// خلط Fisher–Yates — rng قابل للحقن من أجل الاختبارات.
function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ترتيب المشاركين حسب طريقة القرعة.
// participants: [{ id, seed }] — في الموجّه: الأقل seed أولاً، ومن بلا seed في الآخر.
function orderForDraw(participants, drawMode, rng) {
  if (drawMode === 'random') return shuffle(participants.map((p) => p.id), rng);
  return [...participants]
    .map((p, i) => ({ ...p, i }))
    .sort((x, y) => (x.seed ?? Infinity) - (y.seed ?? Infinity) || x.i - y.i)
    .map((p) => p.id);
}

// دوري كل فريق ضد الكل (طريقة الدوران). عدد فردي ⇒ فريق يرتاح كل جولة.
function roundRobin(ids, { doubleRound = false } = {}) {
  if (ids.length < 2) throw bad('يجب وجود مشاركين اثنين على الأقل');
  const list = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const rounds = [];
  let arr = list;
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const x = arr[i];
      const y = arr[n - 1 - i];
      if (x === null || y === null) continue;
      // تبديل الأرض بالتناوب حتى لا يلعب أحد دائماً كطرف أول.
      pairs.push(r % 2 === 0 ? [x, y] : [y, x]);
    }
    rounds.push(pairs);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  if (doubleRound) {
    const back = rounds.map((pairs) => pairs.map(([x, y]) => [y, x]));
    rounds.push(...back);
  }
  const fixtures = [];
  rounds.forEach((pairs, r) =>
    pairs.forEach(([a, b], m) => fixtures.push({ round: r + 1, matchNo: m + 1, aId: a, bId: b, status: 'pending' }))
  );
  return fixtures;
}

// توزيع المشاركين على المجموعات (ثعباني) بحيث تتوزع المصنفات بالتساوي.
function splitGroups(ids, count) {
  if (!Number.isInteger(count) || count < 1) throw bad('عدد المجموعات غير صحيح');
  if (ids.length < count * 2) throw bad('عدد المشاركين قليل جداً لهذا العدد من المجموعات');
  const groups = Array.from({ length: count }, () => []);
  ids.forEach((id, i) => {
    const row = Math.floor(i / count);
    const col = i % count;
    groups[row % 2 === 0 ? col : count - 1 - col].push(id);
  });
  return groups;
}

// ترتيب المقاعد القياسي في الشجرة: المصنف 1 يقابل الأخير، و1 و2 لا يلتقيان قبل النهائي.
function bracketOrder(size) {
  let order = [1];
  while (order.length < size) {
    const len = order.length * 2;
    order = order.flatMap((s) => [s, len + 1 - s]);
  }
  return order;
}

// نقل فائز مباراة كأس إلى مقعده في الدور التالي.
function advanceWinner(fixtures, f) {
  if (!f.nextMatchNo) return null;
  const next = fixtures.find((x) => x.round === f.round + 1 && x.matchNo === f.nextMatchNo);
  if (next) next[f.nextSlot === 'a' ? 'aId' : 'bId'] = f.winnerId;
  return next || null;
}

// شجرة خروج مغلوب. ids مرتبة حسب القوة (أو مخلوطة في العشوائي).
// العدد غير المناسب ⇒ صعود مباشر (bye) لأعلى المصنفين.
function knockoutBracket(ids) {
  if (ids.length < 2) throw bad('يجب وجود مشاركين اثنين على الأقل');
  let size = 2;
  while (size < ids.length) size *= 2;
  const order = bracketOrder(size);
  const slot = (seed) => (seed <= ids.length ? ids[seed - 1] : null);

  const totalRounds = Math.log2(size);
  const fixtures = [];
  for (let r = 1; r <= totalRounds; r++) {
    const count = size / 2 ** r;
    for (let m = 1; m <= count; m++) {
      fixtures.push({
        round: r,
        matchNo: m,
        aId: null,
        bId: null,
        status: 'pending',
        winnerId: null,
        nextMatchNo: r < totalRounds ? Math.ceil(m / 2) : null,
        nextSlot: r < totalRounds ? (m % 2 ? 'a' : 'b') : null,
      });
    }
  }
  fixtures
    .filter((f) => f.round === 1)
    .forEach((f, i) => {
      f.aId = slot(order[i * 2]);
      f.bId = slot(order[i * 2 + 1]);
      if (!f.aId || !f.bId) {
        f.status = 'bye';
        f.winnerId = f.aId || f.bId;
        advanceWinner(fixtures, f);
      }
    });
  return fixtures;
}

// التحقق من شوط واحد حسب إعدادات البطولة. يرجع 'a' أو 'b'.
function setWinner({ a, b }, s) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) throw bad('نتيجة الشوط غير صحيحة');
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === lo) throw bad('لا يمكن أن ينتهي الشوط بالتعادل');
  const target = s.pointsPerSet;
  const cap = s.maxPointsPerSet || null;
  if (hi < target) throw bad(`الشوط ينتهي عند ${target} نقطة`);
  if (cap && hi > cap) throw bad(`الحد الأقصى للشوط ${cap} نقطة`);
  if (s.winByTwo) {
    const reachedCap = cap && hi === cap;
    if (!reachedCap) {
      if (hi - lo < 2) throw bad('يجب الفوز بفارق نقطتين');
      // بعد تجاوز الهدف يستمر الشوط فقط حتى فارق نقطتين بالضبط.
      if (hi > target && hi - lo !== 2) throw bad('نتيجة الشوط غير منطقية');
    }
  } else if (hi !== target) {
    throw bad(`الشوط ينتهي عند ${target} نقطة`);
  }
  return a > b ? 'a' : 'b';
}

// حساب نتيجة مباراة. stage: league | group | knockout.
// يرجع { outcome: 'a'|'b'|'draw', forA, forB, scoreA, scoreB, sets, penaltiesA, penaltiesB }
function evaluateResult(input, tournament, stage) {
  const scoring = tournament.scoring || { mode: 'goals' };
  const isKO = stage === 'knockout';
  const out = { sets: [], scoreA: null, scoreB: null, penaltiesA: null, penaltiesB: null };

  if (scoring.mode === 'sets') {
    const sets = input.sets || [];
    const need = Math.ceil(scoring.bestOf / 2);
    let wa = 0;
    let wb = 0;
    sets.forEach((st, i) => {
      if (wa === need || wb === need) throw bad(`المباراة انتهت قبل الشوط ${i + 1}`);
      if (setWinner(st, scoring) === 'a') wa++;
      else wb++;
    });
    if (wa !== need && wb !== need) throw bad(`يجب أن يفوز أحد الطرفين بـ ${need} أشواط`);
    out.sets = sets.map((s) => ({ a: s.a, b: s.b }));
    out.scoreA = wa;
    out.scoreB = wb;
    out.outcome = wa > wb ? 'a' : 'b';
  } else {
    const { scoreA, scoreB } = input;
    if (![scoreA, scoreB].every((v) => Number.isInteger(v) && v >= 0)) throw bad('النتيجة غير صحيحة');
    out.scoreA = scoreA;
    out.scoreB = scoreB;
    if (scoreA !== scoreB) out.outcome = scoreA > scoreB ? 'a' : 'b';
    else if (!isKO) {
      if (tournament.league && tournament.league.allowDraws === false) throw bad('التعادل غير مسموح في هذه البطولة');
      out.outcome = 'draw';
    } else {
      if (!tournament.knockout || !tournament.knockout.penaltiesEnabled) {
        throw bad('مباريات الكأس لا تنتهي بالتعادل');
      }
      const { penaltiesA, penaltiesB } = input;
      if (![penaltiesA, penaltiesB].every((v) => Number.isInteger(v) && v >= 0) || penaltiesA === penaltiesB) {
        throw bad('يجب إدخال نتيجة ضربات الترجيح بفائز واضح');
      }
      out.penaltiesA = penaltiesA;
      out.penaltiesB = penaltiesB;
      out.outcome = penaltiesA > penaltiesB ? 'a' : 'b';
    }
  }
  out.forA = out.scoreA;
  out.forB = out.scoreB;
  return out;
}

// جدول الترتيب من المباريات الملعوبة.
// fixtures: [{ aId, bId, status, forA, forB, outcome }] — forA/forB أهداف أو أشواط.
function computeStandings(ids, fixtures, rules = {}) {
  const win = rules.winPoints ?? 3;
  const draw = rules.drawPoints ?? 1;
  const loss = rules.lossPoints ?? 0;
  const blank = (id) => ({ id, played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, diff: 0, points: 0 });
  const rowsOf = (subset) => {
    const rows = new Map(subset.map((id) => [id, blank(id)]));
    for (const f of fixtures) {
      if (f.status !== 'played') continue;
      const A = rows.get(f.aId);
      const B = rows.get(f.bId);
      if (!A || !B) continue;
      A.played++;
      B.played++;
      A.for += f.forA;
      A.against += f.forB;
      B.for += f.forB;
      B.against += f.forA;
      if (f.outcome === 'a') {
        A.won++; B.lost++; A.points += win; B.points += loss;
      } else if (f.outcome === 'b') {
        B.won++; A.lost++; B.points += win; A.points += loss;
      } else {
        A.drawn++; B.drawn++; A.points += draw; B.points += draw;
      }
    }
    for (const r of rows.values()) r.diff = r.for - r.against;
    return rows;
  };

  const cmp = (x, y) => y.points - x.points || y.diff - x.diff || y.for - x.for;
  const sorted = [...rowsOf(ids).values()].sort(cmp);

  // كسر التعادل بالمواجهات المباشرة بين المتساوين تماماً.
  const result = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
    const tied = sorted.slice(i, j);
    if (tied.length > 1) {
      const h2h = rowsOf(tied.map((r) => r.id));
      tied.sort((x, y) => cmp(h2h.get(x.id), h2h.get(y.id)) || ids.indexOf(x.id) - ids.indexOf(y.id));
    }
    result.push(...tied);
    i = j;
  }
  return result.map((r, i) => ({ ...r, position: i + 1 }));
}

// المتأهلون من المجموعات إلى الكأس كقائمة مصنفة: أوائل المجموعات أولاً ثم الثواني.
// مع ترتيب الشجرة (1 ضد الأخير) لا يتقابل أبناء المجموعة الواحدة في الدور الأول.
function qualifiersFromGroups(groupStandings, perGroup) {
  const out = [];
  for (let place = 0; place < perGroup; place++) {
    out.push(...groupStandings.map((rows) => rows[place]).filter(Boolean).map((r) => r.id));
  }
  return out;
}

module.exports = {
  shuffle,
  orderForDraw,
  roundRobin,
  splitGroups,
  bracketOrder,
  knockoutBracket,
  advanceWinner,
  setWinner,
  evaluateResult,
  computeStandings,
  qualifiersFromGroups,
};
