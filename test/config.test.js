const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const { Config } = require('../src/core/config');
const { makeTempDir, cleanup } = require('./helpers');

test('Config applies default values when options are missing', () => {
  const config = new Config({ output: './public' });

  assert.equal(config.output, './public');
  assert.equal(config.contents, './contents');
  assert.equal(config.templates, './templates');
  assert.deepEqual(config.plugins, []);
  assert.deepEqual(config.require, {});
});

test('Config.fromFileSync reads file and stores source filename', async () => {
  const root = await makeTempDir();
  const configPath = path.join(root, 'config.json');

  try {
    await fs.writeFile(configPath, JSON.stringify({ output: './dist', port: 9000 }));
    const config = Config.fromFileSync(configPath);

    assert.equal(config.output, './dist');
    assert.equal(config.port, 9000);
    assert.equal(config.__filename, configPath);
  } finally {
    await cleanup(root);
  }
});

test('Config.fromFileSync throws when file is missing', () => {
  assert.throws(
    () => Config.fromFileSync('/tmp/wintersmith-definitely-missing-config.json'),
    /does not exist/
  );
});
