/* Minimal component runtime: a class with state/setState/renderVals mounted with petite-vue. */
(function () {
  class DCLogic {
    constructor() { this.state = {}; this.props = {}; }
    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state) : patch;
      Object.assign(this.state, next || {});
      if (this.__bump) this.__bump();
    }
  }
  window.DCLogic = DCLogic;
  window.mountDC = function (Component) {
    const comp = new Component();
    const store = PetiteVue.reactive({ v: 0 });
    let cache = null, cacheV = -1;
    comp.__bump = function () { store.v++; };
    const vals = function () { const v = store.v; if (cacheV !== v) { cache = comp.renderVals(); cacheV = v; } return cache; };
    const scope = {};
    Object.keys(vals()).forEach(function (k) {
      Object.defineProperty(scope, k, { enumerable: false, configurable: true, get: function () { return vals()[k]; }, set: function () {} });
    });
    PetiteVue.createApp(scope).mount('#app');
    if (comp.componentDidMount) comp.componentDidMount();
    window.addEventListener('pagehide', function () { if (comp.componentWillUnmount) comp.componentWillUnmount(); });
  };
})();
