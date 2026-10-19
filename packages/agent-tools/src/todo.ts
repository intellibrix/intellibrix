import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  id: string
  content: string
  status: TodoStatus
}

/** Holds each run's task list so the host can show or persist it. */
export class TodoStore {
  private readonly lists = new Map<string, TodoItem[]>()

  constructor(private readonly onChange?: (runId: string, todos: TodoItem[]) => void) {}

  /** The task list for `runId` (empty if the model has not made one). */
  get(runId: string): TodoItem[] {
    return [...(this.lists.get(runId) ?? [])]
  }

  set(runId: string, todos: TodoItem[]): void {
    this.lists.set(runId, todos)
    this.onChange?.(runId, [...todos])
  }

  clear(runId: string): void {
    this.lists.delete(runId)
  }
}

export type TodoToolOptions = {
  /** Where lists are kept. Defaults to a private store, reachable as `tool.store`. */
  store?: TodoStore
  /** Called whenever the model replaces its list, e.g. to render progress. Ignored if `store` is given. */
  onChange?: (runId: string, todos: TodoItem[]) => void
}

/** The `todo` tool plus the {@link TodoStore} that backs it. */
export type TodoTool = ToolDefinition & { store: TodoStore }

const summarize = (todos: TodoItem[]) => ({
  todos,
  pending: todos.filter((t) => t.status === 'pending').length,
  inProgress: todos.filter((t) => t.status === 'in_progress').length,
  completed: todos.filter((t) => t.status === 'completed').length,
})

/**
 * A `todo` tool: the model keeps a task list for the current run, replacing the whole list on each
 * call (omit `todos` to read it back). Lists are scoped to the `runId`. At most one task may be
 * `in_progress`, which keeps the model working through the list one item at a time.
 */
export function todoTool(options: TodoToolOptions = {}): TodoTool {
  const store = options.store ?? new TodoStore(options.onChange)
  const tool = defineTool({
    name: 'todo',
    description:
      'Plan and track multi-step work. Pass the complete task list (it replaces the previous one); keep exactly one task in_progress and mark tasks completed as you finish them. Omit todos to read the current list.',
    input: z.object({
      todos: z
        .array(
          z.object({
            id: z.string().optional(),
            content: z.string().min(1),
            status: z.enum(['pending', 'in_progress', 'completed']),
          }),
        )
        .max(100)
        .optional(),
    }),
    execute: async ({ todos }, ctx) => {
      if (!todos) return summarize(store.get(ctx.runId))
      if (todos.filter((t) => t.status === 'in_progress').length > 1) {
        throw new Error('Only one task may be in_progress at a time')
      }
      const ids = new Set<string>()
      const list = todos.map((t, i): TodoItem => {
        const id = t.id && !ids.has(t.id) ? t.id : String(i + 1)
        ids.add(id)
        return { id, content: t.content, status: t.status }
      })
      store.set(ctx.runId, list)
      return summarize(list)
    },
  })
  return Object.assign(tool, { store })
}
