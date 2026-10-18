---
title: A team of agents
description: Delegate between bricks with a supervisor.
---

```ts
import { supervisor } from '@intellibrix/structures'
import { Brick, Intelligence } from 'intellibrix'

const researcher = new Brick({ name: 'researcher', intelligence: researcherAI })
const writer = new Brick({ name: 'writer', intelligence: writerAI })

const team = supervisor({
  supervisor: new Intelligence({ provider, model }),
  bricks: [researcher, writer],
  maxDepth: 3,
})

const { text } = await team.ask('Write a briefing on Structures')
```

The lead model sees each brick as a tool, delegates to them, and composes the answer.
`maxDepth` stops runaway delegation. `structure:hop` events let you reconstruct the whole call
graph of a run.

Other building blocks in `@intellibrix/structures`: `router` (classify, then dispatch),
`sequential` and `parallel` (pipelines and fan-out), and `handoffTool` (transfer control between
bricks). A runnable, fully offline version using `MockProvider` is in
[`examples/supervisor`](https://github.com/intellibrix/intellibrix/tree/master/examples/supervisor).
