const fs = require('fs');
const path = require('path');
const npm = require('npm');
const { ncp } = require('ncp');

const { NpmAdapter, getStorageDir } = require('./common');
const { fileExists, fileExistsSync } = require('./../core/utils');
const { logger } = require('./../core/logger');

const templates = {};

function loadTemplates(directory) {
  if (!fileExistsSync(directory)) {
    return;
  }
  fs.readdirSync(directory)
    .map((filename) => path.join(directory, filename))
    .filter((filename) => fs.statSync(filename).isDirectory())
    .forEach((filename) => {
      templates[path.basename(filename)] = filename;
    });
}

loadTemplates(path.join(__dirname, '../../examples/'));
loadTemplates(path.join(getStorageDir(), 'templates/'));

const usage = `
usage: wintersmith new [options] <path>

creates a skeleton site in <path>

options:

  -f, --force             overwrite existing files
  -T, --template <name>   template to create new site from (defaults to 'blog')

  available templates are: ${Object.keys(templates).join(', ')}

example:

  create a new site in your home directory
  $ wintersmith new ~/my-blog
`;

const options = {
  string: ['template'],
  boolean: ['force'],
  alias: {
    force: 'f',
    template: 'T'
  },
  default: {
    template: 'blog'
  }
};

function fileExistsAsync(filepath) {
  return new Promise((resolve) => fileExists(filepath, resolve));
}

function ncpAsync(from, to) {
  return new Promise((resolve, reject) => {
    ncp(from, to, {}, (error) => (error ? reject(error) : resolve()));
  });
}

function npmLoadAsync(conf) {
  return new Promise((resolve, reject) => {
    npm.load(conf, (error) => (error ? reject(error) : resolve()));
  });
}

function npmInstallAsync(name) {
  return new Promise((resolve, reject) => {
    npm.install(name, (error) => (error ? reject(error) : resolve()));
  });
}

async function createSite(argv) {
  /* copy example directory to *location* */
  const location = argv._[3];
  if (location == null || !location.length) {
    logger.error('you must specify a location');
    return;
  }
  if (templates[argv.template] == null) {
    logger.error(`unknown template '${argv.template}'`);
    return;
  }

  const from = templates[argv.template];
  const to = path.resolve(location);
  logger.info(`initializing new wintersmith site in ${to} using template ${argv.template}`);

  try {
    logger.verbose(`checking validity of ${to}`);
    const exists = await fileExistsAsync(to);
    if (exists && !argv.force) {
      throw new Error(`${to} already exists. Add --force to overwrite`);
    }

    logger.verbose(`recursive copy ${from} -> ${to}`);
    await ncpAsync(from, to);

    const packagePath = path.join(to, 'package.json');
    if (await fileExistsAsync(packagePath)) {
      logger.verbose('installing template dependencies');
      process.chdir(to);
      const conf = { logstream: new NpmAdapter(logger) };
      await npmLoadAsync(conf);
      await npmInstallAsync();
    }

    logger.info('done!');
  } catch (error) {
    logger.error(error.message, error);
    process.exit(1);
  }
}

module.exports = createSite;
module.exports.usage = usage;
module.exports.options = options;
