/**
 * #C — targeted P0 query terms.
 *
 * The broad brand query + classifier misses high-intent posts that don't name
 * the brand plainly. These brand-ANCHORED phrases (quoted, so they OR into the
 * existing keyword mechanism without going broad) sharpen recall for the P0
 * signals — churn, comparison, buying-intent — within a single scan (no extra
 * fetch cost). Anchoring on the brand keeps them from matching unrelated noise.
 */
export function p0Keywords(brandName: string): string[] {
  const b = brandName.trim();
  if (!b) return [];
  return [
    `${b} alternative`, // comparison
    `${b} vs`, // comparison
    `alternative to ${b}`, // comparison
    `switched from ${b}`, // churn
    `${b} cancel`, // churn
    `leaving ${b}`, // churn
    `ditched ${b}`, // churn
    `${b} too expensive`, // churn / pain
    `is ${b} worth it`, // buying intent
    `should I use ${b}`, // buying intent
  ];
}
