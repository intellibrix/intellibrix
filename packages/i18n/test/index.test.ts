import { describe, expect, it } from 'vitest'
import I18nBrick from '../src/index.js'

describe('Internationalization Brick', () => {
  it('should be able to print in different languages', () => {
    const brick = new I18nBrick({
      defaultLanguage: 'en',
      resources: {
        es: {
          translation: {
            Hello: 'Hola',
            World: 'Mundo',
          },
        },
      },
    })

    brick.language = 'es'
    const result = `${brick.t('Hello')} ${brick.t('World')}`
    expect(result).toBe('Hola Mundo')
    brick.language = 'en'
    expect(brick.t('Hello')).toBe('Hello')
  })
})

describe('instance scoping', () => {
  const resources = {
    en: { translation: { Hello: 'Hello' } },
    es: { translation: { Hello: 'Hola' } },
    fr: { translation: { Hello: 'Bonjour' } },
  }

  it('does not leak language state between concurrent instances', () => {
    const a = new I18nBrick({ defaultLanguage: 'es', resources, logLevel: 'fatal' })
    const b = new I18nBrick({ defaultLanguage: 'fr', resources, logLevel: 'fatal' })
    expect(a.t('Hello')).toBe('Hola')
    expect(b.t('Hello')).toBe('Bonjour')
    a.language = 'en'
    expect(a.t('Hello')).toBe('Hello')
    expect(b.t('Hello')).toBe('Bonjour')
    expect(b.language).toBe('fr')
    expect(a.i18next).not.toBe(b.i18next)
  })

  it('create() awaits initialization', async () => {
    const brick = await I18nBrick.create({ defaultLanguage: 'es', resources, logLevel: 'fatal' })
    expect(brick.get('Hello')).toBe('Hola')
  })
})
