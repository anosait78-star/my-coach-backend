// تحليل روابط الفيديو المسموح بها. الأكاديمية تضيف رابطاً خارجياً (لا رفع
// ملفات)، فالرابط يُعرض للاعبين ويُفتح في متصفحهم — لذا نقصره على قائمة
// بيضاء صارمة من المضيفين ونرفض أي مخطط غير https. هذا يمنع تخزين
// javascript:/data: أو روابط تصيّد داخل بروفايل اللاعب.

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
const DRIVE_HOSTS = ['drive.google.com'];

// معرّف فيديو يوتيوب: 11 محرفاً من [A-Za-z0-9_-].
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

const youtubeKey = (u) => {
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return YT_ID.test(id) ? id : null;
  }
  // /watch?v=ID
  const v = u.searchParams.get('v');
  if (v && YT_ID.test(v)) return v;
  // /embed/ID  |  /shorts/ID  |  /live/ID
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
    return YT_ID.test(parts[1]) ? parts[1] : null;
  }
  return null;
};

/**
 * يتحقق من الرابط ويستخرج بياناته.
 * @returns {{url:string, provider:string, videoKey:string|null, thumbnailUrl:string}|null}
 *          null إذا كان الرابط غير صالح أو من مضيف غير مسموح به.
 */
const parseVideoLink = (raw) => {
  const value = String(raw || '').trim();
  if (!value || value.length > 500) return null;

  let u;
  try {
    u = new URL(value);
  } catch (_) {
    return null;
  }
  if (u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.includes(host)) {
    const key = youtubeKey(u);
    if (!key) return null; // رابط يوتيوب بلا معرّف فيديو صالح
    return {
      url: `https://www.youtube.com/watch?v=${key}`, // شكل موحّد ونظيف
      provider: 'youtube',
      videoKey: key,
      thumbnailUrl: `https://img.youtube.com/vi/${key}/hqdefault.jpg`,
    };
  }

  if (DRIVE_HOSTS.includes(host)) {
    return { url: u.toString(), provider: 'drive', videoKey: null, thumbnailUrl: '' };
  }

  return null;
};

const ALLOWED_HINT =
  'الرابط يجب أن يكون رابط يوتيوب أو Google Drive يبدأ بـ https';

module.exports = { parseVideoLink, ALLOWED_HINT };
