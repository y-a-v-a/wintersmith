const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const { Environment } = require('../src/core/environment');
const { makeSite, cleanup } = require('./helpers');

function envBuild(env) {
  return new Promise((resolve, reject) => {
    env.build((error) => (error ? reject(error) : resolve()));
  });
}

test('Environment.build renders markdown pages and copies static files', async () => {
  const root = await makeSite({
    'config.json': JSON.stringify({
      contents: './contents',
      templates: './templates',
      output: './build',
      defaultTemplate: 'index.pug'
    }),
    'contents/index.md': '---\ntitle: Hello\n---\nWelcome.',
    'contents/assets/site.css': 'body { color: #123; }\n',
    'templates/index.pug': 'h1= page.title\n!= page.html'
  });

  try {
    const env = Environment.create(path.join(root, 'config.json'));
    await envBuild(env);

    const html = await fs.readFile(path.join(root, 'build/index.html'), 'utf8');
    const css = await fs.readFile(path.join(root, 'build/assets/site.css'), 'utf8');

    assert.match(html, /<h1>Hello<\/h1>/);
    assert.match(html, /<p>Welcome\.<\/p>/);
    assert.equal(css, 'body { color: #123; }\n');
  } finally {
    await cleanup(root);
  }
});
