// Scenarios for this repo's tools: each tests/<tool>/ holds one feature file, a tool.mjs that says how to run the
// tool, and its fixtures; tests/support/ is the shared World and steps (copied from agent-config on 2026-11-19).
export default {
  paths: ['tests/**/*.feature'],
  import: ['tests/support/*.mjs', 'tests/*/tool.mjs'],
  format: ['progress'],
  parallel: 4,
};
