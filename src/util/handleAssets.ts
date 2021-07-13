/* eslint-disable no-param-reassign */
import * as urlParse from 'url-parse';
import Sandbox, { SandboxProps, SandboxConstructor } from '@ice/sandbox';
import { PREFIX, DYNAMIC, STATIC, IS_CSS_REGEX } from './constant';
import { warn, error } from './message';
import { toArray, isDev, formatMessage, builtInScriptAttributesMap, looseBoolean2Boolean } from './helpers';
import { Fetch, defaultFetch } from '../start';
import type { ScriptAttributes } from '../apps';

const COMMENT_REGEX = /<!--.*?-->/g;

const EMPTY_STRING = '';
const STYLESHEET_LINK_TYPE = 'stylesheet';

const cachedScriptsContent: object = {};
const cachedStyleContent: object = {};

export enum AssetTypeEnum {
  INLINE = 'inline',
  EXTERNAL = 'external',
}

export enum AssetCommentEnum {
  REPLACED = 'replaced',
  PROCESSED = 'processed',
}

export interface Asset {
  type: AssetTypeEnum;
  content: string;
}

export interface ProcessedContent {
  html: HTMLElement;
  assets: Assets;
}

export interface Assets {
  jsList: Asset[];
  cssList: Asset[];
}

export interface ParsedConfig {
  origin: string;
  pathname: string;
}

// Lifecycle Props
export interface ILifecycleProps {
  container: HTMLElement;
  customProps?: object;
}

/**
 * Create link/style element and append to root
 */
export function appendCSS(
  root: HTMLElement | ShadowRoot,
  asset: string | Asset,
  id: string,
): Promise<string> {
  return new Promise<string>(async (resolve, reject) => {
    const { type, content } = (asset as Asset);
    if (!root) reject(new Error(`no root element for css assert: ${content || asset}`));

    if (type && type === AssetTypeEnum.INLINE) {
      const styleElement: HTMLStyleElement = document.createElement('style');
      styleElement.innerHTML = content;
      root.appendChild(styleElement);
      resolve();
      return;
    }

    /**
     * if external resource is cached by prefetch, use cached content instead.
     * For cachedStyleContent may fail to fetch (cors, and so on)，recover to original way
     */
    let useExternalLink = true;
    if (type && type === AssetTypeEnum.EXTERNAL && cachedStyleContent[content]) {
      try {
        const styleElement: HTMLStyleElement = document.createElement('style');
        styleElement.innerHTML = await cachedStyleContent[content];
        root.appendChild(styleElement);
        useExternalLink = false;
        resolve();
      } catch (e) {
        useExternalLink = true;
      }
    }

    if (useExternalLink) {
      const element: HTMLLinkElement = document.createElement('link');
      element.setAttribute(PREFIX, DYNAMIC);
      element.id = id;
      element.rel = 'stylesheet';
      element.href = content || (asset as string);

      element.addEventListener(
        'error',
        () => {
          error(`css asset loaded error: ${content || asset}`);
          return resolve();
        },
        false,
      );
      element.addEventListener('load', () => resolve(), false);

      root.appendChild(element);
    }

  });
}

/**
 * append custom attribute for element
 */
function setAttributeForScriptNode (element: HTMLScriptElement, {
  id,
  src,
  scriptAttributes,
}: { id: string; src: string; scriptAttributes: ScriptAttributes }) {
  /*
  * stamped by icestark for recycle when needed.
  */
  element.setAttribute(PREFIX, DYNAMIC);
  element.id = id;


  element.type = 'text/javascript';
  element.src = src;

  /*
  * `async=false` is required to make sure all js resources execute sequentially.
   */
  element.async = false;

  /*
  * `type` is not allowed to set currently.
  */
  const unableReachedAttributes = [PREFIX, 'id', 'type', 'src', 'async'];

  const attrs = typeof (scriptAttributes) === 'function'
    ? scriptAttributes(src)
    : scriptAttributes;

  if (!Array.isArray(attrs)) {
    isDev && (
      console.warn(formatMessage('scriptAttributes should be Array or Function that returns Array.'))
    );
    return;
  }

  attrs.forEach(attr => {
    const [attrKey, attrValue] = attr.split('=');
    if (unableReachedAttributes.includes(attrKey)) {
      (isDev ? console.warn : console.log)(formatMessage(`${attrKey} will be ignored by icestark.`));
      return;
    }

    if (builtInScriptAttributesMap.has(attrKey)) {
      /*
      * built in attribute like ["crossorigin=use-credentials"]、["nomodule"] should be set as follow:
      * script.crossOrigin = 'use-credentials';
      * script.noModule = true;
      */
      const nonLooseBooleanAttrValue = looseBoolean2Boolean(attrValue);
      element[builtInScriptAttributesMap.get(attrKey)] = nonLooseBooleanAttrValue === undefined || nonLooseBooleanAttrValue;
    } else {
      /*
      * none built in attribute added by `setAttribute`
      */
      element.setAttribute(attrKey, attrValue);
    }
  });

}

/**
 * Create script element (without inline) and append to root
 */
export function appendExternalScript(
  root: HTMLElement | ShadowRoot,
  asset: string | Asset,
  scriptAttributes: ScriptAttributes,
  id: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const { type, content } = (asset as Asset);
    if (!root) reject(new Error(`no root element for js assert: ${content || asset}`));

    const element: HTMLScriptElement = document.createElement('script');
    // inline script
    if (type && type  === AssetTypeEnum.INLINE) {
      element.innerHTML = content;
      root.appendChild(element);
      resolve();
      return;
    }
    setAttributeForScriptNode(element, {
      id,
      src: content ||(asset as string),
      scriptAttributes,
    });

    element.addEventListener(
      'error',
      () => reject(new Error(`js asset loaded error: ${content || asset}`)),
      false,
    );
    element.addEventListener('load', () => resolve(), false);

    root.appendChild(element);
  });
}

export function getUrlAssets(urls: string | string[]) {
  const jsList = [];
  const cssList = [];

  toArray(urls).forEach(url => {
    // //icestark.com/index.css -> true
    // //icestark.com/index.css?timeSamp=1575443657834 -> true
    // //icestark.com/index.css?query=test.js -> false
    const isCss: boolean = IS_CSS_REGEX.test(url);
    const assest: Asset = {
      type: AssetTypeEnum.EXTERNAL,
      content: url,
    };
    if (isCss) {
      cssList.push(assest);
    } else {
      jsList.push(assest);
    }
  });

  return { jsList, cssList };
}

export function fetchScripts(jsList: Asset[], fetch = defaultFetch ) {
  return Promise.all(jsList.map((asset) => {
    const { type, content } = asset;
    if (type === AssetTypeEnum.INLINE) {
      return content;
    } else {
      // content will script url when type is AssetTypeEnum.EXTERNAL
      return cachedScriptsContent[content]
        /*
        * If code is being evaluated as a string with `eval` or via `new Function`，then the source origin
        * will be the page's origin. As a result, `//# sourceURL` appends to the generated code.
        * See https://sourcemaps.info/spec.html
        */
        || (cachedScriptsContent[content] = fetch(content)
          .then(res => res.text())
          .then(res => `${res} \n //# sourceURL=${content}`)
        );
    }
  }));
}

// for prefetch
export function fetchStyles(cssList: Asset[], fetch = defaultFetch) {
  return Promise.all(
    cssList.map((asset) => {
      const { type, content} = asset;
      if (type === AssetTypeEnum.INLINE) {
        return content;
      }
      return cachedStyleContent[content] || (cachedStyleContent[content] = fetch(content).then(res => res.text()));
    })
  );
}

export function parseUrl(entry: string): ParsedConfig {
  const { origin, pathname } = urlParse(entry);
  return {
    origin,
    pathname,
  };
}

export function startWith(url: string, prefix: string): boolean {
  return url.slice(0, prefix.length) === prefix;
}

export function getUrl(entry: string, relativePath: string): string {
  const { origin, pathname } = parseUrl(entry);

  // https://icestark.com/ice/index.html + ./js/index.js -> https://icestark.com/ice/js/index.js
  if (startWith(relativePath, './')) {
    const rPath = relativePath.slice(1);

    if (!pathname || pathname === '/') {
      return `${origin}${rPath}`;
    }

    const pathArr = pathname.split('/');
    pathArr.splice(-1);
    return `${origin}${pathArr.join('/')}${rPath}`;
  } else if (startWith(relativePath, '/')) {
    // https://icestark.com/ice/index.html + /js/index.js -> https://icestark.com/js/index.js
    return `${origin}${relativePath}`;
  } else {
    // https://icestark.com + js/index.js -> https://icestark.com/js/index.js
    return `${origin}/${relativePath}`;
  }
}

/**
 * If script/link processed by @ice/stark, add comment for it
 */
export function getComment(tag: string, from: string, type: AssetCommentEnum): string {
  return `${tag} ${from} ${type} by @ice/stark`;
}

/**
 * check if link is absolute url
 * @param url
 */
export function isAbsoluteUrl(url: string): boolean {
  return (/^(https?:)?\/\/.+/).test(url);
}


export function replaceNodeWithComment(node: HTMLElement, comment: string): void {
  if (node?.parentNode) {
    const commentNode = document.createComment(comment);
    node.parentNode.appendChild(commentNode);
    node.parentNode.removeChild(node);
  }
}

/**
 * html -> { html: processedHtml, assets: processedAssets }
 */
export function processHtml(html: string, entry?: string): ProcessedContent {
  if (!html) return { html: document.createElement('div'), assets: { cssList:[], jsList: []} };

  const domContent = (new DOMParser()).parseFromString(html.replace(COMMENT_REGEX, ''), 'text/html');

  if (entry) {
    // add base URI for absolute resource. see more https://developer.mozilla.org/en-US/docs/Web/HTML/Element/base
    const base = document.createElement('base');
    base.href = entry;
    domContent.getElementsByTagName('head')[0].appendChild(base);
  }

  // process js assets
  const scripts = Array.from(domContent.getElementsByTagName('script'));
  const processedJSAssets = scripts.map(script => {
    const inlineScript = script.src === EMPTY_STRING;

    const externalSrc = !inlineScript && (isAbsoluteUrl(script.src) ? script.src : getUrl(entry, script.src));

    const commentType = inlineScript ? AssetCommentEnum.PROCESSED : AssetCommentEnum.REPLACED;
    replaceNodeWithComment(script, getComment('script', inlineScript ? 'inline' : script.src, commentType));

    return {
      type: inlineScript ? AssetTypeEnum.INLINE : AssetTypeEnum.EXTERNAL,
      content: inlineScript ? script.text : externalSrc,
    };
  });

  // process css assets
  const inlineStyleSheets = Array.from(domContent.getElementsByTagName('style'));
  const externalStyleSheets = Array.from(domContent.getElementsByTagName('link'))
    .filter(link => !link.rel || link.rel.includes(STYLESHEET_LINK_TYPE));

  const processedCSSAssets = [
    ...inlineStyleSheets
      .map(sheet => {
        replaceNodeWithComment(sheet, getComment('style', 'inline', AssetCommentEnum.REPLACED));
        return {
          type: AssetTypeEnum.INLINE,
          content: sheet.innerText,
        };
      }),
    ...externalStyleSheets
      .map((sheet) => {
        replaceNodeWithComment(sheet, getComment('link', sheet.href, AssetCommentEnum.PROCESSED));
        return {
          type: AssetTypeEnum.EXTERNAL,
          content: isAbsoluteUrl(sheet.href) ? sheet.href : getUrl(entry, sheet.href),
        };
      }),
  ];

  if (entry) {
    // remove base node
    const baseNode = domContent.getElementsByTagName('base')[0];
    baseNode?.parentNode.removeChild(baseNode);
  }

  return {
    html: domContent.getElementsByTagName('html')[0],
    assets: {
      jsList: processedJSAssets,
      cssList: processedCSSAssets,
    },
  };
}

const cachedProcessedContent: object = {};

export async function getEntryAssets({
  root,
  entry,
  entryContent,
  assetsCacheKey,
  href = location.href,
  fetch = defaultFetch,
}: {
  root?: HTMLElement | ShadowRoot;
  entry?: string;
  entryContent?: string;
  assetsCacheKey: string;
  href?: string;
  fetch?: Fetch;
  assertsCached?: boolean;
}) {
  let cachedContent = cachedProcessedContent[assetsCacheKey];
  if (!cachedContent) {
    let htmlContent = entryContent;
    if (!htmlContent && entry) {
      if (!fetch) {
        warn('Current environment does not support window.fetch, please use custom fetch');
        throw new Error(
          `fetch ${entry} error: Current environment does not support window.fetch, please use custom fetch`,
        );
      }

      const res = await fetch(entry);
      htmlContent = await res.text();
    }
    cachedContent = processHtml(htmlContent, entry || href);
    cachedProcessedContent[assetsCacheKey] = cachedContent;
  }

  const { html } = cachedContent;

  if (root) {
    root.appendChild(html);
  }

  return cachedContent.assets;
}

export function getAssetsNode(): (HTMLStyleElement|HTMLScriptElement)[] {
  let nodeList = [];
  ['style', 'link', 'script'].forEach((tagName) => {
    nodeList = [...nodeList, ...Array.from(document.getElementsByTagName(tagName))];
  });
  return nodeList;
}

/**
 * Record static assets
 */
export function recordAssets(): void {
  // getElementsByTagName is faster than querySelectorAll
  const assetsList = getAssetsNode();
  assetsList.forEach((assetsNode) => {
    setStaticAttribute(assetsNode);
  });
}

/**
 * If `PREFIX` is setted in `DYNAMIC` type, remain it
 */
export function setStaticAttribute(tag: HTMLStyleElement | HTMLScriptElement): void {
  if (tag.getAttribute(PREFIX) !== DYNAMIC) {
    tag.setAttribute(PREFIX, STATIC);
  }
  tag = null;
}

/**
 * Empty useless assets
 */
export function emptyAssets(
  shouldRemove: (
    assetUrl: string,
    element?: HTMLElement | HTMLLinkElement | HTMLStyleElement | HTMLScriptElement,
  ) => boolean,
  cacheKey: string|boolean,
): void {
  // remove extra assets
  const styleList: NodeListOf<HTMLElement> = document.querySelectorAll(
    `style:not([${PREFIX}=${STATIC}])`,
  );
  styleList.forEach(style => {
    if (shouldRemove(null, style) && checkCacheKey(style, cacheKey)) {
      style.parentNode.removeChild(style);
    }
  });

  const linkList: NodeListOf<HTMLElement> = document.querySelectorAll(
    `link:not([${PREFIX}=${STATIC}])`,
  );
  linkList.forEach(link => {
    if (shouldRemove(link.getAttribute('href'), link) && checkCacheKey(link, cacheKey)) {
      link.parentNode.removeChild(link);
    }
  });

  const jsExtraList: NodeListOf<HTMLElement> = document.querySelectorAll(
    `script:not([${PREFIX}=${STATIC}])`,
  );
  jsExtraList.forEach(js => {
    if (shouldRemove(js.getAttribute('src'), js) && checkCacheKey(js, cacheKey)) {
      js.parentNode.removeChild(js);
    }
  });
}

export function checkCacheKey(node: HTMLElement | HTMLLinkElement | HTMLStyleElement | HTMLScriptElement, cacheKey: string|boolean) {
  return (typeof cacheKey === 'boolean' &&  cacheKey)
    || !node.getAttribute('cache')
    || node.getAttribute('cache') === cacheKey;
}

/**
 * cache all assets loaded by current sub-application
 */
export function cacheAssets(cacheKey: string): void {
  const assetsList = getAssetsNode();
  assetsList.forEach((assetsNode) => {
    // set cache key if asset attributes without prefix=static and cache
    if (assetsNode.getAttribute(PREFIX) !== STATIC && !assetsNode.getAttribute('cache')) {
      assetsNode.setAttribute('cache', cacheKey);
    }
  });
}

/**
 * load and append css assets
 *
 * @export
 * @param {Assets} assets
 */
export async function loadAndAppendCssAssets(assets: Assets) {
  const cssRoot: HTMLElement = document.getElementsByTagName('head')[0];

  const { cssList } = assets;

  // load css content
  await Promise.all(
    cssList.map((asset, index) => appendCSS(cssRoot, asset, `${PREFIX}-css-${index}`)),
  );
}

/**
 * load and append js assets, compatible with v1
 *
 * @export
 * @param {Assets} assets
 * @param {Sandbox} [sandbox]
 * @returns
 */
export async function loadAndAppendJsAssets(
  assets: Assets,
  {
    sandbox,
    fetch = defaultFetch,
    scriptAttributes = [],
  }: {
    sandbox?: Sandbox;
    fetch?: Fetch;
    scriptAttributes?: ScriptAttributes;
  }) {
  const jsRoot: HTMLElement = document.getElementsByTagName('head')[0];

  const { jsList } = assets;

  // handle scripts
  if (sandbox && !sandbox.sandboxDisabled) {
    const jsContents = await fetchScripts(jsList, fetch);
    // excute code by order
    jsContents.forEach(script => {
      sandbox.execScriptInSandbox(script);
    });
    return;
  }

  // dispose inline script
  const hasInlineScript = jsList.find((asset) => asset.type === AssetTypeEnum.INLINE);
  if (hasInlineScript) {
    // make sure js assets loaded in order if has inline scripts
    await jsList.reduce((chain, asset, index) => {
      return chain.then(() => appendExternalScript(jsRoot, asset, scriptAttributes, `${PREFIX}-js-${index}`));
    }, Promise.resolve());
    return;
  }

  await Promise.all(
    jsList.map((asset, index) => appendExternalScript(jsRoot, asset, scriptAttributes, `${PREFIX}-js-${index}`)),
  );
}

export function createSandbox(sandbox?: boolean | SandboxProps | SandboxConstructor) {
  // Create appSandbox if sandbox is active
  let appSandbox = null;
  if (sandbox) {
    if (typeof sandbox === 'function') {
      // eslint-disable-next-line new-cap
      appSandbox = new sandbox();
    } else {
      const sandboxProps = typeof sandbox === 'boolean' ? {} : (sandbox as SandboxProps);
      appSandbox = new Sandbox(sandboxProps);
    }
  }
  return appSandbox;
}
