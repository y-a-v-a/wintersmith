const chalk = require('chalk');
const fs = require('fs');
const npm = require('npm');
const https = require('https');

const { NpmAdapter, loadEnv, commonOptions, extendOptions } = require('./common');
const { fileExists, readJSON } = require('./../core/utils');
const { logger } = require('./../core/logger');

const usage = `
usage: coldsmith plugin [options] <command>

commands:

  ${chalk.bold('list')} - list available plugins
  ${chalk.bold('install')} <plugin> - install plugin

options:

  -C, --chdir [path]      change the working directory
  -c, --config [path]     path to config
`;

const options = {};
extendOptions(options, commonOptions);

function max(array, get = (item) => item) {
  let rv = null;
  for (const item of array) {
    const v = get(item);
    if (v > rv) {
      rv = v;
    }
  }
  return rv;
}

function lpad(string, amount, char = ' ') {
  let p = '';
  for (let i = 0; i < amount - string.length; i += 1) {
    p += char;
  }
  return p + string;
}

function clip(string, maxlen) {
  if (string.length <= maxlen) {
    return string;
  }
  return string.slice(0, maxlen - 2).trim() + '..';
}

function fileExistsAsync(filepath) {
  return new Promise((resolve) => fileExists(filepath, resolve));
}

function readJSONAsync(filepath) {
  return new Promise((resolve, reject) => {
    readJSON(filepath, (error, data) => (error ? reject(error) : resolve(data)));
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

function fetchListing() {
  return new Promise((resolve, reject) => {
    https.get('https://api.npms.io/v2/search?q=keywords:coldsmith-plugin,wintersmith-plugin&size=200', (response) => {
      let error;
      if (response.statusCode !== 200) {
        error = new Error(`Unexpected response when searching registry, HTTP ${response.statusCode}`);
      }
      if (!/^application\/json/.test(response.headers['content-type'])) {
        error = new Error(`Invalid content-type: ${response.headers['content-type']}`);
      }
      if (error != null) {
        response.resume();
        reject(error);
        return;
      }
      const data = [];
      response.on('data', (chunk) => data.push(chunk));
      response.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(Buffer.concat(data));
        } catch (err) {
          reject(err);
          return;
        }
        const listing = parsed.results.map((result) => result.package);
        listing.sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        });
        resolve(listing);
      });
    }).on('error', reject);
  });
}

function displayListing(list) {
  const display = list.map((plugin) => {
    const name = normalizePluginName(plugin.name);
    const description = plugin.description;
    const maintainers = plugin.maintainers.map((v) => v.username).join(' ');
    const homepage = plugin.links?.homepage ?? plugin.links?.npm;
    return { name, description, maintainers, homepage };
  });

  const pad = max(display, (item) => item.name.length);
  const width = process.stdout.getWindowSize ? process.stdout.getWindowSize()[0] : (process.stdout.columns || 80);
  const maxw = width - 2;
  const margin = ' '.repeat(pad);

  for (const plugin of display) {
    let line = `${lpad(plugin.name, pad)}  ${clip(plugin.description, maxw - pad - 2)}`;
    const left = maxw - line.length;
    if (left > plugin.maintainers.length) {
      line += chalk.grey(lpad(plugin.maintainers, left));
    }
    logger.info(line.replace(/^\s*(\S+)  /, (m) => chalk.bold(m)));
    if (plugin.homepage != null && plugin.homepage.length < maxw - pad - 2) {
      logger.info(`${margin}  ${chalk.gray(plugin.homepage)}`);
    }
    logger.info('');
  }
}

function normalizePluginName(name) {
  return name.replace(/^(coldsmith|wintersmith)-/, '');
}

async function installPlugin(env, list, argv) {
  const name = argv._[4];
  let plugin = null;
  for (const p of list) {
    if (normalizePluginName(p.name) === normalizePluginName(name)) {
      plugin = p;
      break;
    }
  }
  if (!plugin) {
    throw new Error(`Unknown plugin: ${name}`);
  }

  const configFile = env.config.__filename;
  const packageFile = env.resolvePath('package.json');

  const packageExists = await fileExistsAsync(packageFile);
  if (!packageExists) {
    logger.warn('package.json missing, creating minimal package');
    await fs.promises.writeFile(packageFile, '{\n  "dependencies": {},\n  "private": true\n}\n');
  }

  logger.verbose(`installing ${plugin.name}`);
  process.chdir(env.workDir);
  await npmLoadAsync({ logstream: new NpmAdapter(logger), save: true });
  await npmInstallAsync(plugin.name);

  const config = await readJSONAsync(configFile);
  if (config.plugins == null) {
    config.plugins = [];
  }
  if (!config.plugins.includes(plugin.name)) {
    config.plugins.push(plugin.name);
  }
  logger.verbose(`saving config file: ${configFile}`);
  const json = JSON.stringify(config, null, 2);
  await fs.promises.writeFile(configFile, `${json}\n`);
}

async function main(argv) {
  const action = argv._[3];
  if (action == null) {
    console.log(usage);
    process.exit(0);
  }

  try {
    switch (action) {
      case 'list': {
        const list = await fetchListing();
        displayListing(list);
        break;
      }
      case 'install': {
        const [env, list] = await Promise.all([
          loadEnv(argv),
          fetchListing()
        ]);
        await installPlugin(env, list, argv);
        break;
      }
      default:
        throw new Error(`Unknown plugin action: ${action}`);
    }
    process.exit(0);
  } catch (error) {
    logger.error(error.message, error);
    process.exit(1);
  }
}

module.exports = main;
module.exports.usage = usage;
module.exports.options = options;
