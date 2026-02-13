const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { Config } = require('../src/core/config');
const { Environment } = require('../src/core/environment');
const { makeSite, cleanup } = require('./helpers');

test('Environment.create wraps plain object config and resolves work directory', async () => {
  const root = await makeSite({
    'contents/index.md': '# Home',
    'templates/index.pug': 'h1 hello'
  });

  try {
    const env = Environment.create({
      contents: './contents',
      templates: './templates',
      output: './build'
    }, root);

    assert.ok(env.config instanceof Config);
    assert.equal(env.workDir, path.resolve(root));
    assert.equal(env.resolvePath('contents'), path.join(root, 'contents'));
    assert.equal(env.resolveContentsPath('index.md'), path.join(root, 'contents', 'index.md'));
  } finally {
    await cleanup(root);
  }
});

test('Environment loads default plugins and exposes content groups', async () => {
  const root = await makeSite({
    'contents/index.md': '# Home',
    'templates/index.pug': 'h1 hello'
  });

  try {
    const env = Environment.create({
      contents: './contents',
      templates: './templates',
      output: './build'
    }, root);

    await env.loadPluginsAsync();

    assert.equal(typeof env.views.template, 'function');
    assert.ok(env.contentPlugins.some((plugin) => plugin.pattern === '**/*.*(markdown|mkd|md)'));
    assert.ok(env.contentPlugins.some((plugin) => plugin.pattern === '**/*.json'));
    assert.ok(env.templatePlugins.some((plugin) => plugin.pattern === '**/*.*(pug|jade)'));

    const groups = env.getContentGroups();
    assert.ok(groups.includes('pages'));
  } finally {
    await cleanup(root);
  }
});
