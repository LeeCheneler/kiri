# Delegation evaluation scenarios

These scenarios evaluate routing and report quality. Prompt assembly tests and
mock-model messaging tests establish deterministic contracts; they do not prove
that a live model chooses the right route or supplies accurate evidence.

Use an isolated workspace and controlled sources. Live-model runs are opt-in.
For each run, save the model/provider, effort, configured delegate roles, prompt
revision, available tools and permissions, fixture inputs, full parent/worker
trace, final answer, elapsed time, and model/tool usage. Repeat runs with the
same fixtures to expose variability. Record measured cost only when available;
label estimates. This document supplies cases and a rubric, not an executable
evaluation harness or a measured baseline.

| Scenario and controlled input | Expected behavior | Failure evidence |
| --- | --- | --- |
| Ask which version introduced a flag; search returns one release-note URL whose body gives the version. | Parent searches, reads the result, and answers with attribution locally. | A second call alone triggers delegation, or the answer relies only on the search snippet. |
| Diagnose a small bug where each next file read depends on the preceding finding. | Parent keeps the tightly coupled investigation local, using as many focused reads as needed. | Handoffs fragment dependent reasoning or repeat reads without benefit. |
| Compare three libraries against compatibility, maintenance, and migration requirements; each library has several independent source documents. | Delegate bounded library investigations when their parallelism/context benefit justifies review, then synthesise against the shared requirements. Briefs include known evidence and avoid overlapping work. | Delegates trivial individual reads, duplicates investigations, or answers before outstanding strands are resolved. |
| A substantial extraction task has fully specified fields; a separate compatibility strand has contradictory version claims. | Size each justified delegation independently: quick/low can handle mechanical extraction; ordinary research fits daily/medium; conflicting evidence may warrant a deeper configured role/effort. | Cheap workers justify unnecessary delegation, or all strands receive maximum/minimum effort regardless of difficulty. |
| Worker sends a milestone note, then a question requiring missing user context, then an incomplete result. | Parent distinguishes all three, answers what it can, continues independent work, and identifies the remaining blocker without declaring completion. | Progress or settlement is mistaken for success, or unsupported answers are invented to unblock the worker. |
| Worker reports two findings backed by titled URLs with dates and quoted/paraphrased evidence; one finding is inferred. | Parent retains usable attribution and labels the inference in its answer without repeating the searches. | Bare worker-local tool IDs are treated as accessible citations, references disappear, or an inference becomes a fact. |
| Worker gives a consequential migration recommendation but its cited source omits a required compatibility guarantee; another source conflicts. | Parent asks for the specific missing evidence or opens the relevant sources selectively, resolving the conflict or disclosing uncertainty. | Blind acceptance, blanket re-investigation, or an unqualified recommendation despite unresolved evidence. |
| A long report cannot fit the message cap; one source was inaccessible. Repeat with message_parent withheld. | Explicit report and saved final reply prioritise findings with evidence, disclose omitted/incomplete work, and provide accessible references for detail. | Silent omission of uncertainty, raw-result dumps, unusable references, or claims that unavailable evidence was verified. |

Score each applicable dimension as **pass**, **partial**, or **fail**, linking to
the trace and fixture evidence that justifies it:

- **Routing:** separation produces a concrete quality, latency, or context benefit;
  local tasks avoid unnecessary briefing and coordination.
- **Evidence:** material claims match the supplied sources and remain attributable;
  observations, inference, stale evidence, and uncertainty are distinguishable.
- **Completion:** progress and questions do not close tasks; incomplete results
  state completed work, remaining work, the stopping reason, and a next step.
- **Verification:** follow-ups target actual gaps or consequential claims and
  avoid routine duplication of completed investigation.
- **Sizing:** model and effort match each task's reasoning needs, within the
  configured roles; unconfigured model roles are never requested.

Compare quality scores alongside latency, calls, and token usage. Fewer calls
alone is not success: unsupported claims or hidden unfinished work fail even
when a run is fast. No live results are claimed by the repository's unit tests.
