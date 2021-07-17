/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/camelcase */
type Scope = unknown;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Factory = () => any;

interface Json<T> {
  [index: string]: T;
}

export interface ModuleOptions {
  entry: string;
  app: string;
  module: string;
};

interface Container {
  init(shareScope: Scope): void;
  get(module: string): Factory;
};

declare const __webpack_init_sharing__: (shareScope: Scope) => Promise<void>;
declare const __webpack_share_scopes__: { default: Scope };

/**
 * CustomEvent Polyfill for IE.
 * See https://gist.github.com/gt3/787767e8cbf0451716a189cdcb2a0d08.
 */
(function() {
  if (typeof (window as any).CustomEvent === 'function') return false;

  function CustomEvent(event, params) {
    params = params || { bubbles: false, cancelable: false, detail: null };
    const evt = document.createEvent('CustomEvent');
    evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
    return evt;
  }

  (window as any).CustomEvent = CustomEvent;
})();

const entryMap: Json<'LOADING' | 'LOAD_ERROR' | 'LOADED'> = {};

/**
 *
 * used for load remote entry.
 */
async function loadEntry (entry: string, root = document.body): Promise<void> {
  if (entryMap[entry] === 'LOADING') {
    // @ts-ignore
    await new Promise(resolve => window.addEventListener(entry, resolve));
  }

  return new Promise<void>(async (resolve, reject) => {
    if (entryMap[entry] === 'LOADED') {
      resolve();
      return;
    }

    entryMap[entry] = 'LOADING';

    const element: HTMLScriptElement = document.createElement('script');

    element.setAttribute('icestark', 'dynamic');
    element.type = 'text/javascript';
    element.src = entry;
    element.async = false;

    element.onerror = () => {
      window.dispatchEvent(new CustomEvent(entry, { detail: { state: 'LOAD_ERROR' }}));
      reject(new Error(`remote entry loaded error: ${entry}`));
    };

    element.onload = () => {
      window.dispatchEvent(new CustomEvent(entry, { detail: { state: 'LOADED' }}));
      entryMap[entry] = 'LOADED';
      resolve();
    };

    root.append(element);
  });
}

/**
 * lookup remote module
 */
async function loadFederatedModule (app: string, module: string, shareScope: Scope = 'default') {
  // initializes the share scope.
  await __webpack_init_sharing__(shareScope);

  // get the container from `window`.
  const container = window[app] as Container;

  //
  await container.init(__webpack_share_scopes__.default);

  const factory = await container.get(module);
  const Module = factory();
  return Module;
}

export function loadModule(options: ModuleOptions): Promise<void> {
  const { app, module, entry } = options;
  // FIXME: should cache modules already loaded

  return loadEntry(entry)
    .then(() => loadFederatedModule(app, module));
}
