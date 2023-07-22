# 🧱 Intellibrix 🧱 <!-- omit in toc -->

## AI-Powered Software Component Framework <!-- omit in toc -->

[![View Docs](https://img.shields.io/badge/view-docs-blue?style=for-the-badge)](https://intellibrix.dev)

[![Version](https://img.shields.io/github/package-json/v/intellibrix/intellibrix?color=success)](https://intellibrix.dev)
[![Last Commit](https://img.shields.io/github/last-commit/intellibrix/intellibrix.svg)](https://github.com/intellibrix/intellibrix/commit/master)
[![Open issues](https://img.shields.io/github/issues/intellibrix/intellibrix.svg)](https://github.com/intellibrix/intellibrix/issues)
[![Closed issues](https://img.shields.io/github/issues-closed/intellibrix/intellibrix.svg)](https://github.com/intellibrix/intellibrix/issues?q=is%3Aissue+is%3Aclosed)

[![Sponsors](https://img.shields.io/github/sponsors/mathiscode?color=red)](https://github.com/sponsors/mathiscode)
[![Contributors](https://img.shields.io/github/contributors/intellibrix/intellibrix?color=yellow)](https://github.com/intellibrix/intellibrix/graphs/contributors)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/intellibrix/intellibrix/blob/master/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](https://github.com/intellibrix/intellibrix/compare)

[![Followers](https://img.shields.io/github/followers/intellibrix?style=social)](https://github.com/intellibrix)
[![Watchers](https://img.shields.io/github/watchers/intellibrix/intellibrix?style=social)](https://github.com/intellibrix/intellibrix)
[![Stars](https://img.shields.io/github/stars/intellibrix/intellibrix?style=social)](https://github.com/intellibrix/intellibrix)

---

![Diagram](https://raw.githubusercontent.com/intellibrix/intellibrix/master/assets/intellibrix-diagram.svg)

---

Intellibrix is a software component framework that organizes functionality into `Structures` and `Bricks`.

- A `Brick` is a software component that provides a specific functionality.
- A `Structure` is a collection of `Bricks` that can easily be passed around in an application.
- A `Brick` can contain many `Programs` that provide different related functionality.
- A `Program` contains `Steps` that are executed in sequence to perform a specific task.
- A `Step` contains `Actions` that are executed in sequence to act upon, process, and transform the data.
- A `Brick` can also contain `Tasks` that are scheduled to run at a specific time or interval.
- A `Database` can be attached to a `Brick` to provide database capabilities.
- An `Intelligence` can be attached to a `Brick` to provide AI or other custom processing capabilities.
- Both `Bricks` and `Structures` have an EventEmitter that can be used to emit and listen for events.

- You aren't limited to using `Programs`, `Databases`, and `Intelligence` - extend a brick and make it work however you want!

---

- [Installation](#installation)
- [Examples](#examples)
  - [AI Smart Brick Example](#ai-smart-brick-example)
  - [Dumb Brick Example](#dumb-brick-example)
  - [Database Example](#database-example)
  - [Custom Intelligence Example](#custom-intelligence-example)
  - [Extending a Brick](#extending-a-brick)
- [Logging](#logging)
- [Intelligence](#intelligence)
- [Database](#database)
- [Events](#events)
- [Tasks](#tasks)
- [Bundled Bricks](#bundled-bricks)
- [Development](#development)
- [Other Notes](#other-notes)

---

## Installation

```sh
npm install --save intellibrix # or your package manager's equivalent
```

## Examples

### AI Smart Brick Example

```typescript
import { Brick, Intelligence, Structure } from 'intellibrix'

const structure = new Structure() // We add our bricks to this (optional)
structure.events.on('add', ({ brick, structure }) => { // Listen for bricks being added to the structure (optional)
  console.log(`Added brick ${brick.id} to ${structure.id}`)
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

### Dumb Brick Example

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
          name: 'add_random',
          description: 'Add a random integer between 10 and 50 to the result',
          method: async function (payload) {
            return payload + Math.floor(Math.random() * (50 - 10 + 1) + 10)
          }
        },
        {
          name: 'floor',
          description: 'Round the result down to the nearest integer',
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

### Database Example

```typescript
import { Brick, Database, Structure } from 'intellibrix'

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
await sqlBrick.db.interface.query('CREATE TABLE IF NOT EXISTS `users` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` TEXT NOT NULL, `rank` TEXT NOT NULL)')
await sqlBrick.db.interface.query('INSERT INTO `users` (`name`, `rank`) VALUES (?, ?)', ['Belisarius Cawl', 'Archmagos'])
const results = await sqlBrick.db.interface.query('SELECT * FROM `users`')
console.log(results)
```

### Custom Intelligence Example

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
const response = await brick.ai.ask({ name: 'Belisarius Cawl' })
console.log(response)
```

### Extending a Brick

```typescript
import { Brick } from 'intellibrix'

class MyBrick extends Brick {
  constructor (options) {
    super(options)
  }

  myMethod ({ topic }) {
    return `${topic} has ${topic.length} characters`
  }
}

const brick = new MyBrick({ name: 'My Brick' })
const lengthString = await brick.myMethod({ topic: 'TypeScript' })
console.log(lengthString)
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

Intelligence is a class that provides AI or other custom processing capabilities to a `Brick`. It can currently utilize the [OpenAI API](https://platform.openai.com/docs/api-reference) or a custom function to manually process data.

An `Intelligence` has these methods:

- `ask('Tell me about the biggest event from 1938', context?)` - Ask the AI a question and return the response (prompt, context?)
- `image('A shiny red apple', '1024x1024')` - Generate an image from a text prompt (prompt, size? = `'256x256'`)

You may pass a `context` array of the format `[{ role: 'user' | 'assistant', content: string }]` to `ask()` to provide context to the AI.

You may also access the `openai` library directly with `brick.ai.instance`.

An OpenAI `Intelligence` supports the [function-calling API](https://platform.openai.com/docs/guides/gpt/function-calling) (see `test/function.test.ts`):

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

## Tasks

Bricks can be assigned scheduled tasks to perform at a certain time or interval. Both cron syntax and Date objects are supported.

```typescript
const brick = new Brick()

const cronTask = brick.schedule({
  name: 'New Year Cron',
  description: 'This uses cron syntax and will run on January 1st at 12:00 AM',
  cron: '0 0 1 1 *',
  start: true, // Start the task immediately, otherwise you must call task.cronjob.start() manually - this does not execute the task
  method: () => console.log('Happy New Year!')
})

const dateTask = brick.schedule({
  name: 'New Year Date',
  description: 'This uses a Date object and will run on January 1st at 12:00 AM',
  date: new Date('January 1, 2022 00:00:00'),
  start: false,
  method: () => console.log('Happy New Year!')
})

brick.unschedule('New Year Cron')
dateTask.cronjob.start() // Since we didn't use the start option, we must start the task manually or it won't run when the date is reached
```

---

## Bundled Bricks

The core `intellibrix` package comes with some bricks that provide basic functionality and serve as examples.

You can instantiate these like any brick, passing in the appropriate intelligence and options.

- Express Web Server
  - A brick that provides a basic [Express](https://expressjs.com) web server
  - `import ExpressBrick from 'intellibrix/bricks/express'`
    - `const routes = [{ method: 'get', path: '/', handler: (req, res) => res.send('Hello World!') }]`
    - `const brick = new ExpressBrick({ port: 3000, routes })`
- Terminal
  - A brick that provides a basic terminal interface powered by [TerminalKit](https://github.com/cronvel/terminal-kit)
  - `import TerminalBrick from 'intellibrix/bricks/terminal'`
    - `const brick = new TerminalBrick()`
    - `brick.print('What is your name? ')`
    - `const name = await brick.input()`
- Question and Answer
  - Simple question and answer functionality powered by [OpenAI](https://openai.com)
  - `import QA from 'intellibrix/bricks/qa'`
    - `const qa = new QA({ intelligence })`
    - `const { text } = qa.run('qa', { question: 'What is the meaning of life?' })`
    - You may pass a `context` array to the payload of [this format](https://platform.openai.com/docs/api-reference/chat/create#chat/create-messages) to track the conversation history

---

## Development

```bash
git clone https://github.com/intellibrix/intellibrix.git # or your fork
cd intellibrix
npm install # or your package manager's equivalent
```

Create a `.jest` folder with an `env.js` file containing the following:

```javascript
process.env.USE_OPENAI=true // Set to false to disable OpenAI tests
process.env.OPENAI_API_KEY="sk-YOUROPENAIAPIKEY" // Your OpenAI API key
process.env.DATABASE_URI="postgresql://user:pass@host:port/dbname" // Your database URI
```

Then run:

```bash
npm run test:watch
```

## Other Notes

- A `Brick` can communicate with its parent `Structure` via `this.structure`
- A `Structure` can enumerate and communicate with its child `Bricks` via `this.bricks`
