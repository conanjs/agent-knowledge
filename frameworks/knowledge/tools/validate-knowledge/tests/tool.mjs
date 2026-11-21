// How the knowledge validator runs on a scenario's fixture copy (specs/001).
import path from 'node:path';
import { codesFromCalls, registerTool, repo } from '../../cucumber-support/tools.mjs';

const validator = 'frameworks/knowledge/tools/validate-knowledge/validate-knowledge.mjs';

registerTool('validate-knowledge', {
  fixture: 'frameworks/knowledge/tools/validate-knowledge/tests/fixtures/base',
  run: (world, extra) => ({
    file: process.execPath,
    args: [path.join(repo, validator), world.at('knowledge'), ...extra],
  }),
  header: /^knowledge validate: /,
  quietPass: 'PASS (0 warning(s))',
  codes: () => codesFromCalls(validator),
  rules: 'frameworks/knowledge/schemas',
});
