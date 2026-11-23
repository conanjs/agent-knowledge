# Requirements for frameworks/knowledge/tools/run-code-harness/run-code-harness.mjs, as executable scenarios.
# The design is frameworks/knowledge/research-agent.design.md §3.6 (Stage 1.5). Output text is part of the requirement.
# No scenario starts a container: see tests/tool.mjs.

Feature: Code-probe harness
  Tagged code blocks run and are checked against what they expect; untagged blocks are skipped.

  Scenario: run checks each tagged block, joins a lib into the probe that uses it, and skips the untagged one
    Given the base fixture tree of "run-code-harness"
    When the tool runs with arguments:
      """
      run
      {root}/run
      1
      """
    Then it exits with 1 and prints:
      """
      probe-01 | node24 | verify stdout:{} | pass (exit 0)
      probe-02 | node24 | verify throws:TypeError | fail (exit 0)
      probe-03 | node24 | syntax-only | pass (exit 0)
      probe-04 | node24 | verify stdout:hi there | pass (exit 0)
      probe-05 | c | verify exit:0 | not_run
      probes: 5 | pass 3 | fail 1 | mixed 0 | not_run 1
      """
    And the file "run/probes/probe-04.js" has a line containing "const greet"
    And the file "run/verdicts/round-1.harness.json" has a line containing '"block_sha":'
    And the file "run/verdicts/round-1.harness.json" has a line containing '"kernel": "'

  Scenario: Without Docker every probe is not_run and the harness exits with 3
    Given the base fixture tree of "run-code-harness-no-docker"
    When the tool runs with arguments:
      """
      run
      {root}/run
      1
      """
    Then it exits with 3 and prints:
      """
      probe-01 | node24 | verify stdout:{} | not_run
      probe-02 | node24 | verify throws:TypeError | not_run
      probe-03 | node24 | syntax-only | not_run
      probe-04 | node24 | verify stdout:hi there | not_run
      probe-05 | c | verify exit:0 | not_run
      probes: 5 | pass 0 | fail 0 | mixed 0 | not_run 5 (Docker is not available)
      """

  Scenario: A bad tag stops the run with exit 2 and names the line
    Given the base fixture tree of "run-code-harness"
    And in "run/doc.md", `js syntax-only id=probe-03` becomes `js syntax-only id=three`
    When the tool runs with arguments:
      """
      run
      {root}/run
      1
      """
    Then it exits with 2 and prints:
      """
      bad tag | line 17: id "three" must be probe-<nn>
      """
