# Scripted agent transcripts

`blocking_delay.scripted.json` is a **hand-written** transcript in the shape of real model turns
(tool calls and text) for the `blocking_delay` fixture. The API replays it when
`LINELAB_AGENT_SCRIPT` points at it. It is used by the e2e test and for demos without an API key.

Everything else in such a session is real: the run report, the compile results (from the
committed compile cache of real arduino-cli output) and the verification gate, which still
decides whether the patch is shown. A replayed session reports its model as `scripted`.
