import type { Request, Response } from 'express'
import { customProvider, Intelligence } from 'intellibrix'
import supertest from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import ExpressBrick, { type ExpressBrickRequest } from '../src/index.js'

const makeBrick = () =>
  new ExpressBrick({
    name: 'Ask Brick',
    port: 0,
    logLevel: 'fatal',
    intelligence: new Intelligence({
      provider: customProvider(async (p) => `echo: ${p}`),
      model: 'mock',
    }),
  })

describe('Express Brick', () => {
  let brick: ExpressBrick

  it('Should be able to create an express app', async () => {
    const port = Math.floor(Math.random() * 10000) + 30000
    const routes = [
      {
        path: '/',
        method: 'get',
        handler: async (req: ExpressBrickRequest, res: Response) => {
          const { brick } = req
          if (!brick?.ai) throw new Error('Brick not found')
          const { text } = await brick.ai.ask('Write a small hello world application in C++')
          res.status(200).json({ error: false, message: 'Hello World', text })
        },
      },
    ]

    const middleware = [
      (_: Request, res: Response, next: any) => {
        res.setHeader('Content-Type', 'application/json')
        next()
      },
    ]

    const intelligence = new Intelligence({
      provider: customProvider(async () => 'int main() { return 0; }'),
      model: 'mock',
    })

    brick = new ExpressBrick({
      name: 'AI Express Brick',
      intelligence,
      port,
      routes,
      middleware,
      builtinMiddleware: { json: true, urlencoded: true },
    })
    expect(brick).toBeInstanceOf(ExpressBrick)
    const api = supertest(brick.express)

    await api
      .get('/')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect((res) => {
        expect(res.body).toHaveProperty('error', false)
        expect(res.body).toHaveProperty('message', 'Hello World')
        expect(res.body).toHaveProperty('text')
        expect(res.body.text).toMatch(/int main/)
        return true
      })
  }, 30000)

  afterEach(() => {
    brick.server?.close()
  })

  describe('ask routes', () => {
    it('askEndpoint replies with {reply}', async () => {
      brick = makeBrick().askEndpoint()
      await supertest(brick.express)
        .post('/ask')
        .send({ prompt: 'hi' })
        .expect(200)
        .expect((res) => expect(res.body).toEqual({ reply: 'echo: hi' }))
    })

    it('askEndpoint rejects a missing prompt with 400', async () => {
      brick = makeBrick().askEndpoint()
      await supertest(brick.express).post('/ask').send({}).expect(400)
    })

    it('askStreamEndpoint emits well-formed SSE and closes', async () => {
      brick = makeBrick().askStreamEndpoint()
      const res = await supertest(brick.express)
        .get('/ask/stream')
        .query({ prompt: 'yo' })
        .expect(200)
        .expect('Content-Type', /text\/event-stream/)
      const frames = res.text.trim().split('\n\n')
      expect(frames.every((f) => /^event: [\w-]+\ndata: .+$/.test(f))).toBe(true)
      expect(frames[0]).toContain('event: text-delta')
      expect(frames[0]).toContain('echo: yo')
      expect(frames.at(-1)).toBe('event: done\ndata: {}')
    })
  })
})
