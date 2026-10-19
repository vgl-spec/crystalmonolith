// Lets the browser paint and handle input between slices of heavy CPU work, so the preloader bar
// keeps moving while geometry is generated.
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
