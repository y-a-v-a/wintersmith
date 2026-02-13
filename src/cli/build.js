const chalk = require('chalk');
const fs = require('fs');
const rimraf = require('rimraf');

const { fileExistsSync } = require('./../core/utils');
const { loadEnv, commonOptions, commonUsage, extendOptions } = require('./common');
const { logger } = require('./../core/logger');

const usage = `
usage: coldsmith build [options]

options:

  -o, --output [path]           directory to write build-output (defaults to ./build)
  -X, --clean                   clean before building (warning: will recursively delete everything at output path)
  ${commonUsage}

  all options can also be set in the config file

examples:

  build using a config file (assuming config.json is found in working directory):
  $ coldsmith build

  build using command line options:
  $ coldsmith build -o /var/www/public/ -T extra_data.json -C ~/my-blog

  or using both (command-line options will override config options):
  $ coldsmith build --config another_config.json --clean
`;

const options = {
  alias: {
    output: 'o',
    clean: 'X'
  },
  boolean: ['clean'],
  string: ['output']
};

extendOptions(options, commonOptions);

function rimrafAsync(target) {
  return new Promise((resolve, reject) => {
    rimraf(target, (error) => (error ? reject(error) : resolve()));
  });
}

function envBuildAsync(env) {
  return new Promise((resolve, reject) => {
    env.build((error) => (error ? reject(error) : resolve()));
  });
}

async function prepareOutputDir(env, argv) {
  const outputDir = env.resolvePath(env.config.output);
  const exists = fileExistsSync(outputDir);
  if (exists) {
    if (argv.clean) {
      logger.verbose(`cleaning - running rimraf on ${outputDir}`);
      await rimrafAsync(outputDir);
      await fs.promises.mkdir(outputDir);
    }
    return;
  }
  logger.verbose(`creating output directory ${outputDir}`);
  await fs.promises.mkdir(outputDir);
}

async function build(argv) {
  const start = new Date();
  logger.info('building site');

  try {
    const env = await loadEnv(argv);
    await prepareOutputDir(env, argv);
    await envBuildAsync(env);
  } catch (error) {
    logger.error(error.message, error);
    process.exit(1);
    return;
  }

  const stop = new Date();
  const delta = stop - start;
  logger.info(`done in ${chalk.bold(delta)} ms\n`);
  process.exit();
}

module.exports = build;
module.exports.usage = usage;
module.exports.options = options;
