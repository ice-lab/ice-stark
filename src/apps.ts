import { SandboxContructor, SandboxProps } from '@ice/sandbox';
import { NOT_LOADED, NOT_MOUNTED, LOADING_ASSETS, UNMOUNTED, LOAD_ERROR, MOUNTED } from './util/constant';
import { matchActivePath, MatchOptions, PathData, PathOptions } from './util/matchPath';
import { createSandbox, getUrlAssets, getEntryAssets, appendAssets, loadAndAppendCssAssets, emptyAssets, Assets } from './util/handleAssets';
import { getCache } from './util/cache';
import { AppLifeCycleEnum } from './util/appLifeCycle';
import { loadUmdModule } from './util/umdLoader';
import { globalConfiguration } from './start';

interface ActiveFn {
  (url: string): boolean;
}

interface LifecycleProps {
  container: HTMLElement | string;
  customProps?: object;
}

export interface ModuleLifeCycle {
  mount?: (props: LifecycleProps) => Promise<void> | void;
  unmount?: (props: LifecycleProps) => Promise<void> | void;
  update?: (props: LifecycleProps) => Promise<void> | void;
  bootstrap?: (props: LifecycleProps) => Promise<void> | void;
}

export interface BaseConfig extends PathOptions {
  name?: string;
  url?: string | string[];
  container?: HTMLElement;
  status?: string;
  sandbox?: boolean | SandboxProps | SandboxContructor;
  entry?: string;
  entryContent?: string;
  umd?: boolean;
  checkActive?: (url: string) => boolean;
  appAssets?: Assets;
  props?: object;
  cached?: boolean;
  title?: string;
}

interface LifeCycleFn {
  (app: AppConfig): void;
}

interface AppLifecylceOptions {
  beforeMount?: LifeCycleFn;
  afterMount?: LifeCycleFn;
  beforeUnmount?: LifeCycleFn;
  afterUnmount?: LifeCycleFn;
  beforeUpdate?: LifeCycleFn;
  afterUpdate?: LifeCycleFn;
}

export interface AppConfig extends BaseConfig {
  activePath?: string | string[] | PathData[] | MatchOptions[] | ActiveFn;
  appLifecycle?: AppLifecylceOptions;
}

export type MicroApp = AppConfig & ModuleLifeCycle;

// cache all microApp
let microApps: MicroApp[] = [];
(window as any).microApps = microApps;
function getAppNames() {
  return microApps.map(app => app.name);
}

export function getMicroApps() {
  return microApps;
}

export function registerMicroApp(appConfig: AppConfig, appLifecyle?: AppLifecylceOptions) {
  // check appConfig.name 
  if (getAppNames().includes(appConfig.name)) {
    throw Error(`name ${appConfig.name} already been regsitered`);
  }
  // set activeRules
  const { activePath, hashType = false, exact = false, sensitive = false, strict = false } = appConfig;
  const activeRules: (ActiveFn | string | MatchOptions)[] = Array.isArray(activePath) ? activePath : [activePath];
  const checkActive = activePath ? (url: string) => activeRules.map((activeRule: ActiveFn | string | MatchOptions) => {
    if (typeof activeRule === 'function' ) {
      return activeRule;
    } else {
      const pathOptions: MatchOptions = { hashType, exact, sensitive, strict };
      const pathInfo = Object.prototype.toString.call(activeRule) === '[object Object]'
        ? { ...pathOptions, ...(activeRule as MatchOptions) }
        : { path: activeRule as string, ...pathOptions };
      return (checkUrl: string) => matchActivePath(checkUrl, pathInfo);
    }
  }).some((activeRule: ActiveFn) => activeRule(url)) : () => true;
  const microApp = {
    status: NOT_LOADED,
    ...appConfig,
    appLifecycle: appLifecyle,
    checkActive,
  };
  microApps.push(microApp);
}

export function registerMicroApps(appConfigs: AppConfig[], appLifecyle?: AppLifecylceOptions) {
  appConfigs.forEach(appConfig => {
    registerMicroApp(appConfig, appLifecyle);
  });
}

export function getAppConfig(appName: string) {
  return microApps.find((microApp) => microApp.name === appName);
}

export function updateAppConfig(appName: string, config) {
  microApps = microApps.map((microApp) => {
    if (microApp.name === appName) {
      return {
        ...microApp,
        ...config,
      };
    }
    return microApp;
  });
}

// load app js assets
export async function loadAppModule(appConfig: AppConfig) {
  let lifecycle: ModuleLifeCycle = {};
  globalConfiguration.onLoadingApp(appConfig);
  const appSandbox = createSandbox(appConfig.sandbox);
  const { url, container, entry, entryContent, name } = appConfig;
  const appAssets = url ? getUrlAssets(url) : await getEntryAssets({
    root: container,
    entry,
    href: location.href,
    entryContent,
    assetsCacheKey: name,
  });
  updateAppConfig(appConfig.name, { appAssets });
  if (appConfig.umd) {
    await loadAndAppendCssAssets(appAssets);
    lifecycle = await loadUmdModule(appAssets.jsList, appSandbox);
  } else {
    await appendAssets(appAssets, appSandbox);
    lifecycle = {
      mount: getCache(AppLifeCycleEnum.AppEnter),
      unmount: getCache(AppLifeCycleEnum.AppLeave),
    };
  }
  globalConfiguration.onFinishLoading(appConfig);
  return combineLifecyle(lifecycle, appConfig);
}

function capitalize(str) {
  if (typeof str !== 'string') return '';
  return `${str.charAt(0).toUpperCase()}${str.slice(1)}`;
}

async function callAppLifecycle(primaryKey: string, lifecycleKey: string, appConfig: AppConfig) {
  if (appConfig.appLifecycle && appConfig.appLifecycle[`${primaryKey}${capitalize(lifecycleKey)}`]) {
    await appConfig.appLifecycle[`${primaryKey}${capitalize(lifecycleKey)}`](appConfig);
  }
}

function combineLifecyle(lifecycle, appConfig) {
  const combinedLifecyle = { ...lifecycle };
  ['mount', 'unmount', 'update'].forEach((lifecycleKey) => {
    if (lifecycle[lifecycleKey]) {
      combineLifecyle[lifecycleKey] = async (props) => {
        await callAppLifecycle('before', lifecycleKey, appConfig);
        await lifecycle[lifecycleKey](props);
        await callAppLifecycle('after', lifecycleKey, appConfig);
      };
    }
  });
  return combinedLifecyle;
}

export function getAppConfigForLoad (app: string | AppConfig, options?: AppLifecylceOptions) {
  if (typeof app === 'string') {
    return getAppConfig(app);
  }
  const { name } = app;
  const appIndex = getAppNames().indexOf(name);
  if (appIndex === -1) {
    registerMicroApp(app, options);
  }
  return getAppConfig(name);
};

export async function createMicroApp(app: string | AppConfig, appLifecyle?: AppLifecylceOptions) {
  const appConfig = getAppConfigForLoad(app, appLifecyle);
  const appName = appConfig && appConfig.name;
  if (appConfig && appName) {
    // check status of app
    if (appConfig.status === NOT_LOADED) {
      if (appConfig.title) document.title = appConfig.title;
      updateAppConfig(appName, { status: LOADING_ASSETS });
      let lifeCycle: ModuleLifeCycle = {};
      try {
        lifeCycle = await loadAppModule(appConfig);
        updateAppConfig(appName, { ...lifeCycle, status: NOT_MOUNTED });
      } catch (err){
        globalConfiguration.onError(err);
        updateAppConfig(appName, { status: LOAD_ERROR });
      }
      if (lifeCycle.mount) {
        // check current url before mount
        mountMicroApp(appConfig.name);
      }
    } else if (appConfig.status === UNMOUNTED) {
      if (!appConfig.cached) {
        await loadAndAppendCssAssets(appConfig.appAssets || { cssList: [], jsList: []});
      }
      mountMicroApp(appConfig.name);
    } else {
      console.info(`[icestark] current status of app ${appName} is ${appConfig.status}`);
    }
    return getAppConfig(appName);
  } else {
    console.error(`[icestark] fail to get app config of ${appName}`);
  }
  return null;
}

export async function mountMicroApp(appName: string) {
  const appConfig = getAppConfig(appName);
  if (appConfig && appConfig.checkActive(window.location.href)) {
    await appConfig.mount({ container: appConfig.container, customProps: appConfig.props });
    updateAppConfig(appName, { status: MOUNTED });
  }
}

export async function unmountMicroApp(appName: string) {
  const appConfig = getAppConfig(appName);
  if (appConfig && appConfig.status === MOUNTED) {
    // remove assets if app is not cached
    emptyAssets(globalConfiguration.shouldAssetsRemove, !appConfig.cached && appConfig.name);
    updateAppConfig(appName, { status: UNMOUNTED });
    await appConfig.unmount({ container: appConfig.container, customProps: appConfig.props });
  }
}

export function unloadMicroApp(appName: string) {
  const appConfig = getAppConfig(appName);
  if (appConfig) {
    unmountMicroApp(appName);
    delete appConfig.mount;
    delete appConfig.unmount;
    delete appConfig.appAssets;
    updateAppConfig(appName, { status: NOT_LOADED });
  } else {
    console.log(`[icestark] can not find app ${appName} when call unloadMicroApp`);
  }
}

export function removeMicroApp(appName: string) {
  const appIndex = getAppNames().indexOf(appName);
  if (appIndex > -1) {
    // unload micro app in case of app is mounted
    unloadMicroApp(appName);
    microApps.splice(appIndex, 1);
  } else {
    console.log(`[icestark] can not find app ${appName} when call removeMicroApp`);
  }
}

export function clearMicroApps () {
  getAppNames().forEach(name => {
    unloadMicroApp(name);
  });
  microApps = [];
}
