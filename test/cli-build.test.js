const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const { makeSite, cleanup, runCli } = require('./helpers');

const rootDir = path.resolve(__dirname, '..');

test('CLI build command writes output files for a minimal site', async () => {
  const siteDir = await makeSite({
    'config.json': JSON.stringify({
      defaultTemplate: 'index.pug'
    }),
    'contents/index.md': '---\ntitle: CLI\n---\nBuilt by CLI.',
    'templates/index.pug': 'h1= page.title\n!= page.html'
  });

  try {
    const result = await runCli(
      [path.join(rootDir, 'bin/coldsmith'), 'build', '-C', siteDir],
      { cwd: rootDir }
    );

    assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    const htmlPath = path.join(siteDir, 'build/index.html');
    const html = await fs.readFile(htmlPath, 'utf8');
    assert.match(html, /<h1>CLI<\/h1>/);
    assert.match(html, /Built by CLI\./);
  } finally {
    await cleanup(siteDir);
  }
});
