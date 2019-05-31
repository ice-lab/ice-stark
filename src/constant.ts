export const PREFIX = 'icestark';

export const ICESTSRK_404 = `/${PREFIX}_404`;

export const setIcestark = (key: string, value: any) => {
  if (!(window as any).ICESTARK) {
    (window as any).ICESTARK = {};
  }
  (window as any).ICESTARK[key] = value;
};

export const getIcestark = (key: string) => {
  const icestark: any = (window as any).ICESTARK;
  return icestark && icestark[key] ? icestark[key] : null;
};