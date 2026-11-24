// The address of a part page: /parts/<number>-<brand>-<what it is>-<application>, e.g.
//   CM.2894920  "Fuel Injector / Application: XPI HD INJECTOR / REMAN Cummins ISX X15 ISX15"  ->  2894920-cummins-fuel-injector-xpi-reman-isx-x15-isx15
// The number comes first because that is what buyers search; the words come from the reviewed title (data/specs.json)
// when the part has one, else from the Unleashed description and brand. When two parts would get the same address the server adds the code.
// Store and site-search links use the short address with the code alone (/parts/cm-2894920), which is never ambiguous;
// the server answers it with a permanent redirect to this one, the address search engines see in the sitemap.
(function (root) {
  var STOP = { medium: 1, heavy: 1, light: 1, duty: 1, trucks: 1, truck: 1, equipment: 1, application: 1, applications: 1, hd: 1, pck: 1, pc: 1, pcs: 1, the: 1, for: 1, and: 1, with: 1, new: 1, of: 1, to: 1, a: 1 };
  function partPath(code, desc, brand) {
    code = String(code || '');
    var bare = code.replace(/^[A-Za-z]{2,4}[.\s]+/, ''), num = bare.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!/\d/.test(num) || num.length < 4) num = code.toLowerCase().replace(/[^a-z0-9]+/g, '');
    var text = (String(brand || '') + ' ' + String(desc || '').replace(/\([^)]*\)/g, ' ')).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ');
    var seen = {}, words = [];
    text.split(/[^a-z0-9.]+/).forEach(function (t) {
      t = t.replace(/^\.+|\.+$/g, '').replace(/\./g, '-');
      if (!t || STOP[t] || seen[t] || t.replace(/-/g, '') === num || (num.indexOf(t.replace(/-/g, '')) >= 0 && (/\d/.test(t) || t.length <= 3)) || (/^\d+$/.test(t) && t.length < 4) || words.length >= 8) return;
      seen[t] = 1; words.push(t);
    });
    return (num + (words.length ? '-' + words.join('-') : '')).replace(/-+/g, '-').slice(0, 90).replace(/-+$/, '');
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = partPath; else root.partPath = partPath;
})(this);
