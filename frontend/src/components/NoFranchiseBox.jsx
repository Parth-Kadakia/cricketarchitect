/**
 * Full-page centered placeholder shown when the user has no franchise yet.
 */
export const NO_FRANCHISE_PATTERNS = [
  'no active franchise',
  'franchise not found',
  'no franchise',
  'world',
];

/** Returns true when the error message signals the user has no franchise / world. */
export function isNoFranchiseError(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return NO_FRANCHISE_PATTERNS.some((p) => lower.includes(p));
}

export default function NoFranchiseBox({ message }) {
  return (
    <div className="no-franchise-wrapper">
      <div className="no-franchise-box">
        <span className="no-franchise-icon">🏟️</span>
        <h2 className="no-franchise-title">No Franchise Found</h2>
        <p className="no-franchise-desc">
          {message || 'You don\u2019t have an active franchise yet. Head to the Dashboard to pick a city and start your journey.'}
        </p>
      </div>
    </div>
  );
}
