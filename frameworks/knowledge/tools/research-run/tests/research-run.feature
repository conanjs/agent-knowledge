# Requirements for frameworks/knowledge/tools/research-run/research-run.mjs, as executable scenarios. The rules
# (RR-1 … RR-15) are defined in frameworks/knowledge/schemas/research-run.schema.md; each scenario title starts with
# the rule code it covers. The fixture is a small repo with one published run, research/demo/widget-limits/, for the
# doc knowledge/demo/widget-limits.md: two questions, two sources with cached text, three claims (one verified by the
# quote check, one by experiment E-1, one unsupported) and the entailment pairs of the doc's ✅ sentences.
#
# Change policy: a rule changes → its scenario changes in the same commit; the output text is part of the requirement.

Feature: Research run scripts
  The scripts do the checks of a research run that need no judgment: merging the researchers' batches, checking
  quotes against the cached pages, replaying experiments, listing the doc's ✅ sentences, and validating the run.

  Background:
    Given the base fixture tree of "research-run"

  # ---- validate: the baseline --------------------------------------------------------------------

  Scenario: The published fixture run passes
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 0 and prints:
      """
      published: 2 source(s), 3 claim(s), 1 experiment(s)
      PASS (0 warning(s))
      """

  Scenario: A command the tool does not know is a usage error
    When the tool runs with "publish research/demo/widget-limits"
    Then it exits with 2

  # ---- init ---------------------------------------------------------------------------------------------

  Scenario: init creates a planned run with a plan template
    When the tool runs with "init demo/new-subject --root {root}"
    Then it exits with 0 and prints:
      """
      created research/demo/new-subject/plan.md
      PASS (0 warning(s))
      """
    And the file "research/demo/new-subject/plan.md" has the line "status: planned"
    And the file "research/demo/new-subject/plan.md" has the line "doc: knowledge/demo/new-subject.md"

  Scenario: RR-1 init refuses a run that already exists
    When the tool runs with "init demo/widget-limits --root {root}"
    Then it exits with 1 and prints:
      """
      FAIL (1)
        RR-1  research/demo/widget-limits/plan.md already exists
      """

  Scenario: RR-1 a plan with the wrong schema fails
    Given in "research/demo/widget-limits/plan.md", `schema: research-run/v1` becomes `schema: research/v0`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-1  plan.md: schema must be research-run/v1, found research/v0"

  Scenario: RR-1 a plan without questions fails
    Given in "research/demo/widget-limits/plan.md", `- Q1: How many items does a widget hold?\n- Q2: What happens when one more item is added?` becomes `- none yet`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-1  plan.md: ## Questions needs at least one `- Q1: …` line"

  # ---- RR-2 approval --------------------------------------------------------------------------------

  Scenario: RR-2 a run past planned needs the day V approved the plan
    Given in "research/demo/widget-limits/plan.md", `approved: 2026-11-20` becomes `approved:`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-2  plan.md: status published needs approved: YYYY-MM-DD (the day V approved the plan)"

  Scenario: RR-2 a refresh with at most 3 sources and no experiments needs no approval
    Given in "research/demo/widget-limits/plan.md", `approved: 2026-11-20` becomes `approved:`
    And in "research/demo/widget-limits/plan.md", `mode: new` becomes `mode: refresh`
    And in "research/demo/widget-limits/plan.md", `status: published` becomes `status: approved`
    And in "research/demo/widget-limits/claims.yaml", `kind: runtime` becomes `kind: documented`
    And in "research/demo/widget-limits/claims.yaml", `    experiment: E-1\n` becomes ``
    And in "research/demo/widget-limits/claims.yaml", `verified-by: experiment` becomes `verified-by: verifier`
    And in "research/demo/widget-limits/sources.yaml", `tier: secondary` becomes `tier: primary`
    And the folder "research/demo/widget-limits/experiments" is removed
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 0 and prints:
      """
      approved: 2 source(s), 3 claim(s), 0 experiment(s)
      PASS (0 warning(s))
      """

  # ---- RR-3 sources ---------------------------------------------------------------------------------

  Scenario: RR-3 a source without a locator fails
    Given in "research/demo/widget-limits/sources.yaml", `    locator: "#limits"\n` becomes ``
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-3  sources.yaml: Q1-S1: locator is required (a section anchor, file path or line range, not the whole site)"

  Scenario: RR-3 a source over plain http fails
    Given in "research/demo/widget-limits/sources.yaml", `url: https://example.com/docs/widgets` becomes `url: http://example.com/docs/widgets`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-3  sources.yaml: Q1-S1: url must start with https:// (or be a path, for retrieval-method local)"

  # ---- RR-4 claims ----------------------------------------------------------------------------------

  Scenario: RR-4 a claim citing a source that is not in sources.yaml fails
    Given in "research/demo/widget-limits/claims.yaml", `      - source: Q1-S1` becomes `      - source: Q1-S9`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-4  claims.yaml: Q1-C1: evidence cites Q1-S9, which is not in sources.yaml"

  Scenario: RR-4 a runtime claim without an experiment fails
    Given in "research/demo/widget-limits/claims.yaml", `    experiment: E-1\n` becomes ``
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-4  claims.yaml: Q2-C1: a runtime claim needs an experiment"

  # ---- RR-5 corroboration ---------------------------------------------------------------------------

  Scenario: RR-5 a critical claim from one publisher, without an experiment, fails
    Given in "research/demo/widget-limits/claims.yaml", `    kind: documented` becomes `    kind: documented\n    critical: true`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-5  claims.yaml: Q1-C1: a critical claim needs sources from two publishers, or an experiment"

  # ---- RR-6 verdicts --------------------------------------------------------------------------------

  Scenario: RR-6 a pending claim fails in a published run
    Given in "research/demo/widget-limits/claims.yaml", `verdict: unsupported` becomes `verdict: pending`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-6  claims.yaml: Q2-C2: still pending in a published run"

  Scenario: RR-6 the quote check cannot verify a claim whose quote check failed
    Given in "research/demo/widget-limits/claims.yaml", `    quote-check: pass\n    verified-by: quote-check` becomes `    quote-check: fail\n    verified-by: quote-check`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-6  claims.yaml: Q1-C1: only a documented claim whose quote check passed is verified by the quote check"

  Scenario: RR-6 an experiment verifies only the claims it names
    Given in "research/demo/widget-limits/experiments/E-1/experiment.yaml", `claims: [Q2-C1]` becomes `claims: [Q1-C1]`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-6  claims.yaml: Q2-C1: experiment E-1 does not name this claim in its claims list"

  # ---- RR-7 experiments -----------------------------------------------------------------------------

  Scenario: RR-7 an experiment without expected.txt fails
    Given the file "research/demo/widget-limits/experiments/E-1/expected.txt" is removed
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-7  experiments/E-1: expected.txt is missing"

  Scenario: RR-7 an experiment's dependencies are pinned, with a lockfile
    Given the file "research/demo/widget-limits/experiments/E-1/package.json" contains:
      """
      { "dependencies": { "left-pad": "^1.3.0" } }
      """
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-7  experiments/E-1: package.json without a lockfile (pnpm-lock.yaml or package-lock.json)"
    And the output has the line "  RR-7  experiments/E-1: left-pad@^1.3.0 is not an exact version"

  Scenario: RR-7 a verified run's last replay must match
    Given in "research/demo/widget-limits/experiments/E-1/output.txt", `RangeError` becomes `TypeError`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-7  experiments/E-1: output.txt does not equal expected.txt; run replay"

  # ---- RR-8 the doc ---------------------------------------------------------------------------------

  Scenario: RR-8 a ✅ on a claim the verifier did not verify fails
    Given in "knowledge/demo/widget-limits.md", `more ⚠️ unverified (Q2-C2)` becomes `more ✅ (Q2-C2)`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-8  knowledge/demo/widget-limits.md: marks Q2-C2 ✅, but its verdict is unsupported"

  Scenario: RR-8 a ✅ without a claim id fails in a researched doc
    Given in "knowledge/demo/widget-limits.md", `## Related` becomes `Widgets are blue ✅.\n\n## Related`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-8  knowledge/demo/widget-limits.md: 1 ✅ without a claim id; every ✅ in a researched doc names its claim, e.g. ✅ (Q1-C2)"

  Scenario: RR-8 the doc's References must list the run folder
    Given in "knowledge/demo/widget-limits.md", `research/demo/widget-limits/` becomes `research/demo/other/`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-8  knowledge/demo/widget-limits.md: References does not list the run folder research/demo/widget-limits/"

  Scenario: RR-8 the doc may not cite a superseded claim
    Given in "research/demo/widget-limits/claims.yaml", `    status: active\n    verdict: verified\n    quote-check: pass\n    verified-by: quote-check` becomes `    status: superseded\n    superseded-by: Q2-C1\n    verdict: verified\n    quote-check: pass\n    verified-by: quote-check`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-8  knowledge/demo/widget-limits.md: cites Q1-C1, which is superseded"

  # ---- RR-9 the verifier's report -------------------------------------------------------------------

  Scenario: RR-9 a verified or published run has the verifier's report
    Given the file "research/demo/widget-limits/verification.md" is removed
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-9  verification.md is missing in a published run"

  # ---- RR-10 entailment -----------------------------------------------------------------------------

  Scenario: RR-10 a ✅ sentence the verifier found overstated fails
    Given in "research/demo/widget-limits/entailment.yaml", `(Q2-C1).\n    verdict: entails` becomes `(Q2-C1).\n    verdict: overstates`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-10  knowledge/demo/widget-limits.md: the sentence for Q2-C1 is overstates, not entails, in entailment.yaml"

  Scenario: RR-10 a ✅ sentence edited after the check fails until pairs and the verifier run again
    Given in "knowledge/demo/widget-limits.md", `holds at most 64 items ✅` becomes `holds up to 64 items ✅`
    When the tool runs with "validate research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  warn  RR-10  entailment.yaml: the pair for Q1-C1 is no longer in the doc; run pairs"
    And the output has the line "  RR-10  knowledge/demo/widget-limits.md: the ✅ sentence for Q1-C1 is not in entailment.yaml; run pairs"

  Scenario: pairs lists each ✅ sentence, keeps the verdicts of unchanged ones and marks changed ones pending
    Given in "knowledge/demo/widget-limits.md", `holds at most 64 items ✅` becomes `holds up to 64 items ✅`
    When the tool runs with "pairs research/demo/widget-limits"
    Then it exits with 0 and prints:
      """
      wrote entailment.yaml: 2 pair(s), 1 for the verifier
      PASS (0 warning(s))
      """
    And the file "research/demo/widget-limits/entailment.yaml" contains exactly:
      """
      pairs:
        - claim: Q1-C1
          sentence: A widget holds up to 64 items ✅ (Q1-C1).
          verdict: pending
        - claim: Q2-C1
          sentence: Adding a 65th item throws a `RangeError` ✅ (Q2-C1).
          verdict: entails
      """

  # ---- merge ------------------------------------------------------------------------------------

  Scenario: merge joins the batches and keeps the verdicts already written
    When the tool runs with "merge research/demo/widget-limits"
    Then it exits with 0 and prints:
      """
      wrote sources.yaml (2) and claims.yaml (3) from 2 batch(es)
      PASS (0 warning(s))
      """
    And the file "research/demo/widget-limits/claims.yaml" has the line "    verdict: unsupported"
    And the file "research/demo/widget-limits/claims.yaml" has the line "    note: The blog gives no number for older releases."

  Scenario: merge keeps the experiment the verifier added to a merged claim
    Given in "research/demo/widget-limits/batches/Q2/claims.yaml", `    experiment: E-1\n` becomes ``
    When the tool runs with "merge research/demo/widget-limits"
    Then it exits with 0
    And the file "research/demo/widget-limits/claims.yaml" has the line "    experiment: E-1"

  Scenario: RR-11 an id in a batch must carry its batch's question
    Given in "research/demo/widget-limits/batches/Q2/claims.yaml", `id: Q2-C2` becomes `id: Q1-C2`
    When the tool runs with "merge research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-11  batches/Q2/claims.yaml: id Q1-C2 must be Q2-C<n>"

  Scenario: RR-11 two batches citing the same page section warn
    Given in "research/demo/widget-limits/batches/Q2/sources.yaml", `url: https://blog.example.org/widgets-full\n    locator: "#the-error"` becomes `url: https://example.com/docs/widgets\n    locator: "#limits"`
    When the tool runs with "merge research/demo/widget-limits"
    Then it exits with 0
    And the output has the line "  warn  RR-11  Q2-S1 and Q1-S1 cite the same url and locator; the verifier may join them"

  Scenario: RR-12 merge refuses to drop a claim that is already merged
    Given in "research/demo/widget-limits/batches/Q2/claims.yaml", `  - id: Q2-C2` becomes `  - id: Q2-C3`
    When the tool runs with "merge research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-12  claims.yaml: Q2-C2 is in no batch; mark it superseded or deprecated in its batch instead of deleting it"

  # ---- quotes -------------------------------------------------------------------------------------

  Scenario: quotes verifies a documented claim whose quote is in the cached page, across line breaks
    Given in "research/demo/widget-limits/claims.yaml", `    verdict: verified\n    quote-check: pass\n    verified-by: quote-check` becomes `    verdict: pending`
    When the tool runs with "quotes research/demo/widget-limits"
    Then it exits with 0 and prints:
      """
      verified by quote check: 1; left for the verifier: 0
      PASS (0 warning(s))
      """
    And the file "research/demo/widget-limits/claims.yaml" has the line "    verified-by: quote-check"

  Scenario: RR-13 a planted wrong quote is caught, and its earlier verdict is withdrawn
    Given in "research/demo/widget-limits/claims.yaml", `quote: A widget holds at most 64 items.` becomes `quote: A widget holds at most 128 items.`
    When the tool runs with "quotes research/demo/widget-limits"
    Then it exits with 0 and prints:
      """
      verified by quote check: 0; left for the verifier: 1
        warn  RR-13  Q1-C1: the quote is not in .cache/Q1-S1.txt; sent to the verifier
      PASS (1 warning(s))
      """
    And the file "research/demo/widget-limits/claims.yaml" has the line "    quote-check: fail"
    And the file "research/demo/widget-limits/claims.yaml" has no line containing "verified-by: quote-check"

  Scenario: RR-13 a source without cached text goes to the verifier
    Given the file "research/demo/widget-limits/.cache/Q2-S1.txt" is removed
    When the tool runs with "quotes research/demo/widget-limits"
    Then it exits with 0
    And the output has the line "  warn  RR-13  Q2-C1: no .cache/Q2-S1.txt to check the quote against; sent to the verifier"

  Scenario: RR-14 a long quote warns
    Given in "research/demo/widget-limits/claims.yaml", `quote: older versions were more generous` becomes `quote: older versions were more generous aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
    When the tool runs with "quotes research/demo/widget-limits"
    Then it exits with 0
    And the output has the line "  warn  RR-14  Q2-C2: the quote from Q2-S1 has 320 characters (keep quotes short, KB-1)"

  # ---- replay -------------------------------------------------------------------------------------

  Scenario: replay re-runs each experiment and compares its output after normalizing times and durations
    When the tool runs with "replay research/demo/widget-limits"
    Then it exits with 0 and prints:
      """
        pass E-1
      PASS (0 warning(s))
      """
    And the file "research/demo/widget-limits/experiments/E-1/output.txt" contains exactly:
      """
      RangeError: widget full at <time> after <duration>
      """

  Scenario: RR-15 an experiment whose output changed fails
    Given in "research/demo/widget-limits/experiments/E-1/expected.txt", `RangeError` becomes `TypeError`
    When the tool runs with "replay research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-15  experiments/E-1: output.txt differs from expected.txt at line 1"

  Scenario: RR-15 an experiment that exits with another code fails
    Given in "research/demo/widget-limits/experiments/E-1/experiment.yaml", `command: node run.mjs` becomes `command: node run.mjs && exit 3`
    When the tool runs with "replay research/demo/widget-limits"
    Then it exits with 1
    And the output has the line "  RR-15  experiments/E-1: exit code 3, expected 0"

  # ---- coverage -----------------------------------------------------------------------------------

  Scenario: Every rule code is covered and defined
    Then every rule code the tool prints is named by a scenario in this feature
    And every rule code the tool prints is a rule row in its schemas
