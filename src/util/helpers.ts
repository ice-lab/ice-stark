export const isDev = process.env.NODE_ENV === 'development';

export const toArray = <T>(any: T | T[]): T[] => {
  return Array.isArray(any) ? any : [any];
};

export const formatMessage = (msg: string): string => {
  return `[icestark]: ${msg}`;
};


/*
  * all built in <script /> attributes referring to https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script
  */
export const builtInScriptAttributesMap = new Map<string, string>([
  ...['async', 'defer', 'integrity', 'nonce', 'referrerpolicy', 'src', 'type', 'autocapitalize', 'dir', 'draggable', 'hidden', 'id', 'lang', 'part', 'slot', 'spellcheck', 'style', 'title', 'translate']
    .map(item => ([item, item]) as [string, string]),
  ['crossorigin', 'crossOrigin'], ['nomodule', 'noModule'], ['contenteditable', 'contentEditable'], ['inputmode', 'inputMode'], ['tabindex', 'tabIndex'],
]);

export const looseBoolean2Boolean = (falsyBoolean: 'true' | 'false' | unknown): boolean | unknown => {
  if (falsyBoolean === 'false' || falsyBoolean === 'true') {
    return falsyBoolean !== 'false';
  }
  return falsyBoolean;
};

