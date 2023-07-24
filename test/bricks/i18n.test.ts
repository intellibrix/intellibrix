import I18nBrick from '../../src/bricks/i18n'

describe('Internationalization Brick', () => {
  it('should be able to print in different languages', () => {
    const brick = new I18nBrick({
      defaultLanguage: 'en',
      resources: {
        es: {
          translation: {
            'Hello': 'Hola',
            'World': 'Mundo'
          }
        }
      }
    })

    brick.language = 'es'
    const result = `${brick.t('Hello')} ${brick.t('World')}`
    expect(result).toBe('Hola Mundo')
    brick.language = 'en'
    expect(brick.t('Hello')).toBe('Hello')
  })
})
