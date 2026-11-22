// How the source rank classifier runs on a scenario's fixture copy.
import path from 'node:path';
import { registerTool, repo } from '../../cucumber-support/tools.mjs';

registerTool('classify-source', {
  fixture: 'frameworks/knowledge/tools/classify-source/tests/fixtures/base',
  run: (world, extra) => ({
    file: process.execPath,
    args: [path.join(repo, 'frameworks/knowledge/tools/classify-source/classify-source.mjs'), ...extra],
  }),
  codes: () => [],
});
