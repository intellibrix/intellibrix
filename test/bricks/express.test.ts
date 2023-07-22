import supertest from 'supertest'
import ExpressBrick, { ExpressBrickRequest } from '../../src/bricks/express'
import { Request, Response } from 'express'
import Intelligence from '../../src/intelligence'

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
          if (!brick) throw new Error('Brick not found')
          const { text } = await brick.ai?.ask('Write a small hello world application in C++')
          res.status(200).json({ error: false, message: 'Hello World', text })
        }
      }
    ]

    const middleware = [
      (_: Request, res: Response, next: any) => {
        res.setHeader('Content-Type', 'application/json')
        next()
      }
    ]

    const intelligence = new Intelligence({ key: process.env['OPENAI_API_KEY'] })
    brick = new ExpressBrick({ name: 'AI Express Brick', intelligence, port, routes, middleware, builtinMiddleware: { json: true, urlencoded: true } })
    expect(brick).toBeInstanceOf(ExpressBrick)
    const api = supertest(brick.express)

    await api.get('/').expect(200).expect('Content-Type', /json/)
      .expect((res) => {
        if (process.env['USE_OPENAI'] !== 'true') return true
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
})
