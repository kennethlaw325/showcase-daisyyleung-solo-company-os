export function isSafeDemoMode(): boolean {
  return process.env.SOLO_OS_DEMO_MODE === "true";
}
