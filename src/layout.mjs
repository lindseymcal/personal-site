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
