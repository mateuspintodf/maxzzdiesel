/* Maxzz B2B store (petite-vue).
   Open catalog for everyone; prices, stock, cart and orders only for signed-in, approved customers.
   Anonymous visitors can add parts to the quote list (/quote), the same list the rest of the site uses. */
(function () {
  var CK = 'mx-portal-cart', QK = 'mx-quote', FGC = {};
  // featured parts whose Unleashed text reads badly; wording only, same part and numbers
  var BRP = { BO: 'Bosch', DN: 'Denso', ZX: 'Zexel', DE: 'Delphi', FB: 'Fratelli Bosio', JV: 'Java', LD: 'Lead', RB: 'Robiel', CO: 'Continental', SI: 'Siemens', VO: 'Volvo Penta', CAT: 'Caterpillar', AP: 'Alliant Power' };
  var TFIX = { 'BO.0.414.702.010': 'Bosch Unit Pump for Volvo Penta, Fits Volvo L180E and L180E HL' };
  function read(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  // what the browser remembers belongs to one signed-in person: it is wiped on sign-out, on a revoked session and when a different person signs in
  function forget() { try { ['mx-portal-cart', 'mx-portal-ship', 'mx-portal-recent', 'mx-portal-who'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} }
  function norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function api(path, opts) {
    opts = opts || {};
    return fetch('/api/portal/' + path, { method: opts.body ? 'POST' : 'GET', credentials: 'same-origin', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function track(ev, p) { try { (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: ev }, p || {})); } catch (e) {} }
  // "Fuel Injector / Application: 13-18 6.7L DODGE CUMMINS / (= 0.986.435.621)" -> title, application, cross refs
  function parse(desc) {
    var d = String(desc || ''), xr = [], m = d.match(/\(=\s*([^)]*)\)/);
    if (m) { xr = m[1].split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean); d = d.replace(m[0], ''); }
    d = d.replace(/\s*=\s*([A-Z0-9][A-Z0-9.\u2011#-]{3,})/gi, function (_, c) { xr.push(c.replace(/#$/, '')); return ''; });
    d = d.replace(/\s*=+>?\s*([^\/]*)/, function (_, c) { c = c.replace(/[()#\s]+$|^[()\s-]+/g, ''); if (c) xr.push(c); return ' '; }).replace(/[#\/\s]+$/, '');
    d = d.replace(/\s*\b(?:Pck|Pack)\s*(?:=|of)\s*\d+\s*(?:pcs\.?)?/gi, '').replace(/\s+,/g, ',').replace(/,(?=\S)/g, ', ').replace(/\s{2,}/g, ' ');
    var parts = d.split(/\s*\/\s*Application:\s*/i);
    var title = (parts[0] || '').replace(/\s*\/\s*$/, '').trim();
    var app = (parts[1] || '').replace(/\s*\/\s*$/, '').replace(/\s*\/\s*/g, ' · ').trim();
    if (!parts[1] && title.indexOf(' / ') > 0) { var p2 = title.split(' / '); title = p2.shift(); app = p2.join(' · '); }
    return { title: title || desc, app: app, xr: xr };
  }
  // catalog text from Unleashed comes in mixed shouting case; one consistent case for every title and application line
  var ACR = 'GMC CDI FTV HDI DCI MWM MBB CRIN DMAX TDCI UIS SN OE OEM HEUI EUI EUP PDE SLP PLD SCV ISX ISB ISC ISL ISM QSB QSC QSK QSL QSM QSX CAT STD DPF DEF EGR SCR HD GM CR VE USA ECM ECU VGT HPCR HP DAF MAN BMW PSG EDC NPT UI UP UPS RBD LML LMM LBZ LLY LB7 L5P CP1 CP2 CP3 CP4 VP29 VP30 VP44 DT466 DT530 VW JCB JD MTU DDC MBE OM IDI DI TDI CRDI PSI NBR FKM PTFE ISO SAE SST HPI PT IVECO DAF NV RPM ID OD TDC EPA UK EU USB LED NO NC DC AC II III IV'.split(' ');
  var SMALL = ['for', 'and', 'with', 'of', 'to', 'in', 'on', 'or', 'the', 'a', 'an', 'by', 'from'];
  function nice(t) {
    t = String(t || '').replace(/\s*\(=\s*[^)]*\)/g, '').replace(/\b(?:Category|Description)\s*:\s*/gi, '').replace(/\s*:\s*$/, '').replace(/\s+NEW\s*:?\s*$/i, '').trim();
    // units: "2,95MM" / "2.80 MM" -> "2.95 mm"
    t = t.replace(/(\d)[,.](\d+)\s*MM\b/gi, '$1.$2 mm').replace(/(\d)\s*MM\b/gi, '$1 mm');
    var i = 0, lowAll = t === t.toLowerCase();
    return t.split(/(\s+)/).map(function (tok) {
      if (/^\s+$/.test(tok) || !tok) return tok;
      var first = i++ === 0;
      if (/\d/.test(tok)) return tok;               // part numbers, model codes, sizes: exactly as written
      return tok.replace(/[A-Za-z][A-Za-z']*/g, function (w) {
        var up = w.toUpperCase();
        if (ACR.indexOf(up) >= 0 && w.length >= 3) return up;
        if (w !== up && !lowAll && !/^[a-z][A-Z]+$/.test(w)) return first && /^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w;  // mixed case: keep as written
        if (up === 'NOX') return 'NOx';
        if (up === 'MM') return 'mm';
        if (lowAll && w.length < 3 && SMALL.indexOf(w) < 0) return up;
        if (ACR.indexOf(up) >= 0 || w.length < 3 && up !== 'NO') return w;
        var lw = w.toLowerCase();
        if (!first && SMALL.indexOf(lw) >= 0) return lw;
        return lw.charAt(0).toUpperCase() + lw.slice(1);
      });
    }).join('').replace(/(\w)-(?=\w)/g, '$1\u2011');
  }
  var CATS = [
    { k: 'Injector', label: 'Injectors', ic: 'inj' }, { k: 'Pump', label: 'Pumps', ic: 'pump' }, { k: 'Nozzle', label: 'Nozzles', ic: 'noz' },
    { k: 'Rail', label: 'Rails', ic: 'rail' }, { k: 'Repair part', label: 'Repair parts', ic: 'rep' }, { k: 'Tool', label: 'Tool sets', ic: 'tool' },
    { k: 'Engine parts', label: 'Engine parts', ic: 'eng' }, { k: 'Fluid', label: 'Fluids', ic: 'fl' }, { k: 'Kit', label: 'Contamination kits', ic: 'kit' }
  ];
  var ENG = [{ k: 'f', label: 'Ford · Power Stroke' }, { k: 'c', label: 'Ram / Dodge · Cummins' }, { k: 'd', label: 'Chevy / GMC · Duramax' }, { k: 'h', label: 'Heavy duty trucks' }];
  // bench photos, validation batch for Mike (generated from the Unleashed photo of each part); key = part number
  var BENCH = {
    // Remade 4:3 from the Unleashed original, and family photos for similar parts
    'RB.410.08.009': '/img/p/robiel-41008009-repair-kit-bosch-6-7l-powerstroke.webp',
    'RB.420.00.215': '/img/p/robiel-420000215-o-ring-black-cav-dpc-pump.webp',
    'BO. F.00R.J00.220': '/img/p/bosch-f00rj00220-o-ring-kit-o-ring-seal.webp',
    'BO.0.281.002.863': '/img/p/bosch-0281002863-sensor-fuel-pressure-sensor-bosch.webp',
    'BO.0.281.002.930': '/img/p/bosch-0281002930-sensor-pressure-sensor.webp',
    'BO.0.281.006.186': '/img/p/bosch-0281006186-sensor-pressure-sensor.webp',
    'BO.0.281.006.246': '/img/p/bosch-0281006246-pressure-regulator.webp',
    'BO.0.281.006.249': '/img/p/bosch-0281006249-sensor-pressure-sensor.webp',
    'BO.0.281.006.357': '/img/p/bosch-0281006357-control-valve-pressure-control-valve.webp',
    'BO.0.445.120.340': '/img/p/bosch-0445120340-fuel-injector.webp',
    'BO.0.445.130.020': '/img/p/bosch-0445130020-diesel-part-fue-return-line.webp',
    'BO.0.986.444.955': '/img/p/bosch-0986444955-diesel-part-control-unit.webp',
    'BO.0.986.444.968': '/img/p/bosch-0986444968-repair-kit-psk-kit.webp',
    'BO.0.986.444.970': '/img/p/bosch-0986444970-diesel-part-bosch-fuel-injection-control-unit.webp',
    'BO.1.460.324.346': '/img/p/bosch-1460324346-fuel-pump-guide-bushing-for-ve-pump.webp',
    'BO.1.462.C00.998': '/img/p/bosch-1462c00998-valve.webp',
    'BO.1.462.C85.997': '/img/p/bosch-1462c85997-seal-kit-shaft-seal.webp',
    'BO.1.465.134.785': '/img/p/bosch-1465134785-diesel-part-housing.webp',
    'BO.1.465.ZS0.054': '/img/p/bosch-1465zs0054-diesel-part-bosch-metering-unit-1-465-zs0-054.webp',
    'BO.1.466.110.637': '/img/p/bosch-1466110637-diesel-part-cam-ring.webp',
    'BO.1.466.111.611': '/img/p/bosch-1466111611-diesel-part-camplate.webp',
    'BO.1.467.010.410': '/img/p/bosch-1467010410-repair-kit-distributor.webp',
    'BO.1.467.035.017': '/img/p/bosch-1467035017-fuel-pump-bosch-feeding-pump.webp',
    'BO.1.680.210.123': '/img/p/bosch-1680210123-o-ring-kit-o-ring.webp',
    'BO.1.680.210.132': '/img/p/bosch-1680210132-o-ring-kit-o-ring.webp',
    'BO.1.687.010.399': '/img/p/bosch-1687010399-diesel-part-supplementary-eqpt-set.webp',
    'BO.1.687.016.111': '/img/p/bosch-1687016111-diesel-part-adapter.webp',
    'BO.2.417.010.010': '/img/p/bosch-2417010010-repair-kit-bosch-seal-kit.webp',
    'BO.2.418.552.179': '/img/p/bosch-2418552179-valve-delivery-valve.webp',
    'BO.2.418.552.191': '/img/p/bosch-2418552191-valve-delivery-valve.webp',
    'BO.2.423.202.001': '/img/p/bosch-2423202001-diesel-part-taper-pin.webp',
    'BO.2.430.136.166': '/img/p/bosch-2430136166-fuel-injector-spacer.webp',
    'BO.2.434.614.022': '/img/p/bosch-2434614022-diesel-part-compression-spring.webp',
    'BO.2.443.461.003': '/img/p/bosch-2443461003-diesel-part-threaded-plug.webp',
    'BO.2.444.618.006': '/img/p/bosch-2444618006-diesel-part-muelle-de-compresion-2-444-618.webp',
    'BO.2.447.010.021': '/img/p/bosch-2447010021-repair-kit-distributor.webp',
    'BO.2.447.010.039': '/img/p/bosch-2447010039-fuel-pump-bosch-hand-pump-pack-of-10-pcs.webp',
    'BO.2.447.419.002': '/img/p/bosch-2447419002-valve.webp',
    'BO.DGK108': '/img/p/bosch-dgk108-repair-kit-service-kit.webp',
    'BO.DGK601': '/img/p/bosch-dgk601-diesel-part-parts-set.webp',
    'BO.DGK602': '/img/p/bosch-dgk602-diesel-part-parts-set.webp',
    'BO.DGK603': '/img/p/bosch-dgk603-diesel-part-parts-set.webp',
    'BO.F.000.421.064': '/img/p/bosch-f000421064-repair-kit-gasket-kit-gov-k-navistar.webp',
    'BO.F.00N.200.798': '/img/p/bosch-f00n200798-valve-overflow-valve.webp',
    'BO.F.00N.300.366': '/img/p/bosch-f00n300366-diesel-part-control-unit-bosch.webp',
    'BO.F.00N.350.355': '/img/p/bosch-f00n350355-fuel-pump-housing.webp',
    'BO.F.00N.350.357': '/img/p/bosch-f00n350357-fuel-pump-housing.webp',
    'BO.F.00R.C00.647': '/img/p/bosch-f00rc00647-diesel-part-fuel-connection-tube.webp',
    'BO.F.00R.J00.222': '/img/p/bosch-f00rj00222-o-ring-kit-o-ring.webp',
    'BO.F.00R.J01.572': '/img/p/bosch-f00rj01572-diesel-part-bosch-fuel-connection-tube-high.webp',
    'BO.F.00R.J04.084': '/img/p/bosch-f00rj04084-diesel-part-connection-tube-man-6110301-6169.webp',
    'BO.F.00R.J04.613': '/img/p/bosch-f00rj04613-diesel-part-bosch-setting-ring.webp',
    'BO.F.00V.C05.001': '/img/p/bosch-f00vc05001-valve-ball.webp',
    'BO.F.00V.C40.401': '/img/p/bosch-f00vc40401-injector-shim.webp',
    'BO.F.00Z.C99.870': '/img/p/bosch-f00zc99870-diesel-part-bosch-part-set.webp',
    'BO.F.00Z.C99.872': '/img/p/bosch-f00zc99872-diesel-part-parts-set.webp',
    'BO.F.00Z.C99.876': '/img/p/bosch-f00zc99876-diesel-part-bosch-part-set.webp',
    'BO.F.01M.100.984': '/img/p/bosch-f01m100984-seal-kit-shaft-seal.webp',
    'BO.F.01M.101.349': '/img/p/bosch-f01m101349-diesel-part-roller-shoe.webp',
    'BO.F.01M.101.438': '/img/p/bosch-f01m101438-diesel-part-bosch-camshaft.webp',
    'BO.H.146.110.062': '/img/p/bosch-h146110062-control-valve.webp',
    'BRH-097': '/img/p/brh097-diesel-part-bearing-housing-volvo-23822625.webp',
    'CMS.0433.175.501': '/img/p/0433175501-diesel-part-cummins.webp',
    'COMMAND PISTON': '/img/p/commandpiston-diesel-part-command-piston-mitsubishi.webp',
    'DE.7123-340R': '/img/p/delphi-7123340r-diesel-part-head-rotor-for-massey-ferguson.webp',
    'DE.7184-082L': '/img/p/delphi-7184082l-diesel-part-delphi-head-rotor.webp',
    'DE.7189-376L': '/img/p/delphi-7189376l-diesel-part-delphi-head-and-rotor.webp',
    'DN.04226-0L020': '/img/p/denso-042260l020-control-valve-toyota-hilux-hiace-2-5l-3-0l.webp',
    'DN.090139-0340': '/img/p/denso-0901390340-diesel-part-oval-ring-denso.webp',
    'DN.090139-0410': '/img/p/denso-0901390410-diesel-part-oring.webp',
    'DN.090140-0030': '/img/p/denso-0901400030-valve-delivery-valve.webp',
    'DN.090140-2590': '/img/p/denso-0901402590-valve.webp',
    'DN.090140-2810': '/img/p/denso-0901402810-control-valve.webp',
    'DN.090150-3040': '/img/p/denso-0901503040-diesel-part-element.webp',
    'DN.090150-5740': '/img/p/denso-0901505740-diesel-part-element.webp',
    'DN.090150-5812': '/img/p/denso-0901505812-fuel-pump-diesel-pump-plunger.webp',
    'DN.090150-5971': '/img/p/denso-0901505971-diesel-part-element.webp',
    'DN.090272-0210': '/img/p/denso-0902720210-diesel-part-rubber-gasket.webp',
    'DN.091337-0150': '/img/p/denso-0913370150-diesel-part-rubber-buffers-zexel-denso.webp',
    'DN.091340-0081': '/img/p/denso-0913400081-diesel-part-bushing.webp',
    'DN.092100-0930': '/img/p/denso-0921000930-fuel-pump-feed-pump-sc.webp',
    'DN.093245-0140': '/img/p/denso-0932450140-diesel-part-washer.webp',
    'DN.093400-0900': '/img/p/denso-0934000900-diesel-part-tobera-dn4sdn90.webp',
    'DN.093400-6810': '/img/p/denso-0934006810-diesel-part-tobera-dn4pd681.webp',
    'DN.094110-0270': '/img/p/denso-0941100270-valve-denso-valve.webp',
    'DN.094140-0040': '/img/p/denso-0941400040-valve-sub-assy.webp',
    'DN.096121-0350': '/img/p/denso-0961210350-diesel-part-denso-shaft-drive.webp',
    'DN.096190-1310': '/img/p/denso-0961901310-diesel-part-timer-piston.webp',
    'DN.096201-0160': '/img/p/denso-0962010160-diesel-part-piston.webp',
    'DN.096218-0020': '/img/p/denso-0962180020-diesel-part-cover.webp',
    'DN.096230-0340': '/img/p/denso-0962300340-diesel-part-camplate.webp',
    'DN.096400-1240': '/img/p/denso-0964001240-diesel-part-cabezal-12-14mm.webp',
    'DN.096400-1481': '/img/p/denso-0964001481-diesel-part-head-rotor-4cil-10mm.webp',
    'DN.096450-0300': '/img/p/denso-0964500300-diesel-part-shaft.webp',
    'DN.192290-0060': '/img/p/denso-1922900060-repair-kit-gasket-kit.webp',
    'DN.294010-0071': '/img/p/denso-2940100071-diesel-part-pipe.webp',
    'DN.294090-1770': '/img/p/denso-2940901770-diesel-part-plunger.webp',
    'DN.294100-0561': '/img/p/denso-2941000561-fuel-pump-supply-pump-housing.webp',
    'DN.294170-0240': '/img/p/denso-2941700240-diesel-part-ring-sub-assy.webp',
    'DN.294180-0090': '/img/p/denso-2941800090-fuel-pump-feed-pump.webp',
    'DN.294183-0141': '/img/p/denso-2941830141-fuel-pump-plate-feed-pump.webp',
    'DN.294187-0040': '/img/p/denso-2941870040-fuel-pump-key-feed-pump.webp',
    'DN.294191-0100': '/img/p/denso-2941910100-fuel-pump-shaft.webp',
    'DN.294191-5040': '/img/p/denso-2941915040-fuel-pump-denso-pump-cam-shaft.webp',
    'DN.294191-5070': '/img/p/denso-2941915070-fuel-pump-cam-shaft.webp',
    'DN.294200-0120': '/img/p/denso-2942000120-control-valve-nissan-mazda-6-toyota-mitsubishi.webp',
    'DN.294200-0650': '/img/p/denso-2942000650-fuel-pump-scv-bomba-inyeccion-denso-scv-to.webp',
    'DN.294200-2750': '/img/p/denso-2942002750-diesel-part-scv.webp',
    'DN.294200-3650': '/img/p/denso-2942003650-control-valve-suction-control-valve.webp',
    'DN.294200-3680': '/img/p/denso-2942003680-diesel-part-scv.webp',
    'DN.295040-6220': '/img/p/denso-2950406220-fuel-injector-orifice-plate.webp',
    'DN.949082-3270': '/img/p/denso-9490823270-fuel-injector-pin-injector-pck.webp',
    'DN.949150-1620': '/img/p/denso-9491501620-seal-kit-seal.webp',
    'DN.949150-2522': '/img/p/denso-9491502522-diesel-part-reten.webp',
    'DN.949150-2920': '/img/p/denso-9491502920-seal-kit-oil-seal.webp',
    'FB.BLLA143P1536': '/img/p/fratelli-bosio-blla143p1536-injector-nozzle-bosio-nozzle.webp',
    'FD.HC3Z9A564A': '/img/p/ford-hc3z9a564a-diesel-part-2017-2019-inj-return-line.webp',
    'IZ.8-98032549-0': '/img/p/8980325490-valve-pressure-limiter-valve.webp',
    'JV.30.107.414': '/img/p/jv-diesel-30107414-diesel-part-connection-tube-isb-bosch-f-00r.webp',
    'JV.30.801.001': '/img/p/jv-diesel-30801001-fuel-pump-cp3-bosch-pump-0-445-020-007-0.webp',
    'JV.40.803.001': '/img/p/jv-diesel-40803001-repair-kit-stralis-complete-bosch-f-00h-n37.webp',
    'JV.50.020.002': '/img/p/jv-diesel-50020002-diesel-part-defletor-uis-cat-c15-c32-c10-c12.webp',
    'JV.60.004.150': '/img/p/jv-diesel-60004150-fuel-injector-washer-for-injector-cummins-isb-4.webp',
    'JV.60.805.070': '/img/p/jv-diesel-60805070-repair-kit-mbb-bosch-f-00h-n37-070-for-unit.webp',
    'JV.60.805.648': '/img/p/jv-diesel-60805648-repair-kit-for-ups-mbb.webp',
    'JV.60.805.690': '/img/p/jv-diesel-60805690-repair-kit-orings-ups-005.webp',
    'JV.75.001.250': '/img/p/jv-diesel-75001250-fuel-injector-washer-for-injector-cummins-isf-3.webp',
    'JV.75.802.035': '/img/p/jv-diesel-75802035-fuel-injector-hilux-3-0.webp',
    'JV.75.802.036': '/img/p/jv-diesel-75802036-fuel-injector-frontier.webp',
    'JV.75.802.325': '/img/p/jv-diesel-75802325-repair-kit-toyota-hilux.webp',
    'KS.RKIT295050-1200': '/img/p/kingstar-rkit2950501200-repair-kit-repairt-kit-for-295050-1200.webp',
    'LD.04226-0L020': '/img/p/lead-042260l020-diesel-part-scv-toyota-294200-0042.webp',
    'LD.090150-5150': '/img/p/lead-0901505150-diesel-part-plunger.webp',
    'LD.090150-5740': '/img/p/lead-0901505740-diesel-part-plunger.webp',
    'LD.131153-7720': '/img/p/lead-1311537720-diesel-part-plunger-a756.webp',
    'LD.140110-6220': '/img/p/lead-1401106220-valve-delivery-valve-k49.webp',
    'LD.140163-2020': '/img/p/lead-1401632020-diesel-part-plunger-k312.webp',
    'LD.19': '/img/p/lead-19-valve-095000-5471-6373-5600-5650-6210.webp',
    'LD.294200-0360': '/img/p/lead-2942000360-control-valve-suction-control-valve-denso.webp',
    'LD.9690ROD': '/img/p/lead-9690rod-diesel-part-rod-9690-for-inj-1j500-53051.webp',
    'LD.BC3Z-9E964-A': '/img/p/lead-bc3z9e964a-diesel-part-fuel-line-pipe.webp',
    'LD.CR42.4': '/img/p/lead-cr424-valve-presure-valve.webp',
    'LD.CR42.5': '/img/p/lead-cr425-valve-lower-valve-assy.webp',
    'LD.CR42.6': '/img/p/lead-cr426-valve-throttle-valve-plate.webp',
    'LD.F.00R.J00.339': '/img/p/lead-f00rj00339-diesel-part-valvula-para-inyector-iveco-euro.webp',
    'LD.F.00R.J01.334': '/img/p/lead-f00rj01334-control-valve.webp',
    'LD.F.00R.J01.428': '/img/p/lead-f00rj01428-control-valve.webp',
    'LD.GD1': '/img/p/lead-gd1-valve-259700-0550.webp',
    'LD.GD2': '/img/p/lead-gd2-valve-259700-0560.webp',
    'LD.No1': '/img/p/lead-no1-solenoid-valve-cap.webp',
    'LD.QSX.7217.07': '/img/p/lead-qsx721707-injector-nozzle-needle-for-inj-4307217-5579423.webp',
    'OMS.02-07-061': '/img/p/oms-0207061-diesel-part-connector-tube-bosch-f-00r-j01.webp',
    'OMS.11-25-041': '/img/p/oms-1125041-valve-0-445-120-342-188-187.webp',
    'OMS.11-25-043': '/img/p/oms-1125043-valve-0-445-120-082.webp',
    'OMS.11-25-051': '/img/p/oms-1125051-valve-0-445-120-008.webp',
    'RB.100.01.14': '/img/p/robiel-1000114-diesel-part-clamp-6-tubes.webp',
    'RB.155.06.07': '/img/p/robiel-1550607-high-pressure-fuel-pump-robiel-capsule-cp3-high-pressure.webp',
    'RB.190.03.153': '/img/p/robiel-19003153-fuel-pump-drive-shaft-cat-feed-pump-w-lock.webp',
    'RB.190.03.16': '/img/p/robiel-1900316-fuel-pump-shaft-cummins-cp2-gear-pump.webp',
    'RB.190.03.18': '/img/p/robiel-1900318-fuel-pump-driver-for-pump.webp',
    'RB.190.52.01': '/img/p/robiel-1905201-diesel-part-ball-diameter-1-18mm.webp',
    'RB.191.01.01': '/img/p/robiel-1910101-fuel-pump-robiel-gear-set-cp3-fuel-pump.webp',
    'RB.191.01.04': '/img/p/robiel-1910104-fuel-pump-gear-set-cat-c4-c6-feed-pump.webp',
    'RB.225.01.54': '/img/p/robiel-2250154-injector-nozzle-spring-unit-nozzle.webp',
    'RB.250.20.06': '/img/p/robiel-2502006-fuel-pump-screw-cat-c6-pump-solenoid.webp',
    'RB.305.02.11': '/img/p/robiel-3050211-diesel-part-pin-pack-with-6pcs.webp',
    'RB.321.10.03': '/img/p/robiel-3211003-fuel-pump-pin-and-roller-cat-pump.webp',
    'RB.324.02.29': '/img/p/robiel-3240229-workshop-tool-box-wrench-29-00-mm.webp',
    'RB.324.03.19': '/img/p/robiel-3240319-workshop-tool-box-wrench-19-00-mm.webp',
    'RB.324.07.15': '/img/p/robiel-3240715-workshop-tool-hex-wrench-15-00-mm.webp',
    'RB.324.07.17': '/img/p/robiel-3240717-workshop-tool-hex-wrench-17-00-mm.webp',
    'RB.324.08.16': '/img/p/robiel-3240816-workshop-tool-octagonal-wrench-16-00-mm.webp',
    'RB.324.08.174': '/img/p/robiel-32408174-workshop-tool-octagonal-wrench-17-50-mm.webp',
    'RB.324.09.27': '/img/p/robiel-3240927-workshop-tool-wrench-12-sides-27-00mm.webp',
    'RB.324.09.28': '/img/p/robiel-3240928-workshop-tool-wrench-12-sides-28-00mm.webp',
    'RB.324.11.12': '/img/p/robiel-3241112-workshop-tool-multi-toothed-socket-wrench.webp',
    'RB.324.12.02': '/img/p/robiel-3241202-fuel-injector-ball-stroke-measuring-tool-crin-2.webp',
    'RB.324.12.06': '/img/p/robiel-3241206-diesel-part-digital-indicator-gauge-stroke.webp',
    'RB.324.12.08': '/img/p/robiel-3241208-injector-shim-adjusting-tool-cri-crin-inj-field.webp',
    'RB.324.12.09': '/img/p/robiel-3241209-fuel-injector-micro-ball-stroke.webp',
    'RB.324.12.171': '/img/p/robiel-32412171-tool-set-cri-inj-electrical-ball-stroke.webp',
    'RB.324.12.18': '/img/p/robiel-3241218-tool-set-inj-ball-clearance-w-electronic.webp',
    'RB.324.12.27': '/img/p/robiel-3241227-tool-set-stroke-measuring-tool-cummins-isx.webp',
    'RB.324.120.21': '/img/p/robiel-32412021-workshop-tool-rod-ring-installation-a-crin.webp',
    'RB.324.13.01': '/img/p/robiel-3241301-workshop-tool-to-pull-the-rod-ring.webp',
    'RB.324.13.02': '/img/p/robiel-3241302-workshop-tool-rod-ring-installation-crin-3.webp',
    'RB.324.13.03': '/img/p/robiel-3241303-valve-device-for-housing-valve.webp',
    'RB.324.13.04': '/img/p/robiel-3241304-fuel-injector-cri-crin-injector-set-valve.webp',
    'RB.324.13.07': '/img/p/robiel-3241307-valve-device-for-housing-cri-crin-valve.webp',
    'RB.324.13.08': '/img/p/robiel-3241308-valve-cri-crin-cr-valve.webp',
    'RB.324.13.09': '/img/p/robiel-3241309-tool-set-removing-tool-crin-inj-parts-set.webp',
    'RB.324.13.18': '/img/p/robiel-3241318-workshop-tool-rod-ring-installation-cri.webp',
    'RB.324.13.34': '/img/p/robiel-3241334-valve-cr-valve-m15x0-50.webp',
    'RB.324.15.012': '/img/p/robiel-32415012-diesel-part-tip-plastic.webp',
    'RB.324.15.04': '/img/p/robiel-3241504-fuel-injector-clamp-for-denso-injector.webp',
    'RB.324.15.09': '/img/p/robiel-3241509-diesel-part-clamp-eui-3500-unit.webp',
    'RB.324.15.10': '/img/p/robiel-3241510-diesel-part-clamp-c15-unit.webp',
    'RB.324.17.030': '/img/p/robiel-32417030-valve-to-cp4-suction-valve-seat.webp',
    'RB.324.17.031': '/img/p/robiel-32417031-valve-to-cp3s3-075-man-suction-valve.webp',
    'RB.324.18.030': '/img/p/robiel-32418030-workshop-tool-to-cp4-suction-valve-seat.webp',
    'RB.324.18.031': '/img/p/robiel-32418031-workshop-tool-to-cp3s3-075-man-suction-valve.webp',
    'RB.324.20.015': '/img/p/robiel-32420015-fuel-pump-cp3-pump-ball-seat-finishing-tool.webp',
    'RB.324.21.080': '/img/p/robiel-32421080-fuel-pump-grinding-edge-tool-pump-plunger-8.webp',
    'RB.324.29.378': '/img/p/robiel-32429378-workshop-tool-nut-wrench-cat-c10-c12-unit.webp',
    'RB.324.44.001': '/img/p/robiel-32444001-diesel-part-grinding-edge-toll-for-denso-rod.webp',
    'RB.324.44.002': '/img/p/robiel-32444002-diesel-part-grinding-edge-toll-for-denso-rod.webp',
    'RB.324.44.051': '/img/p/robiel-32444051-tool-set-grinding-edge-tool-for-denso-rod.webp',
    'RB.324.440.02': '/img/p/robiel-32444002-tool-set-grinding-tool-to-denso-rod.webp',
    'RB.324.55.06': '/img/p/robiel-3245506-high-pressure-fuel-pump-fixing-flange-denso.webp',
    'RB.324.55.07': '/img/p/robiel-3245507-high-pressure-fuel-pump-fixing-flange-bosch-cp4-high.webp',
    'RB.324.55.09': '/img/p/robiel-3245509-high-pressure-fuel-pump-fixing-flange-cat-c4-c6-high.webp',
    'RB.32460093': '/img/p/robiel-32460093-tool-set-interchangeable-tool-a-9-30mm.webp',
    'RB.32460099': '/img/p/robiel-32460099-tool-set-interchangeable-tool-b-9-90mm.webp',
    'RB.32460147': '/img/p/robiel-32460147-tool-set-interchangeable-tool-c-14-70mm.webp',
    'RB.32460172': '/img/p/robiel-32460172-tool-set-interchangeable-tool-aea-a-17-20.webp',
    'RB.340.03.35': '/img/p/robiel-3400335-fuel-pump-relief-valve-bosch-cp2-feed-pump.webp',
    'RB.340.03.39': '/img/p/robiel-3400339-fuel-pump-safety-valve-feed-pump.webp',
    'RB.340.16.02': '/img/p/robiel-3401602-control-valve.webp',
    'RB.340.19.04': '/img/p/robiel-3401904-fuel-pump-pressure-valve-cat-c7-c9.webp',
    'RB.341.03.20': '/img/p/robiel-3410320-valve-overflow-valve-320.webp',
    'RB.341.04.50': '/img/p/robiel-3410450-valve-overflow-valve-450.webp',
    'RB.410.00.062': '/img/p/robiel-41000062-injector-nozzle-repair-parts-caterpillar-perkins.webp',
    'RB.410.00.34': '/img/p/robiel-4100034-fuel-pump-repair-set-cp2-feed-pump.webp',
    'RB.410.00.351': '/img/p/robiel-41000351-repair-kit-hilux-l200-frontier.webp',
    'RB.410.00.361': '/img/p/robiel-41000361-repair-kit-denso-nissan-frontier-l200.webp',
    'RB.410.00.61': '/img/p/robiel-4100061-diesel-part-repair-set-serie-60-n2-unit.webp',
    'RB.410.06.002': '/img/p/robiel-41006002-repair-kit.webp',
    'RB.410.08.003': '/img/p/robiel-41008003-fuel-injector-repair-parts-23670-11030-denso.webp',
    'RB.410.08.004': '/img/p/robiel-41008004-fuel-injector-repair-parts-0-445-116-035-bosch.webp',
    'RB.410.10.033': '/img/p/robiel-41010033-fuel-pump-repair-parts-cp3-renault-master.webp',
    'RB.410.10.034': '/img/p/robiel-41010034-high-pressure-fuel-pump-repair-parts-cp3-iveco-daily-high.webp',
    'RB.410.10.508': '/img/p/robiel-41010508-repair-kit.webp',
    'RB.410.20.005': '/img/p/robiel-41020005-high-pressure-fuel-pump-repair-parts-cp3s3-005-high.webp',
    'RB.410.20.044/1': '/img/p/robiel-410200441-high-pressure-fuel-pump-repair-parts-cp3-high-pressure.webp',
    'RB.410.20.047': '/img/p/robiel-41020047-valve-cp3-renault-master-suction-valve.webp',
    'RB.410.20.048': '/img/p/robiel-41020048-valve-repair-parts-denso-suction-valve.webp',
    'RB.410.20.049': '/img/p/robiel-41020049-fuel-pump-cp3hs3-pump-suction-valve.webp',
    'RB.410.20.052': '/img/p/robiel-41020052-valve-repair-parts-caterpillar-suction.webp',
    'RB.410.20.075': '/img/p/robiel-41020075-high-pressure-fuel-pump-repair-parts-bosch-cp3s3-075-high.webp',
    'RB.410.38.841': '/img/p/robiel-41038841-high-pressure-fuel-pump-cummins-cp2-high-pressure-pump.webp',
    'RB.410.40.003': '/img/p/robiel-41040003-fuel-pump-repair-parts-cummins-isx15.webp',
    'RB.410.53.129/1': '/img/p/robiel-410531291-high-pressure-fuel-pump-repair-parts-cp3-euro-5-high.webp',
    'RB.410.60.6352': '/img/p/robiel-410606352-high-pressure-fuel-pump-o-h-kit-repair-parts-cat-c4-c6.webp',
    'RB.410.70.4611': '/img/p/robiel-410704611-fuel-injector-repair-set-john-deere-9-0l.webp',
    'RB.415.00.18': '/img/p/robiel-4150018-fuel-injector-cat-c7-c9-heui-unit-injector.webp',
    'RB.415.00.22': '/img/p/robiel-4150022-fuel-injector-shim-set-bosch-cri-crin-common.webp',
    'RB.415.00.32': '/img/p/robiel-4150032-fuel-rail-shim-set-bosch-cri-1-0-2-2.webp',
    'RB.415.00.46': '/img/p/robiel-4150046-fuel-injector-cat-series-c-eui-unit-injector.webp',
    'RB.415.01.01': '/img/p/robiel-4150101-fuel-pump-shim-set-cat-c4-c6-inj-and-pump.webp',
    'RB.420.70.692': '/img/p/robiel-42070692-diesel-part-up-1938-unit-inj-w-screw.webp',
    'RB.421.01.720': '/img/p/robiel-42101720-o-ring-kit-o-ring-f-00r-0p0-397-pack-12pcs.webp',
    'RB.600.03.01': '/img/p/robiel-6000301-injector-nozzle-seal-ring-smaller-mbb-2324k.webp',
    'RB.801.04.15': '/img/p/robiel-8010415-injector-shim-adj-shim-inj-coil-spring-load.webp',
    'RB.803.02.200': '/img/p/robiel-80302200-injector-nozzle-adj-shim-nozzle-spring-load.webp',
    'RB.805.10.10': '/img/p/robiel-8051010-injector-shim-cav-1-00mm.webp',
    'RB.819.24.130': '/img/p/robiel-81924130-injector-shim-cp3-coil-armature-1-30mm.webp',
    'RB.819.31.6070': '/img/p/robiel-819316070-injector-shim-navistar-g2-8-0-70mm.webp',
    'RB.819.31.6080': '/img/p/robiel-819316080-injector-shim-navistar-g2-8-0-80mm.webp',
    'RB.819.31.6090': '/img/p/robiel-819316090-injector-shim-navistar-g2-8-0-90mm.webp',
    'RB.819.31.6100': '/img/p/robiel-819316100-injector-shim-navistar-g2-8.webp',
    'RB.821.24.161': '/img/p/robiel-82124161-solenoid-denso-5190-inj-solenoid-1-61mm.webp',
    'RB.821.24.162': '/img/p/robiel-82124162-solenoid-denso-5190-inj-solenoid-1-62mm.webp',
    'RB.821.24.163': '/img/p/robiel-82124163-solenoid-denso-5190-inj-solenoid-1-63mm.webp',
    'RB.822.26.238': '/img/p/robiel-82226238-fuel-injector-cat-common-rail-injector-nozzle-2.webp',
    'RB.B0104.50.37': '/img/p/robiel-b01045037-fuel-injector-bosch-piezo-injector.webp',
    'RB.B0408.00.01': '/img/p/robiel-b04080001-fuel-pump-taper-roller-bearings-cat-c7-c9.webp',
    'RB.BID.014.300': '/img/p/robiel-bid014300-fuel-injector-rod-5160-4-300-mm-denso-injector.webp',
    'RB.BID.024.300': '/img/p/robiel-bid024300-fuel-injector-rod-6490-4-300-mm-denso-injector.webp',
    'RB.BID.034.300': '/img/p/robiel-bid034300-fuel-injector-rod-23670-0l020-4-300-mm-denso.webp',
    'RB.BID.044.300': '/img/p/robiel-bid044300-fuel-injector-rod-16600-eb70a-4-300-mm-denso.webp',
    'RB.BID.044.305': '/img/p/robiel-bid044305-fuel-injector-rod-16600-eb70a-4-305-mm-denso.webp',
    'RB.BID.054.300': '/img/p/robiel-bid054300-fuel-injector-rod-1465a054-4-300-mm-denso.webp',
    'RB.BID.064.300': '/img/p/robiel-bid064300-fuel-injector-rod-6700-4-300-mm-denso-injector.webp',
    'RB.BID.084.300': '/img/p/robiel-bid084300-fuel-injector-rod-095000-631-4-300-mm-denso.webp',
    'RB.D00.36.221': '/img/p/robiel-d0036221-injector-shim-intermediate-shim-bosch-unit-inj.webp',
    'RB.ECP418005': '/img/p/robiel-ecp418005-fuel-pump-plunger-cat-pump-320d-938h-8.webp',
    'RB.EDS008505': '/img/p/robiel-eds008505-fuel-pump-plunger.webp',
    'RK-8295': '/img/p/rk8295-repair-kit-pin-volvo-23158295.webp',
    'SLP- SS-378': '/img/p/slpss378-diesel-part-retainer-ring-voe947378.webp',
    'SLP.CLT-0424': '/img/p/clt0424-seal-kit-cyl-liner-seal-scania-oe.webp',
    'SLP.CLT-199': '/img/p/clt199-seal-kit-cyl-liner-seal-scania-oe.webp',
    'TFC-881': '/img/p/tfc881-workshop-tool-for-trim-cylinder-volvo.webp',
    'VO.971321': '/img/p/volvo-971321-diesel-part-screw-voe971321.webp',
    'ZX.105015-4720': '/img/p/zexel-1050154720-diesel-part-head-rotor.webp',
    'ZX.105220-1910': '/img/p/zexel-1052201910-fuel-pump.webp',
    'ZX.105220-7010': '/img/p/1052207010-diesel-part-h-r.webp',
    'ZX.131150-0720': '/img/p/1311500720-diesel-part-plunger.webp',
    'ZX.131153-1220': '/img/p/zexel-1311531220-diesel-part-element.webp',
    'ZX.131154-3220': '/img/p/zexel-1311543220-diesel-part-plunger-assy.webp',
    'ZX.131499-2320': '/img/p/1314992320-repair-kit.webp',
    'ZX.140110-4420': '/img/p/1401104420-valve-delivery-valve.webp',
    'ZX.140153-9020': '/img/p/1401539020-diesel-part-zexel.webp',
    'ZX.140161-0120': '/img/p/1401610120-diesel-part-plunger-barrel-assy.webp',
    'ZX.146210-5720': '/img/p/1462105720-diesel-part-roller-assy.webp',
    'ZX.146403-9620': '/img/p/1464039620-diesel-part-hydraulic-head.webp',
    'ZX.146600-1120': '/img/p/1466001120-repair-kit-de-reparacion.webp',
    'ZX.152200-5420': '/img/p/zexel-1522005420-fuel-pump-hand-pump.webp',
    'ZX.154200-7920': '/img/p/1542007920-diesel-part-bosch-swivelling-lever.webp',
    'RB.415.00.00': '/img/p/robiel-4150000-injector-shim-briefcase.webp',
    'RB.415.00.15': '/img/p/robiel-4150015-fuel-injector-cat-c7-heui-unit-injector.webp',
    'RB.415.00.17': '/img/p/robiel-4150017-fuel-injector-cat-c9-c7-heui-unit-injector.webp',
    'RB.415.00.21': '/img/p/robiel-4150021-fuel-injector-bosch-cri-2-5-and-denso-g2-g3.webp',
    'RB.415.00.24': '/img/p/robiel-4150024-fuel-injector-cummins-isx-isl-foton-injector.webp',
    'RB.415.00.27': '/img/p/robiel-4150027-fuel-injector-denso-and-siemens-vdo-injectors.webp',
    'RB.415.00.28': '/img/p/robiel-4150028-fuel-injector-siemens-piezoelectric-injector.webp',
    'RB.415.00.35': '/img/p/robiel-4150035-fuel-injector-cat-3500-series-c-eui-unit.webp',
    'RB.415.00.37': '/img/p/robiel-4150037-fuel-injector-cat-delphi-eui-unit-injector-coil.webp',
    'RB.415.00.40': '/img/p/robiel-4150040-fuel-injector-delphi-a1-a2-eui-unit-injector.webp',
    'RB.415.00.44': '/img/p/robiel-4150044-fuel-injector-denso-injector-solenoid.webp',
    'RB.415.00.45': '/img/p/robiel-4150045-fuel-injector-denso-injector-spring-coil.webp',
    'RB.415.00.52': '/img/p/robiel-4150052-fuel-injector-cummins-isx15-xpi-common-rail.webp',
    'RB.800.02.110': '/img/p/robiel-80002110-injector-nozzle-hold-common-rail-nozzle-1-10.webp',
    'RB.800.02.113': '/img/p/robiel-80002113-injector-nozzle-hold-common-rail-nozzle-1-13mm.webp',
    'RB.800.02.115': '/img/p/robiel-80002115-injector-nozzle-hold-common-rail-nozzle-1-15.webp',
    'RB.800.02.118': '/img/p/robiel-80002118-fuel-injector-common-rail-injector-nozzle-1.webp',
    'RB.800.02.120': '/img/p/robiel-80002120-fuel-injector-common-rail-injector-nozzle-1.webp',
    'RB.800.02.123': '/img/p/robiel-80002123-fuel-injector-common-rail-injector-nozzle-1.webp',
    'RB.800.02.125': '/img/p/robiel-80002125-fuel-injector-common-rail-injector-nozzle-1.webp',
    'RB.800.07.160': '/img/p/robiel-80007160-fuel-injector-cat-common-rail-injector-coil-1.webp',
    'RB.800.07.232': '/img/p/robiel-80007232-fuel-injector-cat-common-rail-injector-coil-2.webp',
    'RB.800.28.030': '/img/p/robiel-80028030-injector-shim-iveco-eruo-v-30mm.webp',
    'RB.802.04.11': '/img/p/robiel-8020411-injector-shim-mwm-cummins-pre-injection-1-10-mm.webp',
    'RB.802.04.115': '/img/p/robiel-80204115-injector-shim-mwm-cummins-pre-injection-1-15-mm.webp',
    'RB.803.05.135': '/img/p/robiel-80305135-fuel-injector-bosch-common-rail-injector-nozzle.webp',
    'RB.803.05.140': '/img/p/robiel-80305140-fuel-injector-bosch-common-rail-injector-nozzle.webp',
    'RB.807.13.20': '/img/p/robiel-8071320-fuel-injector-denso-g2-injector-7-00x13-00x2.webp',
    'BO.0.281.006.017': '/img/p/bosch-0281006017-valve-pressure-relief-valve.webp',
    'BO.1.110.010.030': '/img/p/bosch-1110010030-valve-pressure-valve.webp',
    'BO.F.00N.210.061': '/img/p/bosch-f00n210061-control-valve.webp',
    'BO.F.00R.J00.308': '/img/p/bosch-f00rj00308-valve-bosch-valve-spring.webp',
    'BO.F.00R.J01.208': '/img/p/bosch-f00rj01208-injector-nozzle-nut-f-00r-j02-191.webp',
    'BO.F.00R.J01.941': '/img/p/bosch-f00rj01941-valve-0-445-120-0-445-120-140.webp',
    'BO.F.00R.J02.177': '/img/p/bosch-f00rj02177-repair-kit-o-ring-kit.webp',
    'BO.F.00V.C01.022': '/img/p/bosch-f00vc01022-valve-0-445-110-141.webp',
    'BO.F.00V.C01.363': '/img/p/bosch-f00vc01363-valve-0-445-110-255.webp',
    'BO.F.00V.C99.002': '/img/p/bosch-f00vc99002-repair-kit-repair-set-seals-kit.webp',
    'DE.HDF924': '/img/p/delphi-hdf924-diesel-part-diesel-fuel-filter.webp',
    'DN.096140-0030': '/img/p/denso-0961400030-fuel-pump-feed-pump.webp',
    'DN.096417-0040': '/img/p/denso-0964170040-diesel-part-tapon.webp',
    'DN.294009-0052': '/img/p/denso-2940090052-fuel-pump-denso-overhaul-kit-supply-pump.webp',
    'DN.294009-0120': '/img/p/denso-2940090120-fuel-pump-scv-bomba-inyeccion-hp3.webp',
    'DN.294180-0100': '/img/p/denso-2941800100-fuel-pump-denso-feed-pump.webp',
    'DN.294183-0160': '/img/p/denso-2941830160-fuel-pump-plate-of-feed-pump.webp',
    'DN.294183-5020': '/img/p/denso-2941835020-fuel-pump-denso-feed-pump.webp',
    'DN.294184-0140': '/img/p/denso-2941840140-fuel-pump-feed-pump-cover.webp',
    'DN.294184-5000': '/img/p/denso-2941845000-diesel-part-cover.webp',
    'DN.294184-5040': '/img/p/denso-2941845040-fuel-pump-feed-pump-cover-hp4.webp',
    'DN.294191-0080': '/img/p/denso-2941910080-diesel-part-denso-drive-shaft.webp',
    'JV.10.805.176': '/img/p/jv-diesel-10805176-repair-kit.webp',
    'JV.10.805.177': '/img/p/jv-diesel-10805177-fuel-injector-euro-5-bosch-f-00r-j02.webp',
    'JV.10.805.609': '/img/p/jv-diesel-10805609-fuel-injector-fiat-iveco.webp',
    'JV.10.807.369': '/img/p/jv-diesel-10807369-fuel-injector-amarok.webp',
    'JV.10.823.214': '/img/p/jv-diesel-10823214-repair-kit-universal-214.webp',
    'JV.30.001.025': '/img/p/jv-diesel-30001025-fuel-injector-o-a-ring-injector-120-074-bosch-f.webp',
    'JV.30.003.149': '/img/p/jv-diesel-30003149-fuel-injector-washer-for-injector-120-186-120.webp',
    'JV.30.800.975': '/img/p/jv-diesel-30800975-fuel-pump-cp3-iveco-bosch-f-00n-201-975.webp',
    'JV.81.800.351': '/img/p/jv-diesel-81800351-fuel-pump-cat-c4-c6.webp',
    'JV.PEC25547': '/img/p/jv-diesel-pec25547-diesel-part-copper-shild.webp',
    'JV.PEC25558': '/img/p/jv-diesel-pec25558-injector-shim-java-cylinder-head-shim.webp',
    'RB.250.21.70': '/img/p/robiel-2502170-fuel-pump-unit-pump-screw-injector-solenoid.webp',
    'RB.323.01.3241': '/img/p/robiel-323013241-diesel-part-hardware-vice.webp',
    'RB.324.10.10': '/img/p/robiel-3241010-workshop-tool-retaining-bushing-wrench-248-273.webp',
    'RB.324.13.271': '/img/p/robiel-32413271-diesel-part-device-to-remove-the-delphi-cat.webp',
    'RB.324.15.01': '/img/p/robiel-3241501-fuel-injector-support-assembly.webp',
    'RB.324.55.00': '/img/p/robiel-3245500-high-pressure-fuel-pump-bracket-diesel-high-pressure.webp',
    'RB.324.55.01': '/img/p/robiel-3245501-high-pressure-fuel-pump-fixing-flange-bosch-cp3.webp',
    'RB.410.00.26': '/img/p/robiel-4100026-fuel-injector-repair-parts-sprinter-cr-injector.webp',
    'RB.410.00.281': '/img/p/robiel-41000281-injector-nozzle-repair-parts-crin-mwm-nozzle.webp',
    'RB.410.00.29': '/img/p/robiel-4100029-injector-nozzle-repair-parts-crin-cummins-nozzle.webp',
    'RB.410.00.37': '/img/p/robiel-4100037-repair-kit.webp',
    'RB.410.00.38': '/img/p/robiel-4100038-repair-kit.webp',
    'RB.410.00.39': '/img/p/robiel-4100039-fuel-injector-repair-parts-mwm-crin-3-euro-v.webp',
    'RB.410.00.40': '/img/p/robiel-4100040-fuel-injector-repair-set-man-injector-crin3.webp',
    'RB.410.00.41': '/img/p/robiel-4100041-fuel-injector-repair-set-man-injector-crin2.webp',
    'RB.410.08.369': '/img/p/robiel-41008369-fuel-injector-complete-repair-parts-amarok.webp',
    'RB.410.15.105': '/img/p/robiel-41015105-fuel-pump-pes-6a-d-2000-pump-dgk-105.webp',
    'RB.410.15.107': '/img/p/robiel-41015107-fuel-pump-pes-6a-d-3000-pump-dgk-107.webp',
    'RB.410.15.121': '/img/p/robiel-41015121-fuel-pump-ve-pump-dgk-121.webp',
    'RB.410.15.209': '/img/p/robiel-41015209-pressure-regulator-re-30-regulator-dgk-209.webp',
    'RB.410.15.301': '/img/p/robiel-41015301-fuel-pump-fp-k-ke-ks-feed-pump-dgk-301.webp',
    'RB.410.15.306': '/img/p/robiel-41015306-fuel-pump-fp-kg-feed-pump-dgk-306.webp',
    'RB.410.15.306/1': '/img/p/robiel-410153061-fuel-pump-fp-kg-feed-pump-dgk-306-w-filter.webp',
    'RB.410.20.076': '/img/p/robiel-41020076-valve-cp3s3-075-man-suction-valve.webp',
    'RB.410.20.533': '/img/p/robiel-41020533-fuel-pump-bosch-cp4-pump-suction-valve.webp',
    'RB.410.40.832': '/img/p/robiel-41040832-repair-kit.webp',
    'RB.410.61.012': '/img/p/robiel-41061012-diesel-part-external-repair-parts-caterpillar.webp',
    'RB.410.61.394': '/img/p/robiel-41061394-repair-kit.webp',
    'RB.415.00.011': '/img/p/robiel-41500011-diesel-part-parts-set-cri-crin-repairing-r2.webp',
    'RB.421.02.115': '/img/p/robiel-42102115-o-ring-kit-o-ring-black-21-00x1-50-f-00v-c38.webp',
    'RB.424.07.917': '/img/p/robiel-42407917-diesel-part-profile-ring-beige-7-40x1-70-mm.webp',
    'RB.424.08.10E': '/img/p/robiel-4240810e-fuel-injector-repair-parts-common-rail-injector.webp',
    'RB.807.17.16': '/img/p/robiel-8071716-diesel-part-washer-steel-pack-24pcs.webp',
    'SLP.PIK-545': '/img/p/pik545-repair-kit-slp-standard-piston-kit-for-volvo.webp',
    'ZX.131152-5320': '/img/p/1311525320-diesel-part-plunger-a183.webp',
    'ZX.131160-1120': '/img/p/1311601120-valve-delivery-valve-a92.webp',
    'ZX.134178-1620': '/img/p/1341781620-diesel-part-134178-1620-zexel-9-443-610-595.webp',
    'ZX.150560-2400': '/img/p/1505602400-diesel-part-spring-seat.webp',
    'RB.323.02.121': '/img/p/robiel-32302121-cleaning-brush-rail.webp',
    'RB.323.02.291': '/img/p/robiel-32302291-tightness-test-tool-crin-3-cr-valve.webp',
    'RB.323.50.39': '/img/p/robiel-3235039-tool-set-delphi-e3-hd-cat-15-unit.webp',
    'RB.323.50.041': '/img/p/robiel-32350041-tool-set-bosch-eui-eup-valve-changeover.webp',
    'RB.323.50.043': '/img/p/robiel-32350043-tool-set-bosch-eui-eup-valve-changeover.webp',
    'RB.323.50.063': '/img/p/robiel-32350063-tool-set-common-rail-bosch-crin-2-crin-3.webp',
    'RB.323.50.072': '/img/p/robiel-32350072-tool-set-common-rail-bosch-cri-1-0-2-1.webp',
    'RB.323.50.111': '/img/p/robiel-32350111-tool-set-bosch-eui-eup-units-tool-kit.webp',
    'RB.323.50.35': '/img/p/robiel-3235035-tool-set-cp1h-cp1h3-bosch-pump.webp',
    'RB.350.50.041': '/img/p/robiel-35050041-tool-set-bosch-eui-eup-valve-changeover.webp',
    'RB.350.50.33': '/img/p/robiel-3505033-tool-set-delphi-eui-sarie-a1-a3-e1-e3-ncv.webp',
    'BO.0.445.214.059': '/img/p/bosch-0445214059-fuel-rail-fiat-ducato-iveco-daily.webp',
    'BO.0.445.214.100': '/img/p/bosch-0445214100-fuel-rail-ducato-3-0-2006-a-2014-iveco.webp',
    'BO.0.445.223.005': '/img/p/bosch-0445223005-fuel-rail-assy.webp',
    'BO.0.445.226.040': '/img/p/bosch-0445226040-fuel-rail-qsc-qsm11.webp',
    'BO.0.445.226.042': '/img/p/bosch-0445226042-fuel-rail.webp',
    'BO.0.455.214.274': '/img/p/bosch-0455214274-fuel-rail.webp',
    'DE. 28263779': '/img/p/delphi-28263779-fuel-rail-common-d34-7256757-725-6757.webp',
    '45PP3-1': '/img/p/45pp31-sensor-3-pin-thin-screw-nissan.webp',
    'DE.28357705': '/img/p/delphi-28357705-fuel-rail-sensor-rail.webp',
    'DN.499000-6160': '/img/p/denso-4990006160-fuel-rail-sensor-rail.webp',
    'DN.499000-6320': '/img/p/denso-4990006320-fuel-rail-toyota.webp',
    'DN.499000-6340': '/img/p/denso-4990006340-fuel-rail-toyota.webp',
    'LD.55PP30-01': '/img/p/lead-55pp3001-fuel-rail-pressure-sensor-9307-528a.webp',
    'BO.0.445.226.025': '/img/p/bosch-0445226025-fuel-rail-constellation-19-320e-2006-ford.webp',
    'DN.17520-EB75D': '/img/p/denso-17520eb75d-fuel-rail-nissan.webp',
    'LD.55PP06-03': '/img/p/lead-55pp0603-fuel-rail-pressure-sensor-5ws40039.webp',
    'BO.0.433.171.962': '/img/p/bosch-0433171962-injector-nozzle-cr-nozzle.webp',
    'MX.2419680': '/img/p/lead-2419680-fuel-injector-scania-dc09.webp',
    'BO.0.433.171.953': '/img/p/bosch-0433171953-injector-nozzle.webp',
    'LD.G3S67': '/img/p/lead-g3s67-injector-nozzle-g3s67-1j705-53052.webp',
    'LD.G3S19': '/img/p/lead-g3s19-injector-nozzle-g3s19-295050-086-095000-059.webp',
    'LD.G3S72': '/img/p/lead-g3s72-injector-nozzle-g3s72-295050-143.webp',
    'LD.F.00V.X50.083': '/img/p/lead-f00vx50083-fuel-injector-crin-4-2-for-injector-0-445-120.webp',
    'BO.0.433.172.013': '/img/p/bosch-0433172013-injector-nozzle-dlla146p1562.webp',
    'KS.G3S146': '/img/p/king-star-g3s146-injector-nozzle-for-9729505-146-1j702-53051-for.webp',
    'KS.G3S68': '/img/p/king-star-g3s68-injector-nozzle-for-9729505-134-1j706-53052-for.webp',
    'BO.0.433.175.309': '/img/p/bosch-0433175309-injector-nozzle-cr-nozzle.webp',
    'DN.093500-7500': '/img/p/denso-0935007500-injector-nozzle-holder.webp',
    'DN.093400-3020': '/img/p/denso-0934003020-injector-nozzle.webp',
    'BO.0.433.171.562': '/img/p/bosch-0433171562-injector-nozzle.webp',
    'DN.093400-6380': '/img/p/denso-0934006380-injector-nozzle.webp',
    'DN.093400-5840': '/img/p/denso-0934005840-injector-nozzle.webp',
    'BO.0.433.172.083': '/img/p/bosch-0433172083-injector-nozzle-dlla126p1776.webp',
    'LD.ISL.2165.07': '/img/p/lead-isl216507-injector-nozzle-needle-isl.webp',
    'DE.6980584': '/img/p/delphi-6980584-injector-nozzle-295050-054.webp',
    'DN.093400-1590': '/img/p/denso-0934001590-injector-nozzle.webp',
    'DN.093400-1530': '/img/p/denso-0934001530-injector-nozzle.webp',
    'DN.093400-0942': '/img/p/denso-0934000942-injector-nozzle.webp',
    'DN.093400-7580': '/img/p/denso-0934007580-injector-nozzle.webp',
    'BO.0.433.171.655': '/img/p/bosch-0433171655-injector-nozzle-dlla150p1012.webp',
    'DN.093400-9131': '/img/p/denso-0934009131-injector-nozzle.webp',
    'DN.093400-1300': '/img/p/denso-0934001300-injector-nozzle.webp',
    'LD.10R1273': '/img/p/lead-10r1273-injector-nozzle-cat-3406e-c15.webp',
    'ZX.105017-3760': '/img/p/zexel-1050173760-injector-nozzle.webp',
    'BO.0.433.172.337': '/img/p/bosch-0433172337-injector-nozzle-0-445-110-561.webp',
    'ZX.105017-2620': '/img/p/zexel-1050172620-injector-nozzle-dlla156pn262.webp',
    'DN.093400-5200': '/img/p/denso-0934005200-injector-nozzle.webp',
    'DN.093164-1360': '/img/p/denso-0931641360-injector-nozzle-nut-nozzle-retaining.webp',
    'FB.BSLA124P1309': '/img/p/fratelli-bosio-bsla124p1309-injector-nozzle-0-445-120-032.webp',
    'DE.L328PBA': '/img/p/delphi-l328pba-injector-nozzle.webp',
    'DN.093400-8330': '/img/p/denso-0934008330-injector-nozzle.webp',
    'DN.093400-5250': '/img/p/denso-0934005250-injector-nozzle.webp',
    'DN.093400-2970': '/img/p/denso-0934002970-injector-nozzle.webp',
    'DN.093400-2630': '/img/p/denso-0934002630-injector-nozzle.webp',
    'DN.093400-1220': '/img/p/denso-0934001220-injector-nozzle.webp',
    'DN.093400-1160': '/img/p/denso-0934001160-injector-nozzle.webp',
    'DN.093400-0010': '/img/p/denso-0934000010-injector-nozzle.webp',
    'ZX.105025-4000': '/img/p/zexel-1050254000-injector-nozzle-hole-type-nozzle.webp',
    'ZX.105025-2910': '/img/p/zexel-1050252910-injector-nozzle.webp',
    'FB.BLLA147P2172': '/img/p/fratelli-bosio-blla147p2172-injector-nozzle-0-445-124-010-011.webp',
    'FB.BLLA130G3S72': '/img/p/fratelli-bosio-blla130g3s72-injector-nozzle-295050-143.webp',
    'RB.220.03.09': '/img/p/robiel-2200309-fuel-injector-protective-cap-injector-nozzle-9.webp',
    'BO.0.433.175.453': '/img/p/bosch-0433175453-injector-nozzle-dsla146p1527.webp',
    'DE.L053PBC': '/img/p/delphi-l053pbc-injector-nozzle-bebj1a0000.webp',
    'BO.0.433.172.051': '/img/p/bosch-0433172051-injector-nozzle-0-445-120-133.webp',
    'DN.093400-9920': '/img/p/denso-0934009920-injector-nozzle-assy.webp',
    'DN.093400-0081': '/img/p/denso-0934000081-injector-nozzle.webp',
    'DN.093400-6400': '/img/p/denso-0934006400-injector-nozzle-dlla154pn061.webp',
    'DN.093400-0970': '/img/p/denso-0934000970-injector-nozzle.webp',
    'DN.093400-5030': '/img/p/denso-0934005030-injector-nozzle.webp',
    'DN.093400-2020': '/img/p/denso-0934002020-injector-nozzle.webp',
    'BO.0.433.172.234': '/img/p/bosch-0433172234-injector-nozzle-0-445-120-272.webp',
    'DE.L218PBC': '/img/p/delphi-l218pbc-injector-nozzle-re517660.webp',
    'DE.L011PBB': '/img/p/delphi-l011pbb-injector-nozzle-bebe4b04001.webp',
    'LD.DSLA154P1320': '/img/p/lead-dsla154p1320-injector-nozzle-0-445-110-189.webp',
    'LD.DLLA155P840': '/img/p/lead-dlla155p840-injector-nozzle-095000-6521.webp',
    'LD.DLLA144P2273': '/img/p/lead-dlla144p2273-injector-nozzle-0-445-120-304.webp',
    'LD.DLLA143P1536': '/img/p/lead-dlla143p1536-injector-nozzle-0-445-120-054.webp',
    'LD.DLLA118P1677': '/img/p/lead-dlla118p1677-injector-nozzle-0-445-120-112.webp',
    'LD.CR76160-C800T': '/img/p/lead-cr76160c800t-injector-nozzle-c7-nozzles-lead.webp',
    'DN.096400-5640': '/img/p/denso-0964005640-injector-nozzle-dn4pd57-for-2l-3l-engine.webp',
    'ZX.105158-5002': '/img/p/zexel-1051585002-injector-nozzle-and-holder-as.webp',
    'BO.0.433.172.084': '/img/p/bosch-0433172084-injector-nozzle-0-445-120-148.webp',
    'BO.0.433.175.470': '/img/p/bosch-0433175470-injector-nozzle-0-445-120-032-103-114.webp',
    'BO.0.432.191.684': '/img/p/bosch-0432191684-injector-nozzle-861103.webp',
    'ZX.105007-1620': '/img/p/zexel-1050071620-injector-nozzle.webp',
    'BO.0.433.175.062': '/img/p/bosch-0433175062-injector-nozzle-0-432-193-833.webp',
    'BO.0.432.131.743': '/img/p/bosch-0432131743-injector-nozzle-and-holder.webp',
    'FI.ALLA150PM032': '/img/p/alla150pm032-injector-nozzle.webp',
    'BO.0.432.217.104': '/img/p/bosch-0432217104-fuel-injector-nozzle.webp',
    'BO.0.433.171.961': '/img/p/bosch-0433171961-injector-nozzle-0-445-120-340.webp',
    'DE.L130PBA': '/img/p/delphi-l130pba-injector-nozzle.webp',
    'LD.10R8502': '/img/p/lead-10r8502-injector-nozzle-cat-3406e-c15.webp',
    'LD.10R8501': '/img/p/lead-10r8501-injector-nozzle-cat-c15-10r8501.webp',
    'BO.0.430.233.022': '/img/p/bosch-0430233022-injector-nozzle-holder.webp',
    'ZX.105007-1080': '/img/p/zexel-1050071080-injector-nozzle.webp',
    'BO.0.433.271.269': '/img/p/bosch-0433271269-injector-nozzle-0-432-291-838.webp',
    'DN.293400-0330': '/img/p/denso-2934000330-injector-nozzle-alla144g3s33.webp',
    'BO.9.430.084.738': '/img/p/bosch-9430084738-injector-nozzle.webp',
    'FI.M0032P150': '/img/p/m0032p150-injector-nozzle-16600-8052r.webp',
    'BO.0.433.172.063': '/img/p/bosch-0433172063-injector-nozzle-0-445-120-144.webp',
    'BO.0.433.271.423': '/img/p/bosch-0433271423-injector-nozzle-dlla144s829.webp',
    'FB.BLLA155FVX40115': '/img/p/fratelli-bosio-blla155fvx40115-injector-nozzle-0-445-117-043.webp',
    'BO.0.433.172.205': '/img/p/bosch-0433172205-injector-nozzle-0-445-120-253.webp',
    'ZX.105015-5950': '/img/p/zexel-1050155950-injector-nozzle.webp',
    'BO.F.00V.C09.023': '/img/p/bosch-f00vc09023-injector-nozzle-bosch-nozzle-spring.webp',
    'DE.LP052B': '/img/p/delphi-lp052b-injector-nozzle.webp',
    'BO.0.433.175.114': '/img/p/bosch-0433175114-diesel-part-dsla134p604.webp',
    'BO.0.433.172.201': '/img/p/bosch-0433172201-injector-nozzle-0-445-120-237.webp',
    'KS.6970013': '/img/p/kingstar-6970013-injector-nozzle.webp',
    'KS.L221PBC': '/img/p/kingstar-l221pbc-injector-nozzle.webp',
    'KS.DSLA145P1479': '/img/p/kingstar-dsla145p1479-injector-nozzle-dsla145p1479.webp',
    'KS.6980041': '/img/p/kingstar-6980041-injector-nozzle-dlla145p310.webp',
    'KS.DLLA143P1536': '/img/p/kingstar-dlla143p1536-injector-nozzle-0-445-120-054.webp',
    'KS.DLLA137P1648': '/img/p/kingstar-dlla137p1648-injector-nozzle-0-445-120-092.webp',
    'KS.DN4PD57': '/img/p/kingstar-dn4pd57-injector-nozzle.webp',
    'KS.6801180': '/img/p/kingstar-6801180-injector-nozzle.webp',
    'KS.7135-573': '/img/p/kingstar-7135573-injector-nozzle-kit.webp',
    'KS.DLLA150P110': '/img/p/kingstar-dlla150p110-injector-nozzle-0-432-191-815.webp',
    'KS.6980081': '/img/p/kingstar-6980081-injector-nozzle-dsla145p265.webp',
    'KS.6801072': '/img/p/kingstar-6801072-injector-nozzle.webp',
    'KS.L066PBA': '/img/p/kingstar-l066pba-injector-nozzle.webp',
    'KS.6980079': '/img/p/kingstar-6980079-injector-nozzle-dlla148p597.webp',
    'KS.L322PBC': '/img/p/kingstar-l322pbc-injector-nozzle.webp',
    'KS.L222PBC': '/img/p/kingstar-l222pbc-injector-nozzle.webp',
    'KS.L004cva': '/img/p/kingstar-l004cva-injector-nozzle.webp',
    'KS.6801164': '/img/p/kingstar-6801164-injector-nozzle.webp',
    'KS.6801174': '/img/p/kingstar-6801174-injector-nozzle.webp',
    'KS.6980090': '/img/p/kingstar-6980090-injector-nozzle-dsla145p311.webp',
    'KS.7135-580': '/img/p/kingstar-7135580-injector-nozzle-kit.webp',
    'KS.7135-625': '/img/p/kingstar-7135625-injector-nozzle-kit.webp',
    'KS.L001PBC': '/img/p/kingstar-l001pbc-injector-nozzle.webp',
    'KS.017PBB': '/img/p/kingstar-017pbb-injector-nozzle.webp',
    'KS.6801115': '/img/p/kingstar-6801115-injector-nozzle.webp',
    'KS.6801022': '/img/p/kingstar-6801022-injector-nozzle.webp',
    'FB.BLLA124P2200': '/img/p/fratelli-bosio-blla124p2200-injector-nozzle.webp',
    'DN.093400-8601': '/img/p/denso-0934008601-injector-nozzle-dlla145p860.webp',
    'DN.093400-8591': '/img/p/denso-0934008591-injector-nozzle-dlla145p859.webp',
    'ZX.105015-9750': '/img/p/zexel-1050159750-injector-nozzle.webp',
    'LD.105007-1290': '/img/p/lead-1050071290-injector-nozzle-dn10pdn129.webp',
    'LD.105000-2260': '/img/p/lead-1050002260-injector-nozzle-dn0sdn226.webp',
    'LD.105017-2040': '/img/p/lead-1050172040-injector-nozzle-9-432-610-380.webp',
    'LD.105017-3450': '/img/p/lead-1050173450-injector-nozzle-dlla148pn345.webp',
    'LD.105025-4200': '/img/p/lead-1050254200-injector-nozzle-dlla156sm420.webp',
    'LD.105017-3150': '/img/p/lead-1050173150-injector-nozzle-dlla150pn315.webp',
    'LD.105017-2830': '/img/p/lead-1050172830-injector-nozzle-dlla148pn283.webp',
    'LD.093400-5590': '/img/p/lead-0934005590-injector-nozzle-dlla150p59.webp',
    'LD.093400-8080': '/img/p/lead-0934008080-injector-nozzle-dlla150p808.webp',
    'LD.105007-1170': '/img/p/lead-1050071170-injector-nozzle-dn4pdn117.webp',
    'LD.093400-7700': '/img/p/lead-0934007700-injector-nozzle-dn10pdn130.webp',
    'LD.093400-1310': '/img/p/lead-0934001310-injector-nozzle-dn0sd193.webp',
    'LD.DN0PDN704': '/img/p/lead-dn0pdn704-injector-nozzle.webp',
    'LD.093400-8220': '/img/p/lead-0934008220-injector-nozzle-dn0pdn121.webp',
    'LD.093400-6760': '/img/p/lead-0934006760-injector-nozzle-dn0pdn112.webp',
    'LD.093400-5571': '/img/p/lead-0934005571-injector-nozzle-dn4pd57.webp',
    'ZX.105025-2090': '/img/p/zexel-1050252090-injector-nozzle.webp',
    'BO.0.433.171.751': '/img/p/bosch-0433171751-injector-nozzle-bosch-nozzle-repair-kit.webp',
    'FB.G3S51_OLD': '/img/p/fratelli-bosio-g3s51old-injector-nozzle-295050-1050-295050-0300-16600.webp',
    'ZX.105019-2180': '/img/p/zexel-1050192180-injector-nozzle-set-c53ky-nozzle-kit-nz-kit-n-nh.webp',
    'BO.F.019.121.034': '/img/p/bosch-f019121034-injector-nozzle-dlla153p034.webp',
    'ZX.105015-8810': '/img/p/zexel-1050158810-injector-nozzle-dlla160sk881.webp',
    'BO.0.433.175.500': '/img/p/bosch-0433175500-injector-nozzle-0-445-120-208.webp',
    'ZX.105019-2850': '/img/p/zexel-1050192850-injector-nozzle.webp',
    'FI.ALLA152G3S51': '/img/p/alla152g3s51-injector-nozzle-295050-1050-295050-0300-16600.webp',
    'ZX.105019-1390': '/img/p/zexel-1050191390-injector-nozzle.webp',
    'FB.P2170-BLK': '/img/p/fratelli-bosio-p2170blk-injector-nozzle-0-445-120-220.webp',
    'BO.0.433.175.456': '/img/p/bosch-0433175456-injector-nozzle-0-445-120-057.webp',
    'ZX.105017-1770': '/img/p/1050171770-injector-nozzle.webp',
    'ZX.150601-4201': '/img/p/1506014201-injector-nozzle-retaining-nut.webp',
    'DN.093400-1420': '/img/p/denso-0934001420-injector-nozzle-dn4sdnd142.webp',
    'DN.093164-1351': '/img/p/denso-0931641351-injector-nozzle-holder.webp',
    'ZX.105025-1390': '/img/p/1050251390-injector-nozzle-dlla156sm139.webp',
    'FB.BLLA148P826': '/img/p/fratelli-bosio-blla148p826-injector-nozzle-dlla148p828-suitable-095000-5190.webp',
    'FB.BLLA148P820': '/img/p/fratelli-bosio-blla148p820-injector-nozzle-re524362-095000-5160.webp',
    'ZX.105015-5860': '/img/p/1050155860-injector-nozzle.webp',
    'BO.0.433.172.224': '/img/p/bosch-0433172224-injector-nozzle-0-445-120-269.webp',
    'BO.0.433.272.994': '/img/p/bosch-0433272994-injector-nozzle-dlla145s1330.webp',
    'BO.0.433.175.449': '/img/p/bosch-0433175449-injector-nozzle-0-445-120-059.webp',
    'DN.093400-2290': '/img/p/denso-0934002290-injector-nozzle-dlla150sd229.webp',
    'BO.0.433.171.893': '/img/p/bosch-0433171893-injector-nozzle-dlla140p1445.webp',
    'DN.093400-5571': '/img/p/denso-0934005571-injector-nozzle.webp',
    'FB.BLLA158P7154': '/img/p/fratelli-bosio-blla158p7154-injector-nozzle-bebe4b01001-lp004b-for-volvo-fh12.webp',
    'BO.0.433.175.316': '/img/p/bosch-0433175316-injector-nozzle-dlla140p1086.webp',
    'DN.093400-5090': '/img/p/denso-0934005090-injector-nozzle.webp',
    'DN.093400-2292': '/img/p/denso-0934002292-injector-nozzle.webp',
    'BO.0.433.175.387': '/img/p/bosch-0433175387-injector-nozzle-dsla151p1302.webp',
    'DN.293400-0070': '/img/p/denso-2934000070-injector-nozzle-23670-0l100.webp',
    'BO.0.433.171.303': '/img/p/bosch-0433171303-injector-nozzle-dlla134p422.webp',
    'BO.F.000.430.900': '/img/p/bosch-f000430900-injector-nozzle-137p793.webp',
    'FI.ALLA152P862': '/img/p/alla152p862-injector-nozzle-0-445-120-057.webp',
    'FB.BLLA147P788-J': '/img/p/fratelli-bosio-blla147p788j-injector-nozzle-095000-094-095000-077.webp',
    'FB.BLLA155P853-J': '/img/p/fratelli-bosio-blla155p853j-injector-nozzle-095000-546x.webp',
    'DE.6801093': '/img/p/delphi-6801093-injector-nozzle-6703203.webp',
    'BO.0.433.175.271': '/img/p/bosch-0433175271-injector-nozzle-0-445-120-007.webp',
    'BO.0.433.171.688': '/img/p/bosch-0433171688-injector-nozzle-dlla156p1059-hole-type.webp',
    'BO.0.433.175.478': '/img/p/bosch-0433175478-injector-nozzle-dsla153p1710.webp',
    'ZX.105015-5640': '/img/p/1050155640-injector-nozzle-dlla160sn564.webp',
    'ZX.105015-9460': '/img/p/1050159460-injector-nozzle-dlla155sn946.webp',
    'BO.0.433.171.621': '/img/p/bosch-0433171621-injector-nozzle-dlla152p932.webp',
    'ZX.105025-1670': '/img/p/1050251670-injector-nozzle-dlla145sm167.webp',
    'ZX.105017-1080': '/img/p/1050171080-injector-nozzle.webp',
    'BO.0.433.171.881': '/img/p/bosch-0433171881-injector-nozzle-dlla140p1420.webp',
    'BO.0.433.171.867': '/img/p/bosch-0433171867-injector-nozzle-dlla135p1400.webp',
    'ZX.105017-0360': '/img/p/1050170360-injector-nozzle.webp',
    'ZX.105017-1350': '/img/p/1050171350-injector-nozzle.webp',
    'BO.0.433.172.037': '/img/p/bosch-0433172037-injector-nozzle-0-445-120-067.webp',
    'ZX.105025-4070': '/img/p/1050254070-injector-nozzle.webp',
    'FI.ALLA145G3S50': '/img/p/alla145g3s50-injector-nozzle-alla145g3s50.webp',
    'ZX.105017-1070': '/img/p/1050171070-injector-nozzle-dlla155pk107.webp',
    'FB.BLLA154G3S6': '/img/p/fratelli-bosio-blla154g3s6-injector-nozzle-295050-046x.webp',
    'BO.0.433.172.198': '/img/p/bosch-0433172198-injector-nozzle-0-445-120-251.webp',
    'KS.DSLA143P970 KIT': '/img/p/dsla143p970kit-injector-nozzle-0-445-120-007.webp',
    'BO.0.433.171.870': '/img/p/bosch-0433171870-injector-nozzle-0-445-120-043.webp',
    'ZX.105017-1410': '/img/p/1050171410-injector-nozzle-dlla160pn141.webp',
    'ZX.105025-2240': '/img/p/1050252240-injector-nozzle-dlla160pn141.webp',
    'ZX.105025-2340': '/img/p/1050252340-injector-nozzle-dlla150sm234.webp',
    'BO.DLLA145P1024': '/img/p/bosch-dlla145p1024-injector-nozzle-095000-776x.webp',
    'FB.BLLA150P1512': '/img/p/fratelli-bosio-blla150p1512-fuel-injector-dlla150p1512-injector-0-445-110.webp',
    'ST.27333': '/img/p/27333-injector-nozzle.webp',
    'BO.0.433.171.963': '/img/p/bosch-0433171963-injector-nozzle-dlla150p1564.webp',
    'BO.0.433.171.818': '/img/p/bosch-0433171818-injector-nozzle-dlla146p1311.webp',
    'BO.0.433.171.774': '/img/p/bosch-0433171774-injector-nozzle-dlla150p1224.webp',
    'BO.0.433.171.720': '/img/p/bosch-0433171720-injector-nozzle-dlla158p1116.webp',
    'BO.0.433.271.521': '/img/p/bosch-0433271521-injector-nozzle-dlla138s1191.webp',
    'BO.0.433.171.487': '/img/p/bosch-0433171487-injector-nozzle-dlla155p670.webp',
    'BO.0.433.171.462': '/img/p/bosch-0433171462-injector-nozzle-dlla150p615.webp',
    'BO.0.433.171.394': '/img/p/bosch-0433171394-injector-nozzle-dlla152p531.webp',
    'BO.0.433.171.247': '/img/p/bosch-0433171247-injector-nozzle-dlla152p347.webp',
    'BO.0.433.171.058': '/img/p/bosch-0433171058-injector-nozzle-dlla160p58.webp',
    'BO.0.433.171.274': '/img/p/bosch-0433171274-injector-nozzle-dlla148p329-for-6081-at-002-6081.webp',
    'ZX.105015-4560': '/img/p/1050154560-injector-nozzle.webp',
    'ZX.105015-5820': '/img/p/1050155820-injector-nozzle.webp',
    'FB.BLLA144P2170': '/img/p/fratelli-bosio-blla144p2170-injector-nozzle-0-445-120-220.webp',
    'DN.093400-6260': '/img/p/denso-0934006260-injector-nozzle-tobera.webp',
    'BO.DSLA135P1309': '/img/p/bosch-dsla135p1309-injector-nozzle-0-445-120-032.webp',
    'BO.0.433.175.167': '/img/p/bosch-0433175167-injector-nozzle-dsla147p741.webp',
    'ZX.105017-9030': '/img/p/1050179030-injector-nozzle.webp',
    'ZX.105017-3120': '/img/p/1050173120-injector-nozzle.webp',
    'ZX.150650-9600': '/img/p/1506509600-injector-nozzle-connecting-nut.webp',
    'FB.BLLA160P3': '/img/p/fratelli-bosio-blla160p3-injector-nozzle.webp',
    'ZX.105019-1211': '/img/p/1050191211-injector-nozzle.webp',
    'FI.DLLA145P870': '/img/p/dlla145p870-injector-nozzle-095000-5600.webp',
    'DN.093400-6660': '/img/p/denso-0934006660-injector-nozzle-23600-59245.webp',
    'ZX.105000-1600': '/img/p/1050001600-injector-nozzle.webp',
    'BO.0.433.171.224': '/img/p/bosch-0433171224-injector-nozzle-dlla152p313.webp',
    'BO.0.433.175.472': '/img/p/bosch-0433175472-injector-nozzle-dsla145p1679.webp',
    'FB.BLLA156P1114': '/img/p/fratelli-bosio-blla156p1114-injector-nozzle-0-445-110-091-092-306.webp',
    'ZX.105025-1290': '/img/p/1050251290-injector-nozzle.webp',
    'BO.9.432.610.821': '/img/p/bosch-9432610821-injector-nozzle-dlla145sm012.webp',
    'DN.093400-7180': '/img/p/denso-0934007180-injector-nozzle-dlla145p684-for-toyota-1hd-fte.webp',
    'ZX.105007-1240': '/img/p/1050071240-injector-nozzle.webp',
    'ZX.105019-2550': '/img/p/1050192550-injector-nozzle.webp',
    'FB.BLLA137P1577': '/img/p/fratelli-bosio-blla137p1577-injector-nozzle-0-445-120-075.webp',
    'FB.BLLA139P925': '/img/p/fratelli-bosio-blla139p925-injector-nozzle-095000-6500-john-deere.webp',
    'BO.0.433.175.414': '/img/p/bosch-0433175414-injector-nozzle-0-414-703-003.webp',
    'DN.093400-5770': '/img/p/denso-0934005770-injector-nozzle-dlla150p77.webp',
    'DN.093400-1770': '/img/p/denso-0934001770-injector-nozzle-dnosdnd177.webp',
    'DN.093400-1360': '/img/p/denso-0934001360-injector-nozzle-105000-2130.webp',
    'DN.093400-1350': '/img/p/denso-0934001350-injector-nozzle-dn4sdnd135.webp',
    'ZX.105118-7621': '/img/p/1051187621-injector-nozzle-9430613869-isuzu-5861295110.webp',
    'ZX.105017-2090': '/img/p/1050172090-injector-nozzle-8971323091.webp',
    'ZX.105017-2200': '/img/p/1050172200-injector-nozzle-dlla146pn220.webp',
    'ZX.105017-2000': '/img/p/1050172000-injector-nozzle-dlla155pn200.webp',
    'FB.0SD304': '/img/p/fratelli-bosio-0sd304-injector-nozzle.webp',
    'FB.BLLA155P118': '/img/p/fratelli-bosio-blla155p118-injector-nozzle-dlla155p118.webp',
    'FB.BLLA155P840': '/img/p/fratelli-bosio-blla155p840-injector-nozzle-095000-6550-6521.webp',
    'FB.BLLA144SG3S33': '/img/p/fratelli-bosio-blla144sg3s33-diesel-part-295050-0520.webp',
    'FB.BLLA127P945': '/img/p/fratelli-bosio-blla127p945-injector-nozzle-095000-6320.webp',
    'FB.DLLA127P944': '/img/p/fratelli-bosio-dlla127p944-injector-nozzle-095000-6310.webp',
    'ZX.105015-7131': '/img/p/1050157131-injector-nozzle-dlla153sn7131.webp',
    'DN.093127-0560': '/img/p/denso-0931270560-injector-nozzle-spring-nozzle-holder.webp',
    'DN.093400-7050': '/img/p/denso-0934007050-injector-nozzle.webp',
    'DN.093400-2960': '/img/p/denso-0934002960-injector-nozzle.webp',
    'S FB.BLLA158P1500': '/img/p/blla158p1500-injector-nozzle-0-445-120-042.webp',
    'S FB.BLLA154P1320': '/img/p/fratelli-bosio-blla154p1320-injector-nozzle-0-445-110-106-107-170-171-181-182.webp',
    'S FB.BLLA143P5519': '/img/p/blla143p5519-injector-nozzle-0-445-120-255.webp',
    'S FB.BLLA124P5516': '/img/p/blla124p5516-injector-nozzle-0-445-120-238.webp',
    'S FB.BLLA.153.P1246': '/img/p/blla153p1246-injector-nozzle-0-445-110-137-138-162-163-191-192.webp',
    'BO.0.433.271.698': '/img/p/bosch-0433271698-injector-nozzle-dlla145s1169.webp',
    'BO.0.433.171.063': '/img/p/bosch-0433171063-injector-nozzle-dlla160p63.webp',
    'BO.F.01G.0V5.000': '/img/p/bosch-f01g0v5000-injector-nozzle-dlla140pn291.webp',
    'ZX.105015-4190': '/img/p/1050154190-injector-nozzle-dlla154s334n419.webp',
    'BO.0.433.271.616': '/img/p/bosch-0433271616-injector-nozzle-0-432-291-516.webp',
    'DN.DLLA143S1302': '/img/p/denso-dlla143s1302-injector-nozzle-0-432-291-516-for-iveco-holland.webp',
    'DN.093400-5210': '/img/p/denso-0934005210-injector-nozzle-0-445-120-305.webp',
    'FB.BLLA156P1059': '/img/p/fratelli-bosio-blla156p1059-injector-nozzle-dlla156p1059.webp',
    'ZX.105019-1470': '/img/p/1050191470-injector-nozzle.webp',
    'BO.0.432.231.678': '/img/p/bosch-0432231678-injector-nozzle-0-432-231-658.webp',
    'ZX.105017-9000': '/img/p/1050179000-injector-nozzle-dsla147pn900-h-105-017-900-np.webp',
    'BO.0.433.171.646': '/img/p/bosch-0433171646-injector-nozzle-dlla160p1032.webp',
    'ZX.105017-1320': '/img/p/1050171320-injector-nozzle.webp',
    'BO.0.432.231.658': '/img/p/bosch-0432231658-fuel-injector-mb-truck-engine-om-442-la-other.webp',
    'FB.BLLA150P1511': '/img/p/fratelli-bosio-blla150p1511-injector-nozzle-0-445-110-257.webp',
    'FB.BLLA152P865-J': '/img/p/fratelli-bosio-blla152p865j-injector-nozzle-095000-551x.webp',
    'BO.F.00V.C14.012': '/img/p/bosch-f00vc14012-injector-nozzle-nut.webp',
    'BO.0.433.272.997': '/img/p/bosch-0433272997-injector-nozzle-dlla132s1320.webp',
    'BO.0.433.175.347': '/img/p/bosch-0433175347-injector-nozzle-dsla140p1173.webp',
    'BO.0.433.175.426': '/img/p/bosch-0433175426-injector-nozzle-dsla145p1441.webp',
    'BO.0.433.171.435': '/img/p/bosch-0433171435-injector-nozzle-dlla145p574.webp',
    'DN.090150-5510': '/img/p/denso-0901505510-fuel-pump-bebj1d04001.webp',
    'FI.DLLA144P690': '/img/p/dlla144p690-injector-nozzle-8-94392261-4-for-isuzu-4hk1-6hk1.webp',
    'BO.F.00V.C14.018': '/img/p/bosch-f00vc14018-injector-nozzle-cap.webp',
    'BO.0.433.171.982': '/img/p/bosch-0433171982-injector-nozzle-0-445-110-274-0-445-110-275.webp',
    'BO.0.433.175.395': '/img/p/bosch-0433175395-injector-nozzle-0-445-110-189-0-445-110-190.webp',
    'ZX.105110-7591': '/img/p/1051107591-injector-nozzle-dlla154sm133.webp',
    'ZX.150655-0000': '/img/p/1506550000-injector-nozzle.webp',
    'BO.0.433.171.964': '/img/p/bosch-0433171964-injector-nozzle-0-445-120-066.webp',
    'BO.0.433.171.966': '/img/p/bosch-0433171966-injector-nozzle-0-445-120-075.webp',
    'BO.0.433.175.078': '/img/p/bosch-0433175078-injector-nozzle-dsla145p464.webp',
    'BO.0.433.171.347': '/img/p/bosch-0433171347-injector-nozzle-dlla140p483.webp',
    'ZX.105007-1140': '/img/p/1050071140-injector-nozzle.webp',
    'FB.BLLA145P864-J': '/img/p/fratelli-bosio-blla145p864j-injector-nozzle-095000-593x-619x-552x.webp',
    'ZX.105019-1540': '/img/p/1050191540-injector-nozzle.webp',
    'ST.29611': '/img/p/29611-injector-nozzle.webp',
    'BO.0.433.171.157': '/img/p/bosch-0433171157-injector-nozzle-dlla150p178.webp',
    'ZX.105015-3630': '/img/p/1050153630-injector-nozzle.webp',
    'ZX.105015-8760': '/img/p/1050158760-injector-nozzle.webp',
    'FI.ALLA150P1059': '/img/p/alla150p1059-injector-nozzle-dlla150p1059.webp',
    'DN.093400-5800': '/img/p/denso-0934005800-injector-nozzle-tobera-dnopd80.webp',
    'BO.0.433.175.196': '/img/p/bosch-0433175196-injector-nozzle-0-445-110-044.webp',
    'BO.0.433.171.599': '/img/p/bosch-0433171599-injector-nozzle-dlla151p901.webp',
    'FB.BLLA145P1024': '/img/p/fratelli-bosio-blla145p1024-injector-nozzle-095000-776.webp',
    'FB.BLLA148P872-J': '/img/p/fratelli-bosio-blla148p872j-injector-nozzle-095000-565.webp',
    'FB.BLLA153P884-J': '/img/p/fratelli-bosio-blla153p884j-injector-nozzle-095000-580.webp',
    'KS.DLLA155P1030': '/img/p/dlla155p1030-injector-nozzle-095000-956x.webp',
    'DN.093400-6490': '/img/p/denso-0934006490-injector-nozzle-dlla157p649.webp',
    'DN.093400-6500': '/img/p/denso-0934006500-injector-nozzle-tobera-dn0pd650.webp',
    'DN.093400-5500': '/img/p/denso-0934005500-injector-nozzle-dlla160p50.webp',
    'KS.DSLA128P1510': '/img/p/dsla128p1510-injector-nozzle-0-445-120-059.webp',
    'KS.DLLA152P1681': '/img/p/dlla152p1681-injector-nozzle-0-445-110-310.webp',
    'KS.DSLA128P5510': '/img/p/dsla128p5510-injector-nozzle-0-445-120-231.webp',
    'KS.G3S52': '/img/p/g3s52-injector-nozzle-295050-1060.webp',
    'KS.M1600P150': '/img/p/m1600p150-injector-nozzle-a2c59515264-ford-ranger-3-0.webp',
    'KS.M0019P140': '/img/p/m0019p140-injector-nozzle-bk2q9k546ag-ford-ranger.webp',
    'KS.DSLA136P804': '/img/p/dsla136p804-injector-nozzle-0-445-120-002-for-iveco.webp',
    'KS.DLLA146P1296': '/img/p/dlla146p1296-injector-nozzle-0-445-110-141.webp',
    'FB.BLLA152P947-J': '/img/p/fratelli-bosio-blla152p947j-injector-nozzle-095000-625.webp',
    'FI.ALLA158P1092': '/img/p/alla158p1092-injector-nozzle-095000-636.webp',
    'ZX.105019-2170': '/img/p/1050192170-injector-nozzle.webp',
    'ZX.105017-3060': '/img/p/1050173060-injector-nozzle.webp',
    'DN.093400-8670': '/img/p/denso-0934008670-injector-nozzle-dlla154pn064.webp',
    'DN.093400-3380': '/img/p/denso-0934003380-injector-nozzle-dlla158snd338.webp',
    'BO.0.433.172.022': '/img/p/bosch-0433172022-injector-nozzle-0-445-110-293.webp',
    'BO.0.433.171.932': '/img/p/bosch-0433171932-injector-nozzle-0-445-110-257-0-445-110-258.png',
    'BO.0.433.171.654': '/img/p/bosch-0433171654-injector-nozzle-0-445-110-101-064.webp',
    'BO.0.433.171.933': '/img/p/bosch-0433171933-injector-nozzle-0-445-110-153-hyundai-santa-fe.png',
    'DN.G4S008': '/img/p/denso-g4s008-injector-nozzle-23670-0e010-toyota-2gd-2-4-liters.webp',
    'DN.G4S009': '/img/p/denso-g4s009-injector-nozzle-23670-0e060-toyota-1gd-2-8-liters.webp',
    'BO.0.433.171.397': '/img/p/bosch-0433171397-injector-nozzle-dlla145p536.webp',
    'BO.0.433.271.245': '/img/p/bosch-0433271245-injector-nozzle-dlla150s527.webp',
    'BO.0.433.172.232': '/img/p/bosch-0433172232-injector-nozzle-0-414-701-072-1943974.webp',
    'DE.7135-578': '/img/p/delphi-7135578-injector-nozzle-and-valve-kit.webp',
    'FI.ALLA144G3S33': '/img/p/alla144g3s33-injector-nozzle-dlla144g3s33.webp',
    'FI.ALLA155P1044': '/img/p/alla155p1044-injector-nozzle-095000-6520.webp',
    'BO.0.433.171.811': '/img/p/bosch-0433171811-injector-nozzle-0-445-110-141.webp',
    'ZX.105025-3730': '/img/p/1050253730-injector-nozzle.webp',
    'M0034P150': '/img/p/m0034p150-injector-nozzle.webp',
    'ZX.105017-1780': '/img/p/1050171780-injector-nozzle-for-isuzu.webp',
    'BO.F.019.123.094': '/img/p/bosch-f019123094-injector-nozzle-dsla135p005.webp',
    'DP.DLLA152S295': '/img/p/dlla152s295-injector-nozzle.webp',
    'ZX.105017-3070': '/img/p/1050173070-injector-nozzle.webp',
    'DN.DLLA127P944': '/img/p/denso-dlla127p944-injector-nozzle-095000-631.webp',
    'SE.ALLA148P932': '/img/p/alla148p932-injector-nozzle-7385831.webp',
    'DN.093400-7370': '/img/p/denso-0934007370-injector-nozzle-dlla146p737.webp',
    'FI.ALLA162P2160': '/img/p/alla162p2160-injector-nozzle-0-445-110-647.webp',
    'ZX.105007-1650': '/img/p/1050071650-injector-nozzle.webp',
    'ZX.105007-1540': '/img/p/1050071540-injector-nozzle-h-105-007-154-dn4pdn154.webp',
    'ST.35302': '/img/p/35302-injector-nozzle-assembly-hole.webp',
    'ZX.105017-3020': '/img/p/1050173020-injector-nozzle.webp',
    'ZX.105017-1180': '/img/p/1050171180-injector-nozzle-for-mitsubishi-heav-s4k-t.webp',
    'DN.093400-6680': '/img/p/denso-0934006680-injector-nozzle-gmc-tracker-2-8.webp',
    'FI.ALLA152P1072': '/img/p/alla152p1072-injector-nozzle-095000-8340.webp',
    'BO.0.433.171.988': '/img/p/bosch-0433171988-injector-nozzle-0-445-120-089.webp',
    'KS.DLLA145P1720': '/img/p/dlla145p1720-injector-nozzle-0-445-110-317.webp',
    'KS.DLLA156P1114': '/img/p/dlla156p1114-injector-nozzle-0-445-110-091-092-306.webp',
    'KS.DLLA152P980': '/img/p/dlla152p980-injector-nozzle-095000-698x.webp',
    'KS.DLLA158P1096': '/img/p/dlla158p1096-injector-nozzle-095000-8901.webp',
    'KS.DLLA155P842': '/img/p/dlla155p842-injector-nozzle-095000-659x-527x.webp',
    'KS.DLLA157P855': '/img/p/dlla157p855-injector-nozzle-095000-5450.webp',
    'KS.DLLA152P947': '/img/p/dlla152p947-injector-nozzle-095000-625.webp',
    'KS.DLLA145P1024': '/img/p/dlla145p1024-injector-nozzle-095000-7761.webp',
    'KS.DLLA155P1062': '/img/p/dlla155p1062-injector-nozzle-095000-8290.webp',
    'ZX.105007-1300': '/img/p/1050071300-injector-nozzle-pdn130.webp',
    'DN.093400-4020': '/img/p/denso-0934004020-injector-nozzle-dn0pdn130a.webp',
    'S 009 2.8L': '/img/p/8l-injector-nozzle-denso.webp',
    'S 008 2.4L': '/img/p/4l-injector-nozzle-denso.webp',
    'SM.M0019P140': '/img/p/m0019p140-injector-nozzle-siemens.webp',
    'DE.LP004B': '/img/p/delphi-lp004b-injector-nozzle.webp',
    'DE.L357PBC': '/img/p/delphi-l357pbc-injector-nozzle.webp',
    'DE.L214PBC': '/img/p/delphi-l214pbc-injector-nozzle.webp',
    'DE.L212PBC': '/img/p/delphi-l212pbc-injector-nozzle.webp',
    'DE.L137PBD': '/img/p/delphi-l137pbd-injector-nozzle-ejbr03701d.webp',
    'DE.L131PBA': '/img/p/delphi-l131pba-injector-nozzle.webp',
    'DE.L019PBC': '/img/p/delphi-l019pbc-injector-nozzle.webp',
    'KS.DLLA156P1425': '/img/p/dlla156p1425-injector-nozzle-dlla156p1425.webp',
    'KS.DLLA156P1368': '/img/p/dlla156p1368-injector-nozzle-0-445-110-186-279.webp',
    'G3S6': '/img/p/g3s6-injector-nozzle-23670-30400.webp',
    'FB.G3S3 NOZZLE': '/img/p/fratelli-bosio-g3s3nozzle-injector-nozzle-295050-0050-295050-0051-295050.webp',
    'FI.093400-8640': '/img/p/0934008640-injector-nozzle-dlla145p864.webp',
    'FI.DLLA158P854': '/img/p/dlla158p854-injector-nozzle-095000-547x.webp',
    'DN.DLLA155P1030': '/img/p/denso-dlla155p1030-injector-nozzle-095000-956x.webp',
    'FI.ALLA150P866-J': '/img/p/alla150p866j-injector-nozzle-095000-555x.webp',
    'BO.DLLA146P203B': '/img/p/bosch-dlla146p203b-injector-nozzle-dlla146p203b.webp',
    'KS.DLLA145P870': '/img/p/dlla145p870-injector-nozzle-095000-560x.webp',
    'DN.DLLA125P889': '/img/p/denso-dlla125p889-injector-nozzle-095000-648.webp',
    'DE.BDN0PN130A': '/img/p/delphi-bdn0pn130a-injector-nozzle-bdn0pn130a.webp',
    'FI.ALLA158P1096': '/img/p/alla158p1096-injector-nozzle-095000-5471.webp',
    'FI.ALLA155P863': '/img/p/alla155p863-injector-nozzle-alla155p863.webp',
    'FI.ALLA155P842-J': '/img/p/alla155p842j-injector-nozzle-095000-6591.webp',
    'FI.ALLA155P840': '/img/p/alla155p840-injector-nozzle-095000-6591.webp',
    'FI.ALLA155P1062': '/img/p/alla155p1062-injector-nozzle-095000-8290.webp',
    'FI.ALLA154G3S6 F': '/img/p/alla154g3s6f-injector-nozzle-alla154g3s6.webp',
    'FI.ALLA152P981': '/img/p/alla152p981-injector-nozzle-095000-699.webp',
    'FI.ALLA152P980': '/img/p/alla152p980-injector-nozzle-095000-6100.webp',
    'FI.ALLA150PM1600 S': '/img/p/alla150pm1600s-injector-nozzle-a2c59515264-m1600p150-ford-ranger.webp',
    'FI.ALLA148P872': '/img/p/alla148p872-injector-nozzle-095000-5650.webp',
    'FI.ALLA145P1024': '/img/p/alla145p1024-injector-nozzle-095000-7761.webp',
    'FI.ALLA138P934': '/img/p/alla138p934-injector-nozzle-alla150p934.webp',
    'FI.ALLA125P889 F': '/img/p/alla125p889f-injector-nozzle-095000-6481-john-deere.webp',
    'DE.6980548': '/img/p/delphi-6980548-injector-nozzle-095000-8290.webp',
    'DE.6980544': '/img/p/delphi-6980544-injector-nozzle-095000-576x.webp',
    'DE.6980543': '/img/p/delphi-6980543-injector-nozzle-095000-5880.webp',
    'DE.6980542': '/img/p/delphi-6980542-injector-nozzle-095000-8290.webp',
    'DE.6801180': '/img/p/delphi-6801180-injector-nozzle.webp',
    'ST.29279': '/img/p/29279-injector-nozzle-assy.webp',
    'ST.28485': '/img/p/28485-injector-nozzle-assy.webp',
    'ZX.105025-4200': '/img/p/1050254200-injector-nozzle-daewoo-bd58tis.webp',
    'ZX.105019-1240': '/img/p/1050191240-injector-nozzle.webp',
    'ZX.105017-9350': '/img/p/1050179350-injector-nozzle.webp',
    'ZX.105017-3450': '/img/p/1050173450-injector-nozzle.webp',
    'ZX.105017-2910': '/img/p/1050172910-injector-nozzle.webp',
    'ZX.105017-1790': '/img/p/1050171790-injector-nozzle.webp',
    'ZX.105017-1610': '/img/p/1050171610-injector-nozzle.webp',
    'ZX.105015-4740': '/img/p/1050154740-injector-nozzle.webp',
    'ZX.105007-1590': '/img/p/1050071590-injector-nozzle.webp',
    'ZX.105007-1580': '/img/p/1050071580-injector-nozzle.webp',
    'ZX.105007-1390': '/img/p/1050071390-injector-nozzle.webp',
    'ZX.105007-1360': '/img/p/1050071360-injector-nozzle.webp',
    'ZX.105007-1350': '/img/p/1050071350-injector-nozzle.webp',
    'ZX.105007-1170': '/img/p/1050071170-injector-nozzle.webp',
    'ZX.105007-1130': '/img/p/1050071130-injector-nozzle-pdn113.webp',
    'ZX.105007-1120': '/img/p/1050071120-injector-nozzle.webp',
    'ZX.105000-2260': '/img/p/1050002260-injector-nozzle.webp',
    'DN.093490-1740': '/img/p/denso-0934901740-injector-nozzle-095000-625-p947.webp',
    'DN.093490-1530': '/img/p/denso-0934901530-injector-nozzle-095000-776-p864.webp',
    'DN.093490-1480': '/img/p/denso-0934901480-injector-nozzle-095000-547-p854.webp',
    'DN.093490-1340': '/img/p/denso-0934901340-injector-nozzle-095000-829-p1062.webp',
    'DN.093490-1280': '/img/p/denso-0934901280-injector-nozzle-095000-576-tobera.webp',
    'DN.093490-1230': '/img/p/denso-0934901230-injector-nozzle-095000-560-p870.webp',
    'DN.093400-8780': '/img/p/denso-0934008780-injector-nozzle-dn10pdn135.webp',
    'DN.093400-8080': '/img/p/denso-0934008080-injector-nozzle-dlla150p808.webp',
    'DN.093400-6760': '/img/p/denso-0934006760-injector-nozzle-dn0pdn112.webp',
    'DN.093400-6340': '/img/p/denso-0934006340-injector-nozzle-tobera-dn0pd113.webp',
    'DN.093400-6310': '/img/p/denso-0934006310-injector-nozzle-dlla155p631.webp',
    'DN.093400-6190': '/img/p/denso-0934006190-injector-nozzle-dn0pd619.webp',
    'DN.093400-6150': '/img/p/denso-0934006150-injector-nozzle-dlla158p615.webp',
    'DN.093400-5010': '/img/p/denso-0934005010-injector-nozzle-dn4pd1.webp',
    'DN.093400-1630': '/img/p/denso-0934001630-injector-nozzle-dn0sd177.webp',
    'DN.093400-1170': '/img/p/denso-0934001170-injector-nozzle-dlla150s325nd117.webp',
    'DN.093400-1096': '/img/p/denso-0934001096-injector-nozzle-095000-8901.webp',
    'DN.093400-1024': '/img/p/denso-0934001024-injector-nozzle-095000-776.webp',
    'BO.0.443.172.147': '/img/p/bosch-0443172147-injector-nozzle-0-445-110-375.webp',
    'BO.0.433.172.203': '/img/p/bosch-0433172203-injector-nozzle-0-445-120-236.webp',
    'BO.0.433.172.055': '/img/p/bosch-0433172055-injector-nozzle-0-445-110-317.webp',
    'BO.0.433.171.965': '/img/p/bosch-0433171965-injector-nozzle-0-445-120-074-138-139.webp',
    'BO.0.433.171.921': '/img/p/bosch-0433171921-injector-nozzle-0-445-110-250.webp',
    'BO.0.433.171.887': '/img/p/bosch-0433171887-injector-nozzle-0-445-120-049.webp',
    'BO.0.433.171.848': '/img/p/bosch-0433171848-injector-nozzle-0-445-110-279.webp',
    'BO.0.433.171.755': '/img/p/bosch-0433171755-injector-nozzle-0-445-110-126-0-445-110-290.webp',
    'BO.0.433.171.741': '/img/p/bosch-0433171741-injector-nozzle-dlla150p1164.webp',
    'BO.0.433.171.680': '/img/p/bosch-0433171680-injector-nozzle-dlla147p1049.webp',
    'BO.0.433.171.436': '/img/p/bosch-0433171436-injector-nozzle-dlla160p577-mercedes-benz-om457.webp',
    'BO.0.433.171.340': '/img/p/bosch-0433171340-injector-nozzle-dlla143p471-holland.webp',
    'BO.0.432.191.292': '/img/p/bosch-0432191292-injector-nozzle.webp',
    'LD.DLLA139P994': '/img/p/lead-dlla139p994-fuel-injector-for-injector-095000-7150.webp',
    'LD.G4S016': '/img/p/lead-g4s016-injector-nozzle-for-inj-1j508-53051-295700-0100.webp',
    'BO.0.433.172.334': '/img/p/bosch-0433172334-injector-nozzle-0-445-110-777.webp',
    'LD.VP_G4016': '/img/p/lead-vpg4016-valve-plate-for-inj-1j508-53051.webp',
    'ZX.105017-3090': '/img/p/1050173090-injector-nozzle-105118-8211.webp',
    'RB.315.06.68': '/img/p/robiel-3150668-fuel-injector-nut-cat-c10-c12-eui-unit-injector.webp',
    'BO.0.433.171.683': '/img/p/bosch-0433171683-injector-nozzle-0-445-120-014.webp',
    'BO.0.433.171.947': '/img/p/bosch-0433171947-injector-nozzle-0-445-120-054.webp',
    'DE.6970013': '/img/p/delphi-6970013-injector-nozzle-bdn0pdn130a.webp',
    'DE.L242PBC': '/img/p/delphi-l242pbc-injector-nozzle.webp',
    'FI.ALLA145P875-J': '/img/p/alla145p875j-injector-nozzle-095000-8110-p875-mit-pajero.webp',
    'FI.ALLA158P834-J': '/img/p/alla158p834j-injector-nozzle-095000-5224.webp',
    'KS.DLLA145P875': '/img/p/dlla145p875-injector-nozzle-095000-576x.webp',
    'KS.DLLA148P872': '/img/p/dlla148p872-injector-nozzle-095000-565x.webp',
    'KS.DLLA158P1092': '/img/p/dlla158p1092-injector-nozzle-095000-636x.webp',
    'KS.DLLA158P844': '/img/p/dlla158p844-injector-nozzle-095000-636-isuszu-foward-4hk1-5.webp',
    'KS.DLLA158P854': '/img/p/dlla158p854-injector-nozzle-095000-547.webp',
    'KS.G3S33': '/img/p/g3s33-injector-nozzle-295050-0460.webp',
    'KS.G3S6': '/img/p/g3s6-injector-nozzle-g3s6-suiatble-for-23670-0l090.webp',
    'SE.76515': '/img/p/76515-injector-nozzle-77550.webp',
    'ZX.105007-1330': '/img/p/1050071330-injector-nozzle-and-holder.webp',
    'ZX.105017-1860': '/img/p/1050171860-injector-nozzle-dlla154pn186.webp',
    'DN.294000-154# R': '/img/p/denso-294000154r-high-pressure-fuel-pump-john-deere-engine.webp',
    '3348F212-R': '/img/p/3348f212r-high-pressure-fuel-pump-jcb-perkins.webp',
    'BO. 0.445.010.628': '/img/p/bosch-0445010628-high-pressure-fuel-pump-isuzu.webp',
    'BO.0.445.010.024': '/img/p/bosch-0445010024-high-pressure-fuel-pump-sprinter-311-313-411-e-413-2.webp',
    'BO.0.445.010.038': '/img/p/bosch-0445010038-high-pressure-fuel-pump-hyundai-tucson-2-0.webp',
    'BO.0.445.010.159': '/img/p/bosch-0445010159-high-pressure-fuel-pump-cummins-isf.webp',
    'BO.0.445.010.176': '/img/p/bosch-0445010176-high-pressure-fuel-pump-mahindra.webp',
    'BO.0.445.010.181': '/img/p/bosch-0445010181-high-pressure-fuel-pump-ducato-2-3-16v-2008-2012.webp',
    'BO.0.445.010.320': '/img/p/bosch-0445010320-high-pressure-fuel-pump-ducato-boxer-jumper-daily-2-3.webp',
    'BO.0.445.010.342': '/img/p/bosch-0445010342-high-pressure-fuel-pump.webp',
    'BO.0.445.010.355': '/img/p/bosch-0445010355-high-pressure-fuel-pump-kia-sorento.webp',
    'BO.0.445.010.372': '/img/p/bosch-0445010372-high-pressure-fuel-pump-jac-cp1.webp',
    'BO.0445.010.099R': '/img/p/bosch-0445010099r-high-pressure-fuel-pump.webp',
    'BO.0.445.010.206': '/img/p/bosch-0445010206-high-pressure-fuel-pump.webp',
    'BO.0.445.010.259': '/img/p/bosch-0445010259-high-pressure-fuel-pump-gm-chevrolet-s10-2-8.webp',
    'BO.0.445.010.272': '/img/p/bosch-0445010272-high-pressure-fuel-pump-mb-sprinter.webp',
    'BO.0.445.010.290': '/img/p/bosch-0445010290-high-pressure-fuel-pump-hyundai.webp',
    'BO.0.445.010.294': '/img/p/bosch-0445010294-high-pressure-fuel-pump.webp',
    'BO.0.445.010.428': '/img/p/bosch-0445010428-high-pressure-fuel-pump-bosch.webp',
    'BO.0.445.010.430': '/img/p/bosch-0445010430-high-pressure-fuel-pump.webp',
    'BO.0.445.010.457': '/img/p/bosch-0445010457-high-pressure-fuel-pump.webp',
    'BO.0.445.010.507': '/img/p/bosch-0445010507-high-pressure-fuel-pump-cp4-amarok.webp',
    'BO.0.445.010.508': '/img/p/bosch-0445010508-high-pressure-fuel-pump.webp',
    'BO.0.445.010.516': '/img/p/bosch-0445010516-high-pressure-fuel-pump.webp',
    'BO.0.445.010.533': '/img/p/bosch-0445010533-high-pressure-fuel-pump-for-audi-vw-seat-skoda.webp',
    'BO.0.445.010.538': '/img/p/bosch-0445010538-high-pressure-fuel-pump-vw.webp',
    'BO.0.445.010.543': '/img/p/bosch-0445010543-high-pressure-fuel-pump-amarok-pump.webp',
    'BO.0.445.010.546': '/img/p/bosch-0445010546-high-pressure-fuel-pump-cp4-amarok.webp',
    'BO.0.445.010.552': '/img/p/bosch-0445010552-high-pressure-fuel-pump-bosch-1-6.webp',
    'BO.0.445.010.559': '/img/p/bosch-0445010559-high-pressure-fuel-pump-3-0l-daily-iveco.webp',
    'BO.0.445.010.565': '/img/p/bosch-0445010565-high-pressure-fuel-pump-audi-vw-seat-skoda.webp',
    'BO.0.445.010.593': '/img/p/bosch-0445010593-high-pressure-fuel-pump.webp',
    'BO.0.445.010.834': '/img/p/bosch-0445010834-high-pressure-fuel-pump-cummins-5-0l-v8-isv-isv5-0-2016.webp',
    'BO.0.445.010.854': '/img/p/bosch-0445010854-high-pressure-fuel-pump.webp',
    'BO.0.445.010.858': '/img/p/bosch-0445010858-high-pressure-fuel-pump.webp',
    'BO.0.445.020.017': '/img/p/bosch-0445020017-high-pressure-fuel-pump.webp',
    'BO.0.445.020.028': '/img/p/bosch-0445020028-high-pressure-fuel-pump-mitsubishi-canter-m-50.webp',
    'BO.0.445.020.043': '/img/p/bosch-0445020043-high-pressure-fuel-pump.webp',
    'BO.0.445.020.050': '/img/p/bosch-0445020050-high-pressure-fuel-pump-mitsubishi-fuso.webp',
    'BO.0.445.020.200': '/img/p/bosch-0445020200-high-pressure-fuel-pump-kubota.webp',
    'BO.0.445.020.223': '/img/p/bosch-0445020223-high-pressure-fuel-pump.webp',
    'BO.0.445.020.293': '/img/p/bosch-0445020293-high-pressure-fuel-pump-navistar-a26-12-5l.webp',
    'BO.0.445.020.509': '/img/p/bosch-0445020509-high-pressure-fuel-pump.webp',
    'BO.0.445.020.525': '/img/p/bosch-0445020525-high-pressure-fuel-pump-deutz.webp',
    'BO.0.445.023.035': '/img/p/bosch-0445023035-high-pressure-fuel-pump.webp',
    'BO.0.460.424.304': '/img/p/bosch-0460424304-high-pressure-fuel-pump.webp',
    'BO.0.445.020.109': '/img/p/bosch-0445020109-high-pressure-fuel-pump-komatsu-pc200-8-motor.webp',
    'BO.0.445.020.122': '/img/p/bosch-0445020122-high-pressure-fuel-pump-cummins-isf-3-8.webp',
    'BO.0.445.020.126': '/img/p/bosch-0445020126-high-pressure-fuel-pump-navistar-maxxforce-11l-13l.webp',
    'BO.0.445.020.195': '/img/p/bosch-0445020195-high-pressure-fuel-pump-cp5.webp',
    'BO.0.445.020.126R': '/img/p/bosch-0445020126r-high-pressure-fuel-pump.webp',
    'BO.0.445.020.150': '/img/p/bosch-0445020150-high-pressure-fuel-pump.webp',
    'BO.0.445.020.300': '/img/p/bosch-0445020300-high-pressure-fuel-pump-cummins-2010-2014-dodge-6-7l.webp',
    'BO.0.445.020.610': '/img/p/bosch-0445020610-high-pressure-fuel-pump-massey-ferguson-mf8670-mf8690.webp',
    'BO.0.470.004.018': '/img/p/bosch-0470004018-high-pressure-fuel-pump-cummins-isb-qsb-isc8-3-qsb3-9.webp',
    'BO.0.470.006.003 R': '/img/p/bosch-0470006003r-high-pressure-fuel-pump.webp',
    'BO.0.470.006.010': '/img/p/bosch-0470006010-high-pressure-fuel-pump-perkins-vp29-30.webp',
    'BO.0.986.437.016': '/img/p/bosch-0986437016-high-pressure-fuel-pump-sprinter-2-7l.webp',
    'BO.0.986.437.320': '/img/p/bosch-0986437320-high-pressure-fuel-pump-bmw-r90-cp3.webp',
    'BO.0.986.437.512': '/img/p/bosch-0986437512-high-pressure-fuel-pump.webp',
    'BO.0.986.437.461': '/img/p/bosch-0986437461-high-pressure-fuel-pump-iveco-3-0l.webp',
    'BO.0.986.437.507': '/img/p/bosch-0986437507-high-pressure-fuel-pump-mercedes-benz-and-detroit-dd13-15.webp',
    'DE.28297640': '/img/p/delphi-28297640-high-pressure-fuel-pump-sprinter-cdi-2-16v-euro-v-311.webp',
    'DE.28313000': '/img/p/delphi-28313000-high-pressure-fuel-pump-28313000-dnr-oen-320-06825-a-jcb.webp',
    'DE.28435244': '/img/p/delphi-28435244-high-pressure-fuel-pump-jcb.webp',
    'DE.28526888': '/img/p/delphi-28526888-high-pressure-fuel-pump-delphi-bobcat-doosan-1-8l-2-6l.webp',
    'DE.28568252': '/img/p/delphi-28568252-high-pressure-fuel-pump-jcb-320-excavator.webp',
    'DE.9422A030A': '/img/p/delphi-9422a030a-high-pressure-fuel-pump-korando.webp',
    'DE.9424A100A': '/img/p/delphi-9424a100a-high-pressure-fuel-pump-great-wall.webp',
    'CA.326-4634': '/img/p/caterpillar-3264634-high-pressure-fuel-pump-excavators-312d-315d-l-319d-l.webp',
    'DE.8448B371C-R': '/img/p/delphi-8448b371cr-high-pressure-fuel-pump-peugeot-citroen-dw8-1-9-for-ford.webp',
    'DE.9044A150A': '/img/p/delphi-9044a150a-high-pressure-fuel-pump-hyundai.webp',
    'DE.9044A160A': '/img/p/delphi-9044a160a-high-pressure-fuel-pump-ssangyong.webp',
    'DE.9044A162A': '/img/p/delphi-9044a162a-high-pressure-fuel-pump-actyon-kyron-rexton.webp',
    'DE.TPF1R085E2001': '/img/p/delphi-tpf1r085e2001-high-pressure-fuel-pump-unit-john-deere.webp',
    'DN.094000-0420': '/img/p/denso-0940000420-high-pressure-fuel-pump-hino-700-series-truck-e13c.webp',
    'DN.094000-0421': '/img/p/denso-0940000421-high-pressure-fuel-pump-suzu-hino-700.webp',
    'DN.094000-0484': '/img/p/denso-0940000484-high-pressure-fuel-pump-isuzu-6wf.webp',
    'DN.094000-0490': '/img/p/denso-0940000490-high-pressure-fuel-pump-john-deere-3520.webp',
    'DN.094000-0660': '/img/p/denso-0940000660-high-pressure-fuel-pump-sinotruck-howo-a7.webp',
    'FD. FB3Z9A543J': '/img/p/fratelli-bosio-fb3z9a543j-high-pressure-fuel-pump-ranger-2013-a-2020-3-2-diesel.webp',
    'IZ.8-97602049-8': '/img/p/isuzu-8976020498-high-pressure-fuel-pump-isuzu.webp',
    'JD.SE501235R': '/img/p/se501235r-high-pressure-fuel-pump.webp',
    'R90442072A': '/img/p/r90442072a-high-pressure-fuel-pump.webp',
    'SM.BK3Q-9B395-AD': '/img/p/siemens-bk3q9b395ad-high-pressure-fuel-pump-ranger-3-2.webp',
    'ST.DS4831-5068R': '/img/p/ds48315068r-high-pressure-fuel-pump.webp',
    'ZO.3583207': '/img/p/3583207-high-pressure-fuel-pump-volvo-penta.webp',
    'ZX.107492-1083': '/img/p/zexel-1074921083-high-pressure-fuel-pump-isuzu-4he1-diesel-engine-cross.webp',
    'ZZ.11032709R': '/img/p/11032709r-high-pressure-fuel-pump.webp',
    'DN.294000-003#': '/img/p/denso-294000003-high-pressure-fuel-pump.webp',
    'DN.294000-005#R': '/img/p/denso-294000005r-high-pressure-fuel-pump.webp',
    'DN.294000-0059': '/img/p/denso-2940000059-high-pressure-fuel-pump.webp',
    'DN.294000-0354': '/img/p/denso-2940000354-high-pressure-fuel-pump.webp',
    'DN.294000-0530': '/img/p/denso-2940000530-high-pressure-fuel-pump-nissan-frontier.webp',
    'DN.294000-056#': '/img/p/denso-294000056-high-pressure-fuel-pump-john-deere.webp',
    'DN.294000-056#R': '/img/p/denso-294000056r-high-pressure-fuel-pump.webp',
    'DN.294000-059#': '/img/p/denso-294000059-high-pressure-fuel-pump.webp',
    'DN.294000-230#': '/img/p/denso-294000230-high-pressure-fuel-pump-1460a096-mitsubishi-l200-pajero-2.webp',
    'DN.294000-260#': '/img/p/denso-294000260-high-pressure-fuel-pump.webp',
    'DN.294050-0060': '/img/p/denso-2940500060-high-pressure-fuel-pump-jde.webp',
    'DN.294050-0060R': '/img/p/denso-2940500060r-high-pressure-fuel-pump.webp',
    'DN.294050-042#': '/img/p/denso-294050042-high-pressure-fuel-pump-isuzu.webp',
    'DN.299000-0040': '/img/p/denso-2990000040-high-pressure-fuel-pump-hp-5.webp',
    'DN.299000-0050': '/img/p/denso-2990000050-high-pressure-fuel-pump.webp',
    'DN.294000-0403': '/img/p/denso-2940000403-high-pressure-fuel-pump-ford-transit.webp',
    'DN.294000-0700': '/img/p/denso-2940000700-high-pressure-fuel-pump-toyota-2gd.webp',
    'DN.294000-0901R': '/img/p/denso-2940000901r-high-pressure-fuel-pump-recon.webp',
    'DN.294000-093#': '/img/p/denso-294000093-high-pressure-fuel-pump-1kd.webp',
    'DN.294000-095#': '/img/p/denso-294000095-high-pressure-fuel-pump-ford-ranger-2-4tdci-3-2tdci.webp',
    'DN.294000-119#': '/img/p/denso-294000119-high-pressure-fuel-pump-isuzu-4hk1-previous.webp',
    'DN.294000-1220': '/img/p/denso-2940001220-high-pressure-fuel-pump-hp3-nissan-16700-4kv0a.webp',
    'DN.294000-1240': '/img/p/denso-2940001240-high-pressure-fuel-pump-mitsubishi-triton-l200.webp',
    'DN.294000-1250': '/img/p/denso-2940001250-high-pressure-fuel-pump.webp',
    'DN.294000-1304': '/img/p/denso-2940001304-high-pressure-fuel-pump-denso-yanamar-129978-51000.webp',
    'DN.294000-1360': '/img/p/denso-2940001360-high-pressure-fuel-pump-mitsubish.webp',
    'DN.294000-1372': '/img/p/denso-2940001372-high-pressure-fuel-pump-mitsubishi-triton-l200.webp',
    'DN.294000-1401': '/img/p/denso-2940001401-high-pressure-fuel-pump-suzu.webp',
    'DN.294000-1631': '/img/p/denso-2940001631-high-pressure-fuel-pump-cummins.webp',
    'DN.294000-1683': '/img/p/denso-2940001683-high-pressure-fuel-pump.webp',
    'DN.294000-1780R': '/img/p/denso-2940001780r-high-pressure-fuel-pump-cummins.webp',
    'DN.294000-187#': '/img/p/denso-294000187-high-pressure-fuel-pump.webp',
    'DN.294050-0760': '/img/p/denso-2940500760-high-pressure-fuel-pump.webp',
    'DN.9709730-009': '/img/p/denso-9709730009-high-pressure-fuel-pump-toyota-corolla-2-0.webp',
    'DN.9729400-240#': '/img/p/denso-9729400240-high-pressure-fuel-pump.webp',
    'DN.9729405-010': '/img/p/denso-9729405010-high-pressure-fuel-pump.webp',
    'DN.9729900-004#': '/img/p/denso-9729900004-high-pressure-fuel-pump.webp',
    'DN.9729400-136': '/img/p/denso-9729400136-high-pressure-fuel-pump-mitsubishi-l200.webp',
    'SM.A2C53344441': '/img/p/siemens-a2c53344441-high-pressure-fuel-pump-ranger-db3q-9b395-ba-bk3q-9b395.webp',
    'SM.A2C93217600': '/img/p/siemens-a2c93217600-high-pressure-fuel-pump.webp',
    'BO.0.445.010.419': '/img/p/bosch-0445010419-high-pressure-fuel-pump-bosch.webp',
    'BO.0.445.020.033': '/img/p/bosch-0445020033-high-pressure-fuel-pump-cp3.webp',
    'DE.28447439': '/img/p/delphi-28447439-high-pressure-fuel-pump-mb-sprinter.webp',
    'DE.9422A060A': '/img/p/delphi-9422a060a-high-pressure-fuel-pump-hr-2-5-crdi-16v-2013-2018.webp',
    'DN.294000-078#': '/img/p/denso-294000078-high-pressure-fuel-pump-nissan-16700-4kv0a.webp',
    'DN.294000-090#': '/img/p/denso-294000090-high-pressure-fuel-pump-toyota-1kd-2kd.webp',
    'DN.294000-121#': '/img/p/denso-294000121-high-pressure-fuel-pump.webp',
    'FD.2086842': '/img/p/2086842-high-pressure-fuel-pump-ford-transit-2-2l.webp',
    'KB.095000-9690': '/img/p/kubota-0950009690-fuel-injector.webp',
    'BR.0.445.124.047': '/img/p/bosch-0445124047-fuel-injector-cummins-6-7l-isb-2019-2021-2.webp',
    'BR.0.445.120.008': '/img/p/bosch-0445120008-fuel-injector-01-04-duramx.webp',
    'DAP.095000-6320': '/img/p/dap-0950006320-fuel-injector.webp',
    'BO. 0.445.116.025': '/img/p/bosch-0445116025-fuel-injector-detroit.webp',
    'KS.28342997': '/img/p/kingstar-28342997-fuel-injector.webp',
    'KS.0.445.120.067': '/img/p/kingstar-0445120067-fuel-injector.webp',
    'KS.0.445.110.646': '/img/p/kingstar-0445110646-fuel-injector.webp',
    'KS.295050-0300': '/img/p/kingstar-2950500300-fuel-injector.webp',
    'KS.095000-5471': '/img/p/kingstar-0950005471-fuel-injector.webp',
    'KS.095000-5550': '/img/p/kingstar-0950005550-fuel-injector.webp',
    'KS.095000-6243': '/img/p/kingstar-0950006243-fuel-injector-nissan-for-navara-yd25-euro-iv.webp',
    'KS.095000-8290': '/img/p/kingstar-0950008290-fuel-injector-1kd.webp',
    'MZ.095000-6491R': '/img/p/0950006491r-fuel-injector.webp',
    'MZ.095000-6250R': '/img/p/0950006250r-fuel-injector.webp',
    'MZ.095000-6481R': '/img/p/0950006481r-fuel-injector-john-deere-3520-re-529149.webp',
    'DAP.127-8216': '/img/p/dap-1278216-fuel-injector.webp',
    'DAP.095000-6800': '/img/p/dap-0950006800-fuel-injector-kubota.webp',
    'LD.320-0690': '/img/p/lead-3200690-fuel-injector-cat-perkins-2645a749-c6-6.webp',
    'MZ.095000-6480R': '/img/p/0950006480r-fuel-injector.webp',
    'MZ.095000-6490R': '/img/p/0950006490r-fuel-injector.webp',
    'LD.095000-8290': '/img/p/lead-0950008290-diesel-part-inyector-cr-hilux-3-0.webp',
    'LD.095000-7761': '/img/p/lead-0950007761-diesel-part-inyector-cr-hilux-2-5.webp',
    'LD.0.445.110.141': '/img/p/lead-0445110141-diesel-part-inyector-cr-renault-master-2-5.webp',
    'LD.0.445.110.189': '/img/p/lead-0445110189-diesel-part-inyector-cr-sprinter-euro-iii.png',
    'BO. 0.414.702.025': '/img/p/bosch-0414702025-fuel-injector-eui-injector.png',
    'BO. 0.445.120.216': '/img/p/bosch-0445120216-fuel-injector-isuzu.webp',
    'DE.28337917': '/img/p/delphi-28337917-fuel-injector-bobcat-forklift-injector.webp',
    'PK.2645A753': '/img/p/caterpillar-2645a753-fuel-injector-perkins-fuel-injector.webp',
    'AP.64900': '/img/p/alliant-power-64900-fuel-injector.webp',
    'CO.A2C975920080': '/img/p/continental-a2c975920080-fuel-injector.webp',
    'SM.JB3Q-9K546-AB': '/img/p/siemens-jb3q9k546ab-fuel-injector-continental.webp',
    'CM.4954888': '/img/p/cummins-4954888-fuel-injector-cummins-isx.webp',
    'DE.28359042': '/img/p/delphi-28359042-fuel-injector-fit-for-dfi-diesel-engine.webp',
    'AP.53907': '/img/p/alliant-power-53907-fuel-injector.webp',
    'AP.AP63812BJ': '/img/p/alliant-power-ap63812bj-fuel-injector-heui-navistar-detroit-perkins.webp',
    'DE.BEBJ1C01002': '/img/p/delphi-bebj1c01002-fuel-injector.webp',
    'CM.5594305': '/img/p/cummins-5594305-fuel-injector.webp',
    'CM.2872068PX': '/img/p/cummins-2872068px-fuel-injector-cummins-8-3l.webp',
    'PK.2645A749': '/img/p/perkins-2645a749-fuel-injector-caterpillar-c6-6.webp',
    'DE.28490086': '/img/p/delphi-28490086-fuel-injector.webp',
    'DE.28386106': '/img/p/delphi-28386106-fuel-injector-for-jac-x200-t60-t8-2-0.webp',
    'DE.EX635919': '/img/p/delphi-ex635919-fuel-injector-eui.webp',
    'SM.A2C33351900': '/img/p/siemens-a2c33351900-fuel-injector-nissan-navara-np300.webp',
    'DE.EX631753': '/img/p/delphi-ex631753-fuel-injector-cummins-celect.webp',
    'DE.28232242': '/img/p/delphi-28232242-fuel-injector.webp',
    'CAT.232-1172': '/img/p/caterpillar-2321172-fuel-injector-perkins-cat-3412-heui-injector.webp',
    'DAP.127-8209': '/img/p/dap-1278209-fuel-injector-caterpillar-injector-1278209.webp',
    'DAP.127-8222': '/img/p/dap-1278222-fuel-injector.webp',
    'DE.28565337': '/img/p/delphi-28565337-fuel-injector-volkswagen-california-t6-2-0-tdi.webp',
    'DE.28602948': '/img/p/delphi-28602948-fuel-injector-ducato-old.webp',
    'AP.50904': '/img/p/alliant-power-50904-fuel-injector-isuzu.webp',
    'TO.23670-11030': '/img/p/2367011030-fuel-injector-toyota-hilux-2-8-2017.webp',
    'IZ.8-97311372-5': '/img/p/isuzu-8973113725-fuel-injector.webp',
    'DE.28270450': '/img/p/delphi-28270450-fuel-injector-jcb-js210-4-8.webp',
    'LD.326-0690': '/img/p/lead-3260690-fuel-injector.webp',
    'DN.093400-8610': '/img/p/denso-0934008610-injector-nozzle-dlla150p861.webp',
    'CAT.253-0618': '/img/p/caterpillar-2530618-fuel-injector.webp',
    'CAT.374-0750R': '/img/p/caterpillar-3740750r-fuel-injector.webp',
    'CAT.350-7555R': '/img/p/caterpillar-3507555r-fuel-injector.webp',
    'CAT.387-9427R': '/img/p/caterpillar-3879427r-fuel-injector.webp',
    'DE.BEBE4G1200': '/img/p/delphi-bebe4g1200-fuel-injector-volvo-mack-oem-21458369.webp',
    'AP.50903': '/img/p/alliant-power-50903-fuel-injector-john-deere.webp',
    'AP.52902': '/img/p/alliant-power-52902-fuel-injector-john-deere.webp',
    'DE.28236381': '/img/p/delphi-28236381-fuel-injector-hyundai.webp',
    'DE.L194PBC': '/img/p/delphi-l194pbc-injector-nozzle-bebe4d24003-bebe4d24103.webp',
    'TA.23670-39475': '/img/p/2367039475-fuel-injector-hilux-3-0-2012-2013-2014-2015.webp',
    'AP.BN183069101': '/img/p/alliant-power-bn183069101-fuel-injector-2000-2003-8-7l-perkins-1300.webp',
    'DE.28264951': '/img/p/delphi-28264951-fuel-injector-chevrolet-captiva-2-2l.webp',
    'CAT.320-0677': '/img/p/caterpillar-3200677-fuel-injector-perkins.webp',
    'DN.23670-11030': '/img/p/denso-2367011030-fuel-injector-hilux-2-8.webp',
    'DE.L215PBC': '/img/p/delphi-l215pbc-injector-nozzle.webp',
    'DE.L430PBA': '/img/p/delphi-l430pba-injector-nozzle.webp',
    'DE.L322PBC': '/img/p/delphi-l322pbc-injector-nozzle.webp',
    'DE.L216PBC': '/img/p/delphi-l216pbc-injector-nozzle-bebe4d0800-bebe4d24002.webp',
    'DN.295900-0270': '/img/p/denso-2959000270-fuel-injector-toyota-hilux-3-0.webp',
    'CA.2645A751': '/img/p/caterpillar-2645a751-fuel-injector.webp',
    'DN.23670-30270 REM': '/img/p/denso-2367030270rem-fuel-injector-toyota.webp',
    'CA.10R7673': '/img/p/caterpillar-10r7673-fuel-injector-eui.webp',
    'IZ.8-97602803-4': '/img/p/isuzu-8976028034-fuel-injector-isuzu-7-8l.webp',
    'PK.2645A747': '/img/p/perkins-2645a747-fuel-injector-cat-perkins-2645a747-c6-4226779m1.webp',
    'DE.28347042': '/img/p/delphi-28347042-fuel-injector-bobcat-1-8l-2-4l-3-4l.webp',
    'DT.RB5237650CORE': '/img/p/rb5237650core-diesel-part-core.webp',
    'BO.0.445.110.464': '/img/p/bosch-0445110464-fuel-injector-cr-injector-yanmar.webp',
    'BO.RB5235575CORE': '/img/p/bosch-rb5235575core-diesel-part-core.webp',
    'BO.0.445.124.022': '/img/p/bosch-0445124022-fuel-injector-cr-fuel-injector-voe22336268.webp',
    'DN.260100-6010': '/img/p/denso-2601006010-fuel-injector-toyota-1kd.webp',
    'GP.1825900CORE': '/img/p/1825900core-diesel-part-core.webp',
    'DN.295050-221*': '/img/p/denso-295050221-fuel-injector-295050-1050.webp',
    'AP.AP54904CORE': '/img/p/alliant-power-ap54904core-diesel-part-core.webp',
    'BO.0.986.435.532CORE': '/img/p/bosch-0986435532core-diesel-part-core.webp',
    'BO.0.986.435.519CORE': '/img/p/bosch-0986435519core-diesel-part-core.webp',
    'DN.295700-0530': '/img/p/denso-2957000530-fuel-injector-2gd-ftv-2-4l.webp',
    'BO.0.986.435.251CORE': '/img/p/bosch-0986435251core-diesel-part-core.webp',
    'BO.0.986.435.251': '/img/p/bosch-0986435251-fuel-injector.webp',
    'BO.0.986.441.029CORE': '/img/p/bosch-0986441029core-diesel-part-core.webp',
    'BO.0.445.110.777': '/img/p/bosch-0445110777-fuel-injector.webp',
    'BO.0.445.120.076': '/img/p/bosch-0445120076-fuel-injector-yanmar.webp',
    'BO.0.445.110.507': '/img/p/bosch-0445110507-fuel-injector-yanmar.webp',
    'DN.095000-588#': '/img/p/denso-095000588-fuel-injector-toyota-hiace-2-5l.webp',
    'DE.BEBE4D14102': '/img/p/delphi-bebe4d14102-fuel-injector-eui-e3.webp',
    'BO.0.986.437.364': '/img/p/bosch-0986437364-fuel-injector.webp',
    'BO.0.986.435.053': '/img/p/bosch-0986435053-fuel-injector.webp',
    'BO.0.445.110.968': '/img/p/bosch-0445110968-fuel-injector-d18-d24-d34-engines.webp',
    'BO.0.445.120.140': '/img/p/bosch-0445120140-fuel-injector.webp',
    'BO.0.414.001.003': '/img/p/bosch-0414001003-fuel-pump-unit-pump.png',
    'BO.0.986.435.547': '/img/p/bosch-0986435547-fuel-injector.webp',
    'BO.0.445.124.045': '/img/p/bosch-0445124045-fuel-injector.webp',
    'BO.0.445.110.457': '/img/p/bosch-0445110457-fuel-injector.webp',
    'DN.095000-969#': '/img/p/denso-095000969-fuel-injector.webp',
    'BO.0.445.117.035': '/img/p/bosch-0445117035-fuel-injector.webp',
    'DN.095000-6395': '/img/p/denso-0950006395-fuel-injector-isuzu.webp',
    'BO.0.445.110.566': '/img/p/bosch-0445110566-fuel-injector.webp',
    'BO.0.445.117.083': '/img/p/bosch-0445117083-fuel-injector.webp',
    'DN.260100-4030': '/img/p/denso-2601004030-fuel-injector-mitsubishi-triton.webp',
    'BO.0.445.120.273': '/img/p/bosch-0445120273-fuel-injector.webp',
    'BO.0.445.120.062': '/img/p/bosch-0445120062-fuel-injector.webp',
    'BO.0.445.110.540': '/img/p/bosch-0445110540-fuel-injector.webp',
    'BO.0.445.120.519': '/img/p/bosch-0445120519-fuel-injector.webp',
    'BO.0.445.120.257': '/img/p/bosch-0445120257-fuel-injector.webp',
    'BO.0.445.120.133': '/img/p/bosch-0445120133-fuel-injector.webp',
    'BO.0.986.435.109': '/img/p/bosch-0986435109-fuel-injector-sprinter-2-7l.webp',
    'BO.0.445.110.545': '/img/p/bosch-0445110545-fuel-injector.webp',
    'BO.0.414.703.009': '/img/p/bosch-0414703009-fuel-injector-unit-injector.png',
    'BO.0.445.118.061': '/img/p/bosch-0445118061-fuel-injector-2023-2024-ford-6-7l-powerstroke.webp',
    'BO.0.445.110.335': '/img/p/bosch-0445110335-fuel-injector-cri-2-13-14-16.webp',
    'DN.095000-5391': '/img/p/denso-0950005391-fuel-injector-hino-j05d.webp',
    'BO.0.445.120.064': '/img/p/bosch-0445120064-fuel-injector.webp',
    'BO.0.445.110.313': '/img/p/bosch-0445110313-fuel-injector.webp',
    'BO.0.445.120.351': '/img/p/bosch-0445120351-fuel-injector-holland.webp',
    'DN.295050-220R': '/img/p/denso-295050220r-fuel-injector-for-cummins-engine-qsf3-8-isb4-5.webp',
    'DN.295050-187#': '/img/p/denso-295050187-fuel-injector-isuzu.webp',
    'BO.0.445.116.081': '/img/p/bosch-0445116081-fuel-injector-volvo.webp',
    'BO.0.445.110.789': '/img/p/bosch-0445110789-fuel-injector.webp',
    'BO.0.445.116.016': '/img/p/bosch-0445116016-fuel-injector.webp',
    'BO.0.445.120.214': '/img/p/bosch-0445120214-fuel-injector-weichai.webp',
    'DN.260100-6020': '/img/p/denso-2601006020-fuel-injector-hilux-2-5-2010-abril-2012-toyota.webp',
    'BO.0.445.110.561': '/img/p/bosch-0445110561-fuel-injector.webp',
    'BO.0.445.110.254': '/img/p/bosch-0445110254-fuel-injector-hyundai-santa-fe-2.webp',
    'DN.095000-551#': '/img/p/denso-095000551-fuel-injector-isuzu.webp',
    'BO.0.445.110.101': '/img/p/bosch-0445110101-fuel-injector.webp',
    'BO.0.445.110.544': '/img/p/bosch-0445110544-fuel-injector.webp',
    'BO.0.414.755.002': '/img/p/bosch-0414755002-fuel-pump-diesel-fuel-injection-unit-pump-0.png',
    'BO.0.445.116.024': '/img/p/bosch-0445116024-fuel-injector-bmw-3-series-320d-coupe.webp',
    'DN.095000-9510/N': '/img/p/denso-0950009510n-fuel-injector-neutral-box.webp',
    'BO.0.445.110.057': '/img/p/bosch-0445110057-fuel-injector-peugeot-expert-2-0-hdi-2000-2007.webp',
    'BO.0.414.720.215R': '/img/p/bosch-0414720215r-fuel-injector-eui.png',
    'DN.295700-1060': '/img/p/denso-2957001060-fuel-injector-isuzu-dmax-4jj1-lat.webp',
    'BO.0.445.110.918': '/img/p/bosch-0445110918-fuel-injector-jimic.webp',
    'BO.0.414.701.082': '/img/p/bosch-0414701082-fuel-injector-scania-1440579.png',
    'BO.0.445.118.027': '/img/p/bosch-0445118027-fuel-injector.webp',
    'BO.0.445.115.007': '/img/p/bosch-0445115007-fuel-injector.png',
    'BO.0.414.703.013': '/img/p/bosch-0414703013-fuel-injector-unit-injector.png',
    'BO.0.445.110.126': '/img/p/bosch-0445110126-fuel-injector.webp',
    'DN.095000-527#': '/img/p/denso-095000527-fuel-injector.webp',
    'DN.095000-500#': '/img/p/denso-095000500-fuel-injector.webp',
    'BO.0.445.120.246': '/img/p/bosch-0445120246-fuel-injector-deutz-tcd6-1l6.webp',
    'BO.0.445.110.616': '/img/p/bosch-0445110616-fuel-injector.webp',
    'DN.095000-8933': '/img/p/denso-0950008933-fuel-injector-isuzu-6hk1-4hk1.webp',
    'SM.A2C59513553': '/img/p/siemens-a2c59513553-fuel-injector-ranger-discovery-7h2q9k546cb.webp',
    'DN.095000-0741': '/img/p/denso-0950000741-fuel-injector-toyota.webp',
    'DN.095000-5474': '/img/p/denso-0950005474-fuel-injector.webp',
    'DN.095000-7172': '/img/p/denso-0950007172-fuel-injector.webp',
    'DN.095000-637R': '/img/p/denso-095000637r-fuel-injector-isuzu.webp',
    'DN.9709500-075': '/img/p/denso-9709500075-fuel-injector-toyota-1kd-ftv-land-cruiser.webp',
    'BO.0.445.110.190': '/img/p/bosch-0445110190-fuel-injector-sprinter-cdi-311-313.webp',
    'BO.0.445.116.073': '/img/p/bosch-0445116073-fuel-injector-free-lander.webp',
    'BO.0.445.120.548': '/img/p/bosch-0445120548-fuel-injector-volvo-penta.webp',
    'DN.095000-6640': '/img/p/denso-0950006640-fuel-injector-komatsu-saa6d125e-wa470.webp',
    'BO.0.445.120.033': '/img/p/bosch-0445120033-fuel-injector.webp',
    'DN.095000-5280': '/img/p/denso-0950005280-fuel-injector-hino-kobelco-j08e.webp',
    'BO.0.445.120.251': '/img/p/bosch-0445120251-fuel-injector-cummins-6-7l-qsb-hpcr-injector.webp',
    'BO.0.445.120.386': '/img/p/bosch-0445120386-fuel-injector-mercedes-benz-actros-mp4.webp',
    'DN.095000-9510R': '/img/p/denso-0950009510r-fuel-injector-hino-n04c-euro-5-24v.webp',
    'BO.0.445.110.657': '/img/p/bosch-0445110657-fuel-injector-iveco-holland-john-deere-case.webp',
    'BO.0.445.110.260': '/img/p/bosch-0445110260-fuel-injector.webp',
    'DN.095000-7560R': '/img/p/denso-0950007560r-fuel-injector-john-deere.webp',
    'DN.095000-0550R': '/img/p/denso-0950000550r-fuel-injector-john-deere.webp',
    'DN.095000-7172 R': '/img/p/denso-0950007172r-fuel-injector.webp',
    'DN.095000-121*': '/img/p/denso-095000121-fuel-injector.webp',
    'DN.095000-7510': '/img/p/denso-0950007510-fuel-injector.webp',
    'BO.0.432.191.552': '/img/p/bosch-0432191552-fuel-injector-volvo-penta-engine-tad1232ge.webp',
    'BO.0.445.110.351': '/img/p/bosch-0445110351-fuel-injector.webp',
    'DN.095000-0510': '/img/p/denso-0950000510-fuel-injector-nissan-x-trail-t30-2-2l-16600.webp',
    'DN.095000-0950': '/img/p/denso-0950000950-fuel-injector.webp',
    'DN.095000-7800': '/img/p/denso-0950007800-fuel-injector.webp',
    'DN.095000-6860': '/img/p/denso-0950006860-fuel-injector-mitsubishi-fuso-6m60-me304627.webp',
    'BO.0.445.120.108': '/img/p/bosch-0445120108-fuel-injector-volvo-penta.webp',
    'DE.BEBE4C01101': '/img/p/delphi-bebe4c01101-fuel-injector-eui-volvo-oe-reference-number.webp',
    'DE.BEBE4D3401': '/img/p/delphi-bebe4d3401-fuel-injector-eui-volvo-oe-reference-number.webp',
    'BO.0.445.120.235': '/img/p/bosch-0445120235-fuel-injector-sisu-trucks-oem-837073713.webp',
    'BO.0.432.191.788': '/img/p/bosch-0432191788-fuel-injector-volvo.webp',
    'BO.0.986.445.008 BOSCH UNIT PUMP': '/img/p/bosch-0986445008boschunitpump-fuel-pump-bosch-unit-pump.webp',
    'BO.0.445.117.034': '/img/p/bosch-0445117034-fuel-injector.webp',
    'BO.0.414.693.005': '/img/p/bosch-0414693005-fuel-pump-bosch-unit-pump.png',
    'BO.0.986.445.008': '/img/p/bosch-0986445008-fuel-pump-bosch-unit-pump.webp',
    'BO.0.414.799.018': '/img/p/bosch-0414799018-fuel-pump-bosch-unit-pump.png',
    'BO.0.414.799.030': '/img/p/bosch-0414799030-fuel-pump-bosch-unit-pump.png',
    'BO.0.414.799.025': '/img/p/bosch-0414799025-fuel-pump-bosch-unit-pump.png',
    'BO.0.986.445.103': '/img/p/bosch-0986445103-fuel-pump-bosch-unit-pump.webp',
    'BO.0.414.799.038': '/img/p/bosch-0414799038-fuel-pump-bosch-unit-pump.png',
    'BO.0.414.799.017': '/img/p/bosch-0414799017-fuel-pump-bosch-unit-pump.png',
    'BO.0.414.799.009': '/img/p/bosch-0414799009-fuel-pump-eletronic-unit-pump-for-mtu.png',
    'DN.095000-534': '/img/p/denso-095000534-fuel-injector-isuzu-nqr75-4hk1-fvr34-6hk1.webp',
    'BO.0.445.120.092': '/img/p/bosch-0445120092-fuel-injector-holland-cr6-80.webp',
    'BO.0.445.120.157': '/img/p/bosch-0445120157-fuel-injector.webp',
    'BO.0.445.120.174': '/img/p/bosch-0445120174-fuel-injector-volvo-penta-mercedes-mitsubishi.webp',
    'DN.095000-5130': '/img/p/denso-0950005130-fuel-injector-assy-denso-nissan-x-trail-almera.webp',
    'BO.0.445.120.173': '/img/p/bosch-0445120173-fuel-injector-volvo-penta-mercedes-mitsubishi.webp',
    'BO.0.445.120.289': '/img/p/bosch-0445120289-fuel-injector-cummins.webp',
    'BO.0.445.110.484': '/img/p/bosch-0445110484-fuel-injector.webp',
    'BO.0.445.120.052': '/img/p/bosch-0445120052-fuel-injector-volvo-penta-mercedes-mitsubishi.webp',
    'DE.BEBE4D21001': '/img/p/delphi-bebe4d21001-diesel-part-eui-for-hyundai-euro-iii-21914232.webp',
    'BO.0.414.701.062': '/img/p/bosch-0414701062-fuel-injector-scania.png',
    'BO.0.445.120.072': '/img/p/bosch-0445120072-fuel-injector-4m50.webp',
    'DE.BEBE4D37001': '/img/p/delphi-bebe4d37001-diesel-part-delphi-eui-volvo.webp',
    'BO.0.414.720.215': '/img/p/bosch-0414720215-fuel-injector-eui-injector.png',
    'BO.0.445.116.017': '/img/p/bosch-0445116017-fuel-injector-piezo-hyundai-for-kia.webp',
    'BO.0.445.115.028': '/img/p/bosch-0445115028-fuel-injector-piezo.png',
    'BO.0.445.110.044': '/img/p/bosch-0445110044-fuel-injector-suzuki-chevrolet-citroen-fiat.webp',
    'BO.0.445.110.430': '/img/p/bosch-0445110430-fuel-injector-jeep-grand-cherokee-3-0d-from.webp',
    'BO.0.445.116.034': '/img/p/bosch-0445116034-fuel-injector-amarok-2-0-2009-2012-03l130277c.webp',
    'BO.0.445.116.012': '/img/p/bosch-0445116012-fuel-injector-land-rover-discovery.webp',
    'BO.0.445.110.269': '/img/p/bosch-0445110269-fuel-injector.webp',
    'BO.0.445.117.084': '/img/p/bosch-0445117084-fuel-injector-amarock.webp',
    'BO.0.445.110.519': '/img/p/bosch-0445110519-fuel-injector-mb-a4000700187-mitsubishi.webp',
    'DN.295050-105#': '/img/p/denso-295050105-fuel-injector-nissan-pathfinder-navara.webp',
    'BO.0.445.110.255': '/img/p/bosch-0445110255-fuel-injector-hyundai-kia.webp',
    'BO.0.445.120.123': '/img/p/bosch-0445120123-fuel-injector-cummins-oem-4937065-cummins-3-9.webp',
    'BO.0.445.110.251': '/img/p/bosch-0445110251-fuel-injector-volvo-xc90-i-2-4-d-2005-2015.webp',
    'BO.0.445.120.218': '/img/p/bosch-0445120218-fuel-injector-man.webp',
    'BO.0.445.120.126': '/img/p/bosch-0445120126-fuel-injector.webp',
    'BO.0.445.116.050': '/img/p/bosch-0445116050-fuel-injector.webp',
    'BO.0.445.110.512': '/img/p/bosch-0445110512-fuel-injector-jac-2-8l.webp',
    'BO.0.986.435.166': '/img/p/bosch-0986435166-fuel-injector-amarok-2-0-tdi-16v.webp',
    'BO.0.445.120.304': '/img/p/bosch-0445120304-fuel-injector-cummins-isle-engine-5272.webp',
    'BO.0.445.110.682': '/img/p/bosch-0445110682-fuel-injector-fiat-toro.webp',
    'BO.0.432.193.445': '/img/p/bosch-0432193445-fuel-injector-sth-mercedes-benz.webp',
    'DN.095000-0550': '/img/p/denso-0950000550-fuel-injector-john-deere.webp',
    'DN.095000-6813': '/img/p/denso-0950006813-fuel-injector-hino.webp',
    'BO.0.432.193.444': '/img/p/bosch-0432193444-fuel-injector-cummins.webp',
    'BO.0.445.110.265': '/img/p/bosch-0445110265-fuel-injector-renault-master.webp',
    'BO.0.445.110.248': '/img/p/bosch-0445110248-fuel-injector-iveco-daily-2-8.webp',
    'DN.095000-6880R': '/img/p/denso-0950006880r-fuel-injector-john-deere.webp',
    'BO.0.445.110.498': '/img/p/bosch-0445110498-fuel-injector-mahindra.webp',
    'BO.0.445.110.454': '/img/p/bosch-0445110454-fuel-injector-jmc.webp',
    'DN.295050-0470': '/img/p/denso-2950500470-fuel-injector-toyota-hilux-iii-2-5-d-4d-4wd.webp',
    'DN.095000-8740': '/img/p/denso-0950008740-fuel-injector-toyota-hilux-2kd-ftv.webp',
    'DN.095000-5050R': '/img/p/denso-0950005050r-fuel-injector-john-deere.webp',
    'DN.295050-0460': '/img/p/denso-2950500460-fuel-injector-toyota-1kd-ftv-euro-4-hilux-prado.webp',
    'BO.0.445.110.429': '/img/p/bosch-0445110429-fuel-injector-amarok.webp',
    'BO.0.445.120.028': '/img/p/bosch-0445120028-fuel-injector-iveco.webp',
    'DN.295700-0140': '/img/p/denso-2957000140-fuel-injector-hyundai.webp',
    'BO.0.414.701.080': '/img/p/bosch-0414701080-fuel-injector.png',
    'BO.0.445.120.326': '/img/p/bosch-0445120326-fuel-injector.webp',
    'BO.0.445.120.043': '/img/p/bosch-0445120043-fuel-injector-mwm-series-12.webp',
    'BO.0.445.116.064': '/img/p/bosch-0445116064-fuel-injector-land-rover-discovery-citroen.webp',
    'BO.0.445.120.336': '/img/p/bosch-0445120336-fuel-injector-2013-2018-6-7-cummins-cab-chassis.png',
    'BO.0.445.116.043': '/img/p/bosch-0445116043-fuel-injector-freelander.webp',
    'BO.0.445.120.080': '/img/p/bosch-0445120080-fuel-injector.webp',
    'DN.095000-5135': '/img/p/denso-0950005135-fuel-injector-nissan-x-trail-yd22-aw40a-aw4.webp',
    'BO.0.445.120.120': '/img/p/bosch-0445120120-fuel-injector.webp',
    'BO.0.445.120.297': '/img/p/bosch-0445120297-fuel-injector-cummins-isf3-8-5264272-agrale.webp',
    'SM.BK2Q-9K546AF': '/img/p/siemens-bk2q9k546af-fuel-injector-ford-ranger-transit-citroen.webp',
    'DE.7135-538': '/img/p/delphi-7135538-diesel-part-hydraulic-head.webp',
    'DE.28229873R': '/img/p/delphi-28229873r-fuel-injector.webp',
    'DN.295050-1060': '/img/p/denso-2950501060-fuel-injector-nissan-navara.webp',
    'DN.295050-0540': '/img/p/denso-2950500540-fuel-injector-hilux-2-5-final-2010-apr2012.webp',
    'DN.295700-0560': '/img/p/denso-2957000560-fuel-injector-toyota-2gd-ftv-2-4l.webp',
    'DN.095000-7560': '/img/p/denso-0950007560-fuel-injector-john-deere.webp',
    'DN.095000-6980': '/img/p/denso-0950006980-fuel-injector-isuzu-dmax-3-0l-4jj1.webp',
    'DN.095000-6481': '/img/p/denso-0950006481-fuel-injector-john-deere.webp',
    'DN.095000-0144': '/img/p/denso-0950000144-fuel-injector-isuzu-6hk1.webp',
    'BO.0.445.120.272': '/img/p/bosch-0445120272-fuel-injector-cummins-8-3-isc.webp',
    'BO.0.445.120.225': '/img/p/bosch-0445120225-fuel-injector-yuchai-engine-yc4g.webp',
    'BO.0.445.120.074': '/img/p/bosch-0445120074-fuel-injector-volvo.webp',
    'BO.0.445.120.049': '/img/p/bosch-0445120049-fuel-injector-mitsubishi-fuso-canter-4-9l.webp',
    'BO.0.445.120.002': '/img/p/bosch-0445120002-fuel-injector-iveco.webp',
    'BO.0.445.110.647': '/img/p/bosch-0445110647-fuel-injector-amarok.webp',
    'BO.0.445.110.369': '/img/p/bosch-0445110369-fuel-injector-amarok.webp',
    'BO.0.445.110.189 REMAN': '/img/p/bosch-0445110189reman-fuel-injector-bosch.png',
    'BO.0.445.110.183': '/img/p/bosch-0445110183-fuel-injector.png',
    'BO.0.445.110.049': '/img/p/bosch-0445110049-fuel-injector-land-rover.webp',
    'BO.0.445.110.008': '/img/p/bosch-0445110008-fuel-injector-suzuki-chevrolet-citroen-fiat.webp',
    'BO.0.414.750.004': '/img/p/bosch-0414750004-fuel-pump-bosch-unit-pump.png',
    'BO.0.986.437.421': '/img/p/bosch-0986437421-fuel-injector.webp',
    'PP.6920-PP CORE': '/img/p/alliant-power-6920ppcore-diesel-part-core.webp',
    'BO.0.445.110.629': '/img/p/bosch-0445110629-fuel-injector.webp',
    'BO.0.445.126.001': '/img/p/bosch-0445126001-fuel-injector.webp',
    'BO.0.445.118.037': '/img/p/bosch-0445118037-fuel-injector.webp',
    'AP.AP54905CORE': '/img/p/alliant-power-ap54905core-diesel-part-core.webp',
    'BO.0.445.120.212': '/img/p/bosch-0445120212-fuel-injector-iveco.webp',
    'BO.0.445.110.634': '/img/p/bosch-0445110634-fuel-injector-renault.webp',
    'BO.0.445.115.045': '/img/p/bosch-0445115045-fuel-injector-kia-mohave-3-0-crdi-v6.webp',
    'BO.0.445.115.063': '/img/p/bosch-0445115063-fuel-injector-cherokee.webp',
    'BO.0.445.116.035': '/img/p/bosch-0445116035-fuel-injector-amarok.webp',
    'BO.0.445.117.023': '/img/p/bosch-0445117023-fuel-injector-2011-14-ford-f250-super-duty.webp',
    'BO.0.445.120.007': '/img/p/bosch-0445120007-fuel-injector-iveco.webp',
    'BO.0.445.120.054': '/img/p/bosch-0445120054-fuel-injector-iveco-eurocargo-3-9-d-140-300.webp',
    'BO.0.445.120.067': '/img/p/bosch-0445120067-fuel-injector-deutz-renault-mwm-khd-volvo.webp',
    'BO.0.445.120.075': '/img/p/bosch-0445120075-fuel-injector-holland-case-combine-af5130-ih.webp',
    'BO.0.445.120.134': '/img/p/bosch-0445120134-fuel-injector-cummins-isf.webp',
    'BO.0.445.120.195': '/img/p/bosch-0445120195-fuel-injector-detroit-dd13.webp',
    'BO.0.445.124.012': '/img/p/bosch-0445124012-fuel-injector-navistar-engine.webp',
    'BO.F.00H.N37.925': '/img/p/bosch-f00hn37925-solenoid-0-414-701-072-1943974.webp',
    'CA.127-8216': '/img/p/caterpillar-1278216-fuel-injector-eui.webp',
    'CAT.326-4700': '/img/p/caterpillar-3264700-fuel-injector-perkins-2645a747-c6-4226779m1.webp',
    'CAT.326-4700(NOCD)': '/img/p/caterpillar-3264700nocd-fuel-injector.webp',
    'DE.28229876': '/img/p/delphi-28229876-fuel-injector.webp',
    'DE.28258683': '/img/p/delphi-28258683-fuel-injector-jcb.webp',
    'DE.7135-588': '/img/p/delphi-7135588-repair-kit-delphi-actuator-kit.webp',
    'DE.BEBE4C00101': '/img/p/delphi-bebe4c00101-diesel-part-delphi-eui-e1-for-renault-truck.webp',
    'DE.BEBE4D24001': '/img/p/delphi-bebe4d24001-diesel-part-delphi-eui-volvo-21340611.webp',
    'DE.EJBR00301D': '/img/p/delphi-ejbr00301d-fuel-injector-ssangyong-korando-a6-710170121.webp',
    'DE.EJBR02801D': '/img/p/delphi-ejbr02801d-fuel-injector-hyundai-kia.webp',
    'DE.EJBR04401D': '/img/p/delphi-ejbr04401d-fuel-injector-ssangyong-rexton-kyron-roduis.webp',
    'DE.EJBR04501D': '/img/p/delphi-ejbr04501d-fuel-injector-ssangyong-actyon-2-0.webp',
    'DE.EJBR04601D': '/img/p/delphi-ejbr04601d-fuel-injector-ssangyong-rexton.webp',
    'DE.EJBR04701D': '/img/p/delphi-ejbr04701d-fuel-injector-ssangyong-2.webp',
    'DE.EJBR05001D': '/img/p/delphi-ejbr05001d-fuel-injector-jcb.webp',
    'DE.EJBR05501D': '/img/p/delphi-ejbr05501d-fuel-injector-kia.webp',
    'DE.EMBR00301D': '/img/p/delphi-embr00301d-fuel-injector-ssangyong-korando-a6-710170121.webp',
    'DE.L222PBC': '/img/p/delphi-l222pbc-injector-nozzle-20440388-bebe4c01101.webp',
    'DN.095000-0530': '/img/p/denso-0950000530-fuel-injector-toyota-land-cruiser-1kd-ftv.webp',
    'DN.095000-064': '/img/p/denso-095000064-fuel-injector-corolla.webp',
    'DN.095000-5215': '/img/p/denso-0950005215-fuel-injector-hino.webp',
    'DN.095000-547#R': '/img/p/denso-095000547r-fuel-injector-isuzu-npr-hd-4hk1.webp',
    'DN.095000-5650': '/img/p/denso-0950005650-fuel-injector-nissan-c-r.webp',
    'DN.095000-5801': '/img/p/denso-0950005801-fuel-injector-ford-transit-2-4-6c1q-9k546-ac.webp',
    'DN.095000-5801R': '/img/p/denso-0950005801r-fuel-injector-ford-transit-2-4.webp',
    'DN.095000-6243': '/img/p/denso-0950006243-fuel-injector-nissan-for-navara-yd25-euro-iv.webp',
    'DN.095000-6312': '/img/p/denso-0950006312-fuel-injector-john-deere.webp',
    'DN.095000-6376': '/img/p/denso-0950006376-fuel-injector-isuzu-4hk1-6hk1-euro-iv.webp',
    'DN.095000-6481R': '/img/p/denso-0950006481r-fuel-injector-re-529149-dlla125p889-john-deere.webp',
    'DN.095000-6500': '/img/p/denso-0950006500-fuel-injector-john-deere.webp',
    'DN.095000-651#': '/img/p/denso-095000651-fuel-injector-hino-300-toyota-dyna.webp',
    'DN.095000-6590': '/img/p/denso-0950006590-fuel-injector-23670e0010-dlla158p854-for-hino.webp',
    'DN.095000-6613': '/img/p/denso-0950006613-fuel-injector-hino-truck-j05e.webp',
    'DN.095000-6700': '/img/p/denso-0950006700-fuel-injector-sinotruck.webp',
    'DN.095000-7060': '/img/p/denso-0950007060-fuel-injector-ford-transit-2-4-16v-diesel-2008.webp',
    'DN.095000-714#R': '/img/p/denso-095000714r-fuel-injector-hyundai-mighty-mega-truck.webp',
    'DN.095000-7500': '/img/p/denso-0950007500-fuel-injector-mit-4m41.webp',
    'DN.095000-7761': '/img/p/denso-0950007761-fuel-injector-toyota-hilux-vigo-2kd-hiace-2-5-d.webp',
    'DN.095000-8011': '/img/p/denso-0950008011-fuel-injector-sino-truck-howo-d12-a7-2.webp',
    'DN.095000-8100': '/img/p/denso-0950008100-fuel-injector-sinotruck-howo-a7.webp',
    'DN.095000-8110': '/img/p/denso-0950008110-fuel-injector-pajero.webp',
    'DN.095000-8290': '/img/p/denso-0950008290-fuel-injector-hilux-vigo-1kd-ftv-3-0l.webp',
    'DN.095000-8290R': '/img/p/denso-0950008290r-fuel-injector-toyota-hillux-1kd.webp',
    'DN.095000-978#': '/img/p/denso-095000978-fuel-injector-toyota-1vd-ftv-l30d5d095000978.webp',
    'DN.295050-0180': '/img/p/denso-2950500180-fuel-injector-toyota.webp',
    'DN.295050-0520': '/img/p/denso-2950500520-fuel-injector-toyota-1kd.webp',
    'DN.295050-0530': '/img/p/denso-2950500530-fuel-injector-toyota-2kd.webp',
    'DN.295050-0810': '/img/p/denso-2950500810-fuel-injector-hilux-2-5-2010-abril-2012-toyota.webp',
    'DN.9709500-778': '/img/p/denso-9709500778-fuel-injector.webp',
    'LD.326-4700': '/img/p/lead-3264700-fuel-injector-lead-2.webp',
    'MX.2872127PX': '/img/p/maxzz-2872127px-fuel-injector.webp',
    'MZ.7206-0379': '/img/p/72060379-diesel-part-actuador-semi-nuevo.webp',
    'SM.1348623': '/img/p/siemens-1348623-fuel-injector.webp',
    'SM.7001105C1-RV': '/img/p/siemens-7001105c1rv-fuel-injector-revisado-bico-injetor-troller-3-2.webp',
    'SM.A2C3999700080': '/img/p/siemens-a2c3999700080-fuel-injector-mwm-3-2-sprint-7001105c1.webp',
    'SM.A2C59511364': '/img/p/siemens-a2c59511364-fuel-injector.webp',
    'SM.BK2Q-9K546-AG': '/img/p/siemens-bk2q9k546ag-diesel-part-ranger-3-2-transit-2.webp',
    'BO.0.414.701.072': '/img/p/bosch-0414701072-fuel-pump-1943974-scania-r480-dc13-r440.webp',
    'BO.0.445.110.141': '/img/p/bosch-0445110141-fuel-injector-renault.webp',
    'BO.0.445.110.231': '/img/p/bosch-0445110231-fuel-injector-s10-2-8-nissan-frontier-2-8-2005.webp',
    'BO.0.445.110.253': '/img/p/bosch-0445110253-fuel-injector-tucson.webp',
    'BO.0.445.110.257': '/img/p/bosch-0445110257-fuel-injector-hyundai-sonata-nf-2-0-vgt-crdi.webp',
    'BO.0.445.110.273': '/img/p/bosch-0445110273-fuel-injector-iveco-daily.webp',
    'BO.0.445.110.279': '/img/p/bosch-0445110279-fuel-injector-hyundai-and-kia.webp',
    'BO.0.445.110.290': '/img/p/bosch-0445110290-fuel-injector-hyundai.webp',
    'BO.0.445.110.317': '/img/p/bosch-0445110317-fuel-injector-nissan-nozzle-dlla145p1720.webp',
    'BO.0.445.110.418': '/img/p/bosch-0445110418-fuel-injector-iveco.webp',
    'BO.0.445.110.520': '/img/p/bosch-0445110520-fuel-injector.webp',
    'BO.0.445.110.293': '/img/p/bosch-0445110293-fuel-injector-047023-220325-for-great-wall.webp',
    'BO. 0.433.172.200': '/img/p/bosch-0433172200-injector-nozzle-dlla143p2200.webp',
    'BO.0.432.217.255': '/img/p/bosch-0432217255-fuel-injector-bosch-diesel-fuel-injector-nozzle.webp',
    'BO.0.433.171.519': '/img/p/bosch-0433171519-injector-nozzle-dlla146p708.webp',
    'BO.0.433.172.042': '/img/p/bosch-0433172042-injector-nozzle-0-445-120-197.webp',
    'BO.0.433.172.093': '/img/p/bosch-0433172093-injector-nozzle-dlla145p1794.webp',
    'BO.0.433.172.113': '/img/p/bosch-0433172113-injector-nozzle-dlla146p1823.webp',
    'BO.0.433.172.206': '/img/p/bosch-0433172206-injector-nozzle-0-445-120-252.webp',
    'BO.0.433.172.304': '/img/p/bosch-0433172304-injector-nozzle-cr-nozzle.webp',
    'BO.0.433.172.540': '/img/p/bosch-0433172540-injector-nozzle-0-445-120-424.webp',
    'BO.2.418.529.988': '/img/p/bosch-2418529988-injector-nozzle-volvo-man.webp',
    'BO.F.002.C30.007': '/img/p/bosch-f002c30007-injector-nozzle-dlla150s1339.webp',
    'DAP.DLLA155P1025': '/img/p/dlla155p1025-injector-nozzle-095000-778x-754x.webp',
    'DAP.F.019.121.034': '/img/p/dap-f019121034-injector-nozzle-dlla153p034.webp',
    'DE.6980528': '/img/p/delphi-6980528-injector-nozzle-dlla155p842.webp',
    'DE.6980529': '/img/p/delphi-6980529-injector-nozzle-dlla155p840.webp',
    'DE.6980546': '/img/p/delphi-6980546-injector-nozzle-dlla145p870.webp',
    'DE.6980549': '/img/p/delphi-6980549-injector-nozzle-095000-776x-toyota-hilux-2-5.webp',
    'DE.6980577': '/img/p/delphi-6980577-injector-nozzle-dlla150pm1600.webp',
    'DE.6980586': '/img/p/delphi-6980586-injector-nozzle.webp',
    'DE.L052PBC': '/img/p/delphi-l052pbc-injector-nozzle.webp',
    'DE.L060PBA': '/img/p/delphi-l060pba-injector-nozzle-2645a044.webp',
    'DN.093400-6420': '/img/p/denso-0934006420-injector-nozzle-dlla154p642.webp',
    'DN.093400-6920': '/img/p/denso-0934006920-injector-nozzle-3380045500.webp',
    'DN.093400-7680': '/img/p/denso-0934007680-injector-nozzle-me220255.webp',
    'FI.ALLA148P817': '/img/p/alla148p817-injector-nozzle-095000-508x.webp',
    'LD.093400-6920': '/img/p/lead-0934006920-injector-nozzle-dlla146p692.webp',
    'LD.093400-7680': '/img/p/lead-0934007680-injector-nozzle-dlla146p768.webp',
    'LD.105017-2910': '/img/p/lead-1050172910-injector-nozzle-dlla140pn291.webp',
    'LD.105017-9370': '/img/p/lead-1050179370-injector-nozzle-dsla147pn937.webp',
    'LD.DLLA150P1113': '/img/p/lead-dlla150p1113-injector-nozzle-for-inj-1j500-53051-095000-9690.webp',
    'LD.G3S66': '/img/p/lead-g3s66-injector-nozzle-for-kubota-1j770-53051-295050.webp',
    'LD.QSX.7217.08': '/img/p/lead-qsx721708-injector-nozzle-for-inj-4307217-5579423.webp',
    'ST.31068': '/img/p/31068-injector-nozzle.webp',
    'ZX.105015-8680': '/img/p/1050158680-injector-nozzle.webp',
    'ZX.105017-0090': '/img/p/1050170090-injector-nozzle.webp',
    'ZX.105017-1980': '/img/p/1050171980-injector-nozzle.webp',
    'ZX.105017-2760': '/img/p/1050172760-injector-nozzle-dlla155pn276.webp',
    'ZX.105017-9370': '/img/p/1050179370-injector-nozzle-mhy-3436503200-zxl-h105017937-zxl.webp',
    'ZX.105019-2900': '/img/p/zexel-1050192900-injector-nozzle-dlla150sm303.webp',
    'DN.093400-0200': '/img/p/denso-0934000200-injector-nozzle.webp',
    'DN.093400-1330': '/img/p/denso-0934001330-injector-nozzle-dn4sdnd133.webp',
    'DN.093400-5060': '/img/p/denso-0934005060-injector-nozzle-dn15pd6.webp',
    'DN.093400-5320': '/img/p/denso-0934005320-injector-nozzle-tobera-dn20pd32.webp',
    'DN.093400-5620': '/img/p/denso-0934005620-injector-nozzle.webp',
    'DN.093400-6280': '/img/p/denso-0934006280-injector-nozzle-tobera-dn0pd628.webp',
    'DN.093400-7040': '/img/p/denso-0934007040-injector-nozzle-tobera-dn0pd704.webp',
    'LD.093400-5320': '/img/p/lead-0934005320-injector-nozzle-dn20pd32.webp',
    'LD.105007-1300': '/img/p/lead-1050071300-injector-nozzle-dn0pdn130a.webp',
    'LD.105007-1350': '/img/p/lead-1050071350-injector-nozzle-9-432-610-478.webp',
    'LD.105007-1580': '/img/p/lead-1050071580-injector-nozzle-9-432-612-795.webp',
    'ZX.105007-1210': '/img/p/1050071210-injector-nozzle-dn0pdn121.webp',
    'ZX.105007-1290': '/img/p/1050071290-injector-nozzle.webp',
    'FB.BLLA125P889-J': '/img/p/fratelli-bosio-blla125p889j-injector-nozzle-095000-6481-john-deere.webp',
    'FB.BLLA126P1776': '/img/p/fratelli-bosio-blla126p1776-injector-nozzle-0-445-120-140.webp',
    'FB.BLLA139P851-J': '/img/p/fratelli-bosio-blla139p851j-injector-nozzle-095000-5480.webp',
    'FB.BLLA139P887': '/img/p/fratelli-bosio-blla139p887-injector-nozzle-095000-6490-john-deere.webp',
    'FB.BLLA142P1333': '/img/p/fratelli-bosio-blla142p1333-injector-nozzle-0-445-120-028.webp',
    'FB.BLLA143P2155': '/img/p/fratelli-bosio-blla143p2155-fuel-injector-dlla143p2155-injector-0-445-120.webp',
    'FB.BLLA143P2200.BLANK': '/img/p/fratelli-bosio-blla143p2200blank-injector-nozzle-0-445-120-239-256.webp',
    'FB.BLLA145P870': '/img/p/fratelli-bosio-blla145p870-injector-nozzle-095000-5600.webp',
    'FB.BLLA145P875': '/img/p/fratelli-bosio-blla145p875-injector-nozzle-095000-576-mit-pajero-triton-l200.webp',
    'FB.BLLA147P747-J': '/img/p/fratelli-bosio-blla147p747j-injector-nozzle-095000-057x.webp',
    'FB.BLLA148P816-J': '/img/p/fratelli-bosio-blla148p816j-injector-nozzle-095000-5070-095000-513-nissan.webp',
    'FB.BLLA148P817-J': '/img/p/fratelli-bosio-blla148p817j-injector-nozzle-095000-508.webp',
    'FB.BLLA148P932-J': '/img/p/fratelli-bosio-blla148p932j-injector-nozzle-095000-624.webp',
    'FB.BLLA150LP053': '/img/p/fratelli-bosio-blla150lp053-injector-nozzle-dlla150lp053.webp',
    'FB.BLLA150LP193': '/img/p/fratelli-bosio-blla150lp193-injector-nozzle-dlla150lp193.webp',
    'FB.BLLA150P1023': '/img/p/fratelli-bosio-blla150p1023-injector-nozzle-095000-7580.webp',
    'FB.BLLA150P1197': '/img/p/fratelli-bosio-blla150p1197-injector-nozzle-bosch-0-445-110-290-bosch-0-445.webp',
    'FB.BLLA150P866-J': '/img/p/fratelli-bosio-blla150p866j-injector-nozzle-095000-5550.webp',
    'FB.BLLA151G3S10': '/img/p/fratelli-bosio-blla151g3s10-injector-nozzle-235050-0300-2-5-dci.webp',
    'FB.BLLA152G3S51': '/img/p/fratelli-bosio-blla152g3s51-injector-nozzle-295050-1050-295050-0300-16600.webp',
    'FB.BLLA152G3S52': '/img/p/fratelli-bosio-blla152g3s52-injector-nozzle-166-3xn0.webp',
    'FB.BLLA152LP222': '/img/p/fratelli-bosio-blla152lp222-injector-nozzle-dlla152lp222.webp',
    'FB.BLLA152P1072': '/img/p/fratelli-bosio-blla152p1072-injector-nozzle-095000-8340.webp',
    'FB.BLLA152P1115-J': '/img/p/fratelli-bosio-blla152p1115j-fuel-injector-095000-803-injector.webp',
    'FB.BLLA152P980-J': '/img/p/fratelli-bosio-blla152p980j-injector-nozzle-dlla152p980-j.webp',
    'FB.BLLA152P981-J': '/img/p/fratelli-bosio-blla152p981j-injector-nozzle-8-98011605-095000-699-isuzu-d-max.webp',
    'FB.BLLA153P1246': '/img/p/fratelli-bosio-blla153p1246-injector-nozzle-0-445-110-137-138-162-163-191-192.webp',
    'FB.BLLA153P885': '/img/p/fratelli-bosio-blla153p885-injector-nozzle-095000-7060.webp',
    'FB.BLLA155P1028': '/img/p/fratelli-bosio-blla155p1028-injector-nozzle-095000-7640.webp',
    'FB.BLLA155P1030-J': '/img/p/fratelli-bosio-blla155p1030j-injector-nozzle-093500-956x.webp',
    'FB.BLLA155P1044': '/img/p/fratelli-bosio-blla155p1044-injector-nozzle-095000-652.webp',
    'FB.BLLA155P1493': '/img/p/fratelli-bosio-blla155p1493-injector-nozzle-0-445-110-250.webp',
    'FB.BLLA155P1514': '/img/p/fratelli-bosio-blla155p1514-injector-nozzle-0-445-110-249.webp',
    'FB.BLLA155P842-J': '/img/p/fratelli-bosio-blla155p842j-injector-nozzle-095000-659.webp',
    'FB.BLLA155P848': '/img/p/fratelli-bosio-blla155p848-injector-nozzle-095000-6350-hino.webp',
    'FB.BLLA155P941J': '/img/p/fratelli-bosio-blla155p941j-injector-nozzle-095000-6510.webp',
    'FB.BLLA155P970-J': '/img/p/fratelli-bosio-blla155p970j-injector-nozzle-095000-978.webp',
    'FB.BLLA156G3S54': '/img/p/fratelli-bosio-blla156g3s54-injector-nozzle-295050-117-hino.webp',
    'FB.BLLA156P1368': '/img/p/fratelli-bosio-blla156p1368-injector-nozzle-0-445-110-279.webp',
    'FB.BLLA158LNC5600': '/img/p/fratelli-bosio-blla158lnc5600-injector-nozzle.webp',
    'FB.BLLA158LNC5601': '/img/p/fratelli-bosio-blla158lnc5601-injector-nozzle.webp',
    'FB.BLLA158P1092': '/img/p/fratelli-bosio-blla158p1092-injector-nozzle-095000-636.webp',
    'FB.BLLA158P1096': '/img/p/fratelli-bosio-blla158p1096-injector-nozzle-095000-8901.webp',
    'FB.BLLA158P834-J': '/img/p/fratelli-bosio-blla158p834j-injector-nozzle-095000-522.webp',
    'FB.BLLA158P844-J': '/img/p/fratelli-bosio-blla158p844j-injector-nozzle-dlla158p844-j.webp',
    'FB.BLLA158P854': '/img/p/fratelli-bosio-blla158p854-injector-nozzle-095000-547-denso-part-093400-8540.webp',
    'FB.BLLA162P2160': '/img/p/fratelli-bosio-blla162p2160-injector-nozzle-0-445-110-646-647-369-amarok.webp',
    'FB.BSLA124P1659': '/img/p/fratelli-bosio-bsla124p1659-injector-nozzle-0-445-120-032-103-114.webp',
    'FB.BSLA128P5510': '/img/p/fratelli-bosio-bsla128p5510-injector-nozzle-0-445-120-231.webp',
    'FB.BSLA143P5540': '/img/p/fratelli-bosio-bsla143p5540-injector-nozzle-dsla143p5540-suitable-0-445-120.webp',
    'FB.BSLA143P970': '/img/p/fratelli-bosio-bsla143p970-injector-nozzle-0-445-120-007.webp',
    'FB.BSLA154P1320': '/img/p/fratelli-bosio-bsla154p1320-injector-nozzle-0-445-110-106-107-170-171-181-182.webp',
    'FB.P1052 BLK': '/img/p/fratelli-bosio-p1052blk-injector-nozzle-095000-810x.webp',
    'FB.PM006-BLK': '/img/p/fratelli-bosio-pm006blk-injector-nozzle.webp',
    'BO.0.432.133.864': '/img/p/bosch-0432133864-injector-nozzle-and-holder-assy.webp',
    'BO.0.433.172.150': '/img/p/bosch-0433172150-injector-nozzle-0-445-120-177.webp',
    'BO.0.433.172.155': '/img/p/bosch-0433172155-injector-nozzle-0-445-120-161-204.webp',
    'DE.7135-583': '/img/p/delphi-7135583-injector-nozzle-embr00301d.webp',
    'DN.093400-5640': '/img/p/denso-0934005640-injector-nozzle-dn4pd57.webp',
    'DN.093400-7700': '/img/p/denso-0934007700-injector-nozzle-tobera-dn10pdn130.webp',
    'DN.093400-8220': '/img/p/denso-0934008220-injector-nozzle-tobera-dn0pdn121.webp',
    'FB.BLLA140PM019': '/img/p/fratelli-bosio-blla140pm019-injector-nozzle-bk2q-9k546-ag.webp',
    'FB.BLLA150PM1600': '/img/p/fratelli-bosio-blla150pm1600-injector-nozzle-77550-a2c59515264-ford-ranger.webp',
    'FB.BLLA155P1062-J': '/img/p/fratelli-bosio-blla155p1062j-injector-nozzle-095000-8290.webp',
    'RB.220.03.08': '/img/p/robiel-2200308-fuel-injector-protective-cap-a-injector-nozzle.webp',
    'RB.315.06.65': '/img/p/robiel-3150665-injector-nozzle-cap-nut.webp',
    'RB.315.06.75': '/img/p/robiel-3150675-injector-nozzle-cap-nut.webp',
    'RB.315.06.76': '/img/p/robiel-3150676-injector-nozzle-cap-nut.webp',
    'ZX.105015-6380': '/img/p/1050156380-injector-nozzle-dlla158sn638.webp',
    'ZX.105017-3150': '/img/p/1050173150-injector-nozzle-9-432-612-763.webp',
    'ZX.105019-1260': '/img/p/1050191260-injector-nozzle-9-432-612-582.webp',
    'BO. 0.445.020.035': '/img/p/bosch-0445020035-high-pressure-fuel-pump-iveco.webp',
    'BO.0.445.010.275': '/img/p/bosch-0445010275-high-pressure-fuel-pump-mercedes-benz-acello-715-c.webp',
    'BO.0.445.010.279': '/img/p/bosch-0445010279-high-pressure-fuel-pump-hyundai.webp',
    'BO.0.445.010.566': '/img/p/bosch-0445010566-high-pressure-fuel-pump-bosch-cp4-amarok.webp',
    'BO.0.445.010.845': '/img/p/bosch-0445010845-high-pressure-fuel-pump-cummins-dodge-ram-6-7l-engine.webp',
    'BO.0.986.437.310': '/img/p/bosch-0986437310-fuel-pump-bosch-cp3-fuel-injection-pump.webp',
    'BO.0.986.437.332': '/img/p/bosch-0986437332-high-pressure-fuel-pump-lbz-lmm-duramax-cp3-pump.webp',
    'BO.0.470.004.018C': '/img/p/bosch-0470004018c-diesel-part-core.webp',
    'BO.0.986.437.310CORE': '/img/p/bosch-0986437310core-diesel-part-core.webp',
    'DN.294000-026#': '/img/p/denso-294000026-high-pressure-fuel-pump-isuzu.webp',
    'DN.294000-0475': '/img/p/denso-2940000475-high-pressure-fuel-pump-yd25.webp',
    'DN.294000-1202': '/img/p/denso-2940001202-high-pressure-fuel-pump-isuzu-4jj1.webp',
    'DN.294000-1950': '/img/p/denso-2940001950-high-pressure-fuel-pump-hino-toyota-n04c.webp',
    'DN.9729400-121': '/img/p/denso-9729400121-high-pressure-fuel-pump.webp',
    'SM.A2C9321760080': '/img/p/siemens-a2c9321760080-high-pressure-fuel-pump-ford-ranger-2-2013.webp',
    'BO.0.445.218.015': '/img/p/bosch-0445218015-fuel-rail.webp',
    'BO.F.00R.L00.591': '/img/p/bosch-f00rl00591-fuel-rail-side-fuel-rail.webp',
    'DE.28265980': '/img/p/delphi-28265980-fuel-rail-common-fuel-d18-7249383-724-9383.webp',
    'RB.323.50.13': '/img/p/robiel-3235013-tool-set-bosch-eui-eup-delphi-eui-a1-a3-e1.webp',
    'RB.324.18.0011': '/img/p/robiel-324180011-valve-tip-for-poliching-tool-to-cat-cr.webp',
    'RB.324.18.014': '/img/p/robiel-32418014-workshop-tool-polishing-edge-tool-cummins-isx15.webp',
    'RB.324.13.39': '/img/p/robiel-3241339-workshop-tool-for-disassembling-the-mprop.webp',
    'RB.324.04.05': '/img/p/robiel-3240405-workshop-tool-cummins-toothed-wrench-2.webp',
    'BO.F.00R.L01.027': '/img/p/bosch-f00rl01027-fuel-rail-side-fuel-rail.webp',
    'SM.A2C59517043': '/img/p/siemens-a2c59517043-high-pressure-fuel-pump-ford-transit.webp',
    'BO.0.445.010.107': '/img/p/bosch-0445010107-high-pressure-fuel-pump-ford-ranger-mazda-bt50-2-5-3l.webp',
    'BO.0.445.020.146': '/img/p/bosch-0445020146-high-pressure-fuel-pump-dodge-ram-cummins-6-7l.webp',
    'DN.294000-0293': '/img/p/denso-2940000293-high-pressure-fuel-pump-hyundai.webp',
    'DN.9729400-070': '/img/p/denso-9729400070-high-pressure-fuel-pump-toyota.webp',
    'RB.323.50.102': '/img/p/robiel-32350102-tool-set-common-rail-bosch-cri-1-0-2-1.webp',
    'RB.323.50.34': '/img/p/robiel-3235034-tool-set-cp3-bosch-pump.webp',
    'RB.323.50.091': '/img/p/robiel-32350091-tool-set-common-rail-piezo-bosch-cri-3-0.webp',
    'RB.323.50.212': '/img/p/robiel-32350212-tool-set-caterpillar-c4-c6-injector-and.webp',
    'RB.323.50.40': '/img/p/robiel-3235040-tool-set-bosh-crin-4-2-injector.webp',
    'BO.0.432.191.392': '/img/p/bosch-0432191392-fuel-injector-cummins-volvo-oe-3828967.webp',
    'BO.0.445.110.076': '/img/p/bosch-0445110076-fuel-injector-peugeot-307-2-0-hdi.webp',
    'BO.0.445.110.619': '/img/p/bosch-0445110619-fuel-injector.webp',
    'BO.0.445.115.068': '/img/p/bosch-0445115068-fuel-injector-mercedes-injector.png',
    'BO.0.445.117.031': '/img/p/bosch-0445117031-fuel-injector-nissan-titan-5-0l-cummins.webp',
    'BO.0.445.120.385': '/img/p/bosch-0445120385-fuel-injector-crin-4-27.webp',
    'BO.0.445.120.439': '/img/p/bosch-0445120439-fuel-injector.webp',
    'MZ.0.445.120.238R': '/img/p/0445120238r-fuel-injector-5-9-2004-5-2007-ram-pickup-and.webp',
    'CO.A2C59517051': '/img/p/continental-a2c59517051-diesel-part-ranger-3-2-transit-2.webp',
    'CO.A2C9303500080': '/img/p/continental-a2c9303500080-fuel-injector.webp',
    'DAP.295050-198': '/img/p/dap-295050198-fuel-injector.webp',
    'DE.28231014': '/img/p/delphi-28231014-fuel-injector-great-wall-hover-h6-4d20.webp',
    'DE.28307309': '/img/p/delphi-28307309-fuel-injector-mb-sprinter-2-cdi-2016.webp',
    'DE.28317158': '/img/p/delphi-28317158-fuel-injector-dfi-2-5-injector-jcb-55kw-tier4.webp',
    'DE.EJBR03301D': '/img/p/delphi-ejbr03301d-fuel-injector-jmc.webp',
    'DE.R03001D': '/img/p/delphi-r03001d-fuel-injector-kia-bongo.webp',
    'DG-9976': '/img/p/dg9976-fuel-injector-pure-power-l5p-injector.webp',
    'DN.095000-543#': '/img/p/denso-095000543-fuel-injector-dmax-isuzu.webp',
    'DN.095000-5450': '/img/p/denso-0950005450-fuel-injector-mitsubishi-6m60t.webp',
    'DN.095000-6320': '/img/p/denso-0950006320-fuel-injector-john-deere-dz100211.webp',
    'DN.260100-4010': '/img/p/denso-2601004010-fuel-injector-mitsubishi-2-5-motor-4d56.webp',
    'DN.260100-6000': '/img/p/denso-2601006000-fuel-injector-toyota-1kd.webp',
    'DN.295050-0960': '/img/p/denso-2950500960-fuel-injector-gm.webp',
    'DN.295050-1200': '/img/p/denso-2950501200-fuel-injector-kohler.webp',
    'DN.295050-1980': '/img/p/denso-2950501980-fuel-injector-kubota-v3307.webp',
    'DN.295700-0630': '/img/p/denso-2957000630-fuel-injector-g4s-i.webp',
    'BO.0.445.110.130': '/img/p/bosch-0445110130-fuel-injector-land-rover-freelander-2lt-td4-awd.webp',
    'BO.0.445.110.249': '/img/p/bosch-0445110249-fuel-injector-mazda-part-we01-13-h50-mazda-bt.webp',
    'BO.0.445.110.250': '/img/p/bosch-0445110250-fuel-injector-mazda-bt50-2-5.webp',
    'BO.0.445.110.310': '/img/p/bosch-0445110310-fuel-injector-mahindra-scorpio-2-2l.webp',
    'BO.0.445.110.340': '/img/p/bosch-0445110340-fuel-injector.webp',
    'BO.0.445.110.424': '/img/p/bosch-0445110424-fuel-injector-gm-s10.webp',
    'BO.0.445.110.483': '/img/p/bosch-0445110483-fuel-injector.webp',
    'BO.0.445.110.564': '/img/p/bosch-0445110564-fuel-injector-mitsubishi-fuso-3-0.webp',
    'BO.0.445.110.463': '/img/p/bosch-0445110463-fuel-injector-yanmar-deere.webp',
    'BO.0.445.110.508': '/img/p/bosch-0445110508-fuel-injector-cr-injector-yanmar-129e01-53100.webp',
    'BO.0.445.110.535': '/img/p/bosch-0445110535-fuel-injector.webp',
    'BO.0.445.110.558': '/img/p/bosch-0445110558-fuel-injector-deutz-tcd3-6l4.webp',
    'BO.0.445.110.565': '/img/p/bosch-0445110565-fuel-injector.webp',
    'BO.0.445.110.646': '/img/p/bosch-0445110646-fuel-injector-amarok.webp',
    'BO.0.445.110.851': '/img/p/bosch-0445110851-fuel-injector.webp',
    'BO.0.445.120.057': '/img/p/bosch-0445120057-fuel-injector-ih-iveco-holland.webp',
    'BO.0.445.120.066': '/img/p/bosch-0445120066-fuel-injector-deutz-volvo.webp',
    'BO.0.445.120.073': '/img/p/bosch-0445120073-fuel-injector-mitsubishi-canter-3-0.webp',
    'BO.0.445.120.177': '/img/p/bosch-0445120177-fuel-injector-cummins-isb-b-series.webp',
    'BO.0.445.120.231': '/img/p/bosch-0445120231-fuel-injector-cummins-komatsu-pc200-8-excavator.webp',
    'BO.0.445.120.236': '/img/p/bosch-0445120236-fuel-injector-komatsu.webp',
    'BO.0.445.120.550': '/img/p/bosch-0445120550-fuel-injector-volvo-penta.webp',
    'BO.0.445.124.025': '/img/p/bosch-0445124025-fuel-injector-agco-power-183-kw-01-2014-6-l.webp',
    'BO.0.445.116.059': '/img/p/bosch-0445116059-fuel-injector.webp',
    'BO.0.986.435.433': '/img/p/bosch-0986435433-fuel-injector-15-17-ford-6-7l-bosch.webp',
    'CA.320-0690': '/img/p/caterpillar-3200690-fuel-injector-perkins.webp',
    'DE.28229873': '/img/p/delphi-28229873-fuel-injector-hyundai.webp',
    'DE.28342997': '/img/p/delphi-28342997-fuel-injector-mb-sprinter-c-class-2-cdi-12.webp',
    'DE.EJBR03701D': '/img/p/delphi-ejbr03701d-fuel-injector-terracan-r03701d.webp',
    'DN.095000-057#': '/img/p/denso-095000057-fuel-injector-toyota-rav4-ii-2-0-d-4d-23670.webp',
    'DN.095000-547#': '/img/p/denso-095000547-fuel-injector-isuzu-4hk1-isuzu-6hk1.webp',
    'DN.095000-5550': '/img/p/denso-0950005550-fuel-injector-hyundai-mighty-county.webp',
    'BO.0.986.435.410': '/img/p/bosch-0986435410-fuel-injector-11-16-6-6l-gm-duramax-lml.webp',
    'BO.F.00R.J02.703': '/img/p/bosch-f00rj02703-solenoid-valve.webp',
    'DN.095000-5226': '/img/p/denso-0950005226-fuel-injector-hino-e1.webp',
    'DN.095000-5600': '/img/p/denso-0950005600-fuel-injector-mitsubishi-2-5-motor-4d56.webp',
    'DN.095000-5760': '/img/p/denso-0950005760-fuel-injector-cr-mit-1465a054.webp',
    'DN.095000-6253': '/img/p/denso-0950006253-fuel-injector-70a-nissan-frontier-yd25-euro-iv.webp',
    'DN.095000-6360': '/img/p/denso-0950006360-fuel-injector-isuzu-nqr75-4hk1-fvr34-6hk1.webp',
    'DN.095000-714#': '/img/p/denso-095000714-fuel-injector-hyundai-mighty-mega-truck.webp',
    'DN.095000-6491': '/img/p/denso-0950006491-fuel-injector-john-deere.webp',
    'DN.095000-6521': '/img/p/denso-0950006521-fuel-injector-hino-300-n04c-tf-n04c-tq.webp',
    'DN.095000-9510': '/img/p/denso-0950009510-fuel-injector-hino-n04c-euro-5-24v.webp',
    'DN.095000-9560': '/img/p/denso-0950009560-fuel-injector-mitsubishi-triton-1465a257.webp',
    'DN.260100-4040': '/img/p/denso-2601004040-fuel-injector-hilux-vigo-1kd-ftv-3-0l.webp',
    'DN.295050-0300': '/img/p/denso-2950500300-fuel-injector-nissan-2013.webp',
    'DN.295050-176#': '/img/p/denso-295050176-fuel-injector-mit-2-4.webp',
    'DN.295700-0550': '/img/p/denso-2957000550-fuel-injector-toyota-1gd.webp',
    'DN.9729505-0532': '/img/p/denso-97295050532-fuel-injector-toyota-2kd-23670-0l10-2010-2015.webp',
    'SM.A2C59515264': '/img/p/siemens-a2c59515264-fuel-injector-vdo-mwm.webp',
    'SM.CK4Q-9K546-AA': '/img/p/siemens-ck4q9k546aa-fuel-injector-continental-injector.webp',
    'AP.60901': '/img/p/alliant-power-60901-fuel-injector-alliant-power-2003-2010-ford.webp',
    'BO.0.986.435.415': '/img/p/bosch-0986435415-fuel-injector-ford-powerstroke-6-7l-2011-2014.webp',
    'BO.0.445.010.851': '/img/p/bosch-0445010851-high-pressure-fuel-pump-cp4-pump-for-2011-14-ford-6-7l.webp',
    'BO.0.445.010.859': '/img/p/bosch-0445010859-high-pressure-fuel-pump-6-7-powerstroke-cp4-pump.webp',
    'BO.0.445.010.876': '/img/p/bosch-0445010876-fuel-pump-high-pressure-fuel-pump.webp',
    'BO.0.445.010.890': '/img/p/bosch-0445010890-high-pressure-fuel-pump-cp4.webp',
    'CAD.MX06': '/img/p/cad-mx06-fuel-injector-coil-suits-g2-8-injectors-ford.webp',
    'BO.0.445.118.060': '/img/p/bosch-0445118060-fuel-injector-2023-ford-superduty.webp',
    'BO.0.445.118.062': '/img/p/bosch-0445118062-fuel-injector-2023-ford-superduty.webp',
    'PP.DG-6921': '/img/p/alliant-power-dg6921-fuel-injector.webp',
    'RB.323.50.083': '/img/p/robiel-32350083-tool-set-common-rail-denso-g1-g2-g3.webp',
    'FB.BLLA154PM006': '/img/p/fratelli-bosio-blla154pm006-injector-nozzle-ap-ap60901.webp',
    'FB.BLLA150FVX40115': '/img/p/fratelli-bosio-blla150fvx40115-injector-nozzle-0-445-117-043.webp',
    'CO.A2C20004754': '/img/p/continental-a2c20004754-injector-nozzle-ford-powerstroke-6-0-genuine.webp',
    'BO.0.445.120.188': '/img/p/bosch-0445120188-fuel-injector-6-7-isb.webp',
    'BO.0.445.120.193': '/img/p/bosch-0445120193-fuel-injector-07-5-12-6-7l-dodge-cummins.webp',
    'BO.0.445.120.238': '/img/p/bosch-0445120238-fuel-injector-5-9-2004-5-2007-ram-pickup-and.webp',
    'BO.0.445.120.342': '/img/p/bosch-0445120342-fuel-injector-13-18-6-7l-dodge-cummins.webp',
    'BO.0.445.120.384': '/img/p/bosch-0445120384-fuel-injector-ford-cummins-6-7l-isb.webp',
    'BO.0.445.124.039': '/img/p/bosch-0445124039-fuel-injector-cummins-6-7-2019-2021.webp',
    'BO.0.445.124.047': '/img/p/bosch-0445124047-fuel-injector-cummins-6-7l-isb-2019-2021.webp',
    'BO.0.445.124.062': '/img/p/bosch-0445124062-fuel-injector-cummins-6-7l-pickup-2019-2021.webp',
    'BO.0.445.124.071': '/img/p/bosch-0445124071-fuel-injector-cummins-6-7l-ram-2022-current.webp',
    'BO.0.986.435.621': '/img/p/bosch-0986435621-fuel-injector-cummins-6-7l-2013-18.webp',
    'BO.F.00R.J01.714': '/img/p/bosch-f00rj01714-control-valve-0-445-120-342-188-187.webp',
    'BO.F.00R.J02.697': '/img/p/bosch-f00rj02697-solenoid-cummins-5-9l-solenoid-fits-0-445.webp',
    'BO.0.445.020.377': '/img/p/bosch-0445020377-high-pressure-fuel-pump-cp32021-6-7l-cummins.webp',
    'BO.0.445.020.386': '/img/p/bosch-0445020386-high-pressure-fuel-pump-cp3-dodge-ram-2500-3500.webp',
    'BO.0.445.020.609': '/img/p/bosch-0445020609-high-pressure-fuel-pump-6-7l-cummins-cp4-2.webp',
    'BO.0.445.226.126': '/img/p/bosch-0445226126-fuel-rail-13-18-ram-6-7l-cummins.webp',
    'BO.0.445.226.167': '/img/p/bosch-0445226167-fuel-rail-cummins-6-7-ram-2019-2020.webp',
    'BO.0.445.226.23D': '/img/p/bosch-044522623d-fuel-rail-2022-24-6-7l-cummins.webp',
    'BO.0.281.006.117': '/img/p/bosch-0281006117-fuel-rail-cummins-5-9l-6-7l-mpa-rail.webp',
    'BO.F.00R.J02.130': '/img/p/bosch-f00rj02130-valve-0-445-120-255-210-238.webp',
    'BO.F.00Z.R20.002': '/img/p/bosch-f00zr20002-diesel-part-bosch-fuel-connection-tube-high.webp',
    'JV.30.800.974': '/img/p/jv-diesel-30800974-fuel-pump-kit-for-cp3-pump-cummins-bosch-f.webp',
    'JV.30.801.045': '/img/p/jv-diesel-30801045-high-pressure-fuel-pump-kit-for-cp3-high-pressure-pump.webp',
    'LD.CM67.INJLINE01': '/img/p/lead-cm67injline01-injector-line-cummins-6-7l-2021-2023-ram.webp',
    'BO.0.986.435.505': '/img/p/bosch-0986435505-fuel-injector-5-9l-2004-5-2007-cummins.webp',
    'BO.0.445.124.019': '/img/p/bosch-0445124019-fuel-injector-cummins-qsb-6-7l.webp',
    'BO.0.432.131.837': '/img/p/bosch-0432131837-fuel-injector-cummins-4bt-each-60-36-90-2-214.webp',
    'FB.BLLA143P5519': '/img/p/fratelli-bosio-blla143p5519-injector-nozzle-0-445-120-255.webp',
    'BO.0.433.172.124': '/img/p/bosch-0433172124-injector-nozzle-0-445-120-188.webp',
    'FB.BLLA146P1545': '/img/p/fratelli-bosio-blla146p1545-injector-nozzle-0-445-120-050-185.webp',
    'BO.0.433.172.144': '/img/p/bosch-0433172144-injector-nozzle-0-445-120-187-336-366-417.webp',
    'FB.BLLA146P2370': '/img/p/fratelli-bosio-blla146p2370-injector-nozzle-0-445-120-342.webp',
    'BO.0.433.172.145': '/img/p/bosch-0433172145-injector-nozzle-0-445-120-193.webp',
    'FB.BLLA146P2370-BLK': '/img/p/fratelli-bosio-blla146p2370blk-injector-nozzle-0-445-120-342.webp',
    'BO.0.433.175.540': '/img/p/bosch-0433175540-injector-nozzle-0-445-120-212.webp',
    'BO.0.433.175.516': '/img/p/bosch-0433175516-injector-nozzle-dsla124p5516-suitable-0-445-120.webp',
    'BO.0.433.175.519': '/img/p/bosch-0433175519-injector-nozzle-0-445-120-255.webp',
    'BO.0.433.172.370': '/img/p/bosch-0433172370-injector-nozzle-0-445-120-342.webp',
    'BO.0.445.117.010': '/img/p/bosch-0445117010-fuel-injector-i-2011-2016-duramax-lml-6.webp',
    'BO.0.445.120.027': '/img/p/bosch-0445120027-fuel-injector.webp',
    'BO.0.445.120.042': '/img/p/bosch-0445120042-fuel-injector-duramax-lbz.webp',
    'BO.0.445.120.082': '/img/p/bosch-0445120082-fuel-injector-gmc-6-6l-v8-duramax-lmm-2007-10.webp',
    'BO.0.445.020.105': '/img/p/bosch-0445020105-high-pressure-fuel-pump-gm-duramax-cp3-lbz-and-lmm-engine.webp',
    'BO.F.00R.J01.329': '/img/p/bosch-f00rj01329-control-valve-0-445-120-042-0-986-435-521.webp',
    'BO.0.445.120.008': '/img/p/bosch-0445120008-fuel-injector-01-04-duramx-bosch-original.webp',
    'BO.0.986.435.502': '/img/p/bosch-0986435502-fuel-injector-01-04-duramx-bosch-original.webp',
    'RB.323.50.36': '/img/p/robiel-3235036-tool-set-denso-hp3-4-pump.webp',
    'BO.F.00R.J01.159': '/img/p/bosch-f00rj01159-valve-0-445-120-024-026-027.webp',
    'BO.F.00R.J01.747': '/img/p/bosch-f00rj01747-valve-set.webp',
    'FB.BLLA159P1611': '/img/p/fratelli-bosio-blla159p1611-injector-nozzle-0-445-120-082-for-gmc-isuzu.webp',
    'FB.BSLA158P974': '/img/p/fratelli-bosio-bsla158p974-injector-nozzle-0-445-120-008.webp',
    'BO.0.433.171.860': '/img/p/bosch-0433171860-injector-nozzle-0-445-120-027-0-986-435-504.webp',
    'BO.0.433.171.985': '/img/p/bosch-0433171985-injector-nozzle-0-445-120-082.webp',
    'BO.0.433.171.924': '/img/p/bosch-0433171924-injector-nozzle-0-445-120-042.webp',
    'RB.324.22.003': '/img/p/robiel-32422003-workshop-tool-polishing-tool-scania-cummins-hpi.webp',
    // Robiel, photos made from the Robiel catalog (family or kit where the catalog shows one picture for a group)
    'RB.323.50.38': '/img/p/robiel-3235038-tool-set-xpi-isx-15-isl-foton.webp',
    'RB.323.50.261': '/img/p/robiel-32350261-tool-set-cat-c7-c9-navistar-unit.webp',
    'RB.323.50.42': '/img/p/robiel-3235042-tool-set-c7-c9-pump.webp',
    'RB.323.50.221': '/img/p/robiel-32350221-tool-set-kit-delphi-eui-cat-c10-c12-c15.webp',
    'RB.323.50.121': '/img/p/robiel-32350121-repair-kit-delphi-eui-serie-a1-a3-e1-e3-tool.webp',
    'RB.323.50.29': '/img/p/robiel-3235029-workshop-tool-kit-unit-repair-detroit-eui.webp',
    'RB.323.50.33': '/img/p/robiel-3235033-tool-set-test-volvo-d12a-d12c-d12d-d13a.webp',
    'RB.323.50.37': '/img/p/robiel-3235037-tool-set-cummins-m11-n14-unit.webp',
    'RB.410.32.212': '/img/p/robiel-41032212-diesel-part-robiel-complete-repair-parts.webp',
    'RB.410.12.900': '/img/p/robiel-41012900-repair-kit-overhaul-repair-kit-paccar-mx13.webp',
    'RB.323.50.231': '/img/p/robiel-32350231-workshop-tool-unit-repair-delphi-eui-serie-a1.webp',
    'RB.323.50.191': '/img/p/robiel-32350191-tool-set-delphi-eui-a1-a3-series.webp',
    'RB.323.50.41': '/img/p/robiel-3235041-tool-set-daf-injectors-unit-pump.webp',
    'RB.324.17.342': '/img/p/robiel-32417342-tool-set-grinding-tool-to-volvo-deflector.webp',
    'RB.324.18.342': '/img/p/robiel-32418342-workshop-tool-polishing-tool-to-volvo-deflector.webp',
    'RB.323.01.25': '/img/p/robiel-3230125-workshop-tool-tester-adapter-volvo-ui-unit.webp',
    'RB.323.01.66': '/img/p/robiel-3230166-workshop-tool-tester-adapter-d13-volvo-unit.webp',
    'RB.165.05.674': '/img/p/robiel-16505674-diesel-part-plug-6-74mm-detroit-unit-inj.webp',
    'RB.165.07.560': '/img/p/robiel-16507560-diesel-part-ball-stroke-plug-isx15.webp',
    'RB.165.07.620': '/img/p/robiel-16507620-diesel-part-ball-stroke-plug-isx15.webp',
    'RB.165.07.630': '/img/p/robiel-16507630-diesel-part-ball-stroke-plug-isx15.webp',
    'RB.225.01.63': '/img/p/robiel-2250163-injector-nozzle-eui-cat-3500-c15-c10-unuit-nozzle.webp',
    'RB.315.06.74': '/img/p/robiel-3150674-diesel-part-cap-nut-cat-eui-c13-c15unit-inj.webp',
    'RB.323.01.671': '/img/p/robiel-32301671-workshop-tool-nut-wrench-volvo-d12d-d13-nozzle.webp',
    'RB.340.10.00': '/img/p/robiel-3401000-valve-element-detroit-unit-valve-7.webp',
    'RB.340.16.01': '/img/p/robiel-3401601-control-valve-n14-m11-l10.webp',
    'RB.340.19.01': '/img/p/robiel-3401901-valve-spacer-valve-heui-cat-c7-unit.webp',
    'RB.340.19.02': '/img/p/robiel-3401902-valve-spool-valve-heui-cat-c7.webp',
    'RB.410.32.127': '/img/p/robiel-41032127-diesel-part-cummins-isc-isl-qsl-qsc.webp',
    'RB.410.60.357': '/img/p/robiel-41060357-fuel-pump-caterpillar-c7-c9-feeding-pump.webp',
    'RB.410.60.678': '/img/p/robiel-41060678-high-pressure-fuel-pump-repair-parts-set-cat-c7-c9-heui.webp',
    'RB.410.60.766': '/img/p/robiel-41060766-high-pressure-fuel-pump-kit-cat-c7-c9-high-pressure-pump.webp',
    'RB.410.61.010': '/img/p/robiel-41061010-diesel-part-heui-caterpillar-c7-unit-complete.webp',
    'RB.410.61.319/8': '/img/p/robiel-410613198-diesel-part-repair-parts-eui-caterpillar-c10.webp',
    'RB.420.27.6950': '/img/p/robiel-420276950-fuel-injector-eui-volvo-injector-kit.webp',
    'RB.800.05.1880': '/img/p/robiel-800051880-diesel-part-cat-series-c-18-80-mm.webp',
    'RB.800.05.1882': '/img/p/robiel-800051882-diesel-part-cat-series-c-18-82-mm.webp',
    'RB.800.05.1884': '/img/p/robiel-800051884-diesel-part-cat-series-c-18-84-mm.webp',
    'RB.800.05.1886': '/img/p/robiel-800051886-diesel-part-cat-series-c-18-86-mm.webp',
    'RB.800.05.1888': '/img/p/robiel-800051888-diesel-part-cat-series-c-18-88-mm.webp',
    'RB.800.05.190/6': '/img/p/robiel-800051906-diesel-part-cat-series-c-19-06-mm.webp',
    'RB.800.05.190/8': '/img/p/robiel-800051908-diesel-part-cat-series-c-19-08-mm.webp',
    'RB.800.05.1900': '/img/p/robiel-800051900-diesel-part-cat-series-c-19-00-mm.webp',
    'RB.800.05.1906': '/img/p/robiel-800051906-diesel-part-cat-series-c-19-06-mm-2.webp',
    'RB.800.05.1908': '/img/p/robiel-800051908-diesel-part-cat-series-c-19-08-mm-2.webp',
    'RB.800.05.191/0': '/img/p/robiel-800051910-diesel-part-cat-series-c-19-10-mm.webp',
    'RB.800.05.1915': '/img/p/robiel-800051915-diesel-part-cat-series-c-19-15-mm.webp',
    'RB.800.05.1920': '/img/p/robiel-800051920-diesel-part-cat-series-c-19-20-mm.webp',
    'RB.800.05.1935': '/img/p/robiel-800051935-diesel-part-cat-series-c-19-35-mm.webp',
    'RB.800.08.255': '/img/p/robiel-80008255-solenoid-cat-3500-unit-solenoid-2-55-mm.webp',
    'RB.800.08.260': '/img/p/robiel-80008260-solenoid-cat-3500-unit-solenoid-2-60-mm.webp',
    'RB.800.08.265': '/img/p/robiel-80008265-solenoid-cat-3500-unit-solenoid-2-65-mm.webp',
    'RB.800.08.270': '/img/p/robiel-80008270-solenoid-cat-3500-unit-solenoid-2-70-mm.webp',
    'RB.800.08.275': '/img/p/robiel-80008275-solenoid-cat-3500-unit-solenoid-2-75-mm.webp',
    'RB.800.08.280': '/img/p/robiel-80008280-solenoid-cat-3500-unit-solenoid.webp',
    'RB.800.08.285': '/img/p/robiel-80008285-solenoid-cat-3500-unit-solenoid-2-80-mm.webp',
    'RB.800.08.290': '/img/p/robiel-80008290-solenoid-cat-3500-unit-solenoid-2-85-mm.webp',
    'RB.800.08.295': '/img/p/robiel-80008295-solenoid-cat-3500-unit-solenoid-2-90-mm.webp',
    'RB.800.08.300': '/img/p/robiel-80008300-solenoid-cat-3500-unit-solenoid-3-00-mm.webp',
    'RB.800.08.310': '/img/p/robiel-80008310-solenoid-cat-3500-unit-solenoid-3-10-mm.webp',
    'RB.800.08.320': '/img/p/robiel-80008320-solenoid-cat-3500-unit-solenoid-3-20-mm.webp',
    'RB.800.10.180': '/img/p/robiel-80010180-injector-nozzle-cat-series-c-1-80mm.webp',
    'RB.800.10.190': '/img/p/robiel-80010190-injector-nozzle-cat-series-c-1-90mm.webp',
    'RB.800.10.195': '/img/p/robiel-80010195-injector-nozzle-cat-series-c-1-95mm.webp',
    'RB.800.10.200': '/img/p/robiel-80010200-injector-nozzle-cat-series-c-2-00mm.webp',
    'RB.800.10.205': '/img/p/robiel-80010205-injector-nozzle-cat-series-c-2-05mm.webp',
    'RB.800.10.210': '/img/p/robiel-80010210-injector-shim-cat-series-c-2-10mm.webp',
    'RB.800.10.215': '/img/p/robiel-80010215-injector-shim-cat-series-c-2-15mm.webp',
    'RB.800.10.230': '/img/p/robiel-80010230-injector-nozzle-cat-series-c-2-30mm.webp',
    'RB.800.10.235': '/img/p/robiel-80010235-injector-nozzle-cat-series-c-2-35mm.webp',
    'RB.800.10.240': '/img/p/robiel-80010240-injector-nozzle-cat-3500-unit-nozzle-2-40mm.webp',
    'RB.800.10.245': '/img/p/robiel-80010245-injector-nozzle-cat-series-c-2-45mm.webp',
    'RB.800.10.250': '/img/p/robiel-80010250-injector-nozzle-cat-series-c-2-50mm.webp',
    'RB.800.10.255': '/img/p/robiel-80010255-injector-nozzle-cat-series-c-2-55mm.webp',
    'RB.800.10.260': '/img/p/robiel-80010260-injector-nozzle-cat-series-c-2-60mm.webp',
    'RB.800.10.265': '/img/p/robiel-80010265-injector-nozzle-cat-3500-unit-nozzle-2-65mm.webp',
    'RB.800.10.270': '/img/p/robiel-80010270-injector-nozzle-cat-series-c-2-70mm.webp',
    'RB.800.10.275': '/img/p/robiel-80010275-injector-shim-cat-series-c-2-75mm.webp',
    'RB.800.13.198': '/img/p/robiel-80013198-injector-shim-cat-series-c-1-98mm.webp',
    'RB.800.13.199': '/img/p/robiel-80013199-injector-shim-cat-series-c-1-99-mm.webp',
    'RB.800.13.200': '/img/p/robiel-80013200-injector-shim-cat-series-c-200mm.webp',
    'RB.800.38.638': '/img/p/robiel-80038638-control-valve-c7-c9.webp',
    'RB.800.38.640': '/img/p/robiel-80038640-control-valve-pin-6-4mm-c7-c9.webp',
    'RB.801.05.100': '/img/p/robiel-80105100-injector-shim-adjusting-shim-inj-coil-paccar.webp',
    'RB.801.05.110': '/img/p/robiel-80105110-injector-shim-adjusting-shim-inj-coil-paccar.webp',
    'RB.801.06.60': '/img/p/robiel-8010660-diesel-part-cat-3500-6-60-mm.webp',
    'RB.801.06.62': '/img/p/robiel-8010662-diesel-part-cat-3500-6-62-mm.webp',
    'RB.801.06.64': '/img/p/robiel-8010664-diesel-part-cat-3500-6-64-mm.webp',
    'RB.801.06.66': '/img/p/robiel-8010666-diesel-part-cat-3500-6-66-mm.webp',
    'RB.801.06.68': '/img/p/robiel-8010668-diesel-part-cat-3500-6-68-mm.webp',
    'RB.801.06.70': '/img/p/robiel-8010670-diesel-part-cat-3500-6-70-mm.webp',
    'RB.801.06.71': '/img/p/robiel-8010671-diesel-part-cat-3500-6-71-mm.webp',
    'RB.801.06.72': '/img/p/robiel-8010672-diesel-part-cat-3500-6-72-mm.webp',
    'RB.801.06.73': '/img/p/robiel-8010673-diesel-part-cat-3500-6-73-mm.webp',
    'RB.801.06.74': '/img/p/robiel-8010674-diesel-part-cat-3500-6-74-mm.webp',
    'RB.801.06.75': '/img/p/robiel-8010675-diesel-part-cat-3500-6-75-mm.webp',
    'RB.801.06.77': '/img/p/robiel-8010677-diesel-part-cat-3500-6-77-mm.webp',
    'RB.801.06.84': '/img/p/robiel-8010684-diesel-part-cat-3500-6-84-mm.webp',
    'RB.801.06.86': '/img/p/robiel-8010686-diesel-part-cat-3500-6-86-mm.webp',
    'RB.801.09.385': '/img/p/robiel-80109385-diesel-part-detroit-unit-3-85mm.webp',
    'RB.801.09.387': '/img/p/robiel-80109387-diesel-part-detroit-unit-3-87mm.webp',
    'RB.801.09.389': '/img/p/robiel-80109389-diesel-part-detroit-unit-3-89mm.webp',
    'RB.801.09.391': '/img/p/robiel-80109391-diesel-part-detroit-unit-3-91mm.webp',
    'RB.801.09.393': '/img/p/robiel-80109393-diesel-part-detroit-unit-3-93mm.webp',
    'RB.801.09.395': '/img/p/robiel-80109395-diesel-part-detroit-unit-3-95mm.webp',
    'RB.805.10.05': '/img/p/robiel-8051005-injector-shim-armature-stroke-cat-3500-0-05mm.webp',
    'RB.805.10.050': '/img/p/robiel-80510050-injector-shim-armature-stroke-cat-3500-0-50mm.webp',
    'RB.805.10.060': '/img/p/robiel-80510060-injector-shim-armature-stroke-cat-3500-0-60mm.webp',
    'RB.805.10.070': '/img/p/robiel-80510070-injector-shim-armature-stroke-cat-3500-0-70mm.webp',
    'RB.805.10.080': '/img/p/robiel-80510080-injector-shim-armature-stroke-cat-3500-0-80mm.webp',
    'RB.805.10.090': '/img/p/robiel-80510090-injector-shim-armature-stroke-cat-3500-0-90mm.webp',
    'RB.805.10.095': '/img/p/robiel-80510095-injector-shim-armature-stroke-cat-3500-0-95mm.webp',
    'RB.805.10.100': '/img/p/robiel-80510100-injector-shim-armature-stroke-cat-3500-1-00mm.webp',
    'RB.805.10.105': '/img/p/robiel-80510105-injector-shim-armature-stroke-cat-3500-1-05mm.webp',
    'RB.805.10.110': '/img/p/robiel-80510110-injector-shim-armature-stroke-cat-3500-1-10mm.webp',
    'RB.805.10.115': '/img/p/robiel-80510115-injector-shim-armature-stroke-cat-3500-1-15mm.webp',
    'RB.805.10.120': '/img/p/robiel-80510120-injector-shim-armature-stroke-cat-3500-1-20mm.webp',
    'RB.805.10.125': '/img/p/robiel-80510125-injector-shim-armature-stroke-cat-3500-1-25mm.webp',
    'RB.805.10.130': '/img/p/robiel-80510130-injector-shim-armature-stroke-cat-3500-1-30mm.webp',
    'RB.810.26.210': '/img/p/robiel-81026210-fuel-injector-cummins-injector-isx15-2-10mm.webp',
    'RB.810.26.212': '/img/p/robiel-81026212-fuel-injector-cummins-injector-isx15-2-12mm.webp',
    'RB.810.26.214': '/img/p/robiel-81026214-fuel-injector-cummins-injector-isx15-2-14mm.webp',
    'RB.810.26.216': '/img/p/robiel-81026216-fuel-injector-cummins-injector-isx15-2-16mm.webp',
    'RB.810.26.218': '/img/p/robiel-81026218-fuel-injector-cummins-injector-isx15-2-18mm.webp',
    'RB.810.26.220': '/img/p/robiel-81026220-fuel-injector-cummins-injector-isx15-2-20mm.webp',
    'RB.810.26.222': '/img/p/robiel-81026222-fuel-injector-cummins-injector-isx15-2-22mm.webp',
    'RB.810.26.226': '/img/p/robiel-81026226-fuel-injector-cummins-injector-isx15-2-26mm.webp',
    'RB.810.26.228': '/img/p/robiel-81026228-fuel-injector-cummins-injector-isx15-2-28mm.webp',
    'RB.810.26.230': '/img/p/robiel-81026230-fuel-injector-cummins-injector-isx15-2-30mm.webp',
    'RB.810.26.232': '/img/p/robiel-81026232-fuel-injector-cummins-injector-isx15-2-32mm.webp',
    'RB.810.26.234': '/img/p/robiel-81026234-injector-nozzle-cummins-inj-isx15-2-34mm.webp',
    'RB.810.26.236': '/img/p/robiel-81026236-injector-nozzle-cummins-inj-isx15-2-36mm.webp',
    'RB.810.26.238': '/img/p/robiel-81026238-injector-nozzle-cummins-inj-isx15-2-38mm.webp',
    'RB.810.26.240': '/img/p/robiel-81026240-injector-nozzle-cummins-inj-isx15-2-40mm.webp',
    'RB.818.91.0190': '/img/p/robiel-818910190-fuel-injector-cummins-injector-isl-1-90mm.webp',
    'RB.818.91.0192': '/img/p/robiel-818910192-fuel-injector-cummins-injector-isl-1-92mm.webp',
    'RB.818.91.0194': '/img/p/robiel-818910194-fuel-injector-cummins-injector-isl-1-94mm.webp',
    'RB.818.91.0196': '/img/p/robiel-818910196-fuel-injector-cummins-injector-isl-1-96mm.webp',
    'RB.818.91.0198': '/img/p/robiel-818910198-fuel-injector-cummins-injector-isl-1-98mm.webp',
    'RB.818.91.0200': '/img/p/robiel-818910200-fuel-injector-cummins-injector-isl-2-00mm.webp',
    'RB.818.91.0202': '/img/p/robiel-818910202-fuel-injector-cummins-injector-isl-2-02mm.webp',
    'RB.818.91.0204': '/img/p/robiel-818910204-fuel-injector-cummins-injector-isl-2-04mm.webp',
    'RB.818.91.0206': '/img/p/robiel-818910206-fuel-injector-cummins-injector-isl-2-06mm.webp',
    'RB.818.91.0208': '/img/p/robiel-818910208-fuel-injector-shim-commins-injector-isl-2-08mm.webp',
    'RB.818.91.0210': '/img/p/robiel-818910210-fuel-injector-cummins-injector-isl-2-10mm.webp',
    'RB.818.91.0212': '/img/p/robiel-818910212-fuel-injector-cummins-injector-isl-2-12mm.webp',
    'RB.818.91.0214': '/img/p/robiel-818910214-fuel-injector-cummins-injector-isl-2-14mm.webp',
    'RB.818.91.0216': '/img/p/robiel-818910216-fuel-injector-cummins-injector-isl-2-16mm.webp',
    'RB.818.91.0218': '/img/p/robiel-818910218-fuel-injector-cummins-injector-isl-2-18mm.webp',
    'RB.818.91.0220': '/img/p/robiel-818910220-fuel-injector-cummins-injector-isl-2-20mm.webp',
    'RB.821.82.296': '/img/p/robiel-82182296-fuel-injector-isx-isl-foton-2-96-mm.webp',
    'RB.821.82.300': '/img/p/robiel-82182300-fuel-injector-isx-isl-foton-3-00-mm.webp',
    'RB.821.82.302': '/img/p/robiel-82182302-fuel-injector-isx-isl-foton-3-02-mm.webp',
    'RB.821.82.306': '/img/p/robiel-82182306-fuel-injector-isx-isl-foton-3-06-mm.webp',
    'RB.821.82.308': '/img/p/robiel-82182308-fuel-injector-isx-isl-foton-3-08-mm.webp',
    'RB.821.82.312': '/img/p/robiel-82182312-fuel-injector-isx-isl-foton-3-12-mm.webp',
    'RB.821.82.314': '/img/p/robiel-82182314-solenoid-isx-isl-foton-3-14-mm.webp',
    'RB.821.82.316': '/img/p/robiel-82182316-solenoid-isx-isl-foton-3-16-mm.webp',
    'RB.821.82.318': '/img/p/robiel-82182318-fuel-injector-isx-isl-foton-3-18-mm.webp',
    'RB.821.82.320': '/img/p/robiel-82182320-fuel-injector-isx-isl-foton-3-20-mm.webp',
    'RB.822.53.229/9': '/img/p/robiel-822532299-solenoid-c7-c9-solenoid-adjustment-2-99mm.webp',
    'RB.822.53.2295': '/img/p/robiel-822532295-injector-shim-c7-c9-2-95mm.webp',
    'RB.410.12.325': '/img/p/robiel-41012325-fuel-pump-daf-mx13-pump-unit-repair.webp',
    // Heavy duty, family photos by type (confidence family, to be checked part by part)
    'LD.ISL.2127.09 / 2.95 MM': '/img/p/lead-isl212709295mm-diesel-part-adjustment-gasket-2-95-mm.webp',
    'LD.ISL.2127.09 / 2.96 MM': '/img/p/lead-isl212709296mm-diesel-part-adjustment-gasket-2-96-mm.webp',
    'LD.ISL.2127.09 / 2.97 MM': '/img/p/lead-isl212709297mm-diesel-part-adjustment-gasket-2-97-mm.webp',
    'LD.ISL.2127.09 / 2.98 MM': '/img/p/lead-isl212709298mm-diesel-part-adjustment-gasket-2-98-mm.webp',
    'LD.ISL.2127.09 / 2.99 MM': '/img/p/lead-isl212709299mm-diesel-part-adjustment-gasket-2-99-mm.webp',
    'LD.ISL.2127.09 / 3.0 MM': '/img/p/lead-isl21270930mm-diesel-part-adjustment-gasket-3-00-mm.webp',
    'LD.ISL.2127.09 / 3.01 MM': '/img/p/lead-isl212709301mm-diesel-part-adjustment-gasket-3-01-mm.webp',
    'LD.ISL.2127.09 / 3.02 MM': '/img/p/lead-isl212709302mm-diesel-part-adjustment-gasket-3-02-mm.webp',
    'LD.ISL.2127.09 / 3.03 MM': '/img/p/lead-isl212709303mm-diesel-part-adjustment-gasket-3-03-mm.webp',
    'LD.ISL.2127.09 / 3.04 MM': '/img/p/lead-isl212709304mm-diesel-part-adjustment-gasket-3-04-mm.webp',
    'JV.81.103.295': '/img/p/jv-diesel-81103295-injector-shim-cat-c7-c9.webp',
    'JV.81.103.296': '/img/p/jv-diesel-81103296-injector-shim-cat-c7-c9.webp',
    'LD.ISL.2127.10': '/img/p/lead-isl212710-diesel-part-gasket-1.webp',
    'LD.ISL.2127.11': '/img/p/lead-isl212711-diesel-part-gasket-2.webp',
    'LD.ISL.2127.16': '/img/p/lead-isl212716-diesel-part-gasket-3.webp',
    'LD.ISL.7320.16': '/img/p/lead-isl732016-diesel-part-gasket-3-for-2897320.webp',
    'LD.No10': '/img/p/lead-no10-diesel-part-gasket-1-xpi-isx15-for-2897320.webp',
    'LD.No11': '/img/p/lead-no11-diesel-part-gasket-2-xpi-isx15-for-2897320.webp',
    'JV.30.003.150': '/img/p/jv-diesel-30003150-fuel-injector-washer-for-injector-cummins-isbe.webp',
    'JV.50.008.170': '/img/p/jv-diesel-50008170-fuel-injector-washer-for-injector-volvo.webp',
    'JV.50.008.551': '/img/p/jv-diesel-50008551-fuel-injector-washer-for-injector-paccar-mx13.webp',
    'JV.80.004.150': '/img/p/jv-diesel-80004150-fuel-injector-washer-for-injector-xpi.webp',
    'SLP.BR-677': '/img/p/slp-br677-diesel-part-copper-washer-volvo-oe-reference.webp',
    'LD.ISL.2127.13': '/img/p/lead-isl212713-diesel-part-spring-2.webp',
    'LD.No12': '/img/p/lead-no12-diesel-part-spring-1-xpi-isx15-for-2897320.webp',
    'LD.No13': '/img/p/lead-no13-diesel-part-spring-2-xpi-isx15-for-2897320.webp',
    'LD.ISL.2068.07': '/img/p/lead-isl206807-injector-nozzle-needle.webp',
    'LD.ISL.2076.07': '/img/p/lead-isl207607-injector-nozzle-needle.webp',
    'LD.ISL.2127.07': '/img/p/lead-isl212707-injector-nozzle-needle.webp',
    'LD.ISL.2765.07': '/img/p/lead-isl276507-injector-nozzle-needle-for-inj-2872765.webp',
    'LD.Needle2405': '/img/p/lead-needle2405-injector-nozzle-2872405-isx15-xpi.webp',
    'LD.Needle4920': '/img/p/lead-needle4920-injector-nozzle-2894920.webp',
    'LD.Needle7147': '/img/p/lead-needle7147-injector-nozzle-4327147-5579421.webp',
    'LD.Needle7320': '/img/p/lead-needle7320-injector-nozzle-2897320.webp',
    'LD.Needle7518': '/img/p/lead-needle7518-injector-nozzle-2897518.webp',
    'LD.ISL.2127.14': '/img/p/lead-isl212714-diesel-part-guide-sleeve.webp',
    'LD.No14': '/img/p/lead-no14-diesel-part-lead-guide-sleeve-xpi-isx15.webp',
    'LD.No15': '/img/p/lead-no15-repair-kit-lead-o-ring-kit-xpi-isx15.webp',
    'SLP.CLS-160': '/img/p/slp-cls160-repair-kit-cyl-liner-seal-kit.webp',
    'LD.ISL.2068.08': '/img/p/lead-isl206808-injector-nozzle.webp',
    'LD.ISL.2076.08': '/img/p/lead-isl207608-injector-nozzle.webp',
    'LD.ISL.2127.08': '/img/p/lead-isl212708-injector-nozzle.webp',
    'LD.ISL.2765.08': '/img/p/lead-isl276508-injector-nozzle-for-inj-2872765.webp',
    'LD.Nozzle2405': '/img/p/lead-nozzle2405-injector-nozzle-2872405.webp',
    'LD.Nozzle4920': '/img/p/lead-nozzle4920-injector-nozzle-2894920.webp',
    'LD.Nozzle7147': '/img/p/lead-nozzle7147-injector-nozzle-4327147-5579421.webp',
    'LD.nozzle7222': '/img/p/lead-nozzle7222-injector-nozzle-10r7222-c9.webp',
    'LD.Nozzle7320': '/img/p/lead-nozzle7320-injector-nozzle-2897320.webp',
    'LD.Nozzle7518': '/img/p/lead-nozzle7518-injector-nozzle-2897518.webp',
    'FB.BLLA150LP216': '/img/p/fratelli-bosio-blla150lp216-injector-nozzle-bebe4d0800-bebe4d24002.webp',
    'LD.ISL.2127.05': '/img/p/lead-isl212705-control-valve.webp',
    'LD.ISL.2127.06': '/img/p/lead-isl212706-valve-middle-valve.webp',
    'LD.No5': '/img/p/lead-no5-control-valve-xpi-isx15.webp',
    'LD.No6': '/img/p/lead-no6-valve-middle-valve-xpi-isx15.webp',
    'LD.DS100B4AC021 + 20': '/img/p/lead-ds100b4ac02120-fuel-injector-ds100b4ac021-ds100b4ac020-crin-4.webp',
    'LD.DS100B4VC008': '/img/p/lead-ds100b4vc008-fuel-injector-pressure-valve-crin-4-2-for.webp',
    'LD.DS100B4VC099': '/img/p/lead-ds100b4vc099-fuel-injector-valve-plate-crin-4-2-for-injector.webp',
    'LD.ISL.2127.02': '/img/p/lead-isl212702-solenoid-valve.webp',
    'LD.ISL.2127.04': '/img/p/lead-isl212704-solenoid-valve-set.webp',
    'LD.No2': '/img/p/lead-no2-solenoid-valve-xpi-isx15.webp',
    'CAD.MX02': '/img/p/cad-mx02-diesel-part-coil-suits-c7-c9-cat-and-delphi.webp',
    'CM.4902921R': '/img/p/cummins-4902921r-fuel-injector-cummins-injectors-m11.webp',
    'CM.2872127R': '/img/p/cummins-2872127r-fuel-injector-cummins-isc-isl-8-9l.webp',
    'CAT.10R8502R': '/img/p/caterpillar-10r8502r-fuel-injector-c15-3406e.webp',
    'VO.85013611': '/img/p/volvo-85013611-fuel-injector-volvo-d13h-fuel-injector-2011.webp',
    'VO.9020929906': '/img/p/volvo-9020929906-fuel-injector-volvo-d16-eui-fuel-injector.webp',
    'BO.0.444.043.087': '/img/p/bosch-0444043087-diesel-part-dosing-nodule.webp',
    'JV.50.802.002': '/img/p/jv-diesel-50802002-repair-kit-uis-d12-c.webp',
    'JV.81.801.350': '/img/p/jv-diesel-81801350-repair-kit-eui-cat-3500.webp',
    'DSK-200': '/img/p/dsk200-repair-kit-gasket-kit-volvo.webp',
    'DSK-600': '/img/p/dsk600-repair-kit-gasket-kit-compl-dph-volvo.webp',
    'DSK-601': '/img/p/dsk601-diesel-part-gasket-set-volvo.webp',
    'RK-955': '/img/p/rk955-repair-kit-gasket-kit-volvo.webp',
    'SLP.DSK-22555': '/img/p/dsk22555-diesel-part-gasket-set-drop-box.webp',
    'SLP.FS-3095': '/img/p/fs3095-diesel-part-full-gasket-set.webp',
    'SLP.FS-9012': '/img/p/fs9012-diesel-part-gasket-set-complete.webp',
    'SLP.GKK-675': '/img/p/gkk675-diesel-part-engine-overhaul-gasket-set-volvo.webp',
    'SLP.HS-336': '/img/p/slp-hs336-diesel-part-decarbonizing-gasket-set-volvo-oe.webp',
    'SLP.MGS-670': '/img/p/mgs670-diesel-part-manifold-gasket-set-3589670.webp',
    'SLP.TGS-955': '/img/p/slp-tgs955-diesel-part-turbo-gasket-set-volvo-oe.webp',
    'SLP.CDS-674': '/img/p/cds674-diesel-part-complementary-decarb-set.webp',
    'EPL-249': '/img/p/epl249-diesel-part-gasket-volvo-3862249.webp',
    'SLP.CHS-123': '/img/p/chs123-diesel-part-cylinder-head-gasket-volvo-oe.webp',
    'SLP.EV-793': '/img/p/ev793-valve-cover-gasket-volvo-oe.webp',
    'ISK-688': '/img/p/isk688-fuel-injector-sleeve-kit-volvo.webp',
    'SLP.ISK-134': '/img/p/isk134-fuel-injector-sleeve-kit-volvo-oe-reference.webp',
    'SLP.ISK-717': '/img/p/isk717-fuel-injector-sleeve-kit-volvo-oe-ref-21351717.webp',
    'SLP.PRK-117': '/img/p/prk117-repair-kit-piston-ring-kit-volvo-oe.webp',
    'SLP.PRK-1728': '/img/p/prk1728-repair-kit-piston-ring-kit-volvo-oe.webp',
    'SLP.PRK-728X': '/img/p/prk728x-repair-kit-volvo-oe-reference-number.webp',
    'SLP.CLK-5027': '/img/p/clk5027-repair-kit-cylinder-liner-kit-volvo-oem-part.webp',
    'SLP.WAP-414': '/img/p/slp-wap414-fuel-pump-water-pump-volvo-oe-reference.webp',
    'SLP.WAP-939': '/img/p/wap939-fuel-pump-water-pump-21468471.webp',
    'SLP.OP-350': '/img/p/op350-fuel-pump-oil-pump-volvo-oe-reference.webp',
    'SLP.BTE-324': '/img/p/slp-bte324-diesel-part-belt-tensioner.webp',
    'SLP.BTE-523': '/img/p/bte523-diesel-part-belt-tensioner-21422767.webp',
    'SLP.T-639': '/img/p/t639-diesel-part-thermostat-replaces-slp-tk-249.webp',
    'SLP.FF-683': '/img/p/ff683-diesel-part-fuel-filter-volvo-oe-reference.webp',
    'SLP.EXV-4015': '/img/p/exv4015-valve-exhaust-valve-volvo-oe-ref.webp',
    'CR-063': '/img/p/cr063-diesel-part-connecting-rod-volvo-3581063.webp',
    'PRO-385': '/img/p/pro385-diesel-part-piston-rod-volvo-22187385.webp',
    'GBG-2984': '/img/p/gbg2984-diesel-part-gear-volvo-852984.webp',
    'GS-815': '/img/p/gs815-diesel-part-gear-segment-volvo-3856815.webp',
    'RC-504': '/img/p/rc504-diesel-part-engine-mount-volvo-21203504.webp',
    'IC-230': '/img/p/ic230-diesel-part-fuel-cooler-volvo-23485230.webp',
    'SEN-616': '/img/p/sen616-sensor-volvo-3808616.webp',
    'SLP.OLS-447': '/img/p/ols447-sensor-oil-level-sensor-24424110.webp',
    'SLP.BK-509': '/img/p/slp-bk509-repair-kit-bellow-kit-volvo-3594509-3808898.webp',
    'ADR-619': '/img/p/adr619-diesel-part-adapter-volvo-21434619.webp',
    'HC-338': '/img/p/hc338-diesel-part-hose-connection-volvo-872338.webp',
    'CAP-538': '/img/p/cap538-diesel-part-cap-volvo-22092538.webp',
    'N-398': '/img/p/n398-diesel-part-end-nut-volvo.webp',
    'JV.80.500.001': '/img/p/jv-diesel-80500001-fuel-injector-java-sleeve-cap-for-injector.webp',
    'BO.0.414.702.010': '/img/p/bosch-0414702010-fuel-pump-bosch-unit-pump-volvo-penta-fuel.png',
    'BO.0.433.171.931': '/img/p/bosch-0433171931-injector-nozzle-0-445-110-255.png',
    'BO.0.445.020.175': '/img/p/bosch-0445020175-high-pressure-fuel-pump-f250-motor-maxpower-3-9-fab-2006.png',
    'BO.0.445.110.189': '/img/p/bosch-0445110189-fuel-injector-mercedes-benz-sprinter-2000-2003.png',
    'BO.0.445.110.307': '/img/p/bosch-0445110307-fuel-injector-komatsu-pc70-8-pc130-8.png',
    'BO.0.445.115.078': '/img/p/bosch-0445115078-fuel-injector-vw-audi.png',
    'BO.0.445.120.330': '/img/p/bosch-0445120330-fuel-injector.png',
    'BO.0.986.435.504': '/img/p/bosch-0986435504-fuel-injector-gm-6-6l-duramax.png',
    // 4:3 clean photos for Ford, Ram, Chevy/GMC and Nissan parts, made from the best photo found for each part number (validation batch for Mike)
    'BO.0.986.435.520': '/img/p/bosch-0986435520-fuel-injector-gmc-6-6l-v8-duramax-lmm-2007-10.webp',
    'AP.AP54904': '/img/p/alliant-power-ap54904-fuel-injector-l5p-cyl1-3-6-8.webp',
    'BO.0.986.435.409': '/img/p/bosch-0986435409-fuel-injector-2011-2016-6-6l-duramax-lgh.webp',
    'DG-9976': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261115_150001_bc258960-8529-45fc-89ec-f698b4edc98c.webp',
    'DN.DXD51708': '/img/p/denso-dxd51708-diesel-part-gm-part-number-12698552-12678992.webp',
    'BO.0.432.217.276': '/img/p/bosch-0432217276-fuel-injector-gmc-chevy-6-5l-chevrolet-suburban.webp',
    'BO.0.445.020.030': '/img/p/bosch-0445020030-high-pressure-fuel-pump-cp3-gm6-6l.webp',
    'BO.0.986.437.308': '/img/p/bosch-0986437308-high-pressure-fuel-pump-2005-duramax-lly-6-6l.webp',
    'DN.HU294050-0701': '/img/p/denso-hu2940500701-high-pressure-fuel-pump-duramax-l5p-l5d-gm-2017-3500-6-6l.webp',
    'AP.AP54905': '/img/p/alliant-power-ap54905-fuel-injector-l5p-cyl-2-4-5-7.webp',
    'BO.0.986.435.521': '/img/p/bosch-0986435521-fuel-injector-lbz.webp',
    'BO.0.986.437.303': '/img/p/bosch-0986437303-high-pressure-fuel-pump-6-6l-duramax-lb7-2001-2004-5.webp',
    'BO.0.445.010.817': '/img/p/bosch-0445010817-high-pressure-fuel-pump-6-6l-bosch.webp',
    'BO.F.00R.001.205': '/img/p/bosch-f00r001205-fuel-rail-lb7-fuel-rail-l-r.webp',
    'BO.F.00R.001.505': '/img/p/bosch-f00r001505-fuel-rail-left-hand-driver-side-lly-duramax.webp',
    'BO.F.00R.001.512': '/img/p/bosch-f00r001512-fuel-rail-right-hand-passanger-side-lly.webp',
    'BO.F.00R.L00.143': '/img/p/bosch-f00rl00143-fuel-rail-gm-6-6l-duramax-lmm.webp',
    'BO.0.445.117.043': '/img/p/bosch-0445117043-fuel-injector-ford-truck-6-7-powerstroke.webp',
    'BO.0.445.118.059': '/img/p/bosch-0445118059-fuel-injector-ford-6-7l-2022.webp',
    'DE.EX636692': '/img/p/delphi-ex636692-fuel-injector-international-g2-8-ford-6-0l.webp',
    'PP.6920-PP': '/img/p/alliant-power-6920pp-fuel-injector-powerstroke-6-4l-2008-2010.webp',
    'BO.0.445.010.649': '/img/p/bosch-0445010649-high-pressure-fuel-pump-cp4-pump-for-2011-14-ford-6-7l.webp',
    'BO.0.986.437.422': '/img/p/bosch-0986437422-high-pressure-fuel-pump-cp4-2011-14-ford-6-7l-bosch-0-445.webp',
    'BO.0.986.437.441': '/img/p/bosch-0986437441-high-pressure-fuel-pump-2015-18-ford-cp4-bosch-0-445-010.webp',
    'BO.HP032X': '/img/p/bosch-hp032x-high-pressure-fuel-pump-03-04-ford-powerstorke-6-0l-2003.webp',
    'ID.334301': '/img/p/industrial-injection-334301-fuel-pump-industrial-injection-fuel-pump.webp',
    'BO.0.445.010.810': '/img/p/bosch-0445010810-high-pressure-fuel-pump-diesel-engine-6-7l-bosch.webp',
    'BO.0.445.218.017': '/img/p/bosch-0445218017-fuel-rail-2011-to-2017-ford-6-7l-power.webp',
    'BO.0.445.218.025': '/img/p/bosch-0445218025-fuel-rail-2016-2019-nissan-titan-xd.webp',
    'BO.0.445.218.026': '/img/p/bosch-0445218026-fuel-rail-2016-2019-nissan-titan-5-0l.webp',
    'BO.0.432.133.877': '/img/p/bosch-0432133877-fuel-injector-5-9l-cummins-12v-1990-1993.webp',
    'BO.0.432.131.715': '/img/p/bosch-0432131715-fuel-injector.webp',
    'BO.0.445.120.255': '/img/p/bosch-0445120255-fuel-injector-cummins-5-9-2003-2004-5.webp',
    'BO.0.986.435.503': '/img/p/bosch-0986435503-fuel-injector-ram-pickup-truck-2500-3500-mid.webp',
    'BO.0.986.435.518': '/img/p/bosch-0986435518-fuel-injector-6-7l-cummins.webp',
    'BO.0.986.435.519': '/img/p/bosch-0986435519-fuel-injector-cummins-6-7l-isb-07-10.webp',
    'BO.0.986.435.574': '/img/p/bosch-0986435574-fuel-injector-dodge-6-7l-cummins.webp',
    'BO.0986.435.573': '/img/p/bosch-0986435573-fuel-injector-6-7-dodge-cummins.webp',
    'BO.0.432.133.860': '/img/p/bosch-0432133860-fuel-injector-dodge-5-9l-12v-1994-1995-m-t-1996.webp',
    'BO.0.432.193.635': '/img/p/bosch-0432193635-fuel-injector-cummins-dodge-ram-rv275-98-5-02.webp',
    'BO.0.445.010.874': '/img/p/bosch-0445010874-high-pressure-fuel-pump-cp4-ram-6-7l-2019-20.webp',
    'BO.0.445.020.151': '/img/p/bosch-0445020151-high-pressure-fuel-pump-5-9l-cummins-mid-range-cp3.webp',
    'BO.0.445.020.176': '/img/p/bosch-0445020176-high-pressure-fuel-pump-cp3-pump-for-cummins-qsb6-7.webp',
    'BO.0.986.437.307': '/img/p/bosch-0986437307-high-pressure-fuel-pump-cp3-cummins-mid-range.webp',
    'BO.0.986.437.334': '/img/p/bosch-0986437334-fuel-injector-cp3-cummins-isb-6-7l-2007-5-2018.webp',
    'BO.0.986.437.370': '/img/p/bosch-0986437370-high-pressure-fuel-pump-cp3-midrange-reverse-rotation.webp',
    'BO.0.445.226.014': '/img/p/bosch-0445226014-fuel-rail-hpcr-fuel-rail-cummins-5-9l-2003.webp',
    'BO.0.445.226.044': '/img/p/bosch-0445226044-fuel-rail-2007-5-2012-cummins-6-7l-bosch.webp',
    'BO.0.445.216.043': '/img/p/bosch-0445216043-fuel-injector-ram-3-0l-ecodiesel.webp',
    'BO.F.00R.J02.701': '/img/p/bosch-f00rj02701-solenoid-gm.webp',
    'PP.608990': '/img/p/alliant-power-608990-fuel-pump-dcr-pump-conversion-kit-2017-2023.webp',
    'BO.0.432.217.275': '/img/p/bosch-0432217275-fuel-injector-1991-1994-chevy-gmc-6-2l-6-5l.webp',
    'BO.0.928.400.535': '/img/p/bosch-0928400535-pressure-regulator-fuel-pressure-regulator-lb7.webp',
    'BO.0.928.400.653': '/img/p/bosch-0928400653-diesel-part-fuel-pressure-reg-gm6-6l-1-465.webp',
    'BO.0.928.400.673': '/img/p/bosch-0928400673-pressure-regulator-fuel-pressure-regulator-6-6l.webp',
    'BO.1.465.ZS0.058': '/img/p/bosch-1465zs0058-diesel-part-fuel-pressure-reg-gm6-6l-lly.webp',
    'BO.1.465.ZS0.063': '/img/p/bosch-1465zs0063-pressure-regulator-fuel-pressure-regulator-6-6l.webp',
    'LD.DX66.INJLINE01': '/img/p/lead-dx66injline01-injector-line-duramax-lb7-6-6l-injector-line.webp',
    'LD.F.00R.J01.329': '/img/p/lead-f00rj01329-control-valve-0-445-120-042.webp',
    'LD.F.00R.J01.747': '/img/p/lead-f00rj01747-control-valve-0-445-120-082.webp',
    'OMS.11-25-043': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261115_171713_617af284-16ba-45af-ac1a-122df0fe6f1d.webp',
    'BO.1.465.ZS0.044': '/img/p/bosch-1465zs0044-pressure-regulator-fuel-pressure-regulator-0-928-400.webp',
    'BO.F.00R.J02.005': '/img/p/bosch-f00rj02005-valve-0-445-120-008.webp',
    'LD.F.00R.J02.005': '/img/p/lead-f00rj02005-control-valve-0-445-120-008.webp',
    'OMS.11-25-051': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261115_171809_70fdd620-99b2-4b87-a51c-d88f31950a3d.webp',
    'FB.BLLA158P1500': '/img/p/fratelli-bosio-blla158p1500-injector-nozzle-0-445-120-042.webp',
    'FB.BLLA158P1385': '/img/p/fratelli-bosio-blla158p1385-injector-nozzle-0-445-120-027.webp',
    'KS.F.00V.X40.051': '/img/p/bosch-f00vx40051-injector-nozzle-inj-0-986-435-410-0-445-117-010.webp',
    'BO.0.433.175.275': '/img/p/bosch-0433175275-injector-nozzle-0-445-120-008.webp',
    'FB.P1500-BLK': '/img/p/fratelli-bosio-p1500blk-injector-nozzle-0-445-120-042.webp',
    'BO.0.928.400.666': '/img/p/bosch-0928400666-fuel-pump-bosch-pressure-regulator-metering.webp',
    'BO.2.417.413.101': '/img/p/bosch-2417413101-valve-overflow-valve-5-9l-cummins-12v.webp',
    'BO.F.00R.J02.004': '/img/p/bosch-f00rj02004-control-valve-0-445-120-050-185-193-071-184-204.webp',
    'LD.F.00R.J01.714': '/img/p/lead-f00rj01714-control-valve-0-445-120-342-188-187.webp',
    'LD.F.00R.J02.004': '/img/p/lead-f00rj02004-control-valve-0-445-120-050-185-193-071-184-204.webp',
    'OMS.11-25-041': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261115_171954_9f20e10f-42c9-4635-a36e-a7347b339243.webp',
    'OMS.11-25-062': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261115_171953_91b3b388-7948-46eb-b49d-856595348326.webp',
    'LD.F.00R.J02.130': '/img/p/lead-f00rj02130-valve-0-445-120-112-cummins.webp',
    'FB.BSLA124P5516.BLANK': '/img/p/fratelli-bosio-bsla124p5516blank-injector-nozzle-0-445-120-238.webp',
    'FB.BLLA146P2124': '/img/p/fratelli-bosio-blla146p2124-injector-nozzle-0-986-435-574-0-445-120-188.webp',
    'FB.BLLA145P2144': '/img/p/fratelli-bosio-blla145p2144-injector-nozzle-0-986-435-573-bosch-0-433-172-144.webp',
    'FB.BSLA124P5516': '/img/p/fratelli-bosio-bsla124p5516-injector-nozzle-0-445-120-238.webp',
    'FB.BSLA146P2145': '/img/p/fratelli-bosio-bsla146p2145-injector-nozzle-0-445-120-050-185-193.webp',
    'FB.BSLA143P5499': '/img/p/fratelli-bosio-bsla143p5499-injector-nozzle-0-445-120-210.webp',
    'FB.BSLA143P1058': '/img/p/fratelli-bosio-bsla143p1058-injector-nozzle-0-445-120-018.webp',
    'FB.BSLA143P5501': '/img/p/fratelli-bosio-bsla143p5501-injector-nozzle-0-445-120-212-ford-cargo-vw.webp',
    'BO.0.433.175.501': '/img/p/bosch-0433175501-injector-nozzle-0-445-120-212.webp',
    'DY.0.433.175.501': '/img/p/0433175501-injector-nozzle-0-445-120-212.webp',
    'LD.DSLA143P5501': '/img/p/lead-dsla143p5501-injector-nozzle-0-445-120-007-0-445-120-212.webp',
    'FB.BLLA143P1541': '/img/p/fratelli-bosio-blla143p1541-injector-nozzle-0-986-435-519.webp',
    'BO.0.433.175.510': '/img/p/bosch-0433175510-injector-nozzle-0-445-120-255-210-238-5263262.webp',
    'BO.0.433.175.499': '/img/p/bosch-0433175499-injector-nozzle-0-445-120-210.webp',
    'KS.DSLA143P5501': '/img/p/dsla143p5501-injector-nozzle-0-445-120-212.webp',
    'FB.BSLA124P5500': '/img/p/fratelli-bosio-bsla124p5500-injector-nozzle-0-986-435-505.webp',
    'BO.0.445.117.094': '/img/p/bosch-0445117094-fuel-injector-ford-6-7-powerstroke-2015-2019.webp',
    'BO.0.445.117.096': '/img/p/bosch-0445117096-fuel-injector-2011-2014-ford-6-7l-powerstroke.webp',
    'BO.0.445.118.058': '/img/p/bosch-0445118058-fuel-injector-ford-6-7l-powerstroke.webp',
    'MX.HC3Z-9B246-B': '/img/p/maxzz-hc3z9b246b-repair-kit-contamination-kit-essentials-ford.webp',
    'MX.EC3Z-9B246-B': '/img/p/maxzz-ec3z9b246b-repair-kit-contamination-kit-ford-6-7l-2011.webp',
    'BO.0.445.218.028': '/img/p/bosch-0445218028-fuel-rail-genuine-bosch-2020-6-7l.webp',
    'BO.0.281.006.064': '/img/p/bosch-0281006064-sensor-6-7-powerstroke-fuel-pressure.webp',
    'FD.FC3Z00812AA': '/img/p/fc3z00812aa-diesel-part-2011-2019-ford-6-7l-inj-bolt.webp',
    'LD.FD67.INJLINE': '/img/p/lead-fd67injline-injector-line-ford-6-7l-injector-line.webp',
    // Heavy duty,
    'MX.2872405': '/img/p/maxzz-2872405-fuel-injector-isx15-xpi.webp',
    'MX.2897320': '/img/p/maxzz-2897320-fuel-injector-isx15-xpi.webp',
    'CM.2894920': '/img/p/cummins-2894920-fuel-injector-xpi-hd-injector-cummins-isx-x15.webp',
    'CM.4954434': '/img/p/cummins-4954434-fuel-injector-isx-cummins.webp',
    'CM.4954434R': '/img/p/cummins-4954434r-fuel-injector-isx-cummins-injector.webp',
    'CM.4088665R': '/img/p/cummins-4088665r-fuel-injector-isx15-cummins.webp',
    'CM.4062569-R': '/img/p/cummins-4062569r-fuel-injector-qsx15-isx15.webp',
    'DE.EX634434': '/img/p/delphi-ex634434-fuel-injector-cummins-isx-15-0l.webp',
    'CM.3411756': '/img/p/cummins-3411756-fuel-injector-ism-qsm-m11.webp',
    'CM.3095040': '/img/p/cummins-3095040-fuel-injector-cummins-ism-m11-injector.webp',
    'CM.4903472': '/img/p/cummins-4903472-fuel-injector-cummins-m11-qsm11-ism11.webp',
    'CM.4928517R': '/img/p/cummins-4928517r-fuel-injector-ism-4928517.webp',
    'CM.4954679R': '/img/p/cummins-4954679r-fuel-injector-icummins-isl9-5.webp',
    'BO.0.986.435.532': '/img/p/bosch-0986435532-fuel-injector-cummins-8-3l-isc.webp',
    'BO.0.445.120.302': '/img/p/bosch-0445120302-fuel-injector-i-dd15-dd16.webp',
    'BO.0.445.120.303': '/img/p/bosch-0445120303-fuel-injector-detroit-dd15.webp',
    'BO.0.986.435.539': '/img/p/bosch-0986435539-fuel-injector-dd15-dd16-detroit.webp',
    'BO.0.986.435.598': '/img/p/bosch-0986435598-fuel-injector-dd13-12-8l.webp',
    'BO.0.986.435.642': '/img/p/bosch-0986435642-fuel-injector-detroit-dd13.webp',
    'DE.EX631018': '/img/p/delphi-ex631018-fuel-injector-detroit-diesel-s60-rfe4e00001-e-3.webp',
    'BO.0.986.441.029': '/img/p/bosch-0986441029-fuel-injector-detroit-s60-n3-14l.webp',
    'BO.RB5235575': '/img/p/bosch-rb5235575-fuel-injector-eui-injector-detroit-s60-12-7-n2.webp',
    'DT.RB5237650': '/img/p/rb5237650-fuel-injector-detroit-s60-12-7-n2-eui-injector.webp',
    'DE.EX634761': '/img/p/delphi-ex634761-fuel-injector-cat-c7-10r4761-20r8057-222-5961.webp',
    'CA.10R4761': '/img/p/caterpillar-10r4761-fuel-injector-caterpillar-c7.webp',
    'DE.EX639348': '/img/p/delphi-ex639348-fuel-injector-cat-3126b-heui-cat.webp',
    'CAT.10R0963R': '/img/p/caterpillar-10r0963r-fuel-injector-c12-0r8773-0r4988-10r0968.webp',
    'CAT.10R2977R': '/img/p/caterpillar-10r2977r-fuel-injector-cat-c13-injector.webp',
    'DE.EX634763': '/img/p/delphi-ex634763-fuel-injector-cat-c7.webp',
    'CAT.10R1273R': '/img/p/caterpillar-10r1273r-fuel-injector-c15-cat.webp',
    'CAT.10R8501R': '/img/p/caterpillar-10r8501r-fuel-injector-3406e.webp',
    'DE.EX630956': '/img/p/delphi-ex630956-fuel-injector-delphi-1994-2003-cat-c15-c16.webp',
    'DE.EX631007': '/img/p/delphi-ex631007-fuel-injector-volvo-d12-12-1l-volvo-3169521.webp',
    'DE.EX631028': '/img/p/delphi-ex631028-fuel-injector-delphi-volvo-d11f-d13f-d16f-e3-3.webp',
    'DE.EX631029': '/img/p/delphi-ex631029-fuel-injector-volvo-d11f-d13f-d16f-e3-3-eui.webp',
    'VO.85003656': '/img/p/volvo-85003656-fuel-injector-volvo-fuel-injector-d13f-2008.webp',
    'DE.EX631079': '/img/p/delphi-ex631079-fuel-injector-volvo-e3-5-10-0-mm.webp',
    'VO.9022340652': '/img/p/volvo-9022340652-fuel-injector-d13-bebe4l07001.webp',
    'DE.EX631133': '/img/p/delphi-ex631133-diesel-part-delphi-inj-volvo-elec-unit-f2e.webp',
    'DE.EX631145': '/img/p/delphi-ex631145-fuel-injector-f2p-series-fuel-injector-for.webp',
    'GP.1825900': '/img/p/1825900-fuel-injector-paccar-mx13-mx10-2008-2013.webp',
    'PC.2047600': '/img/p/paccar-2047600-fuel-injector-paccar-mx13-mx10.webp',
    'BO.0.986.435.577': '/img/p/bosch-0986435577-fuel-injector-navistar-maxxforce-13.webp',
    'BO.0.445.120.180': '/img/p/bosch-0445120180-fuel-injector-2008-2009-make.webp',
    'AP.AP63911BI': '/img/p/alliant-power-ap63911bi-fuel-injector-navistar-perkins-navistar-dt466.webp',
    'LD.1830561C93': '/img/p/lead-1830561c93-fuel-injector-heui-for-navistar-dt466-dt466e-7.webp',
    'AP.66977R': '/img/p/alliant-power-66977r-fuel-injector-for-international-navistar-dt466.webp',
    'DE.EX551001': '/img/p/delphi-ex551001-fuel-pump-paccar-f2p-pump-asm-paccar-mx13.webp',
    'BO.0.444.042.180': '/img/p/bosch-0444042180-def-supply-module.webp',
    'BO.0.444.042.27E': '/img/p/bosch-044404227e-def-supply-module.webp',
    'BO.0.444.042.29X': '/img/p/bosch-044404229x-def-supply-module.webp',
    'BO.0.444.042.29Z': '/img/p/bosch-044404229z-def-supply-module.webp',
    'BO.0.444.043.017': '/img/p/bosch-0444043017-diesel-part-dosing-module.webp',
    'CAD.MX99': '/img/p/cad-mx99-solenoid-cummins-n14-l10-m11.webp',
    'DAP.F.00V.X50.083': '/img/p/dap-f00vx50083-fuel-injector-crin-4-2-for-injector-0-445-120.webp',
    'DE.HTV113': '/img/p/delphi-htv113-valve-inlet-metering-valve-cummins-isx.webp',
    'LD.2894829': '/img/p/lead-2894829-diesel-part-lead-connector-tubes-isx15.webp',
    'RB.410.06.0002': '/img/p/robiel-410060002-repair-kit-cummins-n14-m11-li0.webp',
    'RB.B040.48.015': '/img/p/robiel-b04048015-fuel-injector-cat-eui-c10-c12-c15-c18-unit.webp',
    'RB.410.00.60': '/img/p/robiel-4100060-diesel-part-repair-parts-set-detroit-eui-60.webp',
    'RB.340.14.001': '/img/p/robiel-34014001-control-valve-c7-diesel.webp',
    'OMS.11-23-992': '/img/p/oms-1123992-repair-kit-254-4339-263-8218-387-9433-235.webp',
    'OMS.11-23-992/C7': '/img/p/oms-1123992c7-valve-238-8091-241-3239-328-2582-387.webp',
    'LD.nozzle4761': '/img/p/lead-nozzle4761-injector-nozzle-10r4761-c7.webp',
    'LD.nozzle4762': '/img/p/lead-nozzle4762-injector-nozzle-10r4762-c7.webp',
    'LD.nozzle4763': '/img/p/lead-nozzle4763-injector-nozzle-10r4763-c7.webp',
    'JV.80.801.717': '/img/p/jv-diesel-80801717-repair-kit-java-repair-kit-inj-cummins-isx.webp',
    'LD.ISX15KIT_7147': '/img/p/lead-isx15kit7147-repair-kit-rebuild-kit-for-inj-4327147-isx15.webp',
    'RB.410.32.235': '/img/p/robiel-41032235-repair-kit-cummins-isx15.webp',
    'JV.80.801.062': '/img/p/jv-diesel-80801062-repair-kit-java-repair-kit-cummins-isx.webp',
    'JV.50.802.088': '/img/p/jv-diesel-50802088-fuel-injector-uis-volvo-d12ac-parcial-delphi.webp',
    'JV.50.802.001': '/img/p/jv-diesel-50802001-repair-kit-uis-volvo-d12-a-c-for-delphi-inj.webp',
    'JV.50.802.003': '/img/p/jv-diesel-50802003-fuel-injector-eui-volvo-d12d-d13a-fh12.webp',
    'JV.81.801.394': '/img/p/jv-diesel-81801394-repair-kit-eui-cat-c15-c32.webp',
    'RB.410.61.015': '/img/p/robiel-41061015-diesel-part-external-repair-parts-cat-c13-c15.webp'
  };
  // search index per row: normalized code (with and without the 2-letter brand prefix) + normalized cross refs
  var SIX = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function six(x) {
    var v = SIX && SIX.get(x); if (v) return v;
    var c = norm(x[0]), t = parse(x[1]);
    v = { c: c, c2: c.replace(/^[A-Z]{2}(?=\d)/, ''), xr: t.xr.map(norm).filter(function (z) { return z.length >= 4; }), t: (t.title || '').toLowerCase(), hay: (x[1] + ' ' + x[0] + ' ' + (x[4] || '') + ' ' + (x[3] || '')).toLowerCase() };
    if (SIX) SIX.set(x, v); return v;
  }
  function matchSearch(list, a) {
    var nq = norm(a), words = String(a).toLowerCase().split(/\s+/).filter(Boolean), sc = [];
    var catw = words.map(function (w) { return w.replace(/s$/, ''); });
    list.forEach(function (x) {
      var s = six(x), score = 0;
      if (nq.length >= 3) {
        if (s.c === nq || s.c2 === nq || s.xr.indexOf(nq) >= 0) score = 1000;
        else if (s.c.indexOf(nq) === 0 || s.c2.indexOf(nq) === 0) score = 800;
        else if (s.xr.some(function (z) { return z.indexOf(nq) === 0; })) score = 700;
        else if (s.c.indexOf(nq) >= 0 || s.xr.some(function (z) { return z.indexOf(nq) >= 0; })) score = 500;
      }
      if (!score && words.length && words.every(function (w) { return s.hay.indexOf(w) >= 0; })) {
        score = 100;
        var cat = String(x[3] || '').toLowerCase();
        if (catw.some(function (w) { return w.length > 2 && cat.indexOf(w) === 0; })) score += 60;
        if (words.some(function (w) { return s.t.indexOf(w) === 0; })) score += 30;
        else if (words.every(function (w) { return s.t.indexOf(w) >= 0; })) score += 15;
      }
      if (score) sc.push([score, x]);
    });
    sc.sort(function (p, q) { return q[0] - p[0]; });
    return sc.map(function (z) { return z[1]; });
  }
  function exactHit(list, a) {
    var nq = norm(a); if (nq.length < 5) return null;
    var own = list.filter(function (x) { var s = six(x); return s.c === nq || s.c2 === nq; });
    if (own.length === 1) return own[0]; if (own.length) return null;
    var xr = list.filter(function (x) { return six(x).xr.indexOf(nq) >= 0; });
    return xr.length === 1 ? xr[0] : null;
  }
  // category icons (24px line, drawn for the store)
  var ICONS = {
    "home": "<path d=\"M4 11l8-6.5 8 6.5\"/><path d=\"M6 9.5V20h12V9.5\"/><path d=\"M10 20v-5h4v5\"/>",
    "inj": "<path d=\"M10 3h4v3h-4z\"/><rect x=\"8.5\" y=\"6\" width=\"7\" height=\"9\" rx=\"1.5\"/><path d=\"M15.5 9H19\"/><path d=\"M11 15h2l-.4 4.5h-1.2z\"/><path d=\"M12 19.5V21\"/>",
    "pump": "<circle cx=\"11\" cy=\"13.5\" r=\"6\"/><circle cx=\"11\" cy=\"13.5\" r=\"2\"/><path d=\"M17 13.5h4\"/><path d=\"M9.5 7.5V4.5h3v3\"/>",
    "noz": "<path d=\"M10 3h4v4h-4z\"/><path d=\"M10.6 7h2.8l-.6 10.5h-1.6z\"/><path d=\"M12 17.5V19\"/><path d=\"M9 21.5l1.5-1.5M15 21.5L13.5 20M12 21.5V21\"/>",
    "rail": "<rect x=\"3\" y=\"10\" width=\"18\" height=\"4.5\" rx=\"2.25\"/><path d=\"M7 10V6.5M12 10V6.5M17 10V6.5\"/><path d=\"M5.5 6.5h3M10.5 6.5h3M15.5 6.5h3\"/>",
    "rep": "<circle cx=\"8\" cy=\"12\" r=\"4.5\"/><circle cx=\"8\" cy=\"12\" r=\"2\"/><path d=\"M17.5 8.5l3 1.75v3.5l-3 1.75-3-1.75v-3.5z\"/><circle cx=\"17.5\" cy=\"12\" r=\"1\"/>",
    "tool": "<path d=\"M14.7 4.3a4 4 0 0 0-4.6 5.4L4 15.8 6.2 18l6.1-6.1a4 4 0 0 0 5.4-4.6l-2.4 2.4-2.1-.6-.6-2.1z\"/><path d=\"M15 15l4 4\"/><path d=\"M17.5 13.5l3 3-1.5 1.5-3-3\"/>",
    "eng": "<path d=\"M5 9h2.5V7h3V5.5h4V7H17l2 2.5V15h-2v2.5H9.5L7.5 15H5z\"/><path d=\"M5 11H3v3h2M19 11.5h2v2.5h-2\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/>",
    "fl": "<path d=\"M7 7h8l3.5 3.5V20H7z\"/><path d=\"M9.5 7V4.5h4V7\"/><path d=\"M12.75 11.5c1.3 1.6 2 2.6 2 3.5a2 2 0 0 1-4 0c0-.9.7-1.9 2-3.5z\"/>",
    "kit": "<path d=\"M3.5 8L12 4l8.5 4v8.5L12 20.5 3.5 16.5z\"/><path d=\"M3.5 8L12 12l8.5-4\"/><path d=\"M12 12v8.5\"/><path d=\"M7.75 6l8.5 4\"/>",
    "all": "<rect x=\"4\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"13.5\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"4\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"13.5\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/>"
    };
  var MEMO = {};
  var RWI = {"app": "<path d=\"M14.7 4.3a4 4 0 0 0-4.6 5.4L4 15.8 6.2 18l6.1-6.1a4 4 0 0 0 5.4-4.6l-2.4 2.4-2.1-.6-.6-2.1z\"/>", "tech": "<path d=\"M10 3h4v3h-4z\"/><rect x=\"8.5\" y=\"6\" width=\"7\" height=\"9\" rx=\"1.5\"/><path d=\"M11 15h2l-.4 4.5h-1.2z\"/>", "spec": "<circle cx=\"12\" cy=\"13\" r=\"8\"/><path d=\"M12 13l4-4M12 5V3M7 13H5M19 13h-2\"/>", "master": "<path d=\"M4 8l4 3 4-6 4 6 4-3-2 10H6z\"/><path d=\"M6 21h12\"/>", "off": "<path d=\"M20 12l-8 8-8-8V4h8z\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/>", "ship": "<path d=\"M3 7h11v9H3zM14 10h4l3 3v3h-7\"/><circle cx=\"7\" cy=\"17.5\" r=\"1.5\"/><circle cx=\"17\" cy=\"17.5\" r=\"1.5\"/>", "fast": "<path d=\"M13 2L4 14h7l-1 8 9-12h-7z\"/>", "fluid": "<path d=\"M7 7h8l3.5 3.5V20H7z\"/><path d=\"M9.5 7V4.5h4V7\"/><path d=\"M12.75 11.5c1.3 1.6 2 2.6 2 3.5a2 2 0 0 1-4 0c0-.9.7-1.9 2-3.5z\"/>", "tool": "<path d=\"M14.7 4.3a4 4 0 0 0-4.6 5.4L4 15.8 6.2 18l6.1-6.1a4 4 0 0 0 5.4-4.6l-2.4 2.4-2.1-.6-.6-2.1z\"/>", "shirt": "<path d=\"M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z\"/>", "school": "<path d=\"M2 9l10-5 10 5-10 5z\"/><path d=\"M6 11v5c3 2 9 2 12 0v-5\"/>", "bench": "<path d=\"M3 10h18M5 10v10M19 10v10M8 10V6h8v4\"/>", "people": "<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6\"/><circle cx=\"17\" cy=\"9\" r=\"2.5\"/><path d=\"M15.5 14.2c3 .2 5.5 2.6 5.5 5.8\"/>", "mic": "<rect x=\"9\" y=\"3\" width=\"6\" height=\"11\" rx=\"3\"/><path d=\"M5 11a7 7 0 0 0 14 0M12 18v3\"/>"};
  // empty document/tracker: returned instead of null so bindings of a view being torn down never read null
  var DOC0 = { none: true, kind: '', number: '', email: '', billTo: [], shipTo: [], refs: [], lines: [], priced: false, total: 0, units: 0, notes: '' };
  var TRK0 = { none: true, label: '', steps: [], at: 0 };
  var DIAL = { '55': 'Brazil', '52': 'Mexico', '57': 'Colombia', '56': 'Chile', '51': 'Peru', '593': 'Ecuador', '54': 'Argentina', '598': 'Uruguay', '595': 'Paraguay', '591': 'Bolivia', '58': 'Venezuela', '507': 'Panama', '506': 'Costa Rica', '502': 'Guatemala', '504': 'Honduras', '503': 'El Salvador', '505': 'Nicaragua' };
  // longest national number per country (digits after the country code), to tell a local number from a full one
  var NAT = { Brazil: 11, Mexico: 10, Colombia: 10, Chile: 9, Peru: 9, Ecuador: 9, Argentina: 11, Uruguay: 9, Paraguay: 9, Bolivia: 8, Venezuela: 10, Panama: 8, 'Costa Rica': 8, Guatemala: 8, Honduras: 8, 'El Salvador': 8, Nicaragua: 8 };
  var NANP = /United States|Puerto Rico|Canada|Dominican Republic/;
  var ROUTES = ['home', 'c', 's', 'g', 'all', 'p', 'cart', 'checkout', 'orders', 'o', 'login', 'sent', 'request', 'requested', 'pending', 'admin', 'quote', 'rewards'];
  var T0 = Date.now();

  var app = PetiteVue.reactive({
    route: 'home', arg: '', me: null, book: null, cat: [], map: {}, fit: { tree: [], items: {}, rel: {} }, buy: null, imgs: {}, bad: {}, pasteWarn: false, exBase: 0, qOpenId: '', pasteMiss: [], autoC: '', autoPrev: '', coTried: false, mbarOn: false, narrow: window.innerWidth <= 760,
    err: '', busy: false, toast: '', toastKind: '', ordersLoaded: false, idem: '', meLoaded: false, lt: '', iv: null, myQuotes: [], hbg: 0, email: '', sentPending: false,
    rq: { name: '', company: '', email: '', phone: '', city: '', state: '', zip: '', country: 'United States', type: '', customerNumber: '', notes: '' }, rqStep: 1, rqTried: false, rqTried2: false, zipMsg: '',
    q: '', qInput: '', limit: 24, picks: {}, cart: read(CK, []), quote: read(QK, []), qOpen: false, qClosing: false, qSent: null, justPlaced: '', qd: { name: '', company: '', email: '', phone: '', type: '', country: 'United States', city: '', po: '', notes: '', needBy: '', dest: 'same', street: '' },
    countries: ['United States', 'Puerto Rico', 'Canada', 'Mexico', 'Brazil', 'Colombia', 'Chile', 'Peru', 'Ecuador', 'Argentina', 'Uruguay', 'Paraguay', 'Bolivia', 'Venezuela', 'Panama', 'Costa Rica', 'Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Dominican Republic', 'Other'], REWARDS: { on: true, demo: true, points: 12480, rate: 1, levels: [
      { k: 'app', n: 'Apprentice', at: 0, c: '#8a9097', perk: 'Points on every order', perks: ['1 point per US$ 1 invoiced', 'Member pricing alerts', 'Order tracking in the store'] },
      { k: 'tech', n: 'Technician', at: 10000, c: '#c87533', perk: 'Free ground freight over US$ 1,500', perks: ['Everything in Apprentice', 'Free ground freight on orders over US$ 1,500', 'Early access to new part lines'] },
      { k: 'spec', n: 'Specialist', at: 25000, c: '#d32a37', perk: 'Priority review and a DTA seat a year', perks: ['Everything in Technician', 'Priority order review', '1 Diesel Tech Academy course seat a year'] },
      { k: 'master', n: 'Master', at: 50000, c: '#1d2126', perk: 'Account manager and a bench day', perks: ['Everything in Specialist', 'Dedicated account manager', 'Annual bench day at Maxzz Florida'] }] },
    rwCat: 'All',
    RWITEMS: [
      { c: 'Savings', i: 'off', n: 'US$ 50 off your next order', d: 'Applied by our sales team when the order is approved.', p: 5000 },
      { c: 'Savings', i: 'off', n: 'US$ 150 off your next order', d: 'For orders over US$ 1,000.', p: 14000 },
      { c: 'Savings', i: 'off', n: 'US$ 400 off a pump or injector set', d: 'On any complete set of injectors or a high pressure pump.', p: 35000 },
      { c: 'Shipping', i: 'ship', n: 'Free ground freight', d: 'One order, any size, inside the US.', p: 4000 },
      { c: 'Shipping', i: 'fast', n: 'Next Day Air upgrade', d: 'When the truck is down and the part cannot wait.', p: 8000 },
      { c: 'Products', i: 'fluid', n: 'ISO 4113 calibration fluid, 5 gal', d: 'Settori calibration fluid for your test bench.', p: 6000 },
      { c: 'Products', i: 'tool', n: 'Robiel tool up to US$ 250', d: 'Pick any Robiel tool from the catalog up to this value.', p: 22000 },
      { c: 'Products', i: 'shirt', n: 'Maxzz shop jacket and cap', d: 'Workwear for the bench, in your team size.', p: 3000 },
      { c: 'Training', i: 'school', n: 'Diesel Tech Academy course', d: 'One online course for a technician on your team.', p: 12000 },
      { c: 'Training', i: 'school', n: 'DTA complete bundle', d: 'Every DTA course for one technician.', p: 40000 },
      { c: 'Experiences', i: 'bench', n: 'Bench day at Maxzz Florida', d: 'A day at our Coconut Creek bench with our technicians.', p: 35000 },
      { c: 'Experiences', i: 'mic', n: 'Private technical session', d: 'One hour online with our senior instructor on your toughest case.', p: 30000 },
      { c: 'Experiences', i: 'people', n: 'Trade show meetup', d: 'Lunch with the Maxzz team at ADS or AAPEX.', p: 20000 }], sortBy: '', specs: null, dtab: '', recent: read('mx-portal-recent', []), paste: '', pasteMsg: '',
    vMake: '', vLast: '', vEng: '', f: { cat: [], brand: [], eng: [], photo: false, stock: false, out: false }, allBrands: false, showF: false, sugOn: false, sugI: -1,
    co: Object.assign({ po: '', method: 'Ground', name: '', street: '', city: '', state: '', zip: '', country: 'United States', notes: '', fwd: '' }, read('mx-portal-ship', {}), { po: '', notes: '' }),
    orders: [], cur: null, accounts: [], sync: null,

    get cats() { var self = this; return CATS.map(function (c) { return Object.assign({ n: self.cat.filter(function (r) { return r[3] === c.k && !(self.hideOut && self.hid(r[0])); }).length }, c); }).filter(function (c) { return c.n; }); },
    get logged() { return !!(this.me && (this.me.admin || (this.me.account && this.me.account.status === 'approved'))); },
    get canOrder() { return !!(this.me && this.me.account && this.me.account.status === 'approved'); },
    get pendingCount() { return this.accounts.filter(function (a) { return a.status === 'pending'; }).length; },
    get engMake() { var k = this.vMake || this.vLast; return this.fit.tree.filter(function (m) { return m.key === k; })[0] || null; },
    get curMake() { var k = this.vMake; return this.fit.tree.filter(function (m) { return m.key === k; })[0] || null; },
    get featured() {
      var self = this, picks = Object.keys(BENCH).concat(['BO.0.986.435.433', 'BO.0.986.435.410', 'BO.0.445.117.023', 'BO.0.445.020.146']);
      var out = picks.map(function (c) { return self.map[c]; }).filter(Boolean);
      out = out.filter(function (r) { return self.hasImg(r[0]); });
      this.cat.some(function (r) { if (out.length >= 8) return true; if ((r[3] === 'Injector' || r[3] === 'Pump') && self.hasImg(r[0]) && out.indexOf(r) < 0) out.push(r); return false; });
      this.cat.some(function (r) { if (out.length >= 8) return true; if (self.hasImg(r[0]) && out.indexOf(r) < 0) out.push(r); return false; });
      // reviewed titles first: the first row a visitor sees should read cleanly
      var sp = this.specs || {}, cur = function (r) { return sp[r[0]] && sp[r[0]].title ? 0 : 1; };
      this.cat.some(function (r) { if (out.length >= 24) return true; if (cur(r) === 0 && self.hasImg(r[0]) && out.indexOf(r) < 0) out.push(r); return false; });
      return out.map(function (r, i) { return [cur(r), i, r]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; }).slice(0, 8);
    },
    get engs() { return ENG; },
    get side() { return ['home', 'c', 's', 'g', 'all'].indexOf(this.route) >= 0; },
    get listTitle() {
      var r = this.route, a = this.arg, f = this.f;
      if ((r === 'c' || r === 'all') && f.cat.length === 1) { var c = CATS.filter(function (x) { return x.k === f.cat[0]; })[0]; return c ? c.label : f.cat[0]; }
      if (r === 's') return 'Results for \u201c' + a + '\u201d';
      if (r === 'g') { var g = this.genOf(a); return g ? g.label + ' ' + g.years : 'Vehicle'; }
      return 'All parts';
    },
    // base set for the route; the sidebar filters stack on top of it
    get memoKey() { return [this.route, this.arg, this.cat.length, JSON.stringify(this.f), this.sortBy, this.book ? this.book.at : 0, Object.keys(this.imgs).length].join('|'); },
    get base() {
      var k = this.route + '|' + this.arg + '|' + this.cat.length + '|' + (this.fit.tree.length) + '|' + (this.book ? this.book.at : 0) + '|' + this.hideOut;
      if (MEMO.baseK === k) return MEMO.base;
      MEMO.baseK = k; MEMO.base = this.baseCalc(); return MEMO.base;
    },
    baseCalc: function () {
      var r = this.route, a = this.arg, self = this, list = this.hideOut ? this.cat.filter(function (x) { return !self.hid(x[0]); }) : this.cat;
      if (r === 'g') return list.filter(function (x) { var f = self.fit.items[x[0]]; return f && f[0].indexOf(a) >= 0; });
      if (r === 's') return matchSearch(list, a);
      return list;
    },
    pass: function (x, skip) {
      var f = this.f;
      if (skip !== 'cat' && f.cat.length && f.cat.indexOf(x[3]) < 0) return false;
      if (skip !== 'brand' && f.brand.length && f.brand.indexOf(x[4] || 'Other') < 0) return false;
      if (skip !== 'eng' && f.eng.length && !f.eng.some(function (e) { return (x[6] || '').indexOf(e) >= 0; })) return false;
      if (skip !== 'photo' && f.photo && !this.img(x[0])) return false;
      if (skip !== 'stock' && f.stock && !(this.qty(x[0]) > 0)) return false;
      if (skip !== 'out' && f.out && !(this.qty(x[0]) != null && this.qty(x[0]) <= 0)) return false;
      return true;
    },
    get results() {
      var k = this.memoKey; if (MEMO.resK === k) return MEMO.res;
      MEMO.resK = k; MEMO.res = this.resultsCalc(); return MEMO.res;
    },
    resultsCalc: function () {
      var self = this, out = this.base.filter(function (x) { return self.pass(x); }), s = this.sortBy;
      if (!s) return out;
      out = out.slice();
      var pr = function (x) { var p = self.price(x[0]); return p == null ? (s === 'plo' ? 1e12 : -1) : p; };
      if (s === 'pn') out.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
      if (s === 'photo') out.sort(function (a, b) { return !!self.img(b[0]) - !!self.img(a[0]); });
      if (s === 'stock') out.sort(function (a, b) { return (self.qty(b[0]) > 0) - (self.qty(a[0]) > 0); });
      if (s === 'plo') out.sort(function (a, b) { return pr(a) - pr(b); });
      if (s === 'phi') out.sort(function (a, b) { return pr(b) - pr(a); });
      return out;
    },
    // other catalog parts listed as the same part (cross references both ways)
    get interch() {
      var p = this.product; if (!p) return [];
      var self = this, mine = norm(p[0]).replace(/^[A-Z]{2}/, ''), xr = parse(p[1]).xr.map(norm).filter(function (x) { return x.length >= 6; });
      return this.cat.filter(function (r) {
        if (r === p) return false;
        var c = norm(r[0]).replace(/^[A-Z]{2}/, '');
        if (xr.some(function (x) { return c === x || c.slice(-x.length) === x; })) return true;
        return mine.length >= 6 && parse(r[1]).xr.map(norm).some(function (x) { return x === mine || x.slice(-mine.length) === mine; });
      }).slice(0, 8);
    },
    // cross-sell: other categories that fit the same vehicles, or the same engine family
    get sameApp() {
      var p = this.product; if (!p) return [];
      var self = this, f = this.fit.items[p[0]], gens = f ? f[0] : [], skip = this.related.concat(this.interch, [p]);
      var hit = this.cat.filter(function (r) {
        if (r[3] === p[3] || skip.indexOf(r) >= 0) return false;
        var g = self.fit.items[r[0]]; return g && gens.length && g[0].some(function (k) { return gens.indexOf(k) >= 0; });
      });
      if (hit.length < 4 && p[6]) this.cat.some(function (r) { if (hit.length >= 8) return true; if (r[3] !== p[3] && r[3] !== 'Engine parts' && skip.indexOf(r) < 0 && hit.indexOf(r) < 0 && (r[6] || '').indexOf(p[6][0]) >= 0) hit.push(r); return false; });
      hit.sort(function (a, b) { return !!self.img(b[0]) - !!self.img(a[0]); });
      return hit.slice(0, 8);
    },
    // fallback so a product page always has a next step: same category, ranked by shared words (engine, maker, model)
    get similar() {
      var p = this.product; if (!p) return [];
      var skip = this.related.concat(this.sameApp, this.interch, [p]);
      if (this.related.length + this.sameApp.length >= 4) return [];
      var STOP = { the: 1, and: 1, for: 1, with: 1, fuel: 1, injector: 1, injectors: 1, pump: 1, kit: 1, fits: 1, application: 1, new: 1, oem: 1, diesel: 1 };
      var toks = function (t) { return String(t || '').toLowerCase().split(/[^a-z0-9.]+/).filter(function (w) { return w.length >= 3 && !STOP[w]; }); };
      var mine = toks(p[1]), self = this;
      var hit = this.cat.filter(function (r) { return r[3] === p[3] && skip.indexOf(r) < 0; }).map(function (r) {
        var t = toks(r[1]), sc = 0; mine.forEach(function (w) { if (t.indexOf(w) >= 0) sc += /\d/.test(w) ? 2 : 1; });
        if (r[4] && r[4] === p[4]) sc += 1; if (self.img(r[0])) sc += 0.5;
        return [sc, r];
      }).filter(function (x) { return x[0] >= 1.5; }).sort(function (a, b) { return b[0] - a[0]; }).map(function (x) { return x[1]; });
      return hit.slice(0, 8);
    },
    get recentList() { var self = this, p = this.product; return this.recent.filter(function (c) { return !p || c !== p[0]; }).map(function (c) { return self.map[c]; }).filter(Boolean).slice(0, 4); },
    get quoteN() { return this.quote.length; },
    get quoteUnits() { return this.quote.reduce(function (a, l) { return a + (l.qty || 1); }, 0); },
    get rwLevel() { var p = this.REWARDS.points, L = this.REWARDS.levels, cur = L[0]; L.forEach(function (l) { if (p >= l.at) cur = l; }); return cur; },
    get rwNext() { var p = this.REWARDS.points; return this.REWARDS.levels.filter(function (l) { return l.at > p; })[0] || null; },
    get rwPct() { var n = this.rwNext, c = this.rwLevel; if (!n) return 100; return Math.min(100, Math.round((this.REWARDS.points - c.at) / (n.at - c.at) * 100)); },
    get rwPathPct() { var L = this.REWARDS.levels, i = L.indexOf(this.rwLevel), seg = 100 / (L.length - 1); return Math.min(100, i * seg + (this.rwNext ? seg * this.rwPct / 100 : 0)); },
    get rwItems() { var c = this.rwCat, p = this.REWARDS.points; return this.RWITEMS.filter(function (r) { return c === 'All' || r.c === c; }).slice().sort(function (a, b) { return (b.p <= p) - (a.p <= p) || a.p - b.p; }); },
    rwIcon: function (k, s) { return '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (RWI[k] || '') + '</svg>'; },
    get firstName() {
      if (!this.me) return '';
      var n = (this.me.name || '').trim().split(/\s+/)[0];
      if (!n) { var lp = String(this.me.email || '').split('@')[0]; n = { marketing: 'Mateus', sales: 'Leise' }[lp] || lp.split(/[._-]/)[0]; n = n.charAt(0).toUpperCase() + n.slice(1); }
      return n;
    },
    get initials() { var n = (this.me && this.me.name) || this.firstName; return n.split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); },
    get greet() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; },
    get openOrders() { return this.orders.filter(function (o) { return ['Completed', 'Deleted'].indexOf(o.status) < 0; }).length; },
    facet: function (g) {
      var k = this.memoKey + '|' + g; if (MEMO['f' + g + 'K'] === k) return MEMO['f' + g];
      MEMO['f' + g + 'K'] = k; MEMO['f' + g] = this.facetCalc(g); return MEMO['f' + g];
    },
    facetCalc: function (g) {
      var self = this, n = {};
      this.base.forEach(function (x) {
        if (!self.pass(x, g)) return;
        if (g === 'cat') n[x[3]] = (n[x[3]] || 0) + 1;
        else if (g === 'brand') { var b = x[4] || 'Other'; n[b] = (n[b] || 0) + 1; }
        else if (g === 'eng') (x[6] || '').split('').forEach(function (e) { n[e] = (n[e] || 0) + 1; });
        else if (g === 'photo') { if (self.img(x[0])) n.y = (n.y || 0) + 1; }
        else if (g === 'stock') { if (self.qty(x[0]) > 0) n.y = (n.y || 0) + 1; }
      });
      return n;
    },
    get fCats() { var n = this.facet('cat'), f = this.f; return CATS.map(function (c) { return { k: c.k, label: c.label, n: n[c.k] || 0 }; }).filter(function (c) { return c.n || f.cat.indexOf(c.k) >= 0; }); },
    get fBrands() {
      var n = this.facet('brand'), f = this.f, all = Object.keys(n).filter(function (b) { return b !== 'Other'; }).sort(function (a, b) { return n[b] - n[a]; });
      f.brand.forEach(function (b) { if (all.indexOf(b) < 0) all.push(b); });
      var list = all.map(function (b) { return { k: b, label: b, n: n[b] || 0 }; });
      return { more: list.length > 8, items: this.allBrands ? list : list.slice(0, 8) };
    },
    get fEngs() { var n = this.facet('eng'); return ENG.map(function (e) { return { k: e.k, label: e.label, n: n[e.k] || 0 }; }); },
    get fCount() { var f = this.f; return f.cat.length + f.brand.length + f.eng.length + (f.photo ? 1 : 0) + (f.stock ? 1 : 0) + (f.out ? 1 : 0); },
    get chips() {
      var f = this.f, out = [];
      f.cat.forEach(function (k) { var c = CATS.filter(function (x) { return x.k === k; })[0]; out.push({ g: 'cat', k: k, label: c ? c.label : k }); });
      f.brand.forEach(function (k) { out.push({ g: 'brand', k: k, label: k }); });
      f.eng.forEach(function (k) { out.push({ g: 'eng', k: k, label: ENG.filter(function (e) { return e.k === k; })[0].label }); });
      if (this.route === 'g') { var gg = this.genOf(this.arg); out.unshift({ g: 'veh', label: gg ? gg.label + ' ' + (gg.years || '') : 'Vehicle' }); }
      if (f.photo) out.push({ g: 'photo', label: 'With photo' });
      if (f.stock) out.push({ g: 'stock', label: 'In stock' });
      if (f.out) out.push({ g: 'out', label: 'Out of stock' });
      return out;
    },
    get sug() { var q = this.qInput.trim(); if (q.length < 2 || !this.cat.length) return []; return matchSearch(this.cat, q).slice(0, 8); },
    get moreRow() {
      var self = this, out = [], feat = this.featured;
      ['Pump', 'Tool', 'Nozzle'].forEach(function (k) { var n = 0; self.cat.some(function (r) { if (r[3] === k && self.hasImg(r[0]) && out.indexOf(r) < 0 && feat.indexOf(r) < 0) { out.push(r); n++; } return n >= (k === 'Pump' ? 2 : 1); }); });
      this.cat.some(function (r) { if (out.length >= 8) return true; if (self.hasImg(r[0]) && r[3] !== 'Injector' && out.indexOf(r) < 0 && feat.indexOf(r) < 0) out.push(r); return false; });
      return out.slice(0, 8);
    },
    get shown() { return this.results.slice(0, this.limit); },
    get product() { return this.route === 'p' ? this.map[this.arg] || null : null; },
    get related() {
      var self = this, p = this.product; if (!p) return [];
      var sr = this.spec && this.spec.rel ? this.spec.rel.split(/\s*,\s*/) : [], codes = (this.fit.rel[p[0]] || []).concat(sr, (this.buy && this.buy[p[0]]) || []), seen = {};
      return codes.filter(function (c) { if (seen[c] || c === p[0]) return false; seen[c] = 1; return true; }).map(function (c) { return self.map[c]; }).filter(Boolean).slice(0, 8);
    },
    // cross-sell on the cart and quote list: bought-together history first, then parts for the same vehicles and engines in complementary categories
    get forgot() {
      var self = this, codes = this.lines.map(function (l) { return l.code; }), key = codes.join('|') + '#' + (this.buy ? Object.keys(this.buy).length : 0) + '#' + this.cat.length;
      if (FGC.k === key) return FGC.v;
      var COMP = { Injector: ['Repair part', 'Nozzle', 'Kit', 'Fluid', 'Tool'], Pump: ['Repair part', 'Rail', 'Kit', 'Injector'], Nozzle: ['Repair part', 'Injector', 'Tool'], Rail: ['Repair part', 'Pump', 'Injector'], 'Repair part': ['Injector', 'Nozzle', 'Tool'], Tool: ['Repair part', 'Fluid'], Fluid: ['Tool', 'Kit'], Kit: ['Fluid', 'Repair part', 'Tool'], 'Engine parts': ['Injector', 'Repair part'] };
      var mine = codes.map(function (c) { return self.map[c]; }).filter(Boolean), have = {}, sc = {};
      var etok = function (t) { return String(t || '').toUpperCase().replace(/\u2011/g, '-').split(/[^A-Z0-9.]+/).filter(function (w) { return /\d/.test(w) && /[A-Z]/.test(w) && w.length >= 3 && !/^\d{4}$/.test(w); }); };
      codes.forEach(function (c) { have[c] = 1; });
      var bump = function (c, n) { if (!c || have[c] || !self.map[c]) return; sc[c] = (sc[c] || 0) + n; };
      mine.forEach(function (p) {
        ((self.buy && self.buy[p[0]]) || []).forEach(function (c) { bump(c, 6); });
        (self.fit.rel[p[0]] || []).forEach(function (c) { bump(c, 5); });
        var comp = COMP[p[3]] || [], f = self.fit.items[p[0]], gens = f ? f[0] : [], eng = String(p[6] || ''); var et = etok(self.title(p));
        self.cat.forEach(function (r) {
          if (have[r[0]] || comp.indexOf(r[3]) < 0) return;
          var g = gens.length && self.fit.items[r[0]];
          if (g && g[0].some(function (k) { return gens.indexOf(k) >= 0; })) bump(r[0], 3 - comp.indexOf(r[3]) * 0.2);
          else if (eng && r[6] && String(r[6]).split('').some(function (k) { return eng.indexOf(k) >= 0; }) && etok(self.title(r)).some(function (t) { return et.indexOf(t) >= 0; })) bump(r[0], 2 - comp.indexOf(r[3]) * 0.1);
        });
      });
      var out = Object.keys(sc).map(function (c) { var r = self.map[c]; return [sc[c] + (self.img(c) ? 1 : 0) + (self.specs && self.specs[c] ? 0.5 : 0), r]; })
        .sort(function (a, b) { return b[0] - a[0]; }), cats = {}, pick = [];
      out.forEach(function (x) { if (pick.length >= 8) return; var k = x[1][3]; if ((cats[k] || 0) >= 3) return; cats[k] = (cats[k] || 0) + 1; pick.push(x[1]); });
      FGC.k = key; FGC.v = pick; return pick;
    },
    get savedShip() {
      var acc = this.me && this.me.account, a = acc && acc.ship;
      if (a && typeof a === 'string') return { street: a, city: '', state: '', zip: '', country: '' };
      if (a && (a.street || a.city)) return a;
      var c = this.co; if (c && c.street) return { street: c.street, city: c.city, state: c.state, zip: c.zip, country: c.country };
      return null;
    },
    shipLine: function (a) { return a ? [a.street, a.city, [a.state, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ') : ''; },
    get qShip() {
      var d = this.qd, sv = this.savedShip;
      if (this.me && sv && d.dest !== 'other') return { street: sv.street || '', city: sv.city || '', state: sv.state || '', zip: sv.zip || '', country: sv.country || d.country };
      return { street: d.street, city: d.city, state: '', zip: '', country: d.country };
    },
    get ordersSorted() { return (this.orders || []).slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); }); },
    get relShown() { var r = this.related, n = r.length >= 8 ? 8 : r.length >= 4 ? 4 : r.length; return r.slice(0, n); },
    get buyAgain() {
      var seen = {}, out = [], self = this;
      (this.orders || []).forEach(function (o) { (o.lines || []).forEach(function (l) { if (!seen[l.code] && self.map[l.code]) { seen[l.code] = 1; out.push(self.map[l.code]); } }); });
      return out.slice(0, 4);
    },
    addAll: function (list) {
      var self = this, nq = 0, nc = 0;
      list.forEach(function (r) {
        var c = r[0];
        if (self.canOrder && self.price(c) != null) { if (!self.inCart(c)) { self.cart.push({ code: c, qty: 1 }); nc++; } }
        else if (!self.inQuote(c)) { self.quote.push({ id: c, name: r[1], pn: c, app: r[3], cat: r[3], slug: r[2], img: '', pos: '', qty: 1 }); nq++; }
      });
      this.save(); write(QK, this.quote); this.pop();
      this.flash((nc ? nc + ' added to your cart' : '') + (nc && nq ? ', ' : '') + (nq ? nq + ' added to your quote list' : '') || 'Already in your list', nc ? 'cart' : 'quote');
    },
    get tab() { return this.dtab || (this.spec.desc ? 'ov' : 'sp'); },
    get pr() { return this.product || ['', '', '', '', '', '', '']; },
    // order flow (cart > shipping > review > order page) and quote flow (list > details > review > done)
    qUnits: function (q) { return (q.lines || []).reduce(function (a, l) { return a + (l.qty || 0); }, 0); },
    qStat: function (q) { var m = { Draft: ['In review', 'Parked', 2], Pending: ['Quote sent', 'Quoted', 3], Open: ['Quote sent', 'Quoted', 3], Accepted: ['Accepted', 'Accepted', 4], Completed: ['Ordered', 'Ordered', 5], Deleted: ['Closed', 'Closed', 1] }[q.ulStatus] || ['In review', 'Parked', 2]; return { t: m[0], c: m[1], at: m[2] }; },
    requote: function (q) { var self = this; (q.lines || []).forEach(function (l) { if (self.map[l.pn]) self.addQuote(l.pn, l.qty); }); this.flash('Parts added to your quote list', 'quote'); },
    // print the document only, with a file name the PDF dialog uses: "Maxzz Diesel Quote request MXQ-10005 Company 2026-11-15"
    printDoc: function () {
      var d = this.route === 'o' && this.cur ? { kind: 'order', number: this.cur.number } : this.doc, acc = this.me && this.me.account;
      var co = acc ? acc.company : (this.qd.company || ''), t = new Date(), ymd = t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
      var name = ['Maxzz Diesel', d && d.kind === 'order' ? 'Order' : 'Quote request', d && d.number && !/confirmation/i.test(d.number) ? d.number : '', co, ymd].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, '-');
      var old = document.title, html = document.documentElement;
      document.title = name; html.classList.add('px-printing');
      var done = function () { document.title = old; html.classList.remove('px-printing'); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done); setTimeout(function () { window.print(); setTimeout(done, 1500); }, 50);
      track('quote_pdf', { kind: d && d.kind || '' });
    },
    get extras() { return (this.route === 'quote' || this.route === 'cart') && this.arg === 'extras'; },
    get inFlow() { var r = this.route; return (r === 'quote') || ((r === 'cart' || r === 'checkout') && this.canOrder); },
    get flow() { return this.route === 'quote' ? 'quote' : 'order'; },
    get step() {
      if (this.route === 'quote') return this.qSent ? 4 : this.arg === 'review' ? 3 : this.arg === 'details' ? 2 : 1;
      if (this.route === 'checkout') return this.arg === 'review' ? 3 : 2;
      return 1;
    },
    get lines() { return this.flow === 'quote' ? this.quote.map(function (l, i) { return { code: l.id, qty: l.qty, i: i }; }) : this.cart.map(function (l, i) { return { code: l.code, qty: l.qty, i: i }; }); },
    get units() { return this.lines.reduce(function (a, l) { return a + l.qty; }, 0); },
    get showPrice() { return this.logged && !!this.book; },
    get noPriceN() { var self = this; return this.lines.filter(function (l) { return self.price(l.code) == null; }).length; },
    get subLabel() { var n = this.noPriceN; if (n && n === this.lines.length) return 'Prices confirmed by sales'; return 'Subtotal ' + this.fmt(this.flowTotal) + (n ? ' · ' + n + (n === 1 ? ' part' : ' parts') + ' priced by sales' : ''); },
    get flowTotal() { var self = this; return this.lines.reduce(function (a, l) { return a + (self.price(l.code) || 0) * l.qty; }, 0); },
    get doc() {
      var self = this, me = this.me, acc = me && me.account, now = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      var who = function () { return me ? [(me.name || self.firstName), acc ? acc.company + (acc.code ? ' · ' + acc.code : '') : 'Maxzz Diesel team', me.email] : [self.qd.name, self.qd.company, self.qd.email, self.qd.phone]; };
      if (this.route === 'o' && this.cur) {
        var o = this.cur, sh = o.ship || {};
        return { kind: 'order', number: o.number, email: o.by || (me && me.email), billTo: who().filter(Boolean),
          shipTo: /will call/i.test(sh.method || '') ? ['Will call', 'Pick up in Coconut Creek, FL'] : [sh.name, sh.street, [sh.city, sh.state, sh.zip].filter(Boolean).join(', '), sh.country].filter(Boolean),
          refs: ['Date ' + this.date(o.created), o.po ? 'PO ' + o.po : 'No PO', sh.method || '', o.unleashedNumber ? 'Ref ' + o.unleashedNumber : ''].filter(Boolean),
          lines: o.lines.map(function (l) { return { code: l.code, name: self.name(l.code) || l.name, qty: l.qty, price: l.price }; }), priced: true, total: o.total, units: o.lines.reduce(function (a, l) { return a + l.qty; }, 0), notes: o.notes };
      }
      if (this.route === 'quote' && this.qSent) {
        var q = this.qSent;
        return { kind: 'quote', number: q.id, email: q.email, billTo: q.from, shipTo: q.ship, refs: q.refs, lines: q.lines, priced: false, units: q.lines.reduce(function (a, l) { return a + l.qty; }, 0), notes: q.notes };
      }
      if (this.step !== 3) return DOC0;
      var ls = this.lines.map(function (l) { return { code: l.code, name: self.name(l.code), qty: l.qty, price: self.price(l.code) }; });
      if (this.flow === 'order') {
        var c = this.co;
        return { kind: 'order', number: 'Number on confirmation', email: me && me.email, billTo: who().filter(Boolean),
          shipTo: this.pickup ? ['Will call', 'Pick up in Coconut Creek, FL'] : [c.name, c.street, [c.city, c.state, c.zip].filter(Boolean).join(', '), c.country, c.fwd ? 'Forwarder: ' + c.fwd : ''].filter(Boolean),
          refs: ['Date ' + now, c.po ? 'PO ' + c.po : 'No PO', c.method].filter(Boolean), lines: ls, priced: true, total: this.flowTotal, units: this.units, notes: c.notes };
      }
      var d = this.qd;
      return { kind: 'quote', number: 'Number on confirmation', email: me ? me.email : d.email, billTo: who().filter(Boolean),
        shipTo: me ? [acc ? acc.company : '', this.qShip.street, [this.qShip.city, this.qShip.state, this.qShip.zip].filter(Boolean).join(', '), this.qShip.country].filter(Boolean) : [d.company, d.city, d.country].filter(Boolean), refs: ['Date ' + now, d.po ? 'PO ' + d.po : 'No PO', d.needBy ? 'Needed by ' + d.needBy : ''].filter(Boolean),
        lines: ls, priced: this.showPrice && this.noPriceN < this.lines.length, total: this.flowTotal, units: this.units, notes: d.notes };
    },
    setLn: function (i, n) { if (String(n).trim() === '' || isNaN(parseInt(n, 10))) return; n = parseInt(n, 10) || 0; if (this.flow === 'quote') return this.qSet(i, n); if (n <= 0) this.remove(i); else { this.cart[i].qty = Math.min(9999, n); this.save(); } },
    moveToQuote: function (i) { var c = this.cart[i]; if (!c) return; this.addQuote(c.code); var l = this.quote.filter(function (x) { return x.id === c.code; })[0]; if (l) { l.qty = c.qty; write(QK, this.quote); } this.remove(i); this.flash('Moved to your quote list (' + c.qty + (c.qty === 1 ? ' unit' : ' units') + ')', 'quote'); },
    clearFlow: function () { if (!confirm('Remove every part from this list?')) return; if (this.flow === 'quote') { this.quote.splice(0); write(QK, []); } else this.clearCart(); },
    next: function () {
      this.err = '';
      if (this.step === 1) {
        if (this.flow === 'order' && this.noPriceLines.length) { this.err = ''; this.flash('Move the parts without online price to a quote first'); return; }
        if (!this.extras && this.forgot.length) { this.exBase = this.lines.length; return this.nav(this.flow === 'order' ? 'cart' : 'quote', 'extras'); }
        return this.nav(this.flow === 'order' ? 'checkout' : 'quote', this.flow === 'order' ? '' : 'details');
      }
      if (this.step === 2) {
        if (this.flow === 'order' && !this.pickup && (!this.co.street.trim() || !this.co.city.trim())) { this.err = 'Fill in the street address and city, or choose Will call.'; return; }
        if (this.flow === 'order' && !this.pickup && /United States|Puerto Rico|Canada/.test(this.co.country || '') && (!String(this.co.state || '').trim() || !String(this.co.zip || '').trim())) { this.coTried = true; var ms = !String(this.co.state || '').trim(), mz = !String(this.co.zip || '').trim(); this.err = 'Fill in the ' + (ms && mz ? 'state and ZIP code' : ms ? 'state' : 'ZIP code') + ', or choose Will call.'; var co = this.co; setTimeout(function () { var el = document.querySelector(!String(co.state || '').trim() ? '[autocomplete=address-level1]' : '[autocomplete=postal-code]'); if (el) el.focus(); }, 30); return; }
        if (this.flow === 'quote' && this.me && this.qd.phone && this.qd.phone.replace(/\D/g, '').length < 7) { this.err = 'Check the phone number, or leave it empty.'; return; }
        if (this.flow === 'quote' && !this.me) { var d = this.qd; if (!d.name.trim() || !d.company.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) || d.phone.replace(/\D/g, '').length < 7) { this.err = 'Fill in name, company, e-mail and phone.'; return; } }
        return this.nav(this.flow === 'order' ? 'checkout' : 'quote', 'review');
      }
    },
    confirmFlow: function () { return this.flow === 'order' ? this.placeOrder() : this.sendQuote(); },
    get adminBar() { return !!(this.me && this.me.admin && this.pendingCount); },
    // what the customer follows after sending: the number and the stages it goes through
    get track() {
      var d = this.doc; if (!d || d.none) return TRK0;
      if (d.kind === 'order') {
        var st = this.cur ? this.stepOf(this.cur) : 1;
        return { label: 'Your order number', steps: ['Order placed', 'In review', 'Approved', 'Shipped', 'Invoiced'], at: st };
      }
      return { label: 'Your quote number', steps: ['Request sent', 'In review', 'Quote sent to you', 'Accepted', 'Shipped'], at: 1 };
    },
    get hi() { return this.firstName ? this.firstName + ', ' : ''; },
    get usPhone() { return NANP.test(this.rq.country); },
    get zipLabel() { return this.rq.country === 'Brazil' ? 'CEP' : /United States|Puerto Rico/.test(this.rq.country) ? 'ZIP' : 'Postal code'; },
    okEmail: function (e) { return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(e || '').trim()); },
    okPhone: function (p) { return String(p || '').replace(/\D/g, '').length >= 10; },
    // country from an international dial code (+55 Brazil...), only while the select is still on a NANP default
    dialCountry: function (v, cur) {
      var r = String(v || '').replace(/[^\d+]/g, ''); if (r.charAt(0) !== '+' || !NANP.test(cur)) return cur;
      var d = r.slice(1); for (var n = 3; n >= 2; n--) if (DIAL[d.slice(0, n)]) { if (!this.autoC) this.autoPrev = cur; this.autoC = DIAL[d.slice(0, n)]; return this.autoC; }
      return cur;
    },
    // phone formatting while typing; final (on blur) adds the country's dial code to a local LATAM number
    // phone field input: a typed dial code may pick the country
    phoneIn: function (o) {
      o.country = this.dialCountry(o.phone, o.country); o.phone = this.maskPhone(o.phone, o.country);
    },
    maskPhone: function (v, country, final) {
      var d = String(v || '').replace(/\D/g, ''), raw = String(v || '').replace(/^\s+/, '');
      if (!raw) return '';
      if (raw === '+') return '+';
      if (/^00[1-9]/.test(d) && !/^\+/.test(raw)) { raw = '+' + raw.replace(/^\s*00/, ''); d = d.slice(2); }
      if (raw.charAt(0) === '+') return '+' + raw.slice(1).replace(/[^\d\s\-]/g, '').replace(/\s{2,}/g, ' ').slice(0, 22);
      var us = country ? NANP.test(country) : this.usPhone;
      if (us) {
        if (final && /Dominican/.test(country) && d.length === 10) return '+1' + d;
        if (d.length === 11 && d[0] === '1' && /[2-9]/.test(d[1])) d = d.slice(1);
        if (d.length > 10) return d[0] === '1' ? d.slice(0, 15) : '+' + d.slice(0, 15);
        if (d.length < 4) return d; if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3); return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
      }
      if (!final) return raw.replace(/[^\d\s()\-.]/g, '').slice(0, 22);
      var code = ''; Object.keys(DIAL).forEach(function (k) { if (DIAL[k] === country) code = k; });
      if (!d) return '';
      if (!code) return raw.slice(0, 22);
      var full = code && d.indexOf(code) === 0 && d.length > (NAT[country] || 10);
      return '+' + (code && !full ? code + d.replace(/^0+/, '') : d).slice(0, 15);
    },
    rqNext: function () { this.rqTried = true; var r = this.rq; if (!r.name.trim() || !this.okEmail(r.email) || !this.okPhone(r.phone)) { setTimeout(function () { var b = document.querySelector('.px-stage .bad input, .px-stage input.bad, .px-stage [aria-invalid=true]'); if (b) b.focus(); }, 30); return; } this.rqStep = 2; setTimeout(function () { var c = document.querySelector('[autocomplete=organization]'); if (c) c.focus(); }, 60); },
    rqZip: function () {
      var self = this, r = this.rq, z = String(r.zip || '').trim(), c = r.country, url = '', br = false;
      clearTimeout(this._zt); this.zipMsg = '';
      if (/United States|Puerto Rico/.test(c) && /^\d{5}$/.test(z)) url = 'https://api.zippopotam.us/us/' + z;
      else if (c === 'Canada' && /^[A-Za-z]\d[A-Za-z]/.test(z)) url = 'https://api.zippopotam.us/ca/' + z.slice(0, 3).toUpperCase();
      else if (c === 'Mexico' && /^\d{5}$/.test(z)) url = 'https://api.zippopotam.us/mx/' + z;
      else if (c === 'Brazil' && /^\d{5}-?\d{3}$/.test(z)) { url = 'https://viacep.com.br/ws/' + z.replace('-', '') + '/json/'; br = true; }
      if (!url) return;
      this._zt = setTimeout(function () {
        fetch(url).then(function (x) { if (!x.ok) throw 0; return x.json(); }).then(function (x) {
          var city = '', st = '';
          if (br) { if (x.erro) throw 0; city = x.localidade; st = x.uf; } else { var pl = (x.places || [])[0] || {}; city = pl['place name'] || ''; st = pl['state abbreviation'] || pl.state || ''; }
          if (city) { r.city = city; r.state = st; self.zipMsg = ''; }
        }).catch(function () { self.zipMsg = ''; });
      }, 300);
    },
    get lp() { return ['request', 'login', 'sent', 'requested', 'pending'].indexOf(this.route) >= 0; },
    get needLogin() { var r = this.route; if (r === 'admin') return !(this.me && this.me.admin); if (r === 'orders') return !this.me && this.meLoaded; return ['cart', 'checkout', 'o'].indexOf(r) >= 0 && !this.canOrder && this.meLoaded; },
    get noPriceLines() { var self = this; return this.cart.filter(function (l) { return self.price(l.code) == null; }).map(function (l) { return l.code; }); },
    get pickup() { return /will call/i.test(this.co.method); },
    get blurb() {
      var p = this.product; if (!p) return '';
      var sp = this.spec, d = sp.desc ? String(sp.desc).split('</p>')[0].replace(/<[^>]+>/g, '').replace(/[^.]*\bships from our [^.]*\.\s*/i, ' ').trim() : '';
      if (d) return d;
      var i = parse(p[1]), type = (sp.type || p[3] || '').toLowerCase();
      if (!p[4] && !i.app && !i.xr.length) return '';
      return [p[4], type].filter(Boolean).join(' ').replace(/^./, function (c) { return c.toUpperCase(); }) + (i.app ? ' for ' + i.app : '') + '.' + (i.xr.length ? ' Same as ' + i.xr.slice(0, 3).join(', ') + '.' : '');
    },
    get spec() { var p = this.product; return (p && this.specs && this.specs[p[0]]) || {}; },
    get keyFacts() {
      var p = this.product, sp = this.spec || {}, i = parse(p && p[1]), out = [];
      if (!p) return out;
      if (sp.eng) out.push(['Engine', nice(sp.eng)]);
      if (sp.models) out.push(['Vehicles', sp.models]);
      if (!sp.eng && i.app) out.push(['Application', nice(i.app)]);
      if (sp.inj) out.push(['Used in', sp.inj]);
      if (p[4]) out.push(['Brand', p[4]]);
      if (sp.cond) out.push(['Condition', sp.cond]);
      if (this.xrefs.length) out.push(['Cross references', this.xrefs.length + (this.xrefs.length === 1 ? ' number' : ' numbers') + ', see below']);
      return out;
    },
    get specRows() {
      var p = this.product, sp = this.spec || {}, i = parse(p && p[1]), r = [];
      if (!p) return r;
      r.push(['Maxzz part number', p[0]]);
      var pn = p[0].replace(/^[A-Z]{2,4}[.\-]/, '');
      r.push(['Manufacturer part number', pn]);
      if (p[4]) r.push(['Brand', p[4]]);
      r.push(['Part type', sp.type || p[3]]);
      if (sp.cond) r.push(['Condition', sp.cond]);
      if (sp.eng) r.push(['Engine / generation', nice(sp.eng)]);
      if (sp.make) r.push(['Vehicle make', sp.make]);
      if (sp.y0) r.push(['Model years', sp.y0 + (sp.y1 ? ' to ' + sp.y1 : ' to today')]);
      if (sp.models) r.push(['Vehicles', sp.models]);
      if (sp.inj) r.push(['Used in injectors', sp.inj]);
      if (!sp.eng && i.app) r.push(['Application', nice(i.app)]);
      var u = this.book && this.book.items[p[0]] && this.book.items[p[0]][3]; if (u) r.push(['Unit', u]);

      return r;
    },
    get appRows() {
      var self = this, p = this.product, sp = this.spec || {}, out = [];
      if (!p) return out;
      this.fits.forEach(function (g) { out.push({ t: g.label + ' ' + (g.years || ''), d: sp.models || '', g: g.key }); });
      if (!out.length && sp.fit) sp.fit.split(/\s*;\s*|\n/).forEach(function (f) { if (f) out.push({ t: f, d: '' }); });
      if (!out.length) { var a = parse(p[1]).app; if (a) out.push({ t: a, d: 'From the catalog description' }); }
      return out;
    },
    get xrefs() {
      var self = this, p = this.product; if (!p) return [];
      var seen = {}, out = [], add = function (n, t) { var k = norm(n); if (!k || seen[k] || k === norm(p[0]).replace(/^[A-Z]{2}/, '')) return; seen[k] = 1; var hit = self.find(n); out.push({ n: n, t: t, code: hit && hit !== p[0] ? hit : null }); };
      parse(p[1]).xr.forEach(function (x) { add(x, 'Equivalent'); });
      var sp = this.spec; if (sp.eq) sp.eq.split(/\s*[,;]\s*/).forEach(function (x) { add(x, 'Equivalent'); });
      this.interch.forEach(function (r) { add(r[0], 'Interchangeable (in stock list)'); });
      return out;
    },
    get faqs() {
      var sp = this.spec; if (!sp.faq) return [];
      var out = [], cur = null;
      sp.faq.split('\n').forEach(function (l) { l = l.trim(); if (/^Q:/.test(l)) { cur = { q: l.slice(2).trim(), a: '' }; out.push(cur); } else if (/^A:/.test(l) && cur) cur.a = l.slice(2).trim(); else if (cur && l) cur.a += ' ' + l; });
      return out;
    },
    get fits() { var self = this, p = this.product, f = p && this.fit.items[p[0]]; if (!f) return []; return f[0].map(function (k) { return self.genOf(k); }).filter(Boolean); },
    get subtotal() { var self = this; return this.cart.reduce(function (a, l) { return a + self.lineTotal(l); }, 0); },

    init: function () {
      var self = this, h = location.search;
      if (/e=link/.test(h)) this.err = 'That sign-in link expired or was already used. Ask for a new one below.';
      if (/e=access/.test(h)) this.err = 'Your access is not approved yet.';
      var iv = h.match(/[?&]iv=([^&]+)/);
      if (iv) { this.iv = { t: decodeURIComponent(iv[1]), info: null, agree: false, name: '' }; location.hash = '#/login'; api('invite-info?t=' + encodeURIComponent(this.iv.t)).then(function (r) { if (r._status === 200) { self.iv.info = r; self.iv.name = r.name || ''; } else { self.iv = null; self.err = 'That invitation link expired or was already used. Ask us for a new one.'; } }); }
      var lt = h.match(/[?&]lt=([^&]+)/);
      if (lt) { this.lt = decodeURIComponent(lt[1]); location.hash = '#/login'; }
      if (h) history.replaceState(null, '', location.pathname + location.hash);
      fetch('/api/catalog').then(function (r) { return r.json(); }).then(function (rows) { self.cat = rows; var m = {}; rows.forEach(function (r) { m[r[0]] = r; if (!r[4]) { var bp = String(r[0]).match(/^([A-Z]{2,3})[.\-]/); if (bp && BRP[bp[1]]) r[4] = BRP[bp[1]]; } }); self.map = m; if (self.route === 'p' && !m[self.arg]) self.fixPart(); });
      fetch('/data/fitment.json?v=1').then(function (r) { return r.json(); }).then(function (f) { self.fit = f; }).catch(function () {});
      fetch('/data/specs.json?v=1').then(function (r) { return r.json(); }).then(function (d) { self.specs = d; }).catch(function () {});
      fetch('/api/portal/images').then(function (r) { return r.json(); }).then(function (m) { self.imgs = m || {}; }).catch(function () {});
      api('me').then(function (me) {
        self.meLoaded = true;
        if (me._status === 200) {
          self.me = me;
          if (read('mx-portal-who', '') !== me.email) { forget(); self.cart = []; self.recent = []; self.co.street = self.co.city = self.co.state = self.co.zip = self.co.fwd = ''; }
          write('mx-portal-who', me.email);
          if (self.logged && (self.route === 'login' || self.route === 'request')) location.replace('#/');
          if (me.account) self.co.name = me.account.company;
          api('prices').then(function (b) { if (b._status === 200) self.book = b; });
          if (me.account) api('orders').then(function (o) { if (o.orders) { self.orders = o.orders; if (self.route === 'o') self.cur = o.orders.filter(function (x) { return x.id === self.arg; })[0] || null; } self.ordersLoaded = true; });
          if (me.admin) self.loadAdmin();
          api('quotes').then(function (q) { if (q.quotes) self.myQuotes = q.quotes; });
        } else if (me._status === 401) forget();
      });
      window.addEventListener('hashchange', function () { self.readHash(); });
      // account menu: close on a click outside it, on Escape and on navigation
      var closeMenus = function (e) { [].forEach.call(document.querySelectorAll('details.pxh-me[open]'), function (d) { if (!e || !d.contains(e.target)) d.removeAttribute('open'); }); };
      document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.pxh-menu a, .pxh-menu button')) { var d = e.target.closest('details'); if (d) d.removeAttribute('open'); return; } closeMenus(e); }); window.addEventListener('hashchange', function () { closeMenus(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });
      document.addEventListener('click', function (e) { if (self.vMake && e.target.closest && !e.target.closest('.px-makes, .px-engs-w')) self.vMake = ''; });
      window.addEventListener('scroll', function () { if (!self.sugOn) return; var a = document.activeElement; if (!a || !a.getBoundingClientRect) return; var b = a.getBoundingClientRect(); if (b.bottom < 90 || b.top > window.innerHeight) { self.sugOn = false; a.blur && a.blur(); } }, { passive: true });
      // mobile product page: the sticky buy bar shows only once the buy box has scrolled out of view
      var mb = function () { if (self.route !== 'p') { if (self.mbarOn) self.mbarOn = false; return; } var el = document.querySelector('.px-pd-info .px-qrow'); var on = !!el && el.getBoundingClientRect().bottom < 70; if (on !== self.mbarOn) self.mbarOn = on; };
      window.addEventListener('scroll', mb, { passive: true }); window.addEventListener('resize', function () { mb(); var n = window.innerWidth <= 760; if (n !== self.narrow) self.narrow = n; });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (self.qOpen) self.qClose(); self.showF = false; if (self.vMake) self.vMake = ''; } });
      this.readHash();
    },
    readHash: function () {
      var raw = (location.hash || '').replace(/^#\/?/, ''), h; try { h = decodeURIComponent(raw); } catch (e) { h = raw; }
      var i = h.indexOf('/');
      var r = i < 0 ? h : h.slice(0, i), a = i < 0 ? '' : h.slice(i + 1);
      this.vMake = '';
      if (r && ROUTES.indexOf(r) < 0) { location.replace('#/'); return; }
      if (r === 'c') { var lc = String(a).toLowerCase(), hit = CATS.filter(function (c) { return c.k.toLowerCase() === lc || c.label.toLowerCase() === lc || c.label.toLowerCase().replace(/s$/, '') === lc; })[0];
        if (!hit) { location.replace('#/all'); return; } if (hit.k !== a) { location.replace('#/c/' + encodeURIComponent(hit.k)); return; } }
      track('portal_view', { portal_route: r || 'home' }); if (r === 's' && a) track('search', { search_term: String(a).slice(0, 80), source: 'store' }); if (r === 'p' && a) track('view_item', { item_id: a, source: 'store' });
      this.route = r || 'home'; this.arg = a; this.err = ''; this.limit = 24; this.sugOn = false; this.showF = false; this.mbarOn = false;
      this.qInput = r === 's' ? a : '';
      if ((r === 'login' || r === 'request') && this.logged) { location.replace('#/'); return; }
      if (r === 'g' && this.fit.tree.length && !this.genOf(a)) { location.replace('#/all'); return; }
      if (r === 'c') this.f = { cat: [a], brand: [], eng: [], photo: false, stock: false, out: false };
      if (r === 's' || r === 'g' || r === 'all' || !r) this.f = { cat: [], brand: [], eng: [], photo: false, stock: false, out: false };
      if (r === 'orders' && this.me) { var s3 = this; api('quotes').then(function (q) { if (q.quotes) s3.myQuotes = q.quotes; }); }
      if (r === 'orders' && this.me && this.me.account) { var self = this; api('orders').then(function (o) { if (o.orders) self.orders = o.orders; }); }
      if (r === 'o') this.cur = this.orders.filter(function (o) { return o.id === a; })[0] || null;
      if (r === 'checkout' && !this.cart.length) { location.hash = '#/cart'; return; }
      if ((r === 'quote' || r === 'cart') && a === 'extras') { if (!(r === 'quote' ? this.quote : this.cart).length) { location.hash = '#/' + r; return; } if (!this.exBase) this.exBase = (r === 'quote' ? this.quote : this.cart).length; }
      if (r === 'quote' && a && !this.quote.length && !this.qSent) { location.hash = '#/quote'; return; }
      this.qOpen = false; if (r !== 'quote') this.qSent = null;
      if (r === 'quote' && this.me) { var acc = this.me.account; if (!this.qd.email) this.qd.email = this.me.email; if (!this.qd.name) this.qd.name = this.me.name || ''; if (!this.qd.company && acc) this.qd.company = acc.company; }
      if ((r === 'p' || r === 'cart' || r === 'quote') && !this.buy) { var me3 = this; this.buy = {}; api('related').then(function (j) { if (j && j.rel) me3.buy = j.rel; }); }
      if (r === 'p' && !this.specs) { var me2 = this; this.specs = {}; fetch('/data/specs.json?v=1').then(function (x) { return x.json(); }).then(function (d) { me2.specs = d; }).catch(function () {}); }
      if (r === 'p') this.dtab = '';
      if (r === 'p' && a && this.cat.length && !this.map[a] && this.fixPart()) return;
      if (r === 'p' && a) { var rc = this.recent.filter(function (c) { return c !== a; }); rc.unshift(a); this.recent = rc.slice(0, 12); write('mx-portal-recent', this.recent); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    // a product link typed loosely (no brand prefix, no dots, lowercase): go to the part, or to search when ambiguous
    fixPart: function () {
      var a = this.arg, nq = norm(a); if (nq.length < 4) return false;
      var hits = this.cat.filter(function (x) { var s = six(x); return s.c === nq || s.c2 === nq; });
      if (hits.length === 1) { location.replace('#/p/' + encodeURIComponent(hits[0][0])); return true; }
      if (hits.length > 1 || matchSearch(this.cat, a).length) { location.replace('#/s/' + encodeURIComponent(a)); return true; }
      return false;
    },
    nav: function (r, a) { location.hash = '#/' + r + (a ? '/' + encodeURIComponent(a) : ''); },
    search: function () {
      if (this.sugOn && this.sugI >= 0 && this.sug[this.sugI]) { this.nav('p', this.sug[this.sugI][0]); return; }
      var q = this.qInput.trim(); if (q.length < 2) return;
      var hit = this.cat.length ? exactHit(this.cat, q) : null; if (hit) { this.qInput = ''; this.nav('p', hit[0]); return; }
      this.nav('s', q);
    },
    sugKey: function (e) {
      var n = this.sug.length; if (!n) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.sugOn = true; this.sugI = (this.sugI + 1) % n; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.sugI = this.sugI <= 0 ? n - 1 : this.sugI - 1; }
      else if (e.key === 'Escape') { this.sugOn = false; this.sugI = -1; }
    },
    sugInput: function () { this.sugOn = true; this.sugI = -1; },
    sugBlur: function () { var self = this; setTimeout(function () { self.sugOn = false; }, 180); },
    // sidebar filters; on the home page a click opens the full list with that filter
    toggle: function (g, k) {
      if (g === 'veh') { this.nav('all'); return; }
      var f = this.f;
      if (g === 'photo' || g === 'stock' || g === 'out') f[g] = !f[g];
      else { var i = f[g].indexOf(k); if (i < 0) f[g].push(k); else f[g].splice(i, 1); }
      this.limit = 24;
      if (this.route === 'home' || (this.route === 'c' && !(f.cat.length === 1 && f.cat[0] === this.arg))) { history.pushState(null, '', '#/all'); this.route = 'all'; this.arg = ''; window.scrollTo({ top: 0, behavior: 'smooth' }); }
    },
    on: function (g, k) { return g === 'photo' || g === 'stock' || g === 'out' ? this.f[g] : this.f[g].indexOf(k) >= 0; },
    clearF: function () { this.f = { cat: [], brand: [], eng: [], photo: false, stock: false, out: false }; if (this.route === 'c') { history.replaceState(null, '', '#/all'); this.route = 'all'; } },
    genOf: function (key) { var out = null; this.fit.tree.forEach(function (m) { m.engines.forEach(function (e) { e.gens.forEach(function (g) { if (g.key === key) out = g; }); }); }); return out; },
    logos: function (k) { return { ford: ['ford.png'], ram: ['ram.png'], gm: ['chevrolet.svg', 'gmc.png'], nissan: ['nissan.svg'] }[k] || []; },
    pickMake: function (k) {
      this.vMake = this.vMake === k ? '' : k; if (this.vMake) this.vLast = this.vMake; this.vEng = '';
      if (this.vMake && window.innerWidth <= 760) setTimeout(function () { var el = document.querySelector('.px-engs-w'); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' }); }, 60);
    },
    loadAdmin: function () { var self = this; api('admin-list').then(function (r) { if (r.sync) self.sync = r.sync; if (r.accounts) self.accounts = r.accounts.map(function (a) { return Object.assign(a, { _q: a.customerNumber || '', _res: null, _pick: null, _busy: false }); }); }); },

    // display helpers
    brandOf: function (r) { if (!r) return ''; if (r[4]) return r[4]; var m = String(r[0]).match(/^([A-Z]{2,3})[.\-]/); return m && BRP[m[1]] || ''; },
    info: function (r) { var i = parse(r && r[1]), sp = r && this.specs && this.specs[r[0]]; i.app = nice(sp && sp.eng ? sp.eng : i.app); if (/^bench \/ shop use$/i.test(i.app)) i.app = ''; return i; },
    // has a photo on file (ignores load failures, so shelves do not reshuffle; failed photos show the placeholder)
    hasImg: function (code) { if (BENCH[code]) return true; var u = this.imgs[code] || (this.book && this.book.items[code] && this.book.items[code][2]); return !!(u && /^https:/.test(u)); },
    img: function (code) { if (this.bad[code]) return ''; if (BENCH[code]) return BENCH[code]; var u = this.imgs[code] || (this.book && this.book.items[code] && this.book.items[code][2]); return u && /^https:/.test(u) ? u : ''; },
    price: function (code) { var p = this.book && this.book.items[code]; return p ? p[0] : null; },
    get hideOut() { return !!(this.logged && this.me && !this.me.admin && this.book); },
    noBuy: function (code) { return this.hideOut && this.hid(code); },
    hid: function (code) { var n = this.qty(code); return n != null && n <= 0; },
    qty: function (code) { var p = this.book && this.book.items[code]; return p ? p[1] : null; },
    stockClass: function (code) { var n = this.qty(code); return n == null || n <= 0 ? 'out' : n < 5 ? 'low' : ''; },
    stockText: function (code) { var n = this.qty(code); if (n == null) return 'Ask us'; if (n <= 0) return this.hideOut ? 'Unavailable, ask us' : 'Backorder'; return n < 5 ? 'Only ' + n + ' left' : 'In stock'; },
    name: function (code) { var r = this.map[code]; return r ? this.title(r) : code; },
    qClose: function () { var self = this; if (!this.qOpen || this.qClosing) return; this.qClosing = true; setTimeout(function () { self.qOpen = false; self.qClosing = false; var f = document.querySelector('.px-fab-b.red'); if (f) f.focus(); }, 210); },
    fmt: function (n) { return n == null ? (this.logged ? 'Price on request' : 'Ask us') : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    ago: function (t) { if (!t) return 'recently'; var m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; },
    date: function (t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); },
    label: function (s) { return { Received: 'Received', Parked: 'In review', Placed: 'Approved', Backordered: 'Backordered', Completed: 'Shipped and invoiced', Deleted: 'Cancelled' }[s] || s; },
    // tracker steps filled: Order placed, In review, Approved, Shipped, Invoiced (matches the status pill)
    stepOf: function (o) { return { Received: 1, Parked: 2, Placed: 3, Backordered: 3, Completed: 5 }[o.status] || 1; },
    bench: function (code) { return !!BENCH[code]; },
    title: function (r) {
      if (!r || !r[0]) return '';
      var sp = this.specs && this.specs[r[0]]; if (sp && sp.title) return nice(sp.title);
      if (TFIX[r[0]]) return TFIX[r[0]];
      var t = nice(parse(r[1]).title), letters = '', up = 0;
      if (t.split(/\s+/).length <= 3) { var br = this.brandOf(r), mpn = r[0].replace(/^[A-Z]{2,4}[.\-]/, ''), ap = nice(parse(r[1]).app); t = [br && t.toLowerCase().indexOf(br.toLowerCase()) < 0 ? br : '', mpn, t].filter(Boolean).join(' ') + (ap && ap.length < 60 ? ' for ' + ap : ''); }
      if (false) t = t.toLowerCase().replace(/\b([a-z])/g, function (c) { return c.toUpperCase(); }).replace(/\b(Gm|Hd|Cr|Hp|Ve|Usa|Dpf|Def|Egr|Nox|Scr|Isx|Isb|Isc|Isl|Qsb|Lml|Lmm|Lbz|Lly|Lb7|L5p|Cp3|Cp4|Ecm|Oem)\b/g, function (w) { return w.toUpperCase(); });
      return t.replace(/(\w)-(?=\w)/g, '$1\u2011');
    },
    icon: function (k) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[k] || '') + '</svg>'; },
    cartQty: function (code) { var l = this.cart.filter(function (x) { return x.code === code; })[0]; return l ? l.qty : 0; },
    inQuote: function (code) { return this.quote.some(function (x) { return x.id === code; }); },
    qSet: function (i, n) { n = parseInt(n, 10) || 0; if (n <= 0) this.quote.splice(i, 1); else this.quote[i].qty = Math.min(9999, n); write(QK, this.quote); },
    pts: function (code) { var p = this.price(code); return p == null ? 0 : Math.round(p * this.REWARDS.rate); },
    copy: function (txt) { var self = this; try { navigator.clipboard.writeText(txt).then(function () { self.flash('Part number copied'); }); } catch (e) {} },
    pick: function (code) { return this.picks[code] || 1; },
    setPick: function (code, v) { this.picks[code] = Math.max(1, Math.min(9999, parseInt(v, 10) || 1)); },

    // quote list (anonymous) and cart (signed in)
    // one stepper per product: before adding it picks the quantity, once in the quote it edits the quote line itself
    sq: function (code) { return this.inQuote(code) ? this.quoteQty(code) : this.pick(code); },
    sqSet: function (code, v) {
      if (String(v).trim() === '' || isNaN(parseInt(v, 10))) return;
      if (!this.inQuote(code)) return this.setPick(code, v);
      var n = parseInt(v, 10) || 0, i = -1; this.quote.forEach(function (x, j) { if (x.id === code) i = j; });
      if (i >= 0) { this.qSet(i, n); if (n <= 0) this.flash('Removed from your quote list'); }
    },
    openQuote: function () { this.qOpen = true; },
    // same pattern for the cart: once the part is in the cart the stepper edits the cart line
    cs: function (code) { return this.inCart(code) ? this.cartQty(code) : this.pick(code); },
    csSet: function (code, v) {
      if (String(v).trim() === '' || isNaN(parseInt(v, 10))) return;
      if (!this.inCart(code)) return this.setPick(code, v);
      var n = parseInt(v, 10) || 0, i = -1; this.cart.forEach(function (x, j) { if (x.code === code) i = j; });
      if (i >= 0) { this.setQty(i, n); if (n <= 0) this.flash('Removed from your cart'); }
    },
    imgFail: function (code) { if (code && !this.bad[code]) this.bad[code] = 1; },
    // part number with line-break points after dots and dashes, never mid-group
    pnw: function (code) { return String(code || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/([.\-\/])/g, '$1<wbr>'); },
    catLabel: function (k) { var c = CATS.filter(function (x) { return x.k === k; })[0]; return c ? c.label : k; },
    catIc: function (k) { var c = CATS.filter(function (x) { return x.k === k; })[0]; return c ? c.ic : 'all'; },
    ph: function (k) { return '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[this.catIc(k)] || '') + '</svg><span>Photo on request</span>'; },
    wa: function (line, code) { var t = 'Hi Maxzz, ' + (code ? 'about part ' + code + ': ' : '') + 'I would like to check price and availability.'; return 'https://wa.me/' + (line === 'latam' ? '17867164857' : '19543716996') + '?text=' + encodeURIComponent(t); },
    quoteQty: function (code) { var l = this.quote.filter(function (x) { return x.id === code; })[0]; return l ? l.qty : 0; },
    addQuote: function (code, n) {
      var r = this.map[code]; if (!r) return; n = Math.max(1, parseInt(n, 10) || 1);
      var l = this.quote.filter(function (x) { return x.id === code; })[0];
      if (l) l.qty += n; else this.quote.push({ id: code, name: r[1], pn: code, app: r[3], cat: r[3], slug: r[2], img: '', pos: '', qty: n });
      write(QK, this.quote); this.picks[code] = 1;
      this.flash(n + ' added to your quote list', 'quote'); this.pop(); track('quote_add_item', { item_id: code, quantity: n, source: 'store' });
    },
    save: function () { write(CK, this.cart); },
    inCart: function (code) { return this.cart.some(function (l) { return l.code === code; }); },
    add: function (code, n) {
      if (!this.canOrder) return this.addQuote(code);
      n = Math.max(1, parseInt(n, 10) || 1);
      var l = this.cart.filter(function (x) { return x.code === code; })[0];
      if (l) l.qty += n; else this.cart.push({ code: code, qty: n });
      this.picks[code] = 1; this.save(); this.pop(); this.flash('Added to cart. ' + this.cart.length + (this.cart.length === 1 ? ' part' : ' parts') + ' in your cart', 'cart');
      track('add_to_cart', { item_id: code, quantity: n, source: 'store' });
    },
    setQty: function (i, v) { var n = parseInt(v, 10) || 0; if (n <= 0) return this.remove(i); this.cart[i].qty = Math.min(9999, n); this.save(); },
    remove: function (i) { this.cart.splice(i, 1); this.save(); },
    clearCart: function () { this.cart.splice(0); this.save(); },
    lineTotal: function (l) { var p = this.price(l.code); return p == null ? 0 : p * l.qty; },
    find: function (raw) {
      var n = norm(raw); if (n.length < 4) return null;
      var hit = this.cat.filter(function (r) { return norm(r[0]) === n; })[0];
      if (!hit) hit = this.cat.filter(function (r) { var c = norm(r[0]); return c.length > n.length && c.slice(-n.length) === n && /^[A-Z]{1,4}$/.test(c.slice(0, c.length - n.length)); })[0];
      return hit ? hit[0] : null;
    },
    addPaste: function () {
      var self = this, ok = 0, miss = [], noPrice = [];
      this.paste.split(/\n+/).forEach(function (line) {
        line = line.trim(); if (!line) return;
        var m = line.match(/^(.*?)[\s,;\t]+(\d{1,5})\s*$/), code = m ? m[1] : line, n = m ? Math.min(9999, parseInt(m[2], 10)) : 1, hit = self.find(code);
        if (!hit) { miss.push(code); return; }
        if (self.flow === 'quote' || self.price(hit) == null) {
          var r = self.map[hit], q = self.quote.filter(function (x) { return x.id === hit; })[0];
          if (q) q.qty += n; else if (r) self.quote.push({ id: hit, name: r[1], pn: hit, app: r[3], cat: r[3], slug: r[2], img: '', pos: '', qty: n });
          if (self.flow === 'quote') ok++; else noPrice.push(hit); return;
        }
        var l = self.cart.filter(function (x) { return x.code === hit; })[0]; if (l) l.qty += n; else self.cart.push({ code: hit, qty: n }); ok++;
      });
      this.save(); write(QK, this.quote);
      var notes = this.qd.notes || '', fresh = miss.filter(function (m) { return notes.indexOf(m) < 0; });
      if (this.flow === 'quote' && fresh.length) this.qd.notes = ((notes ? notes + '\n' : '') + 'Not listed online, please check: ' + fresh.join(', ')).slice(0, 1900);
      this.pasteMiss = miss.slice(0, 30);
      var pm = [];
      if (ok) pm.push(ok + (ok === 1 ? ' part added' : ' parts added'));
      if (miss.length) pm.push((ok ? 'Not found: ' : 'Not listed online: ') + miss.slice(0, 6).join(', ') + (miss.length > 6 ? '...' : '') + (this.flow === 'quote' && this.lines.length ? '. We added them to your notes so sales can check them' : '. Send them to our sales team'));
      if (noPrice.length) pm.push('No online price, moved to your quote list: ' + noPrice.slice(0, 6).join(', '));
      this.pasteMsg = pm.length ? pm.join('. ') + '.' : 'Nothing to add.';
      this.pasteWarn = !!miss.length;
      // the textarea keeps only what still needs attention, so a second click cannot add the same lines twice
      this.paste = this.flow === 'quote' ? '' : miss.join('\n');
    },
    reorder: function (o) {
      var self = this;
      var skipped = 0;
      o.lines.forEach(function (x) {
        if (self.price(x.code) == null) {
          var r = self.map[x.code], q = self.quote.filter(function (z) { return z.id === x.code; })[0];
          if (q) q.qty += x.qty; else self.quote.push({ id: x.code, name: r ? r[1] : (x.name || x.code), pn: x.code, app: r ? r[3] : '', cat: r ? r[3] : '', slug: r ? r[2] : '', img: '', pos: '', qty: x.qty });
          skipped++; return;
        }
        var l = self.cart.filter(function (c) { return c.code === x.code; })[0]; if (l) l.qty += x.qty; else self.cart.push({ code: x.code, qty: x.qty });
      });
      this.save(); write(QK, this.quote); this.nav('cart'); var n = o.lines.length - skipped; if (!n) { this.nav('quote'); this.flash('Added to your quote list. These parts are priced by sales.', 'quote'); return; }
      this.flash(n + (n === 1 ? ' part' : ' parts') + ' added to your cart' + (skipped ? '. ' + skipped + ' without online price added to your quote list' : ''), skipped ? 'quote' : 'cart');
    },
    placeOrder: function () {
      var self = this; if (this.busy) return; this.busy = true; this.err = '';
      if (this.noPriceLines.length) { this.busy = false; this.err = 'Remove the parts without online price first (' + this.noPriceLines.join(', ') + '). You can send them as a quote request.'; return; }
      if (!this.idem) this.idem = Math.random().toString(36).slice(2) + Date.now().toString(36);
      var body = { idem: this.idem, po: this.co.po, notes: this.co.notes, lines: this.cart.map(function (l) { return { code: l.code, qty: l.qty }; }),
        ship: { name: this.co.name, street: this.pickup ? '' : this.co.street, city: this.pickup ? '' : this.co.city, state: this.pickup ? '' : this.co.state, zip: this.pickup ? '' : this.co.zip, country: this.co.country, method: this.co.method, fwd: this.co.fwd } };
      write('mx-portal-ship', { method: this.co.method, name: this.co.name, street: this.co.street, city: this.co.city, state: this.co.state, zip: this.co.zip, country: this.co.country, fwd: this.co.fwd });
      api('order', { body: body }).then(function (r) {
        self.busy = false;
        if (r._status !== 200) { self.err = r.error || 'We could not place the order. Please try again.'; return; }
        if (!r.order) { self.idem = ''; self.clearCart(); self.nav('orders'); self.flash('Order received. It will show in your orders shortly.', 'cart'); return; }
        track('generate_lead', { form: 'portal_order', quote_id: r.order.number, items: r.order.lines.length });
        self.idem = '';
        self.orders.unshift(r.order); self.cur = r.order; self.justPlaced = r.order.id; self.co.po = ''; self.co.notes = '';
        self.nav('o', r.order.id); self.flash('Order received. We will e-mail you when it is approved.');
        setTimeout(function () { self.cart.splice(0); self.save(); }, 0);
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Your cart is saved; try again.'; });
    },

    // sign in and access
    acceptInvite: function () {
      var self = this; if (this.busy || !this.iv || !this.iv.agree) return; this.busy = true; this.err = '';
      api('accept', { body: { t: this.iv.t, agree: true, name: this.iv.name } }).then(function (r) {
        self.busy = false;
        if (r._status === 200) { location.replace('/portal'); location.reload(); } else self.err = r.error && r.error !== 'link' ? r.error : 'That invitation link expired or was already used. Ask us for a new one.';
      });
    },
    confirmLogin: function () {
      var self = this; if (this.busy) return; this.busy = true; this.err = '';
      api('confirm', { body: { t: this.lt } }).then(function (r) {
        self.busy = false;
        if (r._status === 200) { self.lt = ''; location.replace('/portal'); location.reload(); }
        else self.err = r._status === 403 ? 'Your access is not approved yet.' : 'That sign-in link expired or was already used. Ask for a new one below.', self.lt = '';
      });
    },
    sendLink: function () {
      var self = this; this.busy = true; this.err = '';
      api('login', { body: { email: this.email } }).then(function (r) {
        self.busy = false;
        if (r._status === 429) { self.err = 'Too many attempts. Wait a few minutes and try again.'; return; }
        if (r._status !== 200) { self.err = 'Check the e-mail address.'; return; }
        if (r.direct) { track('login', { method: 'email_link' }); location.href = '/portal'; return; }
        track('login_link_sent', { pending: !!r.pending }); self.sentPending = !!r.pending; self.nav('sent');
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Try again.'; });
    },
    sendRequest: function () {
      var self = this, hp = document.getElementById('px-hp');
      this.rqTried2 = true; if (!this.rq.company.trim()) { setTimeout(function () { var c = document.querySelector('[autocomplete=organization]'); if (c) c.focus(); }, 30); return; }
      this.busy = true; this.err = '';
      this.rq.phone = this.maskPhone(this.rq.phone, this.rq.country, true);
      api('request', { body: Object.assign({}, this.rq, { hp: hp ? hp.value : '', t: Date.now() - T0 }) }).then(function (r) {
        self.busy = false;
        if (r._status === 200) { track('b2b_access_request', { form: 'portal' }); self.nav('requested'); }
        else self.err = r._status === 429 ? 'Too many requests from this connection. Try later or call us.' : 'Please fill in name, company, e-mail and phone.';
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Try again.'; });
    },
    sendQuote: function () {
      var self = this, hp = document.getElementById('px-qhp'), t = new Date();
      if (!this.quote.length || this.busy) return;
      if (this.qd.phone) this.qd.phone = this.maskPhone(this.qd.phone, this.qd.country, true);
      var me = this.me, acc = me && me.account, d = Object.assign({}, this.qd);
      if (me) { d.name = me.name || this.firstName; d.email = me.email; d.company = acc ? acc.company : 'Maxzz Diesel (internal)'; if (!d.phone) d.phone = me.phone || ''; d.type = d.type || (acc ? 'Approved B2B account ' + (acc.code || '') : 'Internal'); }
      var snap = this.doc; if (snap && snap.none) snap = null;
      var number = 'QR-' + String(t.getFullYear()).slice(2) + ('0' + (t.getMonth() + 1)).slice(-2) + ('0' + t.getDate()).slice(-2) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      var lines = this.quote.map(function (l) { return { pn: l.id, name: String(self.title(self.map[l.id]) || l.name || '').replace(/\u2011/g, '-'), qty: l.qty }; });
      this.busy = true; this.err = '';
      fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: number, source: 'B2B store' + (this.me && this.me.account ? ' · account ' + (this.me.account.code || this.me.account.company) : ''), hp: hp ? hp.value : '', t: Date.now() - T0,
        customer: { name: d.name, company: d.company, email: d.email, phone: d.phone, type: d.type, notes: d.notes }, shipping: Object.assign({ po: d.po, needBy: d.needBy }, me ? this.qShip : { country: d.country, city: d.city }), lines: lines }) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (res) {
          if (res && res.id) number = res.id;
          track('generate_lead', { form: 'store_quote', quote_id: number, items: lines.length });
          self.busy = false; self.qSent = { id: number, email: d.email, from: snap ? snap.billTo : [d.name, d.company, d.email], ship: snap ? snap.shipTo : [], refs: snap ? snap.refs : [], notes: d.notes, lines: lines.map(function (l) { return { code: l.pn, name: l.name, qty: l.qty, price: null }; }) };
          self.qd.notes = ''; self.qd.po = ''; self.qd.needBy = '';
          if (self.me) self.myQuotes.unshift({ id: number, created: Date.now(), status: 'Sent', lines: lines });
          setTimeout(function () { self.quote.splice(0); write(QK, []); }, 0); window.scrollTo({ top: 0, behavior: 'smooth' });
        })
        .catch(function () { self.busy = false; self.err = 'We could not send it right now. Try again, or e-mail the list to sales@maxzzdiesel.com.'; });
    },
    logout: function () { forget(); api('logout', { body: {} }).then(function () { location.href = '/portal'; }); },

    // admin
    lookup: function (a) { var self = this; if (!a._q.trim()) return; a._busy = true; api('admin-lookup?code=' + encodeURIComponent(a._q.trim())).then(function (r) { a._busy = false; a._res = r.customers || []; if (r.error) self.flash(r.error); }); },
    approve: function (a) { var self = this; api('admin-approve', { body: { account: a.id, customer: a._pick } }).then(function (r) { if (r._status === 200) { self.flash('Approved. Access e-mail sent.'); self.loadAdmin(); } else self.flash(r.error || 'Could not approve'); }); },
    reject: function (a) { var reason = prompt('Reason (optional, sent to the customer):'); if (reason === null) return; var self = this; api('admin-reject', { body: { account: a.id, reason: reason, notify: true } }).then(function () { self.flash('Declined'); self.loadAdmin(); }); },
    moveInd: function (nav) { var a = nav && nav.querySelector('a.on'), i = nav && nav.querySelector('.px-dind'); if (!a || !i) return; i.style.width = a.offsetWidth + 'px'; i.style.transform = 'translateX(' + a.offsetLeft + 'px)'; },
    pop: function () { try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; requestAnimationFrame(function () { document.querySelectorAll('.px-fab-b .n, .pxh-ic .pxh-n, .px-kpis b').forEach(function (e) { e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.3,1.4,.5,1)' }); }); }); } catch (e) {} },
    flash: function (m, kind) { var self = this; this.toast = m; this.toastKind = kind || ''; clearTimeout(this._t); this._t = setTimeout(function () { self.toast = ''; }, 2600); }
  });

  PetiteVue.createApp(app).mount('#app');
  // Keep the sticky offsets in sync with the fixed header and the category bar
  (function(){
    var root = document.documentElement;
    function sync(){
      var h = document.querySelector('.pxh'), b = document.querySelector('.px-bar');
      if (h) root.style.setProperty('--pxh', h.offsetHeight + 'px');
      if (b) root.style.setProperty('--pxbar', b.offsetHeight + 'px');
    }
    window.addEventListener('resize', sync);
    window.addEventListener('hashchange', function(){ setTimeout(sync, 60); });
    setInterval(sync, 1500);
    sync();
  })();
})();
