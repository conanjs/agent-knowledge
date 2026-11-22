# Requirements for frameworks/knowledge/tools/classify-source/classify-source.mjs, as executable scenarios.
# The rank rules are in source-ranks.json next to the script; how they match is in frameworks/knowledge/schemas/_system.md §4.1.
# The output text is part of the requirement: scenarios compare it exactly.

Feature: Source rank classifier
  The classifier gives each URL a source rank from 1 to 6 by host and path prefix, or says no rule covers it (tier B).

  Background:
    Given the base fixture tree of "classify-source"

  Scenario: A URL a rule covers gets that rule's rank, tier A
    When the tool runs with "https://www.rfc-editor.org/rfc/rfc9113"
    Then it exits with 0 and prints:
      """
      Rank 1 | tier A | rfc-editor.org/rfc/ | https://www.rfc-editor.org/rfc/rfc9113
      """

  Scenario: The rule with more path segments wins, so an issue in an official repository is Rank 6
    When the tool runs with arguments:
      """
      https://github.com/microsoft/TypeScript/blob/v5.0.2/README.md
      https://github.com/microsoft/TypeScript/issues/36282
      """
    Then it exits with 0 and prints:
      """
      Rank 1 | tier A | github.com/microsoft/typescript/ | https://github.com/microsoft/TypeScript/blob/v5.0.2/README.md
      Rank 6 | tier A | github.com/*/*/issues/ | https://github.com/microsoft/TypeScript/issues/36282
      """

  Scenario: "www." and letter case do not matter, and a "*." host covers every subdomain
    When the tool runs with arguments:
      """
      https://RFC-Editor.org/RFC/rfc9000
      https://unix.stackexchange.com/q/1
      """
    Then it exits with 0 and prints:
      """
      Rank 1 | tier A | rfc-editor.org/rfc/ | https://RFC-Editor.org/RFC/rfc9000
      Rank 6 | tier A | *.stackexchange.com/ | https://unix.stackexchange.com/q/1
      """

  Scenario: MDN docs are Rank 3, and another MDN path has no rule
    When the tool runs with arguments:
      """
      https://developer.mozilla.org/en-US/docs/Web/HTTP
      https://developer.mozilla.org/en-US/blog/
      """
    Then it exits with 0 and prints:
      """
      Rank 3 | tier A | developer.mozilla.org/en-US/docs/ | https://developer.mozilla.org/en-US/docs/Web/HTTP
      no rank | tier B | no rule | https://developer.mozilla.org/en-US/blog/
      """

  Scenario: A repository with no rule of its own is tier B, whatever its path
    When the tool runs with "https://github.com/someone/notes/blob/main/a.md"
    Then it exits with 0 and prints:
      """
      no rank | tier B | no rule | https://github.com/someone/notes/blob/main/a.md
      """

  Scenario: An argument that is not an http or https URL exits with 1
    When the tool runs with arguments:
      """
      ftp://example.org/x
      https://example.dev/blog/h2
      """
    Then it exits with 1 and prints:
      """
      not a URL | ftp://example.org/x
      no rank | tier B | no rule | https://example.dev/blog/h2
      """

  Scenario: No argument prints the usage and exits with 2
    When the tool runs
    Then it exits with 2 and prints:
      """
      usage: node classify-source.mjs [--rules <file>] <url> … | --census <knowledge-root>
      """

  Scenario: The census counts the ranks of URLs in References sections only
    When the tool runs with arguments:
      """
      --census
      {root}/knowledge
      """
    Then it exits with 0 and prints:
      """
      rank census: 2 docs with external References, 6 URLs
      Rank 1: 1 (17%)
      Rank 2: 0 (0%)
      Rank 3: 1 (17%)
      Rank 4: 0 (0%)
      Rank 5: 0 (0%)
      Rank 6: 1 (17%)
      tier B, no rule: 3 (50%)
      Hosts with no rule, most cited first:
        2 example.dev
        1 another.example
      """

  Scenario: A rule with a rank outside 1–6 makes the rules file invalid
    Given the file "rules.json" contains:
      """
      { "rules": [ { "host": "example.org", "prefix": "/", "rank": 7 } ] }
      """
    When the tool runs with arguments:
      """
      --rules
      {root}/rules.json
      https://example.org/
      """
    Then it exits with 2 and prints:
      """
      rules file {root}/rules.json, rule 1: rank 7 is not 1–6
      """

  Scenario: The same host and prefix listed twice makes the rules file invalid
    Given the file "rules.json" contains:
      """
      { "rules": [ { "host": "example.org", "prefix": "/a/", "rank": 1 }, { "host": "www.example.org", "prefix": "/A/", "rank": 6 } ] }
      """
    When the tool runs with arguments:
      """
      --rules
      {root}/rules.json
      https://example.org/
      """
    Then it exits with 2 and prints:
      """
      rules file {root}/rules.json, rule 2: www.example.org /A/ is listed twice
      """
