# Requirements for frameworks/knowledge/tools/evaluate-research/evaluate-research.mjs, as executable scenarios.
# The design is frameworks/knowledge/research-agent.design.md §3.2 (Stage 1). Output text is part of the requirement.

Feature: Research verifier, Stage 1 helpers
  `ranks` lists the rank of every References URL; `quotes` checks the judge's quotes against the saved pages;
  `ledger` checks a research worker's ledger (ledger.schema.md) against the pages it saved.

  Background:
    Given the base fixture tree of "evaluate-research"

  Scenario: ranks gives each URL its tier, and marks a written rank the rules contradict
    When the tool runs with arguments:
      """
      ranks
      {root}/doc.md
      """
    Then it exits with 0 and prints:
      """
      [^a] | Rank 1 | tier A | rfc-editor.org/rfc/ | written Rank 1 | https://www.rfc-editor.org/rfc/rfc9113
      [^b] | Rank 6 | tier A | stackoverflow.com/ | written Rank 1 | https://stackoverflow.com/q/1 | differs
      [^c] | no rank | tier B | no rule | written: none | https://example.dev/blog/h2
      3 URLs: 2 tier A, 1 tier B; 1 written rank(s) differ from the rules
      """

  Scenario: quotes finds a quote that wraps across comment lines, quotes of two pages with their footnotes inline, and a quote after a page name
    When the tool runs with arguments:
      """
      quotes
      {root}/input/verdict-ok.json
      {root}/input
      """
    Then it exits with 0 and prints:
      """
      quotes: 4 found, 0 missing, in 3 claim(s) with a verdict other than entails
      """

  Scenario: quotes reports a quote that is only on a page the claim does not cite
    When the tool runs with arguments:
      """
      quotes
      {root}/input/verdict-bad.json
      {root}/input
      """
    Then it exits with 1 and prints:
      """
      missing | C3 | the server may send json-rpc requests
      quotes: 0 found, 1 missing, in 1 claim(s) with a verdict other than entails
      """

  Scenario: quotes checks a quote of a probe's output against that probe's stdout in harness.json
    When the tool runs with arguments:
      """
      quotes
      {root}/input/verdict-probe.json
      {root}/input
      """
    Then it exits with 0 and prints:
      """
      quotes: 3 found, 0 missing, in 2 claim(s) with a verdict other than entails
      """

  Scenario: stage1 builds the judge's input folder with each source's tier and only the pages that were saved
    When the tool runs with arguments:
      """
      stage1
      {root}/run
      1
      """
    Then it exits with 0 and prints:
      """
      {root}/run/verdicts/round-1.input | 3 References URLs: 1 tier A, 2 tier B | pages saved: 2 of 3 URLs in the doc
      """
    And "run/verdicts/round-1.input/doc.md" exists
    And "run/verdicts/round-1.input/cache/aaa.txt" exists
    And "run/verdicts/round-1.input/criteria.json" exists
    And the file "run/verdicts/round-1.input/stage1.json" has a line containing '"rule": "rfc-editor.org/rfc/"'
    And the file "run/verdicts/round-1.input/sources.json" has a line containing '"status": "not fetched"'

  Scenario: stage1 --sample picks claims per heading with a seed, forces an --include, and skips the marking legend
    When the tool runs with arguments:
      """
      stage1
      {root}/run
      2
      --sample
      3
      --seed
      7
      --include
      Cell claim
      """
    Then it exits with 0 and prints:
      """
      {root}/run/verdicts/round-2.input | 3 References URLs: 1 tier A, 2 tier B | pages saved: 2 of 3 URLs in the doc | sample: 3 of 5 claims, seed 7
      """
    And the file "run/verdicts/round-2.input/claims.json" has a line containing '"claim": "Cell claim ✅[^a]"'

  Scenario: verdict turns a PASS on too few checkable claims into INCONCLUSIVE, and --write records it
    When the tool runs with arguments:
      """
      verdict
      {root}/input/judge-pass-thin.json
      --write
      """
    Then it exits with 0 and prints:
      """
      final verdict: INCONCLUSIVE (judge PASS; 1 of 4 claims checkable, 25%; threshold 70%)
      """
    And the file "input/judge-pass-thin.json" has a line containing '"verdict": "INCONCLUSIVE"'

  Scenario: verdict keeps a PASS with enough checkable claims, and a FAIL whatever the share
    When the tool runs with arguments:
      """
      verdict
      {root}/input/judge-pass.json
      """
    Then it exits with 0 and prints:
      """
      final verdict: PASS (judge PASS; 3 of 4 claims checkable, 75%; threshold 70%)
      """
    When the tool runs with arguments:
      """
      verdict
      {root}/input/judge-fail-thin.json
      """
    Then it exits with 0 and prints:
      """
      final verdict: FAIL (judge FAIL; 1 of 4 claims checkable, 25%; threshold 70%)
      """

  Scenario: ledger passes a worker's ledger whose quotes are at their place in pages saved by fetch-source.mjs
    When the tool runs with arguments:
      """
      ledger
      {root}/ledger-run
      ground-truth
      """
    Then it exits with 0 and prints:
      """
      ledger ground-truth: 3 sources (2 counted, cap 4), 4 facts (4 at their place), 1 conflict: 0 errors, 0 warnings
      """

  Scenario: ledger reports a planted wrong quote, a quote at the wrong lines, a wrong rank, dangling ids and drafted doc text
    When the tool runs with arguments:
      """
      ledger
      {root}/ledger-run
      pitfall
      """
    Then it exits with 1 and prints:
      """
      error | pitfall | draft | unknown key "draft": a ledger holds sources, facts and conflicts, no doc text
      error | pitfall | S1 | tier A Rank 3, but the rule rfc-editor.org/rfc/ gives tier A Rank 1
      warn | pitfall | S2 | tier B Rank 1 with no provenance_ref: name the page that shows the author's role, unless the URL is the project's own home
      error | pitfall | F1 | quote not in cache/19b1c63f6292.txt: "either peer may set the end_stream flag on any frame and the stream closes at on"
      error | pitfall | F2 | quote is at line 16 of cache/19b1c63f6292.txt, not at line 7
      error | pitfall | F3 | source S9 is not in this ledger
      error | pitfall | X1 | fact F7 is not in this ledger
      ledger pitfall: 2 sources (2 counted, cap 4), 3 facts (0 at their place), 1 conflict: 6 errors, 1 warning
      """

  Scenario: ledger reports a saved page edited after it was fetched
    Given in "ledger-run/cache/f136dcfa5ee3.txt", `and does not wait for` becomes `and waits for`
    When the tool runs with arguments:
      """
      ledger
      {root}/ledger-run
      ground-truth
      """
    Then it exits with 1 and prints:
      """
      error | ground-truth | S2 | cache/f136dcfa5ee3.txt changed after it was fetched: its text no longer matches the SHA-256 it was saved with
      error | ground-truth | F3 | quote not in cache/f136dcfa5ee3.txt: "a server that wants to stop early sends rst_stream and does not wait for the cli"
      ledger ground-truth: 3 sources (2 counted, cap 4), 4 facts (3 at their place), 1 conflict: 2 errors, 0 warnings
      """

  Scenario: ledger holds a profile to its cap of sources, not counting seed sources
    When the tool runs with arguments:
      """
      ledger
      {root}/ledger-run
      ground-truth
      --cap
      1
      """
    Then it exits with 1 and prints:
      """
      error | ground-truth | sources | 2 sources count against the cap of 1 (1 seed source not counted)
      ledger ground-truth: 3 sources (2 counted, cap 1), 4 facts (4 at their place), 1 conflict: 1 error, 0 warnings
      """

  Scenario: No command prints the usage and exits with 2
    When the tool runs
    Then it exits with 2 and prints:
      """
      usage: node evaluate-research.mjs ranks <doc.md> | quotes <verdict.json> <input-dir> | verdict <verdict.json> [--write] | stage1 <run> <n> [--out <dir>] [--sample <k> --seed <s> [--include <regex>...]] | ledger <run> [<profile>...] [--cap <n>]
      """
