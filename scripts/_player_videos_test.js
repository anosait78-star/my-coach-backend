/* eslint-disable no-console */
/**
 * Player Videos feature smoke test.
 * Runs against an ISOLATED test database (dbName: nosait_videos_test) —
 * production data is never touched. The test DB is dropped at the end.
 *
 * Usage: node scripts/_player_videos_test.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const Academy = require('../src/models/academy.model');
const Player = require('../src/models/player.model');
const PlayerAccount = require('../src/models/playerAccount.model');
const PlayerVideo = require('../src/models/playerVideo.model');
const PlayerVideoComment = require('../src/models/playerVideoComment.model');
const { parseVideoLink } = require('../src/utils/videoLink');

const {
  getPlayerVideos,
  createPlayerVideo,
  updatePlayerVideo,
  deletePlayerVideo,
  likeAsAdmin,
  unlikeAsAdmin,
  listCommentsAsAdmin,
  addCommentAsAdmin,
  removeCommentAsAdmin,
  getMyVideos,
  likeAsPlayer,
  unlikeAsPlayer,
  listCommentsAsPlayer,
  addCommentAsPlayer,
  removeCommentAsPlayer,
} = require('../src/controllers/playerVideo.controller');

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

// أدوات mock بسيطة لاستدعاء الـ controllers مباشرة (نفس نمط اختبار البوابة).
const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const call = async (fn, req) => {
  const res = mockRes();
  let nextErr = null;
  try {
    await fn(req, res, (e) => { nextErr = e || null; });
  } catch (e) {
    nextErr = e; // الـ controllers ترمي AppError مباشرةً (express-async-errors)
  }
  return { res, nextErr };
};

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('❌ MONGODB_URI مفقود'); process.exit(1); }

  await mongoose.connect(uri, { dbName: 'nosait_videos_test' });
  console.log('✅ متصل بقاعدة الاختبار المعزولة (nosait_videos_test)');
  await mongoose.connection.dropDatabase();

  // ── 1) تحقّق الروابط (بدون قاعدة بيانات) ──────────────────────────────────
  console.log('\n— 1) تحقّق روابط الفيديو (قائمة بيضاء) —');
  const yt = parseVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  ok('يوتيوب watch → مقبول ويُستخرج المعرّف', yt?.provider === 'youtube' && yt.videoKey === 'dQw4w9WgXcQ');
  ok('يوتيوب يعطي مصغّراً', yt?.thumbnailUrl.includes('dQw4w9WgXcQ'));
  ok('youtu.be مقبول', parseVideoLink('https://youtu.be/dQw4w9WgXcQ')?.videoKey === 'dQw4w9WgXcQ');
  ok('shorts مقبول', parseVideoLink('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.videoKey === 'dQw4w9WgXcQ');
  ok('embed مقبول', parseVideoLink('https://www.youtube.com/embed/dQw4w9WgXcQ')?.videoKey === 'dQw4w9WgXcQ');
  ok('روابط يوتيوب تُوحَّد لصيغة watch',
    parseVideoLink('https://youtu.be/dQw4w9WgXcQ')?.url === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  ok('Google Drive مقبول', parseVideoLink('https://drive.google.com/file/d/abc123/view')?.provider === 'drive');
  ok('http (غير مشفّر) مرفوض', parseVideoLink('http://www.youtube.com/watch?v=dQw4w9WgXcQ') === null);
  ok('javascript: مرفوض', parseVideoLink('javascript:alert(1)') === null);
  ok('data: مرفوض', parseVideoLink('data:text/html,<script>alert(1)</script>') === null);
  ok('مضيف غير مسموح (vimeo) مرفوض', parseVideoLink('https://vimeo.com/12345') === null);
  ok('نص ليس رابطاً مرفوض', parseVideoLink('ليس رابطاً') === null);
  ok('يوتيوب بلا معرّف فيديو مرفوض', parseVideoLink('https://www.youtube.com/feed/trending') === null);
  ok('فارغ مرفوض', parseVideoLink('') === null);

  // ── تجهيز البيانات ────────────────────────────────────────────────────────
  const academyA = await Academy.create({ name: 'أكاديمية أ', phone: '01000000001', address: 'القاهرة', sports: ['كرة قدم'] });
  const academyB = await Academy.create({ name: 'أكاديمية ب', phone: '01000000002', address: 'الجيزة', sports: ['كرة قدم'] });

  const mkPlayer = (academyId, name) => Player.create({
    academyId, fullName: name, birthDate: new Date('2012-01-01'),
    parentName: 'ولي أمر', parentRelationship: 'أب', parentPhone: '0111111',
  });
  const playerA = await mkPlayer(academyA._id, 'لاعب أ');
  const playerA2 = await mkPlayer(academyA._id, 'لاعب أ الثاني');
  const playerB = await mkPlayer(academyB._id, 'لاعب ب');

  const mkAccount = (player) => PlayerAccount.create({
    playerId: player._id, academyId: player.academyId,
    username: `nosait${Math.floor(10000 + Math.random() * 89999)}`,
    password: 'Passw0rd!123',
  });
  const accA = await mkAccount(playerA);
  const accA2 = await mkAccount(playerA2);

  const adminOf = (academyId, name = 'مدير') => ({
    _id: new mongoose.Types.ObjectId(), role: 'academy_admin', academyId, name,
  });
  const adminA = adminOf(academyA._id, 'مدير أ');
  const adminB = adminOf(academyB._id, 'مدير ب');
  const superAdmin = { _id: new mongoose.Types.ObjectId(), role: 'super_admin', academyId: null, name: 'مدير عام' };

  const asAdmin = (user, extra = {}) => ({ user, params: {}, body: {}, query: {}, ...extra });
  const asPlayer = (player, account, extra = {}) =>
    ({ player, playerAccount: account, params: {}, body: {}, query: {}, ...extra });

  // ── 2) إضافة فيديو ────────────────────────────────────────────────────────
  console.log('\n— 2) إضافة فيديو (جهة الإدارة) —');
  const { res: addRes } = await call(createPlayerVideo, asAdmin(adminA, {
    body: { playerId: playerA._id.toString(), title: 'تدريب المهارات', description: 'حصة الأحد', url: 'https://youtu.be/dQw4w9WgXcQ' },
  }));
  ok('الإضافة نجحت (201)', addRes.statusCode === 201 && addRes.body?.success === true);
  const videoId = addRes.body?.data?._id;
  ok('الرابط مُوحَّد ومصغّر يوتيوب محفوظ',
    addRes.body?.data?.url === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' &&
    (addRes.body?.data?.thumbnailUrl || '').includes('dQw4w9WgXcQ'));
  ok('قائمة المعجِبين لا تُسرَّب للعميل', addRes.body?.data?.likes === undefined);
  ok('likesCount = 0 و likedByMe = false', addRes.body?.data?.likesCount === 0 && addRes.body?.data?.likedByMe === false);

  const { nextErr: badUrlErr } = await call(createPlayerVideo, asAdmin(adminA, {
    body: { playerId: playerA._id.toString(), title: 'رابط سيئ', url: 'https://evil.example.com/x.mp4' },
  }));
  ok('رابط من مضيف غير مسموح → 400', badUrlErr?.statusCode === 400);

  const { nextErr: crossErr } = await call(createPlayerVideo, asAdmin(adminB, {
    body: { playerId: playerA._id.toString(), title: 'اختراق', url: 'https://youtu.be/dQw4w9WgXcQ' },
  }));
  ok('عزل الأكاديميات: مدير أكاديمية أخرى → 403', crossErr?.statusCode === 403);

  const { res: superRes } = await call(createPlayerVideo, asAdmin(superAdmin, {
    body: { playerId: playerB._id.toString(), title: 'فيديو لاعب ب', url: 'https://youtu.be/dQw4w9WgXcQ' },
  }));
  ok('super_admin يضيف لأي أكاديمية (201)', superRes.statusCode === 201);

  // ── 3) القراءة والعزل ─────────────────────────────────────────────────────
  console.log('\n— 3) القراءة والعزل —');
  const { res: listRes } = await call(getPlayerVideos, asAdmin(adminA, { query: { playerId: playerA._id.toString() } }));
  ok('المدير يرى فيديوهات لاعبه (1)', listRes.body?.data?.length === 1);

  const { nextErr: listCrossErr } = await call(getPlayerVideos, asAdmin(adminB, { query: { playerId: playerA._id.toString() } }));
  ok('مدير أكاديمية أخرى لا يرى القائمة → 403', listCrossErr?.statusCode === 403);

  const { res: myRes } = await call(getMyVideos, asPlayer(playerA, accA));
  ok('اللاعب يرى فيديوهاته (1)', myRes.body?.data?.length === 1);

  const { res: my2Res } = await call(getMyVideos, asPlayer(playerA2, accA2));
  ok('لاعب آخر بنفس الأكاديمية لا يرى فيديوهات غيره (0)', my2Res.body?.data?.length === 0);

  const { nextErr: likeCrossErr } = await call(likeAsPlayer, asPlayer(playerA2, accA2, { params: { id: videoId } }));
  ok('لاعب آخر لا يستطيع الإعجاب بفيديو غيره → 403', likeCrossErr?.statusCode === 403);

  // ── 4) الإعجاب ────────────────────────────────────────────────────────────
  console.log('\n— 4) الإعجاب —');
  const { res: pLike } = await call(likeAsPlayer, asPlayer(playerA, accA, { params: { id: videoId } }));
  ok('إعجاب اللاعب → likesCount = 1 و likedByMe = true',
    pLike.body?.data?.likesCount === 1 && pLike.body?.data?.likedByMe === true);

  const { res: pLikeAgain } = await call(likeAsPlayer, asPlayer(playerA, accA, { params: { id: videoId } }));
  ok('تكرار الإعجاب لا يضاعف العدّاد', pLikeAgain.body?.data?.likesCount === 1);

  const { res: aLike } = await call(likeAsAdmin, asAdmin(adminA, { params: { id: videoId } }));
  ok('إعجاب الإدارة يُضاف بشكل مستقل (2)', aLike.body?.data?.likesCount === 2);

  const { res: aView } = await call(getPlayerVideos, asAdmin(adminA, { query: { playerId: playerA._id.toString() } }));
  ok('likedByMe محسوب لكل طرف على حدة', aView.body?.data?.[0]?.likedByMe === true);

  const { res: pUnlike } = await call(unlikeAsPlayer, asPlayer(playerA, accA, { params: { id: videoId } }));
  ok('إلغاء إعجاب اللاعب → 1 و likedByMe = false',
    pUnlike.body?.data?.likesCount === 1 && pUnlike.body?.data?.likedByMe === false);

  const { res: aUnlike } = await call(unlikeAsAdmin, asAdmin(adminA, { params: { id: videoId } }));
  ok('إلغاء إعجاب الإدارة → 0', aUnlike.body?.data?.likesCount === 0);

  // ── 5) التعليقات ──────────────────────────────────────────────────────────
  console.log('\n— 5) التعليقات —');
  const { res: aComment } = await call(addCommentAsAdmin, asAdmin(adminA, {
    params: { id: videoId }, body: { text: 'أداء ممتاز 👏' },
  }));
  ok('تعليق الإدارة نجح (201)', aComment.statusCode === 201);
  ok('نوع الكاتب academy', aComment.body?.data?.authorType === 'academy');
  const adminCommentId = aComment.body?.data?._id;

  const { res: pComment } = await call(addCommentAsPlayer, asPlayer(playerA, accA, {
    params: { id: videoId }, body: { text: 'شكراً كوتش' },
  }));
  ok('تعليق اللاعب نجح (201)', pComment.statusCode === 201 && pComment.body?.data?.authorType === 'player');
  const playerCommentId = pComment.body?.data?._id;

  const { nextErr: emptyErr } = await call(addCommentAsPlayer, asPlayer(playerA, accA, {
    params: { id: videoId }, body: { text: '   ' },
  }));
  ok('تعليق فارغ مرفوض → 400', emptyErr?.statusCode === 400);

  const { res: cList } = await call(listCommentsAsPlayer, asPlayer(playerA, accA, { params: { id: videoId } }));
  ok('اللاعب يقرأ التعليقات (2)', cList.body?.data?.length === 2);

  const afterComments = await PlayerVideo.findById(videoId);
  ok('commentsCount = 2', afterComments.commentsCount === 2);

  const { nextErr: delOtherErr } = await call(removeCommentAsPlayer, asPlayer(playerA, accA, {
    params: { id: videoId, commentId: adminCommentId },
  }));
  ok('اللاعب لا يحذف تعليق الإدارة → 403', delOtherErr?.statusCode === 403);

  const { res: delOwn } = await call(removeCommentAsPlayer, asPlayer(playerA, accA, {
    params: { id: videoId, commentId: playerCommentId },
  }));
  ok('اللاعب يحذف تعليقه هو', delOwn.statusCode === 200);

  const { res: delByAdmin } = await call(removeCommentAsAdmin, asAdmin(adminA, {
    params: { id: videoId, commentId: adminCommentId },
  }));
  ok('الإدارة تحذف أي تعليق', delByAdmin.statusCode === 200);

  const afterDeletes = await PlayerVideo.findById(videoId);
  ok('commentsCount عاد إلى 0', afterDeletes.commentsCount === 0);

  const { res: cList2 } = await call(listCommentsAsAdmin, asAdmin(adminA, { params: { id: videoId } }));
  ok('لا تعليقات متبقية', cList2.body?.data?.length === 0);

  // ── 6) التعديل والحذف ─────────────────────────────────────────────────────
  console.log('\n— 6) التعديل والحذف —');
  const { res: upd } = await call(updatePlayerVideo, asAdmin(adminA, {
    params: { id: videoId }, body: { title: 'عنوان محدَّث', url: 'https://drive.google.com/file/d/abc/view' },
  }));
  ok('التعديل نجح والمزوّد تغيّر إلى drive',
    upd.statusCode === 200 && upd.body?.data?.title === 'عنوان محدَّث' && upd.body?.data?.provider === 'drive');

  const { nextErr: updBadErr } = await call(updatePlayerVideo, asAdmin(adminA, {
    params: { id: videoId }, body: { url: 'http://youtube.com/watch?v=dQw4w9WgXcQ' },
  }));
  ok('تعديل برابط غير صالح → 400', updBadErr?.statusCode === 400);

  const { nextErr: delCrossErr } = await call(deletePlayerVideo, asAdmin(adminB, { params: { id: videoId } }));
  ok('مدير أكاديمية أخرى لا يحذف → 403', delCrossErr?.statusCode === 403);

  // تعليق جديد للتأكد أنه يُحذف مع الفيديو
  await call(addCommentAsAdmin, asAdmin(adminA, { params: { id: videoId }, body: { text: 'تعليق قبل الحذف' } }));
  const { res: del } = await call(deletePlayerVideo, asAdmin(adminA, { params: { id: videoId } }));
  ok('الحذف نجح', del.statusCode === 200);
  ok('الفيديو اختفى', (await PlayerVideo.findById(videoId)) === null);
  ok('تعليقات الفيديو حُذفت معه', (await PlayerVideoComment.countDocuments({ videoId })) === 0);

  // ── النتيجة ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`نجح: ${passed}   فشل: ${failed}`);

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error('\n❌ فشل الاختبار باستثناء غير متوقّع:', err);
  try {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  } catch (_) { /* تجاهل */ }
  process.exit(1);
});
