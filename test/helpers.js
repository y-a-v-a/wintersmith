const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

async function makeTempDir(prefix = 'wintersmith-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }
}

async function makeSite(files) {
  const root = await makeTempDir();
  await writeFiles(root, files);
  return root;
}

async function cleanup(directory) {
  if (!directory) return;
  await fs.rm(directory, { recursive: true, force: true });
}

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env || process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

module.exports = {
  makeTempDir,
  writeFiles,
  makeSite,
  cleanup,
  runCli
};
