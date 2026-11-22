# Requirements for frameworks/knowledge/tools/fetch-source/fetch-source.mjs, as executable scenarios.
# The design is frameworks/knowledge/research-agent.design.md §1.3 step 3 and §2.1. Output text is part of the requirement.

Feature: Source fetcher
  Pages are saved as text with their fetch time and hash; GitHub files come raw; PDFs are refused.

  Background:
    Given the base fixture tree of "fetch-source"

  Scenario: plan maps a GitHub file to its raw URL, warns on a moving branch, and drops the fragment
    When the tool runs with arguments:
      """
      plan
      https://github.com/torvalds/linux/blob/master/fs/eventpoll.c#L100
      https://github.com/torvalds/linux/blob/v6.12/fs/eventpoll.c
      https://example.org/paper.pdf
      """
    Then it exits with 0 and prints:
      """
      https://github.com/torvalds/linux/blob/master/fs/eventpoll.c | fetch https://raw.githubusercontent.com/torvalds/linux/master/fs/eventpoll.c | cache/c6cf2d87624a.txt | warn: ref "master" is a moving branch: cite a tag or a commit
      https://github.com/torvalds/linux/blob/v6.12/fs/eventpoll.c | fetch https://raw.githubusercontent.com/torvalds/linux/v6.12/fs/eventpoll.c | cache/787c21f1de96.txt
      https://example.org/paper.pdf | fetch https://example.org/paper.pdf | cache/6d06577100eb.txt | warn: a PDF: v1 saves no PDFs, cite the HTML version
      """

  Scenario: text turns HTML into one line per block, drops scripts and styles, and decodes entities
    When the tool runs with arguments:
      """
      text
      {root}/site/page.html
      """
    Then it exits with 0 and prints:
      """
      Fixture page

      Menu

      Epoll & edge triggers

      An event is generated upon each receipt of a chunk of data.

      Flag | Meaning |

      EPOLLET | edge-triggered |

      Quote: “the next read yields EAGAIN”
      """

  Scenario: fetch saves a page with its hash in sources.json, and a second fetch skips it
    Given a local web server that serves the files in "site"
    When the tool runs with arguments:
      """
      fetch
      {root}/run
      {server}/page.html
      {server}/note.txt
      """
    Then it exits with 0
    And the output has a line containing "saved | 200 |"
    And the file "run/sources.json" has a line containing '"content_type": "text/html"'
    And the file "run/sources.json" has a line containing '"sha256":'
    When the tool runs with arguments:
      """
      fetch
      {root}/run
      {server}/page.html
      """
    Then it exits with 0
    And the output has a line containing "cached | cache/"

  Scenario: fetch refuses a PDF and reports a missing page, and exits with 1
    Given a local web server that serves the files in "site"
    When the tool runs with arguments:
      """
      fetch
      {root}/run
      {server}/paper.pdf
      {server}/missing.html
      """
    Then it exits with 1
    And the output has a line containing "refused | pdf |"
    And the output has a line containing "error | 404 |"
