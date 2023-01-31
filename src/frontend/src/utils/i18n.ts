/** A showcase for static pages. II pages are given a fake connection and loaded from here
 * just to give an idea of what they look like, and to speed up the development cycle when
 * working on HTML and CSS. */

import { TemplateResult, html } from "lit-html";
import { asyncReplace } from "lit-html/directives/async-replace.js";
import { Chan } from "./utils";


// The type of raw copy
type StringCopy<Keys extends string, Lang extends string> = {
  [key in Lang]: { [key in Keys]: string };
};

// The type of dynamic copy
type DynamicCopy<Keys extends string> = { [key in Keys]: TemplateResult };

/// Foo, bar, baz
export class I18n<Lang extends string> {
  private chan: Chan<Lang>;
  private lang: Lang;

  constructor(def: Lang) {
    this.chan = new Chan(def);
    this.lang = def;
  }

  i18n<Keys extends string>(copy: StringCopy<Keys, Lang>): DynamicCopy<Keys> {
    type DefaultCopy = StringCopy<Keys, Lang>[Lang];
    const defCopy: DefaultCopy = copy[this.lang];
    const keys: [Keys] = Object.keys(defCopy) as [Keys];

    const internationalized = keys.reduce((acc, k) => {
      const value: AsyncIterable<string> = this.chan.map((lang) => {
        return copy[lang][k];
      });

      acc[k] = html`${asyncReplace(value)}`;
      return acc;
    }, {} as DynamicCopy<Keys>);

    return internationalized;
  }

  setLanguage(lang: Lang) {
    this.chan.send(lang);
    this.lang = lang;
  }

  getLanguageAsync(): AsyncIterable<Lang> {
    return this.chan.map((x) => x);
  }
}
