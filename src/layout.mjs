// Packing spines onto shelves. Pure functions.

// Rows of unlimited length: items go left to right and a new row starts when one does not fit.
// `costs` is each item's width (including its gap); returns arrays of item indexes.
export function packIntoRows(costs, capacity) {
  const rows = [];
  let row = [];
  let used = 0;
  costs.forEach((cost, i) => {
    if (row.length > 0 && used + cost > capacity) { rows.push(row); row = []; used = 0; }
    row.push(i);
    used += cost;
  });
  if (row.length > 0) rows.push(row);
  return rows;
}

// The home shelf: `costs` are listed NEWEST FIRST. Picks the newest books that fit, then lays them out
// oldest to newest, left to right and top to bottom (like reading a page), the same direction as the
// year shelves on the books page. Returns one array of item indexes per shelf.
export function packNewestChronologically(costs, capacities) {
  const chosen = packIntoTiers(costs, capacities).flat().sort((a, b) => b - a); // highest index = oldest
  while (chosen.length > 0) {
    const tiers = packIntoTiers(chosen.map((i) => costs[i]), capacities);
    if (tiers.flat().length === chosen.length) return tiers.map((t) => t.map((k) => chosen[k]));
    chosen.shift(); // re-packing in reading order did not fit everything: drop the oldest and try again
  }
  return capacities.map(() => []);
}

// A fixed number of shelves, each with its own width. Fills the first shelf, then the next.
// A book that does not fit on the current shelf goes to the next; books that fit nowhere are left out.
// Returns one array of item indexes per shelf (possibly empty).
export function packIntoTiers(costs, capacities) {
  const tiers = capacities.map(() => []);
  const used = capacities.map(() => 0);
  let tier = 0;
  for (let i = 0; i < costs.length && tier < capacities.length; i++) {
    while (tier < capacities.length && used[tier] + costs[i] > capacities[tier]) tier++;
    if (tier >= capacities.length) break;
    tiers[tier].push(i);
    used[tier] += costs[i];
  }
  return tiers;
}
