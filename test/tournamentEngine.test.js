const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/utils/tournamentEngine');

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const pairKey = (f) => [f.aId, f.bId].sort().join('-');

test('round robin: every pair meets exactly once (even and odd)', () => {
  for (const n of [2, 3, 4, 5, 8]) {
    const fx = E.roundRobin(ids(n));
    const keys = fx.map(pairKey);
    assert.equal(keys.length, (n * (n - 1)) / 2, `n=${n}`);
    assert.equal(new Set(keys).size, keys.length, `n=${n} duplicates`);
    const rounds = new Map();
    for (const f of fx) {
      const s = rounds.get(f.round) || new Set();
      assert.ok(!s.has(f.aId) && !s.has(f.bId), `n=${n} round ${f.round}`);
      s.add(f.aId).add(f.bId);
      rounds.set(f.round, s);
    }
    assert.equal(rounds.size, n % 2 ? n : n - 1);
  }
});

test('round robin double: each pair twice with swapped sides', () => {
  const fx = E.roundRobin(ids(4), { doubleRound: true });
  assert.equal(fx.length, 12);
  assert.equal(new Set(fx.map((f) => `${f.aId}>${f.bId}`)).size, 12);
});

test('round robin needs at least 2', () => {
  assert.throws(() => E.roundRobin(['x']), /اثنين/);
});

test('directed draw follows seeds, unseeded last; random draw is a permutation', () => {
  const ps = [{ id: 'a', seed: 3 }, { id: 'b', seed: null }, { id: 'c', seed: 1 }, { id: 'd', seed: 2 }];
  assert.deepEqual(E.orderForDraw(ps, 'directed'), ['c', 'd', 'a', 'b']);
  const r = E.orderForDraw(ps, 'random', () => 0.3);
  assert.deepEqual([...r].sort(), ['a', 'b', 'c', 'd']);
});

test('bracket order keeps top seeds apart', () => {
  assert.deepEqual(E.bracketOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(E.bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('knockout with power of two has no byes', () => {
  const fx = E.knockoutBracket(ids(8));
  assert.equal(fx.length, 7);
  assert.equal(fx.filter((f) => f.status === 'bye').length, 0);
  assert.deepEqual([fx[0].aId, fx[0].bId], ['p1', 'p8']);
});

test('knockout with 6: top 2 seeds get byes and are placed in round 2', () => {
  const fx = E.knockoutBracket(ids(6));
  const byes = fx.filter((f) => f.status === 'bye');
  assert.deepEqual(byes.map((f) => f.winnerId).sort(), ['p1', 'p2']);
  const r2 = fx.filter((f) => f.round === 2);
  assert.equal(r2[0].aId, 'p1');
  assert.equal(r2[1].aId, 'p2');
  assert.equal(fx.find((f) => f.round === 3).nextMatchNo, null);
});

test('knockout with 5 and 3', () => {
  assert.equal(E.knockoutBracket(ids(5)).filter((f) => f.status === 'bye').length, 3);
  const f3 = E.knockoutBracket(ids(3));
  assert.equal(f3.filter((f) => f.status === 'bye').length, 1);
  assert.equal(f3.find((f) => f.round === 2).aId, 'p1');
});

test('advanceWinner moves winner to correct slot', () => {
  const fx = E.knockoutBracket(ids(4));
  const m2 = fx.find((f) => f.round === 1 && f.matchNo === 2);
  m2.winnerId = m2.bId;
  E.advanceWinner(fx, m2);
  assert.equal(fx.find((f) => f.round === 2).bId, m2.bId);
});

test('split groups snake-wise and rejects too few', () => {
  assert.deepEqual(E.splitGroups(ids(8), 2), [['p1', 'p4', 'p5', 'p8'], ['p2', 'p3', 'p6', 'p7']]);
  assert.throws(() => E.splitGroups(ids(3), 2));
});

test('qualifiers feed a bracket where group-mates do not meet first', () => {
  for (const groups of [2, 4]) {
    const g = Array.from({ length: groups }, (_, i) => [{ id: `${i}-1` }, { id: `${i}-2` }]);
    const r1 = E.knockoutBracket(E.qualifiersFromGroups(g, 2)).filter((f) => f.round === 1);
    for (const f of r1) assert.notEqual(f.aId.split('-')[0], f.bId.split('-')[0]);
  }
});

const setsT = { scoring: { mode: 'sets', bestOf: 3, pointsPerSet: 11, winByTwo: true } };

test('sets: valid best of 3', () => {
  const r = E.evaluateResult({ sets: [{ a: 11, b: 7 }, { a: 9, b: 11 }, { a: 13, b: 11 }] }, setsT, 'league');
  assert.equal(r.outcome, 'a');
  assert.equal(r.scoreA, 2);
  assert.equal(r.scoreB, 1);
});

test('sets: rejects invalid sets and extra sets', () => {
  assert.throws(() => E.evaluateResult({ sets: [{ a: 11, b: 10 }] }, setsT, 'league'), /نقطتين/);
  assert.throws(() => E.evaluateResult({ sets: [{ a: 14, b: 11 }] }, setsT, 'league'));
  assert.throws(() => E.evaluateResult({ sets: [{ a: 11, b: 3 }] }, setsT, 'league'), /2 أشواط/);
  assert.throws(
    () => E.evaluateResult({ sets: [{ a: 11, b: 3 }, { a: 11, b: 3 }, { a: 11, b: 3 }] }, setsT, 'league'),
    /انتهت/
  );
});

test('sets: cap allows 1-point win at cap; no win-by-two requires exact target', () => {
  const capped = { scoring: { mode: 'sets', bestOf: 1, pointsPerSet: 21, winByTwo: true, maxPointsPerSet: 30 } };
  assert.equal(E.evaluateResult({ sets: [{ a: 30, b: 29 }] }, capped, 'league').outcome, 'a');
  const plain = { scoring: { mode: 'sets', bestOf: 1, pointsPerSet: 15, winByTwo: false } };
  assert.equal(E.evaluateResult({ sets: [{ a: 14, b: 15 }] }, plain, 'league').outcome, 'b');
  assert.throws(() => E.evaluateResult({ sets: [{ a: 16, b: 14 }] }, plain, 'league'));
});

const goalsT = {
  scoring: { mode: 'goals' },
  league: { allowDraws: true },
  knockout: { penaltiesEnabled: true, penaltiesCount: 5 },
};

test('goals: league draw allowed or forbidden', () => {
  assert.equal(E.evaluateResult({ scoreA: 1, scoreB: 1 }, goalsT, 'league').outcome, 'draw');
  const noDraw = { ...goalsT, league: { allowDraws: false } };
  assert.throws(() => E.evaluateResult({ scoreA: 1, scoreB: 1 }, noDraw, 'league'), /التعادل/);
});

test('goals: knockout draw needs penalties when enabled', () => {
  assert.throws(() => E.evaluateResult({ scoreA: 2, scoreB: 2 }, goalsT, 'knockout'), /الترجيح/);
  const r = E.evaluateResult({ scoreA: 2, scoreB: 2, penaltiesA: 3, penaltiesB: 4 }, goalsT, 'knockout');
  assert.equal(r.outcome, 'b');
  const off = { ...goalsT, knockout: { penaltiesEnabled: false } };
  assert.throws(() => E.evaluateResult({ scoreA: 0, scoreB: 0 }, off, 'knockout'));
});

const P = (aId, bId, forA, forB) => ({
  aId, bId, forA, forB, status: 'played', outcome: forA > forB ? 'a' : forB > forA ? 'b' : 'draw',
});

test('standings: points, draws and positions', () => {
  const fx = [P('x', 'y', 0, 1), P('x', 'z', 2, 0), P('y', 'z', 0, 1), P('z', 'w', 0, 0), P('x', 'w', 1, 1), P('y', 'w', 2, 1)];
  const s = E.computeStandings(['x', 'y', 'z', 'w'], fx);
  const byId = Object.fromEntries(s.map((r) => [r.id, r]));
  assert.equal(byId.y.points, 6);
  assert.equal(byId.x.points, 4);
  assert.equal(byId.w.drawn, 2);
  assert.equal(s[0].id, 'y');
  assert.ok(s.every((r, i) => r.position === i + 1));
});

test('standings: head-to-head breaks a full tie', () => {
  // a و b متساويان تماماً (3 نقاط، فارق 0، أهداف 2) لكن b فاز على a.
  const fx = [P('a', 'b', 0, 1), P('a', 'c', 2, 1), P('b', 'c', 1, 2), P('c', 'd', 0, 0)];
  const s = E.computeStandings(['a', 'b', 'c', 'd'], fx);
  const pos = Object.fromEntries(s.map((r) => [r.id, r.position]));
  assert.ok(pos.b < pos.a, JSON.stringify(s));
});
