// How the code-probe harness runs on a scenario's fixture copy. Scenarios never start a container:
// "run-code-harness" runs node24 probes with the host's node (KB_HARNESS_RUNNER=host-node);
// "run-code-harness-no-docker" points the docker command at a missing file, as on a machine without Docker.
import path from 'node:path';
import { registerTool, repo } from '../../cucumber-support/tools.mjs';

const tool = path.join(repo, 'frameworks/knowledge/tools/run-code-harness/run-code-harness.mjs');
const fixture = 'frameworks/knowledge/tools/run-code-harness/tests/fixtures/base';
registerTool('run-code-harness', { fixture, run: (world, extra) => ({ file: process.execPath, args: [tool, ...extra], env: { KB_HARNESS_RUNNER: 'host-node' } }), codes: () => [] });
registerTool('run-code-harness-no-docker', { fixture, run: (world, extra) => ({ file: process.execPath, args: [tool, ...extra], env: { KB_HARNESS_RUNNER: '', KB_HARNESS_DOCKER: world.at('no-docker-here') } }), codes: () => [] });
