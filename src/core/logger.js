const chalk = require('chalk');
const winston = require('winston');
const util = require('util');

class CliTransport extends winston.Transport {
  /* Winston transport that logs info to stdout and errors stderr */
  constructor(options = {}) {
    super(options);
    this.name = 'cli';
    this.quiet = options.quiet || false;
  }

  log(info, callback) {
    const { level, message } = info;
    const meta = info.meta != null ? info.meta : {};

    if (level === 'error') {
      process.stderr.write(`\n  ${chalk.red('error')} ${message}\n`);
      if (this.level === 'verbose' && meta != null) {
        if (meta.stack != null) {
          const stack = meta.stack.substr(meta.stack.indexOf('\n') + 1);
          process.stderr.write(`${stack}\n\n`);
        }
        for (const key in meta) {
          if (key === 'message' || key === 'stack') {
            continue;
          }
          const value = meta[key];
          const pretty = util.inspect(value, false, 2, true).replace(/\n/g, '\n    ');
          process.stderr.write(`    ${key}: ${pretty}\n`);
        }
      } else {
        process.stderr.write('\n');
      }
    } else if (!this.quiet) {
      let output = message;
      if (level !== 'info') {
        const color = level === 'warn' ? 'yellow' : 'grey';
        output = `${chalk[color](level)} ${message}`;
      }
      if (Object.keys(meta).length > 0) {
        output += util.format(' %j', meta);
      }
      process.stdout.write(`  ${output}\n`);
    }

    this.emit('logged');
    callback(null, true);
  }
}

const transports = [
  new CliTransport({ level: 'info' })
];

const logger = winston.createLogger({
  exitOnError: true,
  transports
});

module.exports = { logger, transports };
