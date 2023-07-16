# 🧱 Intellibrix 🧱 <!-- omit in toc -->

## AI-Powered Software Component Framework <!-- omit in toc -->

[![Version](https://img.shields.io/github/package-json/v/intellibrix/intellibrix?color=success)](https://web3os.sh)
[![Last Commit](https://img.shields.io/github/last-commit/intellibrix/intellibrix.svg)](https://github.com/intellibrix/intellibrix/commit/master)
[![Open issues](https://img.shields.io/github/issues/intellibrix/intellibrix.svg)](https://github.com/intellibrix/intellibrix/issues)
[![Closed issues](https://img.shields.io/github/issues-closed/intellibrix/intellibrix.svg)](https://github.com/intellibrix/intellibrix/issues?q=is%3Aissue+is%3Aclosed)

[![Sponsors](https://img.shields.io/github/sponsors/intellibrix?color=red)](https://github.com/intellibrix/intellibrix/blob/master/LICENSE)
[![Contributors](https://img.shields.io/github/contributors/intellibrix/intellibrix?color=yellow)](https://github.com/intellibrix/intellibrix/graphs/contributors)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/intellibrix/intellibrix/blob/master/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](https://github.com/intellibrix/intellibrix/compare)

[![Followers](https://img.shields.io/github/followers/intellibrix?style=social)](https://github.com/intellibrix)
[![Watchers](https://img.shields.io/github/watchers/intellibrix/intellibrix?style=social)](https://github.com/intellibrix/intellibrix)
[![Stars](https://img.shields.io/github/stars/intellibrix/intellibrix?style=social)](https://github.com/intellibrix/intellibrix)

---

Intellibrix is a software component framework that organizes functionality into `Structures` and `Bricks`.

- A `Brick` is a software component that provides a specific functionality.
- A `Structure` is a collection of `Bricks` that can easily be passed around in an application.
- A `Brick` can contain many `Programs` that provide different related functionality
- A `Program` contains `Steps` that are executed in sequence to perform a specific task.
- A `Step` contains `Actions` that are executed in sequence to act upon, process, and transform the data.
- A `Database` can be attached to a `Brick` to provide database capabilities.
- An `Intelligence` can be attached to a `Brick` to provide AI or other custom processing capabilities.
- Both `Bricks` and `Structures` have an EventEmitter that can be used to emit and listen for events.

---

- [Installation](#installation)
- [AI Smart Brick Example](#ai-smart-brick-example)
- [Dumb Brick Example](#dumb-brick-example)
- [Database Example](#database-example)
- [Custom Intelligence Example](#custom-intelligence-example)
- [Extending a Brick](#extending-a-brick)
- [Logging](#logging)
- [Intelligence](#intelligence)
- [Database](#database)
- [Events](#events)
- [Bundled Bricks](#bundled-bricks)

---

## Installation

```sh
npm install --save intellibrix # or your package manager's equivalent
```

## AI Smart Brick Example

```typescript
import { Brick, Intelligence, Structure } from 'intellibrix'

const structure = new Structure() // We add our bricks to this (optional)
structure.events.on('add', (brick) => { // Listen for bricks being added to the structure (optional)
  console.log(`Added brick ${brick.id}`)
})

const intelligence = new Intelligence({ // Define our intelligence
  service: 'openai', // default
  model: 'gpt-3.5-turbo', // default
  system: 'Respond to every question in the style of Shakespeare', // optional
  key: 'OPENAI_API_KEY' // replace with your API key
})

const brick = new Brick({ intelligence }) // Create the brick, passing our intelligence
structure.add(brick) // Add the brick to the structure (optional)

// This is the core feature of Bricks, they're programmable
brick.program({ // Define a program on our brick
  name: 'poem', // Program name
  description: 'Generate a poem', // Program description
  steps: [ // One or many steps
    {
      name: 'step_1', // Step name
      description: 'Fetch a response from the OpenAI API', // Step description
      actions: [ // One or many actions
        {
          name: 'fetch_poem', // Action name
          description: 'Fetch a response from the OpenAI API', // Action description
          method: async function ({ topic }) { // This is the function that will be executed for this action
            return await this.ai.ask(`Write a poem about ${topic}`) // Ask the AI to answer our question
          }
        }
      ]
    }
  ]
})

const { text } = await brick.run('poem', { topic: 'TypeScript' })
console.log(text)

// You can also access brick.ai.ask directly
// const { text } = await brick.ai.ask('Write a poem about TypeScript')
// console.log(text)
```

## Dumb Brick Example

```typescript
import { Brick, Structure } from 'intellibrix'

const structure = new Structure()
const brick = new Brick()
structure.add(brick)

// This program will return the result of a multi-step calculation with multiple actions
// This is intentionally overcomplicated to show how to chain actions and steps
// name and description are optional, but can be used for easier analysis and debugging later
brick.program({
  name: 'calculate',
  description: 'Multi-step calculation',
  steps: [
    {
      name: 'Step 1',
      description: 'Add the numbers, then multiply by a random number between 0 and 1',
      actions: [
        {
          name: 'sum',
          description: 'Add two numbers',
          method: async function ({ x, y }) {
            return x + y
          }
        },
        {
          name: 'multiply',
          description: 'Multiply a number by a random number between 0 and 1',
          method: async function (payload) {
            return payload * Math.random()
          }
        }
      ]
    },
    {
      name: 'Step 2',
      description: 'Add a random integer between 10 and 50 to the result and return the floor',
      actions: [
        {
          name: 'add_one',
          description: 'Add a random integer between 10 and 50 to the result',
          method: async function (payload) {
            return payload + Math.floor(Math.random() * (50 - 10 + 1) + 10)
          }
        },
        {
          name: 'floor',
          description: 'Round a number down to the nearest integer',
          method: async function (payload) {
            return Math.floor(payload)
          }
        }
      ]
    }
  ]
})

const result = await brick.run('calculate', { x: 1, y: 2 })
console.log(result)
```

## Database Example

```typescript
import { Brick } from 'intellibrix'

const structure = new Structure()
const keyValueDatabase = new Database()
const sqlDatabase = new Database({ service: 'sql', uri: 'sqlite::memory:' })
const keyValueBrick = new Brick({ database: keyValueDatabase })
const sqlBrick = new Brick({ database: sqlDatabase })
structure.add(keyValueBrick)
structure.add(sqlBrick)

keyValueBrick.db.interface.set('foo', 'bar')
const foo = await keyValueBrick.db.interface.get('foo')
console.log(foo)

// Also access all of Sequelize's power directly with sqlBrick.db.sequelize
sqlBrick.db.interface.query('CREATE TABLE IF NOT EXISTS `users` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` TEXT NOT NULL, `rank` TEXT NOT NULL)')
sqlBrick.db.interface.query('INSERT INTO `users` (`name`, `rank`) VALUES (?, ?)', ['Belisarius Cawl', 'Archmagos'])
const results = await sqlBrick.db.interface.query('SELECT * FROM `users`')
console.log(results)
```

## Custom Intelligence Example

```typescript
import { Brick, Intelligence } from 'intellibrix'
const intelligence = new Intelligence({
  service: 'custom',
  method: async function ({ name }) {
    // You would likely want to do something more interesting here
    return `Hello ${name}`
  }
})

const brick = new Brick({ intelligence })
const response = await brick.ai?.ask({ name: 'Belisarius Cawl' })
console.log(response)
```

## Extending a Brick

```typescript
import { Brick } from 'intellibrix'

class MyBrick extends Brick {
  constructor (opts) {
    super(opts)
  }

  async myMethod ({ topic }) {
    return await this.ai.ask(`Write a poem about ${topic}`)
  }
}

const brick = new MyBrick({ intelligence })
const { text } = await brick.myMethod({ topic: 'TypeScript' })
```

---

## Logging

Intellibrix uses [Pino](https://github.com/pinojs/pino) for logging in both Bricks and Structures:

```typescript
import { Brick, Structure } from 'intellibrix'

// To use raw JSON logs, pass { logJSON: true } to the Brick or Structure constructor
// Pass in pinoOptions to override the default transport and logging options
const structure = new Structure({ name: 'My Structure', logLevel: 'debug' })
const brick = new Brick({ name: 'My Brick', logLevel: 'silent' })
structure.add(brick) // Outputs: DEBUG (STRUCTURE:My Structure): Added Brick: My Brick
structure.log.info('This is an info message') // Outputs: INFO (STRUCTURE:My Structure): This is an info message
brick.log.fatal('This is a fatal message') // Outputs: Nothing because logLevel is set to silent
```

## Intelligence

Intelligence is a class that provides AI capabilities to a `Brick`. It can currently utilize the [OpenAI API](https://platform.openai.com/docs/api-reference) or a custom function to manually process data.

An `Intelligence` has these methods:

- `ask('Tell me about the biggest event from 1938', context || [])` - Ask the AI a question and return the response
- `image('A shiny red apple', '1024x1024')` - Generate an image from a text prompt (prompt, size)

You may pass a context array of the format `[{ role: ChatCompletionRequestMessageRoleEnum, content: string }]` to `ask()` to provide context to the AI.

An OpenAI `Intelligence` supports the function-calling API (see `test/function.test.ts`):

```typescript
const intelligence = new Intelligence({
  service: 'openai',
  model: 'gpt-3.5-turbo-0613',
  key: 'OPENAI_API_KEY',
  functions: {
    schema: [
      {
        name: 'return_answer',
        description: 'Test function',
        parameters: {
          type: 'object',
          required: ['answer', 'explanation'],
          properties: {
            answer: {
              type: 'string',
              description: 'The answer to the question'
            },
            explanation: {
              type: 'string',
              description: 'The explanation of the answer'
            }
          }
        }
      }
    ],

    methods: {
      return_answer: async (payload) => {
        payload.processed = true // This just shows that you can modify the payload
        return payload
      }
    }
  }
})

const brick = new Brick({ intelligence })
const response = await brick.ai.ask('What is 42 + 42?')
console.log(response.functionResult)
```

## Database

Database is a class that can be attached to a `Brick` to provide database capabilities. It currently supports in-memory key-value storage as well as various SQL servers via [Sequelize](https://sequelize.org).

A `Database` has these methods, depending on the type of storage:

**In-Memory Key-Value Storage**:

- `set('foo', 'bar')` - Set a key to a value
- `get('foo')` - Get a value from a key
- `delete('foo')` - Delete a key
- `dump()` - Dump the entire database to an object
- `load(data)` - Overwrite the entire database with an object

**SQL Storage**:

- `query('SELECT * FROM users WHERE name="?"', ['Fabius Bile'])` - Run a SQL query

## Events

Both `Structures` and `Bricks` have EventEmitters that can be used to emit and listen for events.

```typescript
const structure = new Structure()
const brick = new Brick()
structure.events.on('foo', () => console.log('foo'))
brick.events.on('bar', () => console.log('bar'))
structure.events.emit('foo')
brick.events.emit('bar')
```

---

## Bundled Bricks

The core `intellibrix` package comes with some bricks that provide basic functionality.

You can instantiate these like any brick, passing in the appropriate intelligence and options.

- Question and Answer
  - Simple question and answer functionality
  - `import QA from 'intellibrix/bricks/qa'`
    - `const qa = new QA({ intelligence })`
    - `const { text } = qa.run('qa', { question: 'What is the meaning of life?' })`
    - You may pass a `context` array to the payload of [this format](https://platform.openai.com/docs/api-reference/chat/create#chat/create-messages) to track the conversation history

---