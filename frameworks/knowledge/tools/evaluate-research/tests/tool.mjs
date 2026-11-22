// How the research verifier's Stage 1 helpers run on a scenario's fixture copy.
import path from 'node:path';
import { registerTool, repo } from '../../cucumber-support/tools.mjs';

registerTool('evaluate-research', {
  fixture: 'frameworks/knowledge/tools/evaluate-research/tests/fixtures/base',
  run: (world, extra) => ({
    file: process.execPath,
    args: [path.join(repo, 'frameworks/knowledge/tools/evaluate-research/evaluate-research.mjs'), ...extra],
  }),
  codes: () => [],
});
