/* Katalog orientacyjny. Crr z testów bębnowych (BRR i podobne):
   jedna opona, 29 km/h, 42,5 kg, typowe ciśnienie. Na szutrze i w lesie
   model mnoży te wartości przez nawierzchnię — bęben jest gładki. */
(function (root) {
  const T = [
    { n: "Continental GP5000 S TR", d: "szosa", crr: 0.0032, klasa: "race" },
    { n: "Vittoria Corsa Pro TLR", d: "szosa", crr: 0.0032, klasa: "race" },
    { n: "Pirelli P Zero Race TLR RS", d: "szosa", crr: 0.0034, klasa: "race" },
    { n: "Schwalbe Pro One TLE", d: "szosa", crr: 0.0036, klasa: "race" },
    { n: "Michelin Power Cup TLR", d: "szosa", crr: 0.0033, klasa: "race" },
    { n: "Continental GP5000 (dętkowa)", d: "szosa", crr: 0.0036, klasa: "race" },
    { n: "Vittoria Corsa N.EXT", d: "szosa", crr: 0.004, klasa: "allround" },
    { n: "Continental Ultra Sport", d: "szosa", crr: 0.005, klasa: "allround" },
    { n: "Schwalbe Durano", d: "szosa", crr: 0.0056, klasa: "allround" },
    { n: "Continental Gatorskin", d: "szosa", crr: 0.0058, klasa: "knobby" },
    { n: "Schwalbe Marathon Plus", d: "szosa", crr: 0.0088, klasa: "knobby" },
    { n: "Schwalbe G-One RS", d: "gravel", crr: 0.007, klasa: "race" },
    { n: "Tufo Gravel Speedero", d: "gravel", crr: 0.0072, klasa: "race" },
    { n: "Continental Terra Speed", d: "gravel", crr: 0.0078, klasa: "race" },
    { n: "Panaracer GravelKing SS", d: "gravel", crr: 0.009, klasa: "allround" },
    { n: "Specialized Pathfinder Pro", d: "gravel", crr: 0.0085, klasa: "allround" },
    { n: "Pirelli Cinturato Gravel H", d: "gravel", crr: 0.01, klasa: "allround" },
    { n: "Panaracer GravelKing SK", d: "gravel", crr: 0.0102, klasa: "allround" },
    { n: "Vittoria Terreno Mix", d: "gravel", crr: 0.0102, klasa: "allround" },
    { n: "WTB Riddler", d: "gravel", crr: 0.0112, klasa: "knobby" },
    { n: "Maxxis Rambler", d: "gravel", crr: 0.0105, klasa: "knobby" },
    { n: "Schwalbe G-One Bite", d: "gravel", crr: 0.0105, klasa: "knobby" },
    { n: "Schwalbe Thunder Burt", d: "mtb", crr: 0.0061, klasa: "race" },
    { n: "Schwalbe Racing Ralph Super Race", d: "mtb", crr: 0.0064, klasa: "race" },
    { n: "Maxxis Rekon Race", d: "mtb", crr: 0.0066, klasa: "race" },
    { n: "Vittoria Mezcal", d: "mtb", crr: 0.0067, klasa: "race" },
    { n: "Maxxis Ikon", d: "mtb", crr: 0.0072, klasa: "race" },
    { n: "Continental Race King", d: "mtb", crr: 0.0068, klasa: "race" },
    { n: "Maxxis Rekon", d: "mtb", crr: 0.0086, klasa: "allround" },
    { n: "Schwalbe Nobby Nic", d: "mtb", crr: 0.0092, klasa: "allround" },
    { n: "Maxxis Minion DHF", d: "mtb", crr: 0.0108, klasa: "knobby" },
    { n: "Maxxis Dissector", d: "mtb", crr: 0.0098, klasa: "allround" },
    { n: "Schwalbe Magic Mary", d: "mtb", crr: 0.0114, klasa: "knobby" },
    { n: "Maxxis Assegai", d: "dh", crr: 0.0122, klasa: "knobby" },
    { n: "Maxxis Minion DHR II DH", d: "dh", crr: 0.0128, klasa: "knobby" },
    { n: "Schwalbe Magic Mary DH", d: "dh", crr: 0.0132, klasa: "knobby" },
    { n: "Maxxis Shorty DH", d: "dh", crr: 0.0135, klasa: "knobby" },
    { n: "Michelin DH34", d: "dh", crr: 0.0126, klasa: "knobby" },
    { n: "Maxxis High Roller II DH", d: "dh", crr: 0.013, klasa: "allround" },
    { n: "Maxxis Holy Roller", d: "dirt", crr: 0.0078, klasa: "park" },
    { n: "Schwalbe Table Top", d: "dirt", crr: 0.008, klasa: "park" },
    { n: "Maxxis Hookworm 26\"", d: "dirt", crr: 0.0088, klasa: "park" },
    { n: "Kenda Kranium", d: "dirt", crr: 0.0085, klasa: "allround" },
    { n: "Odyssey Path Pro 26\"", d: "dirt", crr: 0.0076, klasa: "race" },
    { n: "Maxxis DTH 26\"", d: "dirt", crr: 0.0072, klasa: "race" },
    { n: "Maxxis Hookworm 20\"", d: "bmx", crr: 0.0074, klasa: "park" },
    { n: "Cult Dehart", d: "bmx", crr: 0.0068, klasa: "park" },
    { n: "Odyssey Path Pro 20\"", d: "bmx", crr: 0.0062, klasa: "park" },
    { n: "Tioga PowerBlock", d: "bmx", crr: 0.0054, klasa: "race" },
    { n: "Maxxis DTH 20\"", d: "bmx", crr: 0.0058, klasa: "race" },
    { n: "Fairdale Ridgerunner", d: "bmx", crr: 0.007, klasa: "allround" },
    { n: "Kenda K-Rad 20\"", d: "bmx", crr: 0.0082, klasa: "knobby" },
  ];

  root.BieznikTires = {
    all: T,
    forDisc(d) {
      const map = { szosa: "szosa", gravel: "gravel", mtb: "mtb", dh: "dh", dirt: "dirt", bmx: "bmx" };
      const key = map[d] || "szosa";
      return T.filter((x) => x.d === key).sort((a, b) => a.crr - b.crr);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
