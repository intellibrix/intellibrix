import Brick, { BrickOptions } from '../brick'
import i18next from 'i18next'

/**
 * Interface representing the options for the I18nBrick.
 * It extends from {@link BrickOptions}.
 */
export interface I18nBrickOptions extends BrickOptions {
  /** The default language for the I18nBrick. @default en */
  defaultLanguage?: string
  /** A flag indicating whether to enable debug mode. */
  debug?: boolean
  /** The resources for the I18nBrick, organized by language and translation key. */
  resources: {
    [language: string]: {
      translation: {
        [key: string]: string
      }
    }
  }
}

/**
 * Class representing an I18n (Internationalization) Brick.
 * It extends from the {@link Brick} class.
 * 
 * @example const brick = new I18nBrick({ resources: { es: { translation: { 'Hello': 'Hola' } } } })
 */
export default class I18nBrick extends Brick {
  /** The i18next instance. */
  i18next: any
  /** The translation function. */
  t: (key: string, options?: any) => void

  /**
   * Creates a new I18n Brick.
   * @param options - The options for the I18n Brick.
   */
  constructor(options: I18nBrickOptions = { resources: { en: { translation: {} } } }) {
    super(options)

    const i18nextOptions = {
      lng: options.defaultLanguage || 'en',
      ...options
    }

    i18next.init(i18nextOptions)
    this.i18next = i18next
    this.t = i18next.t
  }

  /**
   * Gets the languages supported by the I18n Brick.
   */
  get languages() {
    return i18next.languages
  }

  /**
   * Gets the current language of the I18n Brick.
   */
  get language() {
    return i18next.language
  }

  /**
   * Sets the current language of the I18n Brick.
   */
  set language(language) {
    i18next.changeLanguage(language)
  }

  /**
   * Translates text using the current language.
   * @param text - The text to translate.
   */
  get(text: string) {
    return i18next.t(text)
  }
}
