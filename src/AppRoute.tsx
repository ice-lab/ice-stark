import * as React from 'react';
import { AppHistory } from './appHistory';
import { loadEntry, loadEntryContent, appendAssets, emptyAssets } from './util/handleAssets';
import { setCache, getCache } from './util/cache';
import { callAppEnter, callAppLeave } from './util/appLifeCycle';
import { callCapturedPopStateListeners } from './util/capturedListeners';

interface AppRouteState {
  cssLoading: boolean;
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

// from user config
export interface AppConfig {
  title?: string;
  useShadow?: boolean;
  hashType?: boolean | hashType;
  basename?: string;
  exact?: boolean;
  strict?: boolean;
  sensitive?: boolean;
  rootId?: string;
  path: string | string[];
  url?: string | string[];
  entry?: string;
  entryContent?: string;
  component?: React.ReactElement;
  render?: (props?: AppRouteComponentProps) => React.ReactElement;
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
}

export function converArray2String(list: string | string[]) {
  if (Array.isArray(list)) {
    return list.join(',');
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
  };

  private myRefBase: HTMLDivElement = null;

  private unmounted: boolean = false;

  private prevAppConfig: AppConfig = null;

  static defaultProps = {
    useShadow: false,
    exact: false,
    strict: false,
    sensitive: false,
    rootId: 'icestarkNode',
    shouldAssetsRemove: () => true,
  };

  componentDidMount() {
    setCache('root', null);
    this.renderChild();
  }

  shouldComponentUpdate(nextProps, nextState) {
    const { path, url, title, rootId, useShadow } = this.props;
    const { cssLoading } = this.state;

    if (
      converArray2String(path) === converArray2String(nextProps.path) &&
      converArray2String(url) === converArray2String(nextProps.url) &&
      title === nextProps.title &&
      rootId === nextProps.rootId &&
      useShadow === nextProps.useShadow &&
      cssLoading === nextState.cssLoading
    ) {
      // reRender is triggered by sub-application router / browser, call popStateListeners
      callCapturedPopStateListeners();
      return false;
    }
    return true;
  }

  componentDidUpdate(prevProps) {
    const { path, url, title, rootId, useShadow } = this.props;

    if (
      converArray2String(path) !== converArray2String(prevProps.path) ||
      converArray2String(url) !== converArray2String(prevProps.url) ||
      title !== prevProps.title ||
      rootId !== prevProps.rootId ||
      useShadow !== prevProps.useShadow
    ) {
      // record config for prev App
      this.prevAppConfig = getAppConfig(prevProps);

      this.renderChild();
    }
  }

  componentWillUnmount() {
    // Empty useless assets before unmount
    const { shouldAssetsRemove } = this.props;

    emptyAssets(shouldAssetsRemove);
    this.triggerPrevAppLeave();
    this.unmounted = true;
    setCache('root', null);
  }

  /**
   * Load assets and render sub-application
   */
  renderChild = (): void => {
    const { rootId, useShadow } = this.props;

    const myBase: HTMLElement = this.myRefBase;
    if (!myBase) return;

    this.triggerPrevAppLeave();

    // reCreate rootElement to remove sub-application instance,
    // rootElement is created for render sub-application
    let rootElement: any = this.reCreateElementInBase(rootId);

    // prevent duplicate creation of shadowRoot
    if (useShadow && !rootElement.shadowRoot) {
      rootElement = rootElement.attachShadow
        ? rootElement.attachShadow({ mode: 'open', delegatesFocus: false })
        : (rootElement as any).createShadowRoot();
    }

    setCache('root', rootElement);

    this.loadNextApp(useShadow);
  };

  loadNextApp = async (useShadow?: boolean) => {
    const {
      path,
      url,
      entry,
      entryContent,
      title,
      triggerLoading,
      triggerError,
      onAppEnter,
      shouldAssetsRemove,
    } = this.props;
    // empty useless assets before loading
    emptyAssets(shouldAssetsRemove);

    if (title) document.title = title;

    const handleLoading = (loading: boolean): void => {
      // if AppRoute is unmounted, cancel all operations
      if (this.unmounted) return;

      const { cssLoading } = this.state;
      if (loading !== cssLoading) {
        this.setState({ cssLoading: loading });
        typeof triggerLoading === 'function' && triggerLoading(loading);
      }
    };

    const handleError = (errMessage: string): void => {
      // if AppRoute is unmounted, cancel all operations
      if (this.unmounted) return;

      handleLoading(false);
      typeof triggerError === 'function' && triggerError(errMessage);
    };

    // trigger loading before handleAssets
    handleLoading(true);

    if (typeof onAppEnter === 'function') onAppEnter(getAppConfig(this.props));

    const prevAppConfig = this.prevAppConfig;

    try {
      if (entry) {
        // entry for fetch -> process -> append
        const rootElement = getCache('root');
        await loadEntry(rootElement, entry);
      } else if (entryContent) {
        // entryContent for process -> append
        const rootElement = getCache('root');
        const cachedKey = title || converArray2String(path);
        await loadEntryContent(rootElement, entryContent, location.href, cachedKey);
      } else {
        const assetsList = Array.isArray(url) ? url : [url];
        await appendAssets(assetsList, useShadow);
      }

      // if AppRoute is unmounted, or current app is not the latest app, cancel all operations
      if (this.unmounted || this.prevAppConfig !== prevAppConfig) return;

      // trigger sub-application render
      callAppEnter();

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

  triggerPrevAppLeave = (): void => {
    const { onAppLeave } = this.props;

    callAppLeave();

    // trigger onAppLeave
    const prevAppConfig = this.prevAppConfig;

    if (prevAppConfig) {
      if (typeof onAppLeave === 'function') onAppLeave(prevAppConfig);
      this.prevAppConfig = null;
    }
  };

  render() {
    return (
      <div
        ref={element => {
          this.myRefBase = element;
        }}
        className={this.state.cssLoading ? 'ice-stark-loading' : 'ice-stark-loaded'}
      />
    );
  }
}
