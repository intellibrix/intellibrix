import i18next, { type i18n, type TFunction } from 'i18next'
import { Brick, type BrickOptions } from 'intellibrix'

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
 * @example
 * const brick = new I18nBrick({ resources: { es: { translation: { 'Hello': 'Hola' } } } })
 * brick.language = 'es'
 * console.log(brick.t('Hello')) // 'Hola'
 */
export default class I18nBrick extends Brick {
  /** This brick's own i18next instance (never the global singleton). */
  i18next: i18n
  /** The translation function, bound to this brick's instance. */
  t: TFunction

  /**
   * Creates a new I18n Brick. Initialization is synchronous for inline
   * `resources`; use {@link I18nBrick.create} when the options pull in an async
   * backend and you need to await readiness.
   * @param options - The options for the I18n Brick.
   */
  constructor(options: I18nBrickOptions = { resources: { en: { translation: {} } } }) {
    super(options)

    this.i18next = i18next.createInstance()
    this.initPromise = this.i18next.init(I18nBrick.i18nextOptions(options))
    this.t = this.i18next.t.bind(this.i18next)
  }

  /** Resolves once i18next has finished initializing. */
  readonly initPromise: Promise<TFunction>

  /** Creates a brick and waits for i18next initialization to finish. */
  static async create(options?: I18nBrickOptions): Promise<I18nBrick> {
    const brick = new I18nBrick(options)
    await brick.initPromise
    return brick
  }

  private static i18nextOptions(options: I18nBrickOptions) {
    const { defaultLanguage, debug, resources } = options
    return {
      lng: defaultLanguage || 'en',
      fallbackLng: 'en',
      debug,
      resources,
      // Inline resources load synchronously, so `t()` works right after construction.
      initImmediate: false,
    }
  }

  /**
   * Gets the languages supported by the I18n Brick.
   */
  get languages() {
    return this.i18next.languages
  }

  /**
   * Gets the current language of the I18n Brick.
   */
  get language() {
    return this.i18next.language
  }

  /**
   * Sets the current language of the I18n Brick.
   */
  set language(language) {
    void this.i18next.changeLanguage(language)
  }

  /**
   * Translates text using the current language.
   * @param text - The text to translate.
   */
  get(text: string) {
    return this.i18next.t(text)
  }
}
