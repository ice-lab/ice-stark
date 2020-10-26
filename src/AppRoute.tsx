import * as React from 'react';
import Sandbox, { SandboxProps, SandboxContructor } from '@ice/sandbox';
import { AppHistory } from './appHistory';
import renderComponent from './util/renderComponent';
import { appendAssets, emptyAssets, cacheAssets, getEntryAssets, getUrlAssets } from './util/handleAssets';
import { setCache, getCache } from './util/cache';
import { callAppEnter, callAppLeave, cacheApp, isCached, AppLifeCycleEnum } from './util/appLifeCycle';
import { callCapturedEventListeners } from './util/capturedListeners';
import ModuleLoader from './util/umdLoader';

import isEqual = require('lodash.isequal');

interface AppRouteState {
  cssLoading: boolean;
  showComponent: boolean;
}

// "slash" - hashes like #/ and #/sunshine/lollipops
// "noslash" - hashes like # and #sunshine/lollipops
// "hashbang" - “ajax crawlable” (deprecated by Google) hashes like #!/ and #!/sunshine/lollipops
type hashType = 'hashbang' | 'noslash' | 'slash';

interface Match<Params extends { [K in keyof Params]?: string } = {}> {
  params: Params;
  isExact: boolean;
  path: string;
  url: string;
}

interface Location<Query extends { [K in keyof Query]?: string } = {}> {
  pathname: string;
  query: Query;
  hash: string;
}

export interface AppRouteComponentProps<Params extends { [K in keyof Params]?: string } = {}> {
  match: Match<Params>;
  location: Location;
  history: AppHistory;
}

export interface PathData {
  value: string;
  exact?: boolean;
  strict?: boolean;
  sensitive?: boolean;
}

// from user config
export interface AppConfig {
  sandbox?: boolean | SandboxProps | SandboxContructor;
  title?: string;
  hashType?: boolean | hashType;
  basename?: string;
  exact?: boolean;
  strict?: boolean;
  sensitive?: boolean;
  rootId?: string;
  path: string | (string | PathData)[];
  url?: string | string[];
  entry?: string;
  entryContent?: string;
  component?: React.ReactElement;
  render?: (props?: AppRouteComponentProps) => React.ReactElement;
  cache?: boolean;
  umd?: boolean; // mark if sub-application is an umd module
  name?: string; // used to mark a umd module, recommaded config it as same as webpack.output.library
  customProps?: object; // custom props passed from framework app to sub app
}

// from AppRouter
export interface AppRouteProps extends AppConfig {
  onAppEnter?: (appConfig: AppConfig) => void;
  onAppLeave?: (appConfig: AppConfig) => void;
  triggerLoading?: (loading: boolean) => void;
  triggerError?: (err: string) => void;
  shouldAssetsRemove?: (
    assetUrl?: string,
    element?: HTMLElement | HTMLLinkElement | HTMLStyleElement | HTMLScriptElement,
  ) => boolean;
  componentProps?: AppRouteComponentProps;
  clearCacheRoot?: () => void;
  moduleLoader?: ModuleLoader;
}

export function converArray2String(list: string | (string | PathData)[]) {
  if (Array.isArray(list)) {
    return list.map((item) => {
      if (Object.prototype.toString.call(item) === '[object Object]') {
        return Object.keys(item).map((key) => `${key}:${item[key]}`).join(',');
      }
      return item;
    }).join(',');
  }

  return String(list);
}

/**
 * Get app config from AppRoute props
 */
function getAppConfig(appRouteProps: AppRouteProps): AppConfig {
  const appConfig: AppConfig = { path: '' };
  const uselessList = ['onAppEnter', 'onAppLeave', 'triggerLoading', 'triggerError'];

  Object.keys(appRouteProps).forEach(key => {
    if (uselessList.indexOf(key) === -1) {
      appConfig[key] = appRouteProps[key];
    }
  });

  return appConfig;
}

export default class AppRoute extends React.Component<AppRouteProps, AppRouteState> {
  state = {
    cssLoading: false,
    showComponent: false,
  };

  private myRefBase: HTMLDivElement = null;

  private appSandbox: Sandbox;

  private unmounted: boolean = false;

  private prevAppConfig: AppConfig = null;

  private rootElement: HTMLElement;

  static defaultProps = {
    exact: false,
    strict: false,
    sensitive: false,
    sandbox: false,
    rootId: 'icestarkNode',
    shouldAssetsRemove: () => true,
  };

  componentDidMount() {
    this.renderChild();
  }

  shouldComponentUpdate(nextProps, nextState) {
    const { path, url, title, rootId, componentProps } = this.props;
    const { cssLoading, showComponent } = this.state;
    // re-render and callCapturedEventListeners if componentProps is changed
    if ((nextProps.component || nextProps.render && typeof nextProps.render === 'function') &&
      !isEqual(componentProps, nextProps.componentProps)) {
      callCapturedEventListeners();
      return true;
    } else if (
      converArray2String(path) === converArray2String(nextProps.path) &&
      converArray2String(url) === converArray2String(nextProps.url) &&
      title === nextProps.title &&
      rootId === nextProps.rootId &&
      cssLoading === nextState.cssLoading &&
      showComponent === nextState.showComponent
    ) {
      // reRender is triggered by sub-application router / browser, call popStateListeners
      callCapturedEventListeners();
      return false;
    }
    return true;
  }

  componentDidUpdate(prevProps) {
    const { path, url, title, rootId } = this.props;

    if (
      converArray2String(path) !== converArray2String(prevProps.path) ||
      converArray2String(url) !== converArray2String(prevProps.url) ||
      title !== prevProps.title ||
      rootId !== prevProps.rootId
    ) {
      this.renderChild();
    }
  }

  componentWillUnmount() {
    // Empty useless assets before unmount
    const { shouldAssetsRemove, cache, clearCacheRoot } = this.props;
    if (cache) {
      cacheAssets(this.getCacheKey());
    }
    // empty cached assets if cache is false
    emptyAssets(shouldAssetsRemove, !cache && this.getCacheKey());
    this.triggerPrevAppLeave();
    this.unmounted = true;
    clearCacheRoot();
  }

  /**
   * get cache key
   */
  getCacheKey = (appConfig?: AppConfig) => {
    const { path } = appConfig || this.props;
    // use path as cache key
    return converArray2String(path);
  }

  /**
   * Load assets and render sub-application
   */
  renderChild = (): void => {
    const { rootId, component, render } = this.props;

    // cache prev app asset before load next app
    if (this.prevAppConfig && this.prevAppConfig.cache) {
      cacheAssets(this.getCacheKey(this.prevAppConfig));
    }

    // if component / render exists,
    // set showComponent to confirm capturedEventListeners triggered at the right time
    if (component || (render && typeof render === 'function')) {
      this.triggerPrevAppLeave();

      this.triggerOnAppEnter();

      this.setState({ showComponent: true });
      return;
    }

    const myBase: HTMLElement = this.myRefBase;
    if (!myBase) return;

    this.triggerPrevAppLeave();

    // reCreate rootElement to remove sub-application instance,
    // rootElement is created for render sub-application
    this.rootElement = this.reCreateElementInBase(rootId);

    setCache('root', this.rootElement);

    this.loadNextApp();
  };

  loadNextApp = async () => {
    const {
      url,
      entry,
      entryContent,
      title,
      triggerLoading,
      triggerError,
      shouldAssetsRemove,
      cache,
      sandbox,
      path,
      umd,
      name,
      customProps,
    } = this.props;
    // set loadMode when load micro app
    if (umd) {
      setCache('loadMode', 'umd');
    } else {
      setCache('loadMode', sandbox ? 'script' : 'sandbox');
    }
    if (sandbox) {
      if (typeof sandbox === 'function') {
        // eslint-disable-next-line new-cap
        this.appSandbox = new sandbox();
      } else {
        const sandboxProps = typeof sandbox === 'boolean' ? {} : (sandbox as SandboxProps);
        this.appSandbox = new Sandbox(sandboxProps);
      }
    }
    const assetsCacheKey = this.getCacheKey();
    const cached = cache && isCached(assetsCacheKey);
    // empty useless assets before loading
    emptyAssets(shouldAssetsRemove, !cached && assetsCacheKey);

    if (title) document.title = title;

    const handleLoading = (loading: boolean): void => {
      // if AppRoute is unmounted, cancel all operations
      if (this.unmounted) return;

      const { cssLoading } = this.state;
      if (loading !== cssLoading) {
        this.setState({ cssLoading: loading, showComponent: false });
        triggerLoading(loading);
      }
    };

    const handleError = (errMessage: string): void => {
      // if AppRoute is unmounted, cancel all operations
      if (this.unmounted) return;

      handleLoading(false);
      triggerError(errMessage);
    };

    // trigger loading before handleAssets
    !cached && handleLoading(true);

    const currentAppConfig: AppConfig = this.triggerOnAppEnter();
    try {
      let appAssets = null;
      if (entry || entryContent) {
        // entry for fetch -> process -> append
        appAssets = await getEntryAssets({
          root: this.rootElement,
          entry,
          href: location.href,
          entryContent,
          assetsCacheKey,
        });
      } else if (url){
        const urls = Array.isArray(url) ? url : [url];
        appAssets = getUrlAssets(urls);
      }
      if (appAssets && !cached) {
        await appendAssets(appAssets, name || assetsCacheKey, umd, this.appSandbox);
      }
      // if AppRoute is unmounted, or current app is not the latest app, cancel all operations
      if (this.unmounted || this.prevAppConfig !== currentAppConfig) return;
      if (cache) {
        // cache app lifecycle after load assets
        cacheApp(assetsCacheKey);
      }

      if (!getCache(AppLifeCycleEnum.AppEnter)) {
        console.warn('[icestark] please trigger app mount manually via registerAppEnter, app path: ', path);
      }
      if (!getCache(AppLifeCycleEnum.AppLeave)) {
        console.warn('[icestark] please trigger app unmount manually via registerAppLeave, app path: ', path);
      }
      // trigger sub-application render
      callAppEnter({ container: this.rootElement, customProps });

      // cancel loading after handleAssets
      handleLoading(false);
    } catch (error) {
      handleError(error.message);
    }
  };

  reCreateElementInBase = (elementId: string): HTMLElement => {
    const myBase = this.myRefBase;
    if (!myBase) return;

    // remove all elements in base
    myBase.innerHTML = '';

    // create new rootElement
    const element = document.createElement('div');
    element.id = elementId;
    myBase.appendChild(element);
    return element;
  };

  /**
   * Trigger onAppLeave in AppRouter and callAppLeave(registerAppLeave callback)
   * reset this.prevAppConfig
   */
  triggerPrevAppLeave = (): void => {
    const { onAppLeave, triggerLoading, customProps } = this.props;
    if (this.appSandbox) {
      this.appSandbox.clear();
      this.appSandbox = null;
    }
    // trigger onAppLeave
    const prevAppConfig = this.prevAppConfig;

    if (prevAppConfig) {
      if (typeof onAppLeave === 'function') onAppLeave(prevAppConfig);
      this.prevAppConfig = null;
    }
    // reset loading state when leave app
    triggerLoading(false);
    callAppLeave({ customProps, container: this.rootElement });
  };

  /**
   * Trigger onAppEnter in AppRouter
   * callAppEnter(registerAppEnter callback) will be triggered later
   * record current appConfig as this.prevAppConfig
   */
  triggerOnAppEnter = (): AppConfig => {
    const { onAppEnter } = this.props;

    const currentAppConfig = getAppConfig(this.props);
    this.prevAppConfig = currentAppConfig;

    // trigger onAppEnter
    if (typeof onAppEnter === 'function') onAppEnter(currentAppConfig);

    return currentAppConfig;
  };

  render() {
    const { component, render, componentProps } = this.props;
    const { cssLoading, showComponent } = this.state;

    if (component) {
      return showComponent ? renderComponent(component, componentProps) : null;
    }

    if (render && typeof render === 'function') {
      return showComponent ? render(componentProps) : null;
    }

    return (
      <div
        ref={element => {
          this.myRefBase = element;
        }}
        className={cssLoading ? 'ice-stark-loading' : 'ice-stark-loaded'}
      />
    );
  }
}
