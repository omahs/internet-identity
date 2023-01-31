import { I18n as BaseI18n } from "./utils/i18n";

const supportedLanguages = ["en"] as const;

export type SupportedLanguage = typeof supportedLanguages[number];

export class I18n extends BaseI18n<SupportedLanguage> {
  constructor() {
    super("en");
  }
}
