import Sandbox from '@ice/sandbox';
import { getGlobalProp, noteGlobalProps } from './global';
import { StarkModule } from './modules';

export interface ImportTask {
  [name: string]: Promise<string[]>;
};

export type PromiseModule = Promise<Response>;

export interface Fetch {
  (input: RequestInfo, init?: RequestInit): Promise<Response>;
}

export default class ModuleLoader {
  private importTask: ImportTask = {};

  load(starkModule: StarkModule, fetch: Fetch = window.fetch): Promise<string[]> {
    const { url, name } = starkModule;
    if (this.importTask[name]) {
      // return promise if current module is pending or resolved
      return this.importTask[name];
    }
    const urls = Array.isArray(url) ? url : [url];

    const task = Promise.all(
      urls.map(
        (scriptUrl) => fetch(scriptUrl)
          .then((res) => res.text())
          .then(res => `${res} \n //# sourceURL=${scriptUrl}`)
      )
    );
    this.importTask[name] = task;
    return task;
  }

  removeTask(name: string) {
    delete this.importTask[name];
  }

  clearTask() {
    this.importTask = {};
  }

  execModule(starkModule: StarkModule, sandbox?: Sandbox, deps?: object) {
    return this.load(starkModule).then((sources) => {
      let globalWindow = null;
      if (sandbox?.getSandbox) {
        sandbox.createProxySandbox(deps);
        globalWindow = sandbox.getSandbox();
      } else {
        globalWindow = window;
      }
      const { name } = starkModule;
      let libraryExport = '';
      // excute script in order
      try {
        sources.forEach((source, index) => {
          const lastScript = index === sources.length - 1;
          if (lastScript) {
            noteGlobalProps(globalWindow);
          }
          // check sandbox
          if (sandbox?.execScriptInSandbox) {
            sandbox.execScriptInSandbox(source);
          } else {
            // https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/eval
            // eslint-disable-next-line no-eval
            (0, eval)(source);
          }
          if (lastScript) {
            libraryExport = getGlobalProp(globalWindow);
          }
        });
      } catch (err) {
        console.error(err);
      }
      const moduleInfo = libraryExport ? (globalWindow as any)[libraryExport] : ((globalWindow as any)[name] || {});
      // remove moduleInfo from globalWindow in case of excute multi module in globalWindow
      if ((globalWindow as any)[libraryExport]) {
        delete globalWindow[libraryExport];
      }
      return moduleInfo;
    });
  }
};
