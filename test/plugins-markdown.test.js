const test = require('node:test');
const assert = require('node:assert/strict');

const { Environment } = require('../src/core/environment');
const { makeSite, cleanup } = require('./helpers');

test('Markdown plugin loads YAML and fenced metadata and resolves internal links', async () => {
  const root = await makeSite({
    'contents/a.md': '---\ntitle: Alpha\n---\n[Go](b.md)',
    'contents/b.md': '```metadata\ntitle: Beta\n```\nHello from b',
    'templates/index.pug': 'h1 test'
  });

  try {
    const env = Environment.create({
      contents: './contents',
      templates: './templates'
    }, root);
    await env.loadPluginsAsync();

    const contents = await env.getContentsAsync();
    const alpha = contents['a.md'];
    const beta = contents['b.md'];

    assert.equal(alpha.title, 'Alpha');
    assert.equal(beta.title, 'Beta');

    const alphaHtml = alpha.getHtml('/');
    assert.match(alphaHtml, /href="\/b\.html"/);
  } finally {
    await cleanup(root);
  }
});

test('Markdown plugin reports invalid YAML metadata errors', async () => {
  const root = await makeSite({
    'contents/bad.md': '---\ntitle: [broken\n---\ntext',
    'templates/index.pug': 'h1 test'
  });

  try {
    const env = Environment.create({
      contents: './contents',
      templates: './templates'
    }, root);
    await env.loadPluginsAsync();

    await assert.rejects(
      async () => env.getContentsAsync(),
      (error) => /bad\.md/.test(error.message) && /YAML/.test(error.message)
    );
  } finally {
    await cleanup(root);
  }
});
