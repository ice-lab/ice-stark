import '@testing-library/jest-dom/extend-expect';
import { FetchMock } from 'jest-fetch-mock';

import * as React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { AppRouter, AppRoute, AppLink, appHistory } from '../src/index';
import { setCache, getCache } from '../src/util/cache';

describe('AppRouter', () => {
  beforeEach(() => {
    (fetch as FetchMock).resetMocks();
  });

  test('render the AppRouter', () => {
    const props = {
      onRouteChange: jest.fn(),
      useShadow: false,
      NotFoundComponent: <div data-testid="icestarkDefalut">NotFound</div>,
    };
    const { getByTestId } = render(<AppRouter {...props} />);

    const textNode = getByTestId('icestarkDefalut');

    expect(textNode).toHaveTextContent('NotFound');
    expect(props.onRouteChange).toHaveBeenCalledTimes(1);

    window.history.pushState({}, 'test', '/#/test');
    expect(props.onRouteChange).toHaveBeenCalledTimes(2);

    window.history.replaceState({ forceRender: true }, 'test2', '/#/test2');
    expect(props.onRouteChange).toHaveBeenCalledTimes(3);
  });

  test('test for AppRoute Component/render', () => {
    window.history.pushState({}, 'test', '/');

    const props = {
      onRouteChange: jest.fn(),
      LoadingComponent: <div>Loading</div>,
    };

    /**
     * Test for render
     */
    const { container, rerender, unmount, getByText } = render(
      <AppRouter {...props}>
        <AppRoute path="/" component={<div data-testid="icestarkTest">test</div>} />
      </AppRouter>,
    );

    expect(container.innerHTML).toContain('test');
    expect(props.onRouteChange).toHaveBeenCalledTimes(1);

    rerender(
      <AppRouter {...props}>
        <AppRoute
          path="/"
          render={() => (
            <div data-testid="icestarkTest">
              test
              <button
                type="submit"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('icestark:not-found'));
                }}
              >
                Jump NotFound
              </button>
              <button
                type="submit"
                onClick={() => {
                  window.dispatchEvent(new PopStateEvent('popstate', {}));
                }}
              >
                Jump Hash
              </button>
            </div>
          )}
        />
      </AppRouter>,
    );

    expect(container.innerHTML).toContain('test');
    expect(props.onRouteChange).toHaveBeenCalledTimes(1);

    fireEvent.click(getByText(/Jump Hash/i));
    expect(props.onRouteChange).toHaveBeenCalledTimes(2);

    fireEvent.click(getByText(/Jump NotFound/i));
    expect(container.innerHTML).toContain('NotFound');

    /**
     * Test for HashType
     */
    window.history.pushState({}, 'test', '/');

    setCache('appLeave', () => {});
    rerender(
      <AppRouter {...props}>
        <AppRoute path="/" url={[]} hashType />
      </AppRouter>,
    );

    // expect(getCache('appLeave')).toBeNull();
    const appRouteNode = container.querySelector('.ice-stark-loading');
    expect(container.innerHTML).toContain('Loading');
    expect(appRouteNode.childNodes.length).toBe(1);
    unmount();
  });

  test('test for AppRoute url -> error', done => {
    window.history.pushState({}, 'test', '/');

    const props = {
      onRouteChange: jest.fn(),
      LoadingComponent: <div>Loading</div>,
    };

    const { container, unmount } = render(
      <AppRouter {...props}>
        <AppRoute path="/" url={['//icestark.com/js/index.js']} hashType="hashbang" />
      </AppRouter>,
    );

    expect(container.innerHTML).toContain('Loading');

    setTimeout(function() {
      const dynamicScript = document.querySelector('[icestark=dynamic]');
      expect(dynamicScript.id).toBe('icestark-js-0');
      expect(dynamicScript.getAttribute('src')).toBe('//icestark.com/js/index.js');
      dynamicScript.dispatchEvent(new ErrorEvent('error'));

      // expect(container.innerHTML).toContain('js asset loaded error: //icestark.com/js/index.js');
      unmount();
    }, done());
  });

  test('test for AppRoute url -> success', () => {
    window.history.pushState({}, 'test', '/');

    const props = {
      onRouteChange: jest.fn(),
      LoadingComponent: <div>Loading</div>,
    };

    const { container, unmount } = render(
      <AppRouter {...props} useShadow>
        <AppRoute
          path="/"
          url={['//icestark.com/js/index.js', '//icestark.com/css/index.css']}
          useShadow={false}
        />
      </AppRouter>,
    );

    // setTimeout(function() {
    //   // js load success
    //   const dynamicScriptLoaded = document.querySelector('script[icestark=dynamic]');
    //   expect(dynamicScriptLoaded.getAttribute('id')).toBe('icestark-js-0');
    //   expect(dynamicScriptLoaded.getAttribute('type')).toBe('text/javascript');
    //   expect(dynamicScriptLoaded.getAttribute('src')).toBe('//icestark.com/js/index.js');

    //   dynamicScriptLoaded.dispatchEvent(new Event('load'));

    //   expect(container.querySelector('.ice-stark-loading').childNodes.length).toBe(1);

    //   // css load success
    //   const dynamicLinkLoaded = document.querySelector('link[icestark=dynamic]');
    //   expect(dynamicLinkLoaded.getAttribute('id')).toBe('icestark-css-0');
    //   expect(dynamicLinkLoaded.getAttribute('rel')).toBe('stylesheet');
    //   expect(dynamicLinkLoaded.getAttribute('href')).toBe('//icestark.com/css/index.css');

    //   dynamicLinkLoaded.dispatchEvent(new Event('load'));

    //   // expect(container.querySelector('.ice-stark-loaded').childNodes.length).toBe(1);

    //   unmount();
    // }, done());
  });

  // test('test for AppRoute htmlUrl -> success', done => {
  //   window.history.pushState({}, 'test', '/');

  //   const props = {
  //     onRouteChange: jest.fn(),
  //     LoadingComponent: <div>Loading</div>,
  //   };

  //   (fetch as FetchMock).mockResponseOnce(
  //     '<html>' +
  //       '  <head>' +
  //       '    <meta charset="utf-8" />' +
  //       '    <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1" />' +
  //       '    <link rel="dns-prefetch" href="//g.alicdn.com" />' +
  //       '    <link rel="stylesheet" href="/index.css" />' +
  //       '    <title>This is for test</title>' +
  //       '  </head>' +
  //       '  <body>' +
  //       '    <div id="App">' +
  //       '    </div>' +
  //       '    <script src="index.js"></script>' +
  //       '    <div id="page_bottom"></div>' +
  //       '  </body>' +
  //       '</html>',
  //   );

  //   const { container, unmount } = render(
  //     <AppRouter {...props}>
  //       <AppRoute path="/" htmlUrl="//icestark.com" />
  //     </AppRouter>,
  //   );

  //   setTimeout(function() {
  //     expect(container.innerHTML).toContain('Loading');
  //     expect(container.innerHTML).not.toContain('<meta');
  //     expect(container.innerHTML).toContain('<!--link /index.css processed by @ice/stark-->');
  //     expect(container.innerHTML).toContain('<!--script index.js replaced by @ice/stark-->');

  //     const scripts = container.getElementsByTagName('script');
  //     for (let i = 0; i < scripts.length; i++) {
  //       scripts[i].dispatchEvent(new Event('load'));
  //     }

  //     unmount();
  //   }, done());
  // });

  // test('test for AppRoute htmlUrl -> error', done => {
  //   const warnMockFn = jest.fn();
  //   (global as any).console = {
  //     warn: warnMockFn,
  //   };

  //   window.history.pushState({}, 'test', '/');

  //   const props = {
  //     onRouteChange: jest.fn(),
  //     LoadingComponent: <div>Loading</div>,
  //   };

  //   const err = new Error('err');
  //   (fetch as FetchMock).mockRejectOnce(err);

  //   const { container, unmount } = render(
  //     <AppRouter {...props}>
  //       <AppRoute path="/" htmlUrl="//icestark.com" />
  //     </AppRouter>,
  //   );

  //   setTimeout(function() {
  //     // expect(warnMockFn).toBeCalledTimes(1);
  //     // expect(container.innerHTML).toContain('fetch //icestark.com error');
  //     unmount();
  //   }, done());
  // });
});

describe('AppLink', () => {
  test('render the AppLink', () => {
    const className = 'ice-stark-test';
    const props = {
      to: '/test',
      className,
    };
    const TestText = 'This is a test';

    const { container, getByText, rerender } = render(<AppLink {...props}>{TestText}</AppLink>);
    const appLinkNode = container.querySelector(`.${className}`);

    expect(appLinkNode).toHaveTextContent(TestText);
    expect(appLinkNode).toHaveAttribute('href');

    const mockPushState = jest.fn();
    window.history.pushState = mockPushState;

    fireEvent.click(getByText(/This is a test/i));
    expect(mockPushState.mock.calls.length).toBe(1);

    rerender(
      <AppLink {...props} replace>
        {TestText}
      </AppLink>,
    );
    const mockReplaceState = jest.fn();
    window.history.replaceState = mockReplaceState;

    fireEvent.click(getByText(/This is a test/i));
    expect(mockReplaceState.mock.calls.length).toBe(1);
  });
});

describe('appHistory', () => {
  test('appHistory', () => {
    const mockPushState = jest.fn();
    window.history.pushState = mockPushState;

    appHistory.push('/test');
    expect(mockPushState.mock.calls.length).toBe(1);

    const mockReplaceState = jest.fn();
    window.history.replaceState = mockReplaceState;

    appHistory.replace('/test');
    expect(mockReplaceState.mock.calls.length).toBe(1);
  });
});
