// Sub-categories used by the portal side filter (copied from js/portal-app.js SUBS); the admin uses them to group products.
window.MX_SUBS = (function () {
  var SUBS = {
    'Injector': [
      ['reman', 'Reman injectors', function (c, d) { return /REMAN/.test(d) || /^BO\.0\.986\.435/.test(c); }],
      ['parts', 'Injector parts', function (c, d) { return /SOLENOID|SHIM|\bCORE\b|NOZZLE|VALVE|SEAL|KIT\b/.test(d) && !/FUEL INJECTOR|COMPLETE/.test(d); }],
      ['unit', 'Unit injectors (EUI / HEUI)', function (c, d) { return /\bEUI\b|\bHEUI\b|UNIT INJ/.test(d); }],
      ['new', 'New injectors', function () { return true; }]
    ],
    'Pump': [
      ['reman', 'Reman pumps', function (c, d) { return /REMAN/.test(d) || /^BO\.0\.986\.437/.test(c); }],
      ['parts', 'Pump components & kits', function (c, d) { return !/HIGH PRESSURE PUMP|HIGH-PRESSURE PUMP|FUEL PUMP|INJECTION PUMP/.test(d) || /\bKIT\b|REPAIR/.test(d); }],
      ['new', 'New pumps', function () { return true; }]
    ],
    'Nozzle': [
      ['fb', 'Fratelli Bosio', function (c) { return /^FB\./.test(c); }],
      ['bosch', 'Bosch', function (c) { return /^BO\.|^BR\./.test(c); }],
      ['denso', 'Denso', function (c) { return /^DN\./.test(c); }],
      ['zexel', 'Zexel', function (c) { return /^ZX\./.test(c); }],
      ['delphi', 'Delphi', function (c) { return /^DE\./.test(c); }],
      ['lead', 'Lead', function (c) { return /^LD\./.test(c); }],
      ['kingstar', 'Kingstar', function (c) { return /^KS\./.test(c); }],
      ['parts', 'Holders, nuts & caps', function (c, d) { return /HOLDER|\bNUT\b|\bCAP\b/.test(d); }],
      ['other', 'Other nozzles', function () { return true; }]
    ],
    'Repair part': [
      ['lines', 'Lines & connector tubes', function (c, d) { return /\bLINE\b|TUBE|CONNECTOR|\bPIPE\b/.test(d); }],
      ['sensors', 'Sensors', function (c, d) { return /SENSOR/.test(d); }],
      ['sol', 'Solenoids & armatures', function (c, d) { return /SOLENOID|ARMATURE|\bCOIL\b|MAGNET/.test(d); }],
      ['shims', 'Shims', function (c, d) { return /SHIM|ADJUSTING|ADJUSTMENT/.test(d); }],
      ['valves', 'Valve sets', function (c, d) { return /VALVE|VALVULA/.test(d); }],
      ['seals', 'Seals, O-rings & gaskets', function (c, d) { return /SEAL|O-?\W?RING|GASKET|WASHER|RETEN|COPPER/.test(d); }],
      ['kits', 'Repair kits', function (c, d) { return /\bKIT\b|REPAIR SET|REPAIR PARTS/.test(d); }],
      ['pump', 'Pump parts', function (c, d) { return /PLUNGER|PUMP|\bELEMENT\b|SHAFT|\bCAM\b|ROTOR|\bHEAD\b|CABEZAL|HYDRAULIC|\bSCV\b|METERING|DISTRIBUTOR|ROLLER|LEVER|HOUSING/.test(d); }],
      ['nozzles', 'Nozzles & needles', function (c, d) { return /NOZZLE|TOBERA|NEEDLE/.test(d); }],
      ['small', 'Pins, springs & small parts', function (c, d) { return /\bPIN\b|SPRING|MUELLE|PLATE|\bNUT\b|SCREW|\bBALL\b|\bSEAT\b|SPACER|PISTON|PLUG|BOLT|NIPPLE|ADAPTER|COVER|BUFFER|SLEEVE|\bROD\b/.test(d); }],
      ['other', 'Other repair parts', function () { return true; }]
    ],
    'Tool': [
      ['test', 'Testers & measuring', function (c, d) { return /TEST|MEASUR|GAUGE|COMPARATOR/.test(d); }],
      ['sets', 'Tool sets', function (c, d) { return /\bSET\b|\bKIT\b|EVO/.test(d); }],
      ['single', 'Single tools', function () { return true; }]
    ],
    'Engine parts': [
      ['gaskets', 'Gaskets & seals', function (c, d) { return /GASKET|SEAL|O-?RING|\bRING\b|WASHER/.test(d); }],
      ['bearings', 'Bearings & bushings', function (c, d) { return /BEARING|BUSH/.test(d); }],
      ['cyl', 'Cylinder, piston & liner', function (c, d) { return /CYLINDER|PISTON|LINER|\bROD\b/.test(d); }],
      ['valves', 'Valves', function (c, d) { return /VALVE/.test(d); }],
      ['filters', 'Filters & hoses', function (c, d) { return /FILTER|HOSE/.test(d); }],
      ['sensors', 'Sensors', function (c, d) { return /SENSOR/.test(d); }],
      ['other', 'Other engine parts', function () { return true; }]
    ],
    'Rail': [
      ['parts', 'Rail sensors & valves', function (c, d) { return /SENSOR|VALVE/.test(d); }],
      ['rails', 'Fuel rails', function () { return true; }]
    ]
  };
  return SUBS;
})();
window.MX_BRP = { BO: 'Bosch', DN: 'Denso', ZX: 'Zexel', DE: 'Delphi', FB: 'Fratelli Bosio', JV: 'Java', LD: 'Lead', RB: 'Robiel', CO: 'Continental', SI: 'Siemens', VO: 'Volvo Penta', CAT: 'Caterpillar', AP: 'Alliant Power' };
