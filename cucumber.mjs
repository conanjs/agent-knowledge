// Scenarios for this repo's tools: each frameworks/<framework>/tools/<tool>/tests/ holds one feature file, a tool.mjs
// that says how to run the tool, and its fixtures; frameworks/knowledge/tools/cucumber-support/ is the shared World and steps.
export default {
  paths: ['frameworks/*/tools/*/tests/*.feature'],
  import: ['frameworks/*/tools/cucumber-support/*.mjs', 'frameworks/*/tools/*/tests/tool.mjs'],
  format: ['progress'],
  parallel: 4,
};
