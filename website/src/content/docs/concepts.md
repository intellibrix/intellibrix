---
title: Core concepts
description: The few ideas that everything in intellibrix is built from.
---

intellibrix is organised as **Structure → Brick → Program → Step → Action**, with an
**Intelligence** that gives a brick access to a model.

![How Structures, Bricks, Programs and Intelligence fit together](/intellibrix-diagram.svg)

| Concept | What it is |
|---|---|
| **Brick** | A software component that provides specific functionality. Extend it, or use it as is. |
| **Structure** | A collection of bricks that share state (`structure.state`) and usage accounting, and can coordinate. |
| **Program** | A named, optionally schema-typed workflow on a brick. Every program is automatically available to models as a tool (`brick.tools()`). |
| **Step / Action** | A program is a list of steps; a step is a list of actions run in sequence to transform data. |
| **Intelligence** | Wraps a `Provider` and a model name. Provides `ask`, `stream`, `object` (validated structured output), `embed` and `image`. |
| **Provider** | The seam to a model. Performs **exactly one model step** per call. |
| **Tool** | A typed function a model may call, made with `defineTool`. |

## Who owns what

The most important rule: **a `Provider` does one model step, and `runAgentLoop` owns iteration.**
The loop calls the provider, executes the tool calls it returns (after validating their input
and checking approvals), appends the results, and repeats until the model stops or `maxSteps` is
reached. That means a new provider is small (see [Writing a custom provider](/guides/custom-provider/)),
and every provider gets approvals, tracing, memory and usage accounting for free.

## Events and observability

Bricks and structures are event emitters and log through one shared Pino logger. For each
`ask`, `onRunEvent` emits `run:*`, `model:*`, `tool:*` and `approval:*` events, and optional
OpenTelemetry spans are available. Token and cost accounting rolls up from brick to structure.

## A stable core

The core surface (`messages`, `tool`, `provider`, `loop`, `intelligence`, `brick`, `structure`,
`database`, `testing`, `checkpoint`) is the stable 1.x API. New capabilities are added as new
modules next to it rather than by changing those signatures.
