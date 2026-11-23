// How fetch-source.mjs runs on a scenario's fixture copy. Pages come from a local web server the scenario starts.
import path from 'node:path';
import { registerTool, repo } from '../../cucumber-support/tools.mjs';

registerTool('fetch-source', {
  fixture: 'frameworks/knowledge/tools/fetch-source/tests/fixtures/base',
  run: (world, extra) => ({ file: process.execPath, args: [path.join(repo, 'frameworks/knowledge/tools/fetch-source/fetch-source.mjs'), ...extra] }),
  codes: () => [],
});
