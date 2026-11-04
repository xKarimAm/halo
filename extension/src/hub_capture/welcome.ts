// One-time welcome (Karim 2026-11-04): Chrome fires onInstalled with reason
// "install" once per install; updates say "update" and never reopen it.
export function welcomeOnInstall(
  details: { reason: string },
  tabs: { create(o: { url: string }): unknown },
  getURL: (path: string) => string,
): void {
  if (details.reason === "install") tabs.create({ url: getURL("/welcome.html") });
}
