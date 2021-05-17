import Sandbox from '../src/index';

describe('sandbox: excapeSandbox', () => {
  const sandbox = new Sandbox({});
  const delay = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

  test('execute script in sandbox', () => {
    sandbox.execScriptInSandbox('window.a = 1;expect(window.a).toBe(1);');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).a).toBe(1);
    sandbox.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).a).toBe(undefined);
  });

  test('capture global event', async () => {
    sandbox.execScriptInSandbox(`
      setInterval(() => {expect(1).toBe(2)}, 100);
      setTimeout(() => { expect(1).toBe(2)}, 100)`
    );
    sandbox.clear();
    // delay 1000 ms for timeout
    await delay(1000);
    expect(true).toBe(true);
  });
});

describe('sandbox: default props', () => {
  const sandbox = new Sandbox({ multiMode: true });

  test('execute script in sandbox', () => {
    sandbox.execScriptInSandbox('window.a = 1;expect(window.a).toBe(1);');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).a).toBe(undefined);
  });
});

describe('sandbox: access contructor', () => {
  const sandbox = new Sandbox();

  test('execute global functions', () => {
    sandbox.execScriptInSandbox('window.error = new Error("errmsg");Error.toString();');
    const globalWindow = sandbox.getSandbox();
    expect((globalWindow as any).error.toString()).toBe('Error: errmsg');
  });
});

describe('sanbox: binding this', () => {
  const sandbox = new Sandbox();
  test('bind this to proxy', () => {
    sandbox.execScriptInSandbox('expect(window === this).toBe(true);');
  });
});

describe('sandbox: falsy values should be trapped.', () => {
  const sandbox = new Sandbox({ multiMode: true });

  test('Falsy value - 0', () => {
    sandbox.execScriptInSandbox('window.a = 0;expect(window.a).toBe(0);');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).a).toBe(undefined);
  });

  test('Falsy value - false', () => {
    sandbox.execScriptInSandbox('window.b = false;expect(window.b).toBe(false);');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).a).toBe(undefined);
  });

  test('Falsy value - void 0', () => {
    sandbox.execScriptInSandbox('window.c = void 0;expect(window.c).toBe(undefined);');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).a).toBe(undefined);
  });
});

describe('eval in sandbox', () => {
  const sandbox = new Sandbox({ multiMode: true });

  test('execution context is not global execution context', () => {
    let error = null;
    try {
      sandbox.execScriptInSandbox(
        `
          function bar (value) {
            eval('console.log(value);');
          }
          bar(1);
        `
      );
    } catch (e) {
      error = e.message;
    }

    expect(error).toBe(null);
  });
});

