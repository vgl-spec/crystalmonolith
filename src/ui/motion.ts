// One shared reduced-motion query. Read at call time, not cached as a boolean, so flipping the OS
// setting while the page is open takes effect on the next animation.
const query = window.matchMedia('(prefers-reduced-motion: reduce)');

export const prefersReducedMotion = (): boolean => query.matches;
