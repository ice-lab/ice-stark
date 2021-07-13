import * as React from 'react';
import renderComponent from './util/renderComponent';
import { AppHistory } from './appHistory';
import { unloadMicroApp, BaseConfig, createMicroApp } from './apps';
import { converArray2String } from './AppRouter';
import { PathData } from './util/matchPath';
import { callCapturedEventListeners, resetCapturedEventListeners } from './util/capturedListeners';
// eslint-disable-next-line import/order
import isEqual = require('lodash.isequal');

interface AppRouteState {
  showComponent: boolean;
}

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

// from AppRouter
export interface AppRouteProps extends BaseConfig {
  componentProps?: AppRouteComponentProps;
  cssLoading?: boolean;
  rootId?: string;
  component?: React.ReactElement;
  /**
   * will be deprecated in future version, use funcational `activePath` instead.
   * @see activePath
   * @deprecated
   */
  basename?: string;
  render?: (componentProps: AppRouteComponentProps) => React.ReactElement;
  /**
   * will be deprecated in future version, use `activePath` instead.
   * @see activePath
   * @deprecated
   */
  path?: string | string[] | PathData[];
  onAppEnter?: (appConfig: CompatibleAppConfig) => void;
  onAppLeave?: (appConfig: CompatibleAppConfig) => void;
}

export type CompatibleAppConfig = Omit<AppRouteProps, 'componentProps' | 'cssLoading' | 'onAppEnter' | 'onAppLeave'>

/**
 * Gen compatible app config from AppRoute props
 */
function genCompatibleAppConfig (appRouteProps: AppRouteProps): CompatibleAppConfig {
  const appConfig: CompatibleAppConfig = {};
  const omitProperties = ['componentProps', 'cssLoading', 'onAppEnter', 'onAppLeave'];

  Object.keys(appRouteProps).forEach(key => {
    if (omitProperties.indexOf(key) === -1) {
      appConfig[key] = appRouteProps[key];
    }
  });

  return appConfig;
}

function path2ActivePath (appConfig: CompatibleAppConfig) {
  const { path, activePath } = appConfig;
  return path || activePath;
}

export default class AppRoute extends React.Component<AppRouteProps, AppRouteState> {
  state = {
    showComponent: false,
  };

  private myRefBase: HTMLDivElement = null;

  static defaultProps = {
    exact: false,
    strict: false,
    sensitive: false,
    sandbox: false,
    rootId: 'icestarkNode',
    shouldAssetsRemove: () => true,
  };

  componentDidMount() {
    this.mountApp();
  }

  shouldComponentUpdate(nextProps, nextState) {
    const { url, title, rootId, componentProps, cssLoading, name } = this.props;
    const { showComponent } = this.state;
    // re-render and callCapturedEventListeners if componentProps is changed
    if ((nextProps.component || nextProps.render && typeof nextProps.render === 'function') &&
      !isEqual(componentProps, nextProps.componentProps)) {
      callCapturedEventListeners();
      return true;
    } else if (
      name === nextProps.name &&
      converArray2String(url) === converArray2String(nextProps.url) &&
      title === nextProps.title &&
      rootId === nextProps.rootId &&
      cssLoading === nextProps.cssLoading &&
      showComponent === nextState.showComponent
    ) {
      // reRender is triggered by sub-application router / browser, call popStateListeners
      callCapturedEventListeners();
      return false;
    }
    return true;
  }

  componentDidUpdate(prevProps) {
    const { url, title, rootId, entry, entryContent } = this.props;

    if (
      converArray2String(url) !== converArray2String(prevProps.url) ||
      title !== prevProps.title ||
      entry !== prevProps.entry ||
      entryContent !== prevProps.entryContent ||
      rootId !== prevProps.rootId
    ) {
      this.unmountApp();
      this.mountApp();
    }
  }

  componentWillUnmount() {
    this.unmountApp();
  }

  mountApp = () => {
    resetCapturedEventListeners();
    const { onAppEnter } = this.props;

    // Trigger app enter
    if(typeof onAppEnter === 'function') {
      onAppEnter(genCompatibleAppConfig(this.props));
    }

    if (this.validateRender()) {
      this.setState({ showComponent: true });
    } else {
      this.renderChild();
    }
  }

  unmountApp = () => {
    const { name, onAppLeave } = this.props;

    // Trigger app leave
    if (typeof onAppLeave === 'function') {
      onAppLeave(genCompatibleAppConfig(this.props));
    }

    if (!this.validateRender()) {
      unloadMicroApp(name);
    }
  }

  renderChild = (): void => {
    const { path, name, rootId, ...rest } = this.props;
    // reCreate rootElement to remove sub-application instance,
    // rootElement is created for render sub-application
    const rootElement: HTMLElement = this.reCreateElementInBase(rootId);
    const appConfig = {
      ...(rest as BaseConfig),
      name,
      activePath: path,
      container: rootElement,
    };

    createMicroApp(appConfig);
  }

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
  }

  validateRender() {
    const { render, component } = this.props;
    return render && typeof render === 'function' || component;
  }

  render() {
    const { render, component, componentProps, cssLoading } = this.props;
    const { showComponent } = this.state;
    if (component) {
      return showComponent ? renderComponent(component, componentProps) : null;
    }
    if (render && typeof render === 'function') {
      return showComponent? render(componentProps) : null;
    }
    return (
      // eslint-disable-next-line react/jsx-filename-extension
      <div
        ref={element => {
          this.myRefBase = element;
        }}
        className={cssLoading ? 'ice-stark-loading' : 'ice-stark-loaded'}
      />
    );
  }
}
