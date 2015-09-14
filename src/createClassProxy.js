import difference from 'lodash/array/difference';

import createPrototypeProxy from './createPrototypeProxy';
import bindAutoBindMethods from './bindAutoBindMethods';
import deleteUnknownAutoBindMethods from './deleteUnknownAutoBindMethods';

const ignoreSpecialStatics = (() => {
  const staticsToIgnore = ['__reactPatchProxy', 'type', 'displayName'];
  return n => staticsToIgnore.indexOf(n) < 0;
}());

export default function proxyClass(InitialClass) {
  // Prevent double wrapping.
  // Given a proxy class, return the existing proxy managing it.
  if (Object.prototype.hasOwnProperty.call(InitialClass, '__reactPatchProxy')) {
    return InitialClass.__reactPatchProxy;
  }

  const prototypeProxy = createPrototypeProxy();
  let CurrentClass;

  // Create a proxy constructor with matching name
  const ProxyClass = new Function('getCurrentClass',
    `return function ${InitialClass.name || 'ProxyClass'}() {
      return getCurrentClass().apply(this, arguments);
    }`
  )(() => CurrentClass);

  const dynamicStatics = {};

  function updateStatics(NextClass) {
    const nextNames = Object.getOwnPropertyNames(NextClass).filter(ignoreSpecialStatics);
    const currentNames = Object.getOwnPropertyNames(ProxyClass).filter(ignoreSpecialStatics);

    const addedNames = difference(nextNames, currentNames);

    addedNames.forEach((name) => {
      const originalDesc = Object.getOwnPropertyDescriptor(NextClass, name) || {};
      
      const {
        enumerable = false,
        configurable = true
      } = originalDesc;

      const gettable = !!originalDesc.get || originalDesc.value;
      const settable = !!originalDesc.set || originalDesc.writable;
      
      const descriptor = {
        enumerable,
        configurable,
      };

      if (gettable) {
        descriptor.get = () => {
          return dynamicStatics.hasOwnProperty(name) ? dynamicStatics[name] : CurrentClass[name];
        };
      }

      if (settable) {
        descriptor.set = (val) => {
          CurrentClass[name] = val;
          dynamicStatics[name] = val;
        };
      }

      Object.defineProperty(ProxyClass, name, descriptor);
    });
  }

  // Point proxy constructor to the proxy prototype
  ProxyClass.prototype = prototypeProxy.get();

  function update(NextClass) {
    if (typeof NextClass !== 'function') {
      throw new Error('Expected a constructor.');
    }

    // Prevent proxy cycles
    if (Object.prototype.hasOwnProperty.call(NextClass, '__reactPatchProxy')) {
      return update(NextClass.__reactPatchProxy.__getCurrent());
    }

    // Save the next constructor so we call it
    CurrentClass = NextClass;

    // Update the prototype proxy with new methods
    const mountedInstances = prototypeProxy.update(NextClass.prototype);

    // Set up the constructor property so accessing the statics work
    ProxyClass.prototype.constructor = ProxyClass;

    // Naïvely proxy static methods and properties
    ProxyClass.prototype.constructor.__proto__ = NextClass;

    // Try to infer displayName
    ProxyClass.displayName = NextClass.name || NextClass.displayName;

    updateStatics(NextClass);

    // We might have added new methods that need to be auto-bound
    mountedInstances.forEach(bindAutoBindMethods);
    mountedInstances.forEach(deleteUnknownAutoBindMethods);

    // Let the user take care of redrawing
    return mountedInstances;
  };

  function get() {
    return ProxyClass;
  }

  function getCurrent() {
    return CurrentClass;
  }

  update(InitialClass);

  const proxy = { get, update };

  Object.defineProperty(proxy, '__getCurrent', {
    configurable: false,
    writable: false,
    enumerable: false,
    value: getCurrent
  });

  Object.defineProperty(ProxyClass, '__reactPatchProxy', {
    configurable: false,
    writable: false,
    enumerable: false,
    value: proxy
  });

  return proxy;
}