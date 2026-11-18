const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const {
  renderDeletionPage,
  renderDeletionSuccess,
  validateDeletionForm,
} = require('../src/utils/accountDeletionPage');

test('valid form passes and trims values', () => {
  const { data, errors, isSpam } = validateDeletionForm({
    accountIdentifier: '  player01 ',
    contact: 'parent@example.com',
    relationship: 'parent',
    reason: 'moving away',
  });
  assert.deepEqual(errors, []);
  assert.equal(isSpam, false);
  assert.equal(data.accountIdentifier, 'player01');
  assert.equal(data.relationship, 'parent');
});

test('missing identifier/contact are rejected', () => {
  const { errors } = validateDeletionForm({ accountIdentifier: '', contact: 'x' });
  assert.equal(errors.length, 2);
});

test('unknown relationship falls back to self; non-string fields are ignored', () => {
  const { data, errors } = validateDeletionForm({
    accountIdentifier: { $ne: '' },
    contact: '0100 000 0000',
    relationship: 'admin',
  });
  assert.equal(data.relationship, 'self');
  assert.equal(data.accountIdentifier, '');
  assert.equal(errors.length, 1);
});

test('honeypot marks spam', () => {
  const { isSpam } = validateDeletionForm({ accountIdentifier: 'ab', contact: 'a@b.co', website: 'http://spam' });
  assert.equal(isSpam, true);
});

test('page escapes user input and keeps required Play info', () => {
  const html = renderDeletionPage({
    values: { accountIdentifier: '<script>alert(1)</script>' },
    errors: ['خطأ'],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('My Coach Academy'));
  assert.ok(html.includes('action="/delete-account"'));
  assert.ok(!/<script\b/i.test(html), 'page must not need inline scripts (helmet CSP)');
  assert.ok(renderDeletionSuccess().includes('تم استلام'));
});

test('GET /delete-account serves the page through the router', async () => {
  const { publicRouter } = require('../src/routes/accountDeletion.routes');
  const app = express();
  app.use('/delete-account', publicRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await new Promise((resolve, reject) => {
      http.get({ port, path: '/delete-account' }, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'], body }));
      }).on('error', reject);
    });
    assert.equal(res.status, 200);
    assert.match(res.type, /text\/html/);
    assert.ok(res.body.includes('طلب حذف الحساب'));
  } finally {
    server.close();
  }
});
