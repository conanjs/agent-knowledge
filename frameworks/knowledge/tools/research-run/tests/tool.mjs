// How research-run.mjs runs on a scenario's fixture copy. The copy is a small repo: knowledge/demo/widget-limits.md
// and its published run research/demo/widget-limits/. Each scenario names the command and the run folder.
import path from 'node:path';
import { codesFromCalls, registerTool, repo } from '../../cucumber-support/tools.mjs';

const tool = 'frameworks/knowledge/tools/research-run/research-run.mjs';

registerTool('research-run', {
  fixture: 'frameworks/knowledge/tools/research-run/tests/fixtures/base',
  run: (world, extra) => ({
    file: process.execPath,
    args: [path.join(repo, tool), ...extra.map((a) => (a.startsWith('research/') ? world.at(a) : a))],
  }),
  header: /^research-run \w+: /,
  quietPass: 'PASS (0 warning(s))',
  codes: () => codesFromCalls(tool),
  rules: 'frameworks/knowledge/schemas',
});
