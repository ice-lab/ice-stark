import * as React from 'react';
import fetchHTML from '@ice/stark-html';
import { AppHistory } from './appHistory';
import { loadAssets, emptyAssets, appendInlineCode } from './handleAssets';
import { setCache, getCache } from './cache';

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

export interface AppConfig {
  title?: string;
  useShadow?: boolean;
  hashType?: boolean | hashType;
  basename?: string;
  exact?: boolean;
  strict?: boolean;
  sensitive?: boolean;
  rootId?: string;
}

export interface AppRouteProps extends AppConfig {
  path: string | string[];
  url?: string | string[];
  htmlUrl?: string;
  ErrorComponent?: any;
  LoadingComponent?: any;
  component?: React.ReactElement;
  render?: (props?: AppRouteComponentProps) => React.ReactElement;
  forceRenderCount?: number;
  onAppEnter?: (appConfig: AppConfig) => void;
  onAppLeave?: (appConfig: AppConfig) => void;
  triggerLoading?: (loading: boolean) => void;
  triggerError?: (err: string) => void;
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
  const appConfig: AppConfig = {};
  const uselessList = [
    'forceRenderCount',
    'url',
    'onAppEnter',
    'onAppLeave',
    'triggerLoading',
    'triggerError',
  ];

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

  static defaultProps = {
    useShadow: false,
    exact: false,
    strict: false,
    sensitive: false,
    rootId: 'icestarkNode',
  };

  componentDidMount() {
    setCache('root', null);
    this.renderChild();
  }

  componentDidUpdate(prevProps) {
    const { path, url, title, rootId, forceRenderCount, useShadow } = this.props;

    if (
      converArray2String(path) !== converArray2String(prevProps.path) ||
      converArray2String(url) !== converArray2String(prevProps.url) ||
      title !== prevProps.title ||
      rootId !== prevProps.rootId ||
      forceRenderCount !== prevProps.forceRenderCount ||
      useShadow !== prevProps.useShadow
    ) {
      // record config for prev App
      const prevAppConfig = getAppConfig(prevProps);

      this.renderChild(prevAppConfig);
    }
  }

  componentWillUnmount() {
    // Empty useless assets before unmount
    const { useShadow } = this.props;
    emptyAssets(useShadow);
    setCache('root', null);
    this.unmounted = true;
  }

  /**
   * Load assets and render child app
   */
  renderChild = (prevAppConfig?: AppConfig): void => {
    const { rootId, useShadow, onAppLeave } = this.props;

    const myBase: HTMLElement = this.myRefBase;
    if (!myBase) return;

    if (prevAppConfig) {
      // trigger registerAppLeaveCallback
      const registerAppLeaveCallback = getCache('appLeave');

      if (registerAppLeaveCallback) {
        registerAppLeaveCallback();
        setCache('appLeave', null);
      }

      // trigger onAppLeave
      if (typeof onAppLeave === 'function') onAppLeave(prevAppConfig);

      // empty useless assets before loading
      emptyAssets(prevAppConfig.useShadow);

      // remove rootElement for previous app
      this.removeElementFromBase(prevAppConfig.rootId);
    }

    // ReCreate rootElement to remove React Component instance,
    // rootElement is created for render Child App
    this.removeElementFromBase(rootId);
    let rootElement: any = this.appendElementToBase(rootId);

    // prevent duplicate creation of shadowRoot
    if (useShadow && !rootElement.shadowRoot) {
      rootElement = rootElement.attachShadow
        ? rootElement.attachShadow({ mode: 'open', delegatesFocus: false })
        : (rootElement as any).createShadowRoot();
    }

    setCache('root', rootElement);

    this.loadNextApp(rootElement, useShadow);
  };

  loadNextApp = (rootElement: any, useShadow?: boolean) => {
    const { url, htmlUrl, title, triggerLoading, triggerError, onAppEnter } = this.props;

    if (title) document.title = title;

    // common load assets function
    const loadAppAssets = assetsList => {
      if (typeof onAppEnter === 'function') onAppEnter(getAppConfig(this.props));

      loadAssets(
        assetsList,
        useShadow,
        (err: any): boolean => {
          if (err) {
            // Handle error
            typeof triggerError === 'function' && triggerError(err);
            return true;
          }

          typeof triggerLoading === 'function' && triggerLoading(false);

          return this.unmounted;
        },
        (): void => {
          this.setState({ cssLoading: false });
        },
      );
    };

    // trigger loading before loadAssets
    this.setState({ cssLoading: true });
    typeof triggerLoading === 'function' && triggerLoading(true);

    if (htmlUrl) {
      fetchHTML(htmlUrl).then(processed => {
        if (this.unmounted) return;

        // when fetchHTML error, trigger render ErrorComponent
        if (typeof processed === 'string') {
          typeof triggerError === 'function' && triggerError(processed);
          return;
        }

        const { html, url: assetsList, code } = processed as any;

        rootElement.innerHTML = html;
        appendInlineCode(rootElement, code);
        loadAppAssets(assetsList);
      });
    } else {
      loadAppAssets(Array.isArray(url) ? url : [url]);
    }
  };

  appendElementToBase = (elementId: string): HTMLElement => {
    const myBase = this.myRefBase;
    if (!myBase) return;

    const element = document.createElement('div');
    element.id = elementId;
    myBase.appendChild(element);
    return element;
  };

  removeElementFromBase = (elementId: string): void => {
    const myBase = this.myRefBase;
    if (!myBase) return;

    const element = myBase.querySelector(`#${elementId}`);
    if (element) {
      myBase.removeChild(element);
    }
  };

  render() {
    const { path, title } = this.props;

    return (
      <div
        key={`${converArray2String(path)}-${title}`}
        ref={element => {
          this.myRefBase = element;
        }}
        className={this.state.cssLoading ? 'ice-stark-loading' : 'ice-stark-loaded'}
      />
    );
  }
}
