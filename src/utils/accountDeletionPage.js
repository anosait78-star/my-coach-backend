// صفحة ويب عامة لطلب حذف الحساب (مطلوبة من Google Play — Data safety).
// HTML خالص بلا JavaScript حتى يتوافق مع CSP الافتراضي في helmet
// (script-src 'self')؛ النموذج يُرسَل POST لنفس المسار (form-action 'self').

const CONTACT_EMAIL = 'ahmed@nosait.com';
const APP_NAME = 'My Coach Academy';
const DEVELOPER = 'NOSAIT';

const LIMITS = {
  accountIdentifier: [2, 150],
  contact: [5, 150],
  requesterName: [0, 100],
  academyName: [0, 150],
  reason: [0, 1000],
};
const RELATIONSHIPS = ['self', 'parent', 'other'];

const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

// يُرجع { data, errors, isSpam } — errors رسائل عربية؛ فارغة إذا كان الطلب صالحاً.
function validateDeletionForm(body = {}) {
  const data = {};
  const bad = [];
  for (const [field, [min, max]] of Object.entries(LIMITS)) {
    const v = typeof body[field] === 'string' ? body[field].trim() : '';
    data[field] = v;
    if (v.length < min || v.length > max) bad.push(field);
  }
  data.relationship = RELATIONSHIPS.includes(body.relationship) ? body.relationship : 'self';
  // حقل فخّ للروبوتات — مخفي عن البشر؛ إن امتلأ نعتبر الطلب سبام.
  const isSpam = typeof body.website === 'string' && body.website.trim() !== '';
  const messages = {
    accountIdentifier: 'يرجى إدخال اسم المستخدم أو البريد أو رقم الهاتف الخاص بالحساب.',
    contact: 'يرجى إدخال بريد إلكتروني أو رقم هاتف صحيح للتواصل.',
    requesterName: 'الاسم طويل جداً.',
    academyName: 'اسم الأكاديمية طويل جداً.',
    reason: 'السبب طويل جداً (الحد 1000 حرف).',
  };
  return { data, errors: bad.map((f) => messages[f]), isSpam };
}

const STYLE = `
  :root { color-scheme: light dark; --bg:#f6f7fb; --card:#fff; --text:#1d2433; --muted:#5b6475; --accent:#1f6feb; --border:#d9dee8; --ok:#1a7f37; --err:#cf222e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1420; --card:#171d2b; --text:#e6e9f0; --muted:#9aa4b8; --border:#2a3346; --accent:#4c8dff; } }
  * { box-sizing: border-box; }
  body { margin:0; font-family: "Cairo", "Segoe UI", Tahoma, Arial, sans-serif; background:var(--bg); color:var(--text); line-height:1.7; }
  main { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:20px; margin-bottom:16px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  h2 { font-size: 1.1rem; margin: 0 0 8px; }
  .muted { color: var(--muted); font-size: .92rem; }
  ul { padding-inline-start: 20px; margin: 6px 0; }
  label { display:block; font-weight:600; margin: 12px 0 4px; }
  input, select, textarea { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px; background:transparent; color:var(--text); font: inherit; }
  textarea { min-height: 90px; resize: vertical; }
  button { margin-top:16px; width:100%; padding:12px; border:0; border-radius:10px; background:var(--accent); color:#fff; font: inherit; font-weight:700; cursor:pointer; }
  a { color: var(--accent); }
  .hp { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
  .alert { border-radius:10px; padding:12px 14px; margin-bottom:12px; }
  .alert.err { border:1px solid var(--err); color:var(--err); }
  .alert.ok { border:1px solid var(--ok); color:var(--ok); }
  .en { direction:ltr; text-align:left; }
`;

function layout(title, body) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function renderDeletionPage({ values = {}, errors = [] } = {}) {
  const v = (k) => escapeHtml(values[k] || '');
  const sel = (k) => ((values.relationship || 'self') === k ? ' selected' : '');
  const errorBox = errors.length
    ? `<div class="alert err" role="alert"><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`
    : '';

  return layout(`حذف الحساب — ${APP_NAME}`, `
  <div class="card">
    <h1>طلب حذف الحساب والبيانات</h1>
    <p class="muted">تطبيق <strong>${APP_NAME}</strong> — المطوّر: ${DEVELOPER}</p>
    <p>من خلال هذه الصفحة يمكنك طلب حذف حسابك في التطبيق وجميع البيانات المرتبطة به. يمكن لولي الأمر تقديم الطلب نيابةً عن اللاعب القاصر.</p>
  </div>

  <div class="card">
    <h2>خطوات الحذف</h2>
    <ul>
      <li>املأ النموذج بالأسفل باسم المستخدم أو البريد أو رقم الهاتف المسجَّل به الحساب.</li>
      <li>سنتواصل معك على وسيلة التواصل التي تكتبها للتأكد من ملكية الحساب.</li>
      <li>يتم تنفيذ الحذف خلال 30 يوماً من تأكيد الطلب، ونُبلغك عند الانتهاء.</li>
    </ul>
    <p class="muted">يمكنك أيضاً إرسال الطلب بالبريد إلى <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
  </div>

  <div class="card">
    <h2>البيانات التي يتم حذفها</h2>
    <ul>
      <li>بيانات الحساب: الاسم، اسم المستخدم، البريد، رقم الهاتف، وكلمة المرور.</li>
      <li>بيانات اللاعب: تاريخ الميلاد، بيانات ولي الأمر، الحضور، والتقييمات.</li>
      <li>الصور والفيديوهات والرسائل المرتبطة بالحساب.</li>
    </ul>
    <h2>البيانات التي قد يتم الاحتفاظ بها</h2>
    <ul>
      <li>سجلات المدفوعات والاشتراكات التي يلزم القانون بالاحتفاظ بها لأغراض محاسبية، فقط للمدة التي يفرضها القانون، ثم تُحذف.</li>
      <li>نسخ احتياطية مؤقتة تُحذف تلقائياً خلال 30 يوماً.</li>
    </ul>
  </div>

  <div class="card">
    <h2>نموذج طلب الحذف</h2>
    ${errorBox}
    <form method="post" action="/delete-account" novalidate>
      <label for="accountIdentifier">اسم المستخدم / البريد / رقم الهاتف الخاص بالحساب *</label>
      <input id="accountIdentifier" name="accountIdentifier" required maxlength="150" value="${v('accountIdentifier')}">

      <label for="academyName">اسم الأكاديمية</label>
      <input id="academyName" name="academyName" maxlength="150" value="${v('academyName')}">

      <label for="requesterName">اسمك</label>
      <input id="requesterName" name="requesterName" maxlength="100" value="${v('requesterName')}">

      <label for="relationship">صفتك</label>
      <select id="relationship" name="relationship">
        <option value="self"${sel('self')}>صاحب الحساب</option>
        <option value="parent"${sel('parent')}>ولي أمر اللاعب</option>
        <option value="other"${sel('other')}>أخرى</option>
      </select>

      <label for="contact">بريد إلكتروني أو رقم هاتف للتواصل *</label>
      <input id="contact" name="contact" required maxlength="150" value="${v('contact')}">

      <label for="reason">سبب الحذف (اختياري)</label>
      <textarea id="reason" name="reason" maxlength="1000">${v('reason')}</textarea>

      <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>

      <button type="submit">إرسال طلب الحذف</button>
    </form>
  </div>

  <div class="card en">
    <h2>Account &amp; data deletion — ${APP_NAME}</h2>
    <p>Developer: ${DEVELOPER}. Use the form above (or email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>) with your username, email or phone. We verify ownership and delete your account and associated data (profile, player records, photos, videos, messages) within 30 days. Payment records required by law may be retained only for the legally required period. A parent may request deletion on behalf of a minor.</p>
  </div>`);
}

function renderDeletionSuccess() {
  return layout(`تم استلام الطلب — ${APP_NAME}`, `
  <div class="card">
    <div class="alert ok" role="status">تم استلام طلب حذف الحساب بنجاح.</div>
    <p>سنتواصل معك على وسيلة التواصل التي كتبتها لتأكيد ملكية الحساب، ثم يتم الحذف خلال 30 يوماً.</p>
    <p class="muted">لأي استفسار: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
  </div>
  <div class="card en"><p>Your deletion request was received. We will contact you to verify ownership and complete the deletion within 30 days.</p></div>`);
}

module.exports = {
  renderDeletionPage,
  renderDeletionSuccess,
  validateDeletionForm,
  escapeHtml,
};
