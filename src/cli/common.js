const path = require('path');
const stream = require('stream');

const { Config } = require('./../core/config');
const { Environment } = require('./../core/environment');
const { logger } = require('./../core/logger');
const { fileExists } = require('./../core/utils');

const defaults = {
  string: ['chdir', 'config', 'contents', 'templates', 'locals', 'require', 'plugins', 'ignore'],
  default: {
    config: './config.json',
    chdir: null
  },
  alias: {
    config: 'c',
    chdir: 'C',
    contents: 'i',
    templates: 't',
    locals: 'L',
    require: 'R',
    plugins: 'P',
    ignore: 'I'
  }
};

const commonUsage = [
  '-C, --chdir [path]            change the working directory',
  `  -c, --config [path]           path to config (defaults to ${defaults.default.config})`,
  `  -i, --contents [path]         contents location (defaults to ${Config.defaults.contents})`,
  `  -t, --templates [path]        template location (defaults to ${Config.defaults.templates})`,
  '  -L, --locals [path]           optional path to json file containing template context data',
  '  -R, --require                 comma separated list of modules to add to the template context',
  '  -P, --plugins                 comma separated list of modules to load as plugins',
  '  -I, --ignore                  comma separated list of files/glob-patterns to ignore'
].join('\n');

function extendOptions(base, extra) {
  for (const type of ['string', 'boolean']) {
    if (base[type] == null) {
      base[type] = [];
    }
    if (extra[type] != null) {
      base[type] = base[type].concat(extra[type]);
    }
  }
  for (const type of ['alias', 'default']) {
    if (base[type] == null) {
      base[type] = {};
    }
    if (extra[type] != null) {
      for (const key in extra[type]) {
        base[type][key] = extra[type][key];
      }
    }
  }
}

function fileExistsAsync(filepath) {
  return new Promise((resolve) => fileExists(filepath, resolve));
}

function configFromFileAsync(configPath) {
  return new Promise((resolve, reject) => {
    Config.fromFile(configPath, (error, config) => {
      if (error) return reject(error);
      return resolve(config);
    });
  });
}

async function loadEnvAsync(argv) {
  /* creates a new coldsmith environment
     options are resolved with the hierarchy: argv > configfile > defaults */
  const workDir = path.resolve(argv.chdir || process.cwd());
  logger.verbose(`creating environment - work directory: ${workDir}`);

  const configPath = path.join(workDir, argv.config);
  let config;
  if (await fileExistsAsync(configPath)) {
    logger.info(`using config file: ${configPath}`);
    config = await configFromFileAsync(configPath);
  } else {
    logger.verbose('no config file found');
    config = new Config();
  }

  config._cliopts = {};
  for (const key in argv) {
    let value = argv[key];
    const excluded = ['_', 'chdir', 'config', 'clean'];
    if (excluded.includes(key)) {
      continue;
    }
    if (key === 'port') {
      value = Number(value);
    }
    if (key === 'ignore' || key === 'require' || key === 'plugins') {
      value = value.split(',');
      if (key === 'require') {
        const reqs = {};
        for (const v of value) {
          let [alias, module] = v.split(':');
          if (module == null) {
            module = alias;
            alias = module.replace(/\/$/, '').split('/').slice(-1)[0];
          }
          reqs[alias] = module;
        }
        value = reqs;
      }
    }
    config[key] = config._cliopts[key] = value;
  }

  logger.verbose('config:', config);
  const env = new Environment(config, workDir, logger);

  const paths = ['contents', 'templates'];
  for (const pathname of paths) {
    const resolved = env.resolvePath(env.config[pathname]);
    if (!(await fileExistsAsync(resolved))) {
      throw new Error(`${pathname} path invalid (${resolved})`);
    }
  }

  return env;
}

function loadEnv(argv, callback) {
  if (typeof callback === 'function') {
    loadEnvAsync(argv)
      .then((env) => callback(null, env))
      .catch((error) => callback(error));
    return;
  }
  return loadEnvAsync(argv);
}

if (stream.Writable == null) {
  class Writable extends stream.Stream {
    constructor() {
      super();
      this.writable = true;
    }

    write(string, encodig = 'utf8') {
      return this._write(string, encodig, () => {});
    }
  }
  stream.Writable = Writable;
}

class NpmAdapter extends stream.Writable {
  /* Redirects output of npm to a logger */
  constructor(loggerInstance) {
    super({ decodeStrings: false });
    this.logger = loggerInstance;
    this.buffer = '';
  }

  _write(chunk, _encoding, callback) {
    this.buffer += chunk;
    if (chunk.indexOf('\n') !== -1) {
      this.flush();
    }
    return callback();
  }

  flush() {
    const lines = this.buffer.split('\n');
    this.buffer = '';
    for (const lineRaw of lines) {
      if (!(lineRaw.length > 0)) {
        continue;
      }
      let line = lineRaw.replace(/^npm /, '');
      if (line.slice(0, 4) === 'WARN') {
        this.logger.warn(`npm: ${line.slice(5)}`);
      } else {
        this.logger.verbose(`npm: ${line}`);
      }
    }
  }
}

function getStorageDir() {
  /* Return users coldsmith directory, used for cache and user templates. */
  if (process.env.COLDSMITH_PATH != null) {
    return process.env.COLDSMITH_PATH;
  }
  if (process.env.WINTERSMITH_PATH != null) {
    return process.env.WINTERSMITH_PATH;
  }
  const home = process.env.HOME || process.env.USERPROFILE;
  let dir = 'coldsmith';
  if (process.platform !== 'win32') {
    dir = `.${dir}`;
  }
  return path.resolve(home, dir);
}

module.exports = {
  commonOptions: defaults,
  commonUsage,
  extendOptions,
  loadEnv,
  NpmAdapter,
  getStorageDir
};
