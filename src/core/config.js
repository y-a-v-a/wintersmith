const { readJSON, readJSONSync, fileExists, fileExistsSync } = require('./utils');

class Config {
  /* The configuration object */
  static defaults = {
    contents: './contents',
    ignore: [],
    locals: {},
    plugins: [],
    require: {},
    templates: './templates',
    views: null,
    output: './build',
    baseUrl: '/',
    hostname: null,
    port: 8080,
    _fileLimit: 40,
    _restartOnConfChange: true
  };

  constructor(options = {}) {
    Object.assign(this, options);
    for (const [option, defaultValue] of Object.entries(this.constructor.defaults)) {
      if (this[option] == null) {
        this[option] = defaultValue;
      }
    }
  }

  static fromFile(path, callback) {
    /* Read config from *path* as JSON and *callback* with a Config instance. */
    fileExists(path, (exists) => {
      if (!exists) {
        callback(new Error(`Config file at '${path}' does not exist.`));
        return;
      }
      readJSON(path, (error, options) => {
        if (error) {
          callback(error);
          return;
        }
        const config = new Config(options);
        config.__filename = path;
        callback(null, config);
      });
    });
  }

  static fromFileSync(path) {
    /* Read config from *path* as JSON return a Config instance. */
    if (!fileExistsSync(path)) {
      throw new Error(`Config file at '${path}' does not exist.`);
    }
    const config = new Config(readJSONSync(path));
    config.__filename = path;
    return config;
  }
}

module.exports = { Config };
