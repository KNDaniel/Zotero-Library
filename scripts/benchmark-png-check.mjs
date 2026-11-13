// Measure the sequential PNG-presence loop from runVerification with the plan's scale fixture.
// The 10,500 synthetic annotations use a 25% image ratio; no Zotero data is read.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const TOTAL_ANNOTATIONS = 10_500;
const IMAGE_COUNT = Math.round(TOTAL_ANNOTATIONS * 0.25);
const LIMITS = [4, 8, 16];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zl-png-bench-"));
const dataDir = path.join(tmp, "data");
fs.mkdirSync(path.join(dataDir, "cache", "library"), { recursive: true });
fs.mkdirSync(path.join(dataDir, "cache", "groups"), { recursive: true });
const annotations = Array.from({ length: IMAGE_COUNT }, (_, i) => ({ key: `AN${String(i).padStart(6, "0")}` }));
const exists = async (p) => {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
};

async function checkOne(a) {
  // Same order and short-circuit behavior as runVerification: library first, groups second.
  return (await exists(path.join(dataDir, "cache", "library", `${a.key}.png`)))
    || (await exists(path.join(dataDir, "cache", "groups", `${a.key}.png`)));
}

async function sequential(list) {
  let present = 0;
  for (const a of list) if (await checkOne(a)) present++;
  return present;
}

async function bounded(list, concurrency) {
  let next = 0;
  let present = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      if (await checkOne(list[i])) present++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return present;
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const durations = new Map([["sequential", []], ...LIMITS.map((n) => [`${n} workers`, []])]);
try {
  // Warm the filesystem path caches before recording, then compare identical queries.
  await sequential(annotations.slice(0, 100));
  for (const limit of LIMITS) await bounded(annotations.slice(0, 100), limit);
  for (let run = 0; run < 7; run++) {
    const runs = [["sequential", () => sequential(annotations)], ...LIMITS.map((limit) => [`${limit} workers`, () => bounded(annotations, limit)])];
    for (const [name, fn] of runs) {
      const t0 = performance.now();
      const found = await fn();
      durations.get(name).push(performance.now() - t0);
      if (found !== 0) throw new Error("La fixture debía tener todos los PNG ausentes.");
    }
  }
  console.log(`Fixture: ${TOTAL_ANNOTATIONS} anotaciones · ${IMAGE_COUNT} de imagen · 2 rutas ausentes por imagen.`);
  console.log(`Sondeos por pasada: ${IMAGE_COUNT * 2}. Mediana secuencial: ${median(durations.get("sequential")).toFixed(1)} ms.`);
  for (const limit of LIMITS) {
    const samples = durations.get(`${limit} workers`);
    console.log(`Mediana con ${limit} operaciones concurrentes: ${median(samples).toFixed(1)} ms (${(median(durations.get("sequential")) / median(samples)).toFixed(2)}×).`);
    console.log(`  Pasadas: ${samples.map((n) => n.toFixed(1)).join(", ")} ms.`);
  }
  console.log(`Pasadas secuenciales: ${durations.get("sequential").map((n) => n.toFixed(1)).join(", ")} ms.`);
} finally {
  const resolvedTemp = fs.realpathSync(os.tmpdir());
  const resolvedTarget = fs.realpathSync(tmp);
  if (path.dirname(resolvedTarget) !== resolvedTemp || !path.basename(resolvedTarget).startsWith("zl-png-bench-")) {
    throw new Error("La guardia de limpieza no reconoce el directorio temporal de este benchmark.");
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}
