// "Get from production" for one card: card and engagement first, then the
// whole page it sits on (a resumable copy, one call per ~50 s step).
type Step = { step: string; ok: boolean; detail?: string };
export type FromProd = { ok: boolean; steps: Step[]; job?: { id: string; finished: boolean } | null };

export async function fromProd(id: string, onStep?: (n: number) => void): Promise<FromProd> {
  const call = (job?: string) =>
    fetch(`/api/teamcards/${id}/from-prod`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job ? { job } : {}) })
      .then((r) => r.json())
      .catch(() => ({ ok: false, steps: [{ step: "network error", ok: false }] }));
  let j: FromProd = await call();
  const steps = [...(j.steps ?? [])];
  for (let n = 1; j.ok && j.job && !j.job.finished && n < 12; n++) {
    onStep?.(n);
    j = await call(j.job.id);
    steps.push(...(j.steps ?? []));
  }
  const seen = new Set<string>();
  const unique = steps.filter((s) => (seen.has(s.step) ? false : (seen.add(s.step), true)));
  return { ...j, ok: j.ok && (!j.job || j.job.finished), steps: unique };
}
