import { MatchOptions, PathData, PathOptions, matchActivePath } from './matchPath';

interface ActiveFn {
  (url: string): boolean;
}

export type ActivePath = string | string[] | PathData[] | MatchOptions[] | ActiveFn;

const checkAtive = (options: PathOptions, activePath?: ActivePath ) => {
  const { hashType = false, exact = false, sensitive = false, strict = false } = options;
  const activeRules: (ActiveFn | string | MatchOptions)[] = Array.isArray(activePath) ? activePath : [activePath];
  return activePath ? (url: string) => activeRules.map((activeRule: ActiveFn | string | MatchOptions) => {
    if (typeof activeRule === 'function' ) {
      return activeRule;
    } else {
      const pathOptions: MatchOptions = { hashType, exact, sensitive, strict };
      const pathInfo = Object.prototype.toString.call(activeRule) === '[object Object]'
        ? { ...pathOptions, ...(activeRule as MatchOptions) }
        : { path: activeRule as string, ...pathOptions };
      return (checkUrl: string) => matchActivePath(checkUrl, pathInfo);
    }
  }).some((activeRule: ActiveFn) => activeRule(url))
  // active app when activePath is not specified
    : () => true;
};

export default checkAtive;
