// One-time welcome page (Karim 2026-11-04), opened by the background worker on
// install only. "Take the tour" opens the meetings page with ?tour=1, which
// starts the Induction tour once and drops the flag from the address.
const APP = "http://127.0.0.1:8765";
const go = document.getElementById("go") as HTMLButtonElement;
const note = document.getElementById("note") as HTMLElement;

go.addEventListener("click", async () => {
  go.disabled = true;
  try {
    const res = await fetch(`${APP}/healthz`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    location.href = `${APP}/notes/?tour=1`;
  } catch {
    note.textContent = "Start the Halo app on this computer, then press Take the tour again.";
    note.classList.add("warn");
    go.disabled = false;
  }
});
