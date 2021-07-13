import * as React from 'react';
import * as urlParse from 'url-parse';
import { AppRouteProps, AppRouteComponentProps, CompatibleAppConfig } from './AppRoute';
import appHistory from './appHistory';
import renderComponent from './util/renderComponent';
import { ICESTSRK_ERROR, ICESTSRK_NOT_FOUND } from './util/constant';
import { setCache } from './util/cache';
import start, { unload, Fetch, defaultFetch, Prefetch } from './start';
import { matchActivePath, PathData, addLeadingSlash } from './util/matchPath';
import { AppConfig } from './apps';
import { doPrefetch } from './util/prefetch';
import checkActive from './util/checkActive';

type RouteType = 'pushState' | 'replaceState';

export interface AppRouterProps {
  onRouteChange?: (
    pathname: string,
    query: object,
    hash?: string,
    type?: RouteType | 'init' | 'popstate',
  ) => void;
  ErrorComponent?: React.ComponentType | React.ReactElement;
  LoadingComponent?: React.ComponentType | React.ReactElement;
  NotFoundComponent?: React.ComponentType | React.ReactElement;
  onAppEnter?: (appConfig: CompatibleAppConfig) => void;
  onAppLeave?: (appConfig: CompatibleAppConfig) => void;
  onLoadingApp?: (appConfig: CompatibleAppConfig) => void;
  onFinishLoading?:  (appConfig: CompatibleAppConfig) => void;
  onError?: (err: Error) => void;
  shouldAssetsRemove?: (
    assetUrl?: string,
    element?: HTMLElement | HTMLLinkElement | HTMLStyleElement | HTMLScriptElement,
  ) => boolean;
  basename?: string;
  fetch?: Fetch;
  prefetch?: Prefetch;
}

interface AppRouterState {
  url: string;
  appLoading: string;
  started: boolean;
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

export default class AppRouter extends React.Component<AppRouterProps, AppRouterState> {

  private unmounted: boolean = false;

  private err: string | Error = ''; // js assets load err

  private appKey: string = '';

  static defaultProps = {
    onRouteChange: () => {},
    // eslint-disable-next-line react/jsx-filename-extension
    ErrorComponent: ({ err }: { err: string | Error}) => <div>{ typeof err === 'string' ? err : err?.message }</div>,
    LoadingComponent: <div>Loading...</div>,
    NotFoundComponent: <div>NotFound</div>,
    shouldAssetsRemove: () => true,
    onAppEnter: () => {},
    onAppLeave: () => {},
    onLoadingApp: () => {},
    onFinishLoading: () => {},
    onError: () => {},
    basename: '',
    fetch: defaultFetch,
    prefetch: false,
  };

  constructor(props) {
    super(props);
    this.state = {
      url: location.href,
      appLoading: '',
      started: false,
    };

    const { fetch, prefetch: strategy, children } = props;

    if (strategy) {
      this.prefetch(strategy, children, fetch);
    }
  }

  componentDidMount() {
    // render NotFoundComponent eventListener
    window.addEventListener('icestark:not-found', this.triggerNotFound);

    /* lifecycle `componentWillUnmount` of pre-rendering executes later then
     * `constructor` and `componentWilllMount` of next-rendering, whereas `start` should be invoked before `unload`.
     * status `started` used to make sure parent's `componentDidMount` to be invoked eariler then child's,
     * for mounting child component needs global configuration be settled.
     */
    const { shouldAssetsRemove, onAppEnter, onAppLeave, fetch } = this.props;
    start({
      shouldAssetsRemove,
      onAppLeave,
      onAppEnter,
      onLoadingApp: this.loadingApp,
      onFinishLoading: this.finishLoading,
      onError: this.triggerError,
      reroute: this.handleRouteChange,
      fetch,
    });
    this.setState({ started: true });
  }

  componentWillUnmount() {
    this.unmounted = true;
    window.removeEventListener('icestark:not-found', this.triggerNotFound);
    unload();
    this.setState({ started: false });
  }

  /**
   * prefetch for resources.
   * no worry to excute `prefetch` many times, for all prefetched resources have been cached, and never request twice.
   */
  prefetch = (strategy: Prefetch, children: React.ReactNode, fetch = window.fetch) => {
    const apps: AppConfig[] = React.Children
      /**
       * we can do prefetch for url, entry and entryContent.
       */
      .map(children, childElement =>  {
        if (React.isValidElement(childElement)) {
          const { url, entry, entryContent, name, path } = childElement.props as AppRouteProps;
          if (url || entry || entryContent) {
            return {
              ...childElement.props,
              /**
               * name of AppRoute may be not provided, use `path` instead.
              */
              name: name || converArray2String(path),
            };
          }

        }
        return false;
      })
      .filter(Boolean);

    doPrefetch(apps, strategy, fetch);
  }

  /**
   * Trigger Error
   */
  triggerError = (err): void => {
    // if AppRouter is unmounted, cancel all operations
    if (this.unmounted) return;

    this.props.onError(err);
    this.err = err;
    this.setState({ url: ICESTSRK_ERROR });
  };

  triggerNotFound = (): void => {
    // if AppRouter is unmounted, cancel all operations
    if (this.unmounted) return;
    this.setState({ url: ICESTSRK_NOT_FOUND });
  };

  /**
   * Trigger onRouteChange
   */
  handleRouteChange = (url: string, type: RouteType | 'init' | 'popstate'): void => {
    if (!this.unmounted && url !== this.state.url) {
      this.setState({ url });
    }
    const { pathname, query, hash } = urlParse(url, true);
    this.props.onRouteChange(pathname, query, hash, type);
  };

  loadingApp = (app: AppConfig) => {
    if (this.unmounted) return;
    this.props.onLoadingApp(app);
    this.setState({ appLoading: app.name });
  }

  finishLoading = (app: AppConfig) => {
    if (this.unmounted) return;
    this.props.onFinishLoading(app);
    const { appLoading } = this.state;
    if (appLoading === app.name) {
      this.setState({ appLoading: '' });
    }
  }

  render() {
    const {
      NotFoundComponent,
      ErrorComponent,
      LoadingComponent,
      children,
      basename: appBasename,
    } = this.props;
    const { url, appLoading, started } = this.state;

    if (!started) {
      return renderComponent(LoadingComponent, {});
    }

    // directly render ErrorComponent
    if (url === ICESTSRK_NOT_FOUND) {
      return renderComponent(NotFoundComponent, {});
    } else if (url === ICESTSRK_ERROR) {
      return renderComponent(ErrorComponent, { err: this.err });
    }

    let match = null;
    let element: React.ReactElement;
    // let routerPath = null;
    React.Children.forEach(children, child => {
      if (match == null && React.isValidElement(child)) {
        const { path, activePath, exact, strict, sensitive, hashType } = child.props;
        // routerPath = appBasename
        //   ? [].concat(path).map((pathStr: string | PathData) => `${addLeadingSlash(appBasename)}${(pathStr as PathData).value || pathStr}`)
        //   : path;
        element = child;
        // match = matchActivePath(url, {
        //   ...child.props,
        //   path: routerPath,
        // });
        match = checkActive({
          exact,
          strict,
          sensitive,
          hashType,
        }, activePath)(url);
      }
    });


    if (match) {
      const { path, basename, name } = element.props as AppRouteProps;
      setCache('basename', `${appBasename}${basename || (Array.isArray(path) ? (path[0] as PathData).value || path[0] : path)}`);
      this.appKey = name || converArray2String(path);
      const componentProps: AppRouteComponentProps = {
        location: urlParse(url, true),
        match,
        history: appHistory,
      };
      return (
        <div>
          {appLoading === this.appKey ? renderComponent(LoadingComponent, {}) : null}
          {React.cloneElement(element, {
            key: this.appKey,
            name: this.appKey,
            componentProps,
            cssLoading: appLoading === this.appKey,
            onAppEnter: this.props.onAppEnter,
            onAppLeave: this.props.onAppLeave,
            path: routerPath,
          })}
        </div>
      );
    }
    return renderComponent(NotFoundComponent, {});
  }
}
