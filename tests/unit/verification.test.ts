import { describe, expect, it } from "vitest";

import { CATEGORY_SEED } from "@/lib/config/services";
import {
  CAPTURE_THRESHOLDS,
  captureQuality,
  judgeCapture,
  measureCapture,
  type CaptureMeasurement,
} from "@/lib/verification/capture";
import {
  CONSENT_POINTS,
  CONSENT_SCOPE,
  CONSENT_VERSION,
  consentCovers,
  newConsent,
} from "@/lib/verification/consent";
import {
  manualIdentity,
  identityAdapter,
  identityMatchingIsLive,
  type IdentityAdapter,
} from "@/lib/verification/identity";
import {
  PROBATION,
  canAcceptAnotherJob,
  eligibleForEmergencyPool,
  judgeProbation,
} from "@/lib/verification/probation";
import {
  competenceSatisfied,
  documentsFor,
  requiredDocumentsFor,
  tradeHasCtevt,
} from "@/lib/verification/requirements";
import { queuePriority, scoreApplication } from "@/lib/verification/risk";

/**
 * Provider verification: the rules, without a database.
 *
 * The properties being protected are the ones that would make this a
 * verification theatre rather than a verification: a score that decides
 * instead of a person, a "verified" tick that conflates identity with
 * competence, a probation that does not actually limit anything, and an
 * unconfigured face-matching vendor whose silence reads as a pass.
 */

/* ------------------------------------------------------------------ *
 * Identity is not competence
 * ------------------------------------------------------------------ */

describe("the two questions are kept apart", () => {
  it("asks every trade for a police clearance, because every one of them enters a home", () => {
    // There is no category here where "they do not really go inside" is true.
    // A cleaner is alone in a bedroom; a mover carries a home into a van.
    for (const category of CATEGORY_SEED) {
      expect(
        requiredDocumentsFor([category.slug]),
        `no police clearance required for ${category.slug}`,
      ).toContain("police_clearance");
    }
  });

  it("labels each document with what it actually proves", () => {
    const documents = documentsFor(["plumbing"]);
    const citizenship = documents.find((d) => d.kind === "citizenship");
    const ctevt = documents.find((d) => d.kind === "ctevt");

    // The whole framing: a citizenship certificate proves nothing about
    // plumbing, so it must never be filed under competence.
    expect(citizenship?.proves).toBe("identity");
    expect(ctevt?.proves).toBe("competence");
  });

  it("asks for a CTEVT certificate only where the trade has one", () => {
    expect(tradeHasCtevt("electrical")).toBe(true);
    expect(tradeHasCtevt("plumbing")).toBe(true);
    // CTEVT does not certify house cleaning or moving, and asking would send
    // somebody hunting for a document that does not exist.
    expect(tradeHasCtevt("home-cleaning")).toBe(false);
    expect(tradeHasCtevt("movers-packers")).toBe(false);
    expect(documentsFor(["home-cleaning"]).some((d) => d.kind === "ctevt")).toBe(
      false,
    );
  });

  it("does not require a PAN, because plenty of working tradespeople have none", () => {
    expect(requiredDocumentsFor(["plumbing"])).not.toContain("pan");
    expect(documentsFor(["plumbing"]).some((d) => d.kind === "pan")).toBe(true);
  });

  it("accepts either a certificate or a recorded assessment, and never neither", () => {
    expect(
      competenceSatisfied({ hasCtevt: true, assessmentPassed: false }),
    ).toBe(true);
    // Twenty years on the tools and no certificate is a real and common case.
    expect(
      competenceSatisfied({ hasCtevt: false, assessmentPassed: true }),
    ).toBe(true);
    expect(
      competenceSatisfied({ hasCtevt: false, assessmentPassed: false }),
    ).toBe(false);
  });

  it("marks the police clearance as expiring, because it is a statement about a moment", () => {
    const clearance = documentsFor(["plumbing"]).find(
      (d) => d.kind === "police_clearance",
    );
    expect(clearance?.expires).toBe(true);
    // A citizenship certificate does not go stale; who you are does not lapse.
    expect(
      documentsFor(["plumbing"]).find((d) => d.kind === "citizenship")?.expires,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The score sorts; it never decides
 * ------------------------------------------------------------------ */

const CLEAN = {
  duplicateHitsAgainstRemoved: [],
  missingRequired: 0,
  documentQuality: 1,
  references: "positive",
  competenceEstablished: true,
} as const;

describe("risk scoring surfaces evidence rather than a verdict", () => {
  it("gives a complete, clean application nothing to answer for", () => {
    const verdict = scoreApplication({ ...CLEAN });
    expect(verdict.score).toBe(0);
    expect(verdict.band).toBe("low");
    expect(verdict.evidence).toEqual([]);
  });

  it("attaches a reason to every point it charges", () => {
    // The property that matters: a reviewer can always read WHY. A queue
    // showing "72" and hiding the reason is one where the number stops being
    // questioned.
    const verdict = scoreApplication({
      ...CLEAN,
      duplicateHitsAgainstRemoved: ["document"],
      missingRequired: 2,
      references: "negative",
    });
    expect(verdict.evidence.length).toBeGreaterThan(0);
    for (const item of verdict.evidence) {
      expect(item.detail.length).toBeGreaterThan(10);
      expect(item.points).toBeGreaterThan(0);
    }
  });

  it("puts the strongest evidence first", () => {
    const verdict = scoreApplication({
      ...CLEAN,
      duplicateHitsAgainstRemoved: ["document"],
      references: "unreachable",
    });
    const points = verdict.evidence.map((item) => item.points);
    expect([...points].sort((a, b) => b - a)).toEqual(points);
    expect(verdict.evidence[0].key).toBe("duplicate:document");
  });

  it("treats a document match against a removed provider as the loudest signal", () => {
    // The attack the phase exists to stop.
    const duplicate = scoreApplication({
      ...CLEAN,
      duplicateHitsAgainstRemoved: ["document"],
    });
    const everythingElse = scoreApplication({
      ...CLEAN,
      missingRequired: 5,
      documentQuality: 0,
      references: "unreachable",
      competenceEstablished: false,
    });
    expect(duplicate.score).toBeGreaterThan(everythingElse.score);
    expect(duplicate.band).toBe("high");
  });

  it("does not let a shared ward accuse anybody", () => {
    // Kathmandu wards hold tens of thousands of people.
    const verdict = scoreApplication({
      ...CLEAN,
      duplicateHitsAgainstRemoved: ["area"],
    });
    expect(verdict.band).toBe("low");
  });

  it("weighs a bad camera far below a bad reference", () => {
    // Treating a cheap phone in bad light as suspicion would score poverty.
    const blurry = scoreApplication({ ...CLEAN, documentQuality: 0 });
    const badReference = scoreApplication({ ...CLEAN, references: "negative" });
    expect(blurry.score).toBeLessThan(badReference.score);
    expect(blurry.band).toBe("low");
  });

  it("counts references we have not called as our gap, and keeps the file open", () => {
    const verdict = scoreApplication({ ...CLEAN, references: "not_contacted" });
    expect(verdict.score).toBeGreaterThan(0);
    expect(verdict.evidence[0].detail).toMatch(/our gap/i);
  });

  it("never exceeds the scale however bad the application is", () => {
    const verdict = scoreApplication({
      duplicateHitsAgainstRemoved: [
        "document",
        "face",
        "account",
        "name",
        "device",
        "area",
      ],
      missingRequired: 9,
      documentQuality: 0,
      references: "negative",
      competenceEstablished: false,
    });
    expect(verdict.score).toBe(100);
    // And still only a band, never a decision.
    expect(verdict.band).toBe("high");
  });
});

describe("the queue puts waiting first", () => {
  it("floats a clean application that has been waiting three weeks above a fresh flagged one", () => {
    /*
     * The failure this prevents: a queue sorted by risk alone, where quiet
     * genuine applications sink and the platform is slowest at exactly the
     * supply it needs. A plumber who waits three weeks has signed up with a
     * competitor, and that loss appears in no metric.
     */
    const waitingPlumber = queuePriority({
      waitingDays: 21,
      demand: 0.9,
      riskScore: 0,
    });
    const freshAndFlagged = queuePriority({
      waitingDays: 0,
      demand: 0.2,
      riskScore: 100,
    });
    expect(waitingPlumber).toBeGreaterThan(freshAndFlagged);
  });

  it("still brings a flagged application forward rather than letting it rot", () => {
    const flagged = queuePriority({ waitingDays: 2, demand: 0, riskScore: 80 });
    const quiet = queuePriority({ waitingDays: 2, demand: 0, riskScore: 0 });
    expect(flagged).toBeGreaterThan(quiet);
  });

  it("prefers the trade nobody in that ward covers", () => {
    const scarce = queuePriority({ waitingDays: 3, demand: 1, riskScore: 0 });
    const plentiful = queuePriority({ waitingDays: 3, demand: 0, riskScore: 0 });
    expect(scarce).toBeGreaterThan(plentiful);
  });

  it("is not confused by a negative wait", () => {
    expect(queuePriority({ waitingDays: -5, demand: 0, riskScore: 0 })).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Probation actually limits
 * ------------------------------------------------------------------ */

const GRADUATED = {
  completedJobs: PROBATION.completedJobs,
  ratingAvg: 4.6,
  ratingCount: 12,
  upheldComplaints: 0,
  daysSinceApproval: PROBATION.days,
};

describe("probation is the real safety net", () => {
  it("starts a newly approved professional as provisional", () => {
    const verdict = judgeProbation({
      completedJobs: 0,
      ratingAvg: 0,
      ratingCount: 0,
      upheldComplaints: 0,
      daysSinceApproval: 0,
    });
    expect(verdict.standing).toBe("provisional");
    expect(verdict.remaining).toContain("jobs");
    expect(verdict.remaining).toContain("days");
  });

  it("graduates only when all four gates are passed", () => {
    expect(judgeProbation(GRADUATED).standing).toBe("established");
  });

  it("does not graduate ten jobs done in a weekend", () => {
    // Jobs alone can be farmed by a friend booking ten cheap jobs.
    const verdict = judgeProbation({ ...GRADUATED, daysSinceApproval: 2 });
    expect(verdict.standing).toBe("provisional");
    expect(verdict.remaining).toEqual(["days"]);
  });

  it("does not graduate on a handful of ratings from those same friends", () => {
    const verdict = judgeProbation({ ...GRADUATED, ratingCount: 2 });
    expect(verdict.standing).toBe("provisional");
    expect(verdict.remaining).toEqual(["rating"]);
  });

  it("holds probation on a single upheld complaint, whatever else is true", () => {
    // The override: one upheld complaint means the evidence we have is bad.
    const verdict = judgeProbation({ ...GRADUATED, upheldComplaints: 1 });
    expect(verdict.standing).toBe("provisional");
    expect(verdict.remaining).toContain("complaint");
  });

  it("limits concurrent jobs while provisional, and does not once established", () => {
    // A limit that does not limit is the whole failure mode here.
    expect(canAcceptAnotherJob("provisional", 0)).toBe(true);
    expect(canAcceptAnotherJob("provisional", 1)).toBe(true);
    expect(canAcceptAnotherJob("provisional", PROBATION.maxConcurrentJobs)).toBe(
      false,
    );
    expect(canAcceptAnotherJob("established", 40)).toBe(true);
  });

  it("keeps a provisional professional out of the emergency pool", () => {
    /*
     * An emergency is somebody frightened, at night, letting a stranger in.
     * It is the worst possible place to discover a new professional is not
     * what their paperwork said. A customer asking for them BY NAME still
     * reaches them — that is the customer's own judgement.
     */
    expect(eligibleForEmergencyPool("provisional")).toBe(false);
    expect(eligibleForEmergencyPool("established")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Capture quality
 * ------------------------------------------------------------------ */

/** A flat grey frame: perfectly exposed, and completely featureless. */
function flat(width: number, height: number, value: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return data;
}

/** Hard vertical stripes across a region — a stand-in for legible text. */
function striped(
  width: number,
  height: number,
  region: { x0: number; y0: number; x1: number; y1: number },
): Uint8ClampedArray {
  const data = flat(width, height, 128);
  for (let y = region.y0; y < region.y1; y += 1) {
    for (let x = region.x0; x < region.x1; x += 1) {
      const value = x % 2 === 0 ? 20 : 230;
      const p = (y * width + x) * 4;
      data[p] = value;
      data[p + 1] = value;
      data[p + 2] = value;
    }
  }
  return data;
}

describe("a bad photograph is refused on the phone, not in the queue", () => {
  it("calls a featureless frame blurry", () => {
    const measurement = measureCapture(flat(40, 40, 128), 40, 40);
    expect(measurement.sharpness).toBeLessThan(CAPTURE_THRESHOLDS.minSharpness);
    const verdict = judgeCapture(measurement);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.problem).toBe("blurry");
  });

  it("calls an unlit frame dark, and says so before it says anything else", () => {
    /*
     * Order matters for the advice to be actionable: telling somebody to hold
     * the phone steadier when they are photographing in an unlit corridor
     * sends them round the same loop twice.
     */
    const verdict = judgeCapture(measureCapture(flat(40, 40, 20), 40, 40));
    expect(!verdict.ok && verdict.problem).toBe("dark");
  });

  it("calls a blown-out frame glare", () => {
    const verdict = judgeCapture(measureCapture(flat(40, 40, 255), 40, 40));
    expect(!verdict.ok && verdict.problem).toBe("glare");
  });

  it("accepts a sharp document filling the frame", () => {
    const data = striped(40, 40, { x0: 2, y0: 2, x1: 38, y1: 38 });
    const verdict = judgeCapture(measureCapture(data, 40, 40));
    expect(verdict.ok).toBe(true);
  });

  it("tells somebody holding the card too far away to come closer", () => {
    // Sharp, well lit, and eight pixels tall in the middle of the frame.
    const data = striped(40, 40, { x0: 17, y0: 17, x1: 23, y1: 23 });
    const measurement = measureCapture(data, 40, 40);
    expect(measurement.fill).toBeLessThan(CAPTURE_THRESHOLDS.minFill);
    expect(!judgeCapture(measurement).ok).toBe(true);
    const verdict = judgeCapture(measurement);
    expect(!verdict.ok && verdict.problem).toBe("tooFar");
  });

  it("survives a frame too small to measure rather than throwing", () => {
    const verdict = judgeCapture(measureCapture(flat(1, 1, 128), 1, 1));
    expect(verdict.ok).toBe(false);
  });

  it("scores quality on a 0–1 scale that a blurred capture bottoms out", () => {
    const blurred: CaptureMeasurement = {
      sharpness: 0,
      glare: 0,
      brightness: 128,
      fill: 1,
    };
    expect(captureQuality(blurred)).toBe(0);
    expect(captureQuality({ ...blurred, sharpness: 100_000 })).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Consent
 * ------------------------------------------------------------------ */

describe("consent is versioned, stamped and scoped", () => {
  it("names the face as its own sensitive category", () => {
    // Biometric data under the Individual Privacy Act. Burying it inside
    // "your information" is exactly what the Act is about.
    const face = CONSENT_POINTS.find((point) => point.key === "yourFace");
    expect(face?.sensitive).toBe(true);
  });

  it("answers what, why, who and how long", () => {
    const keys = CONSENT_POINTS.map((point) => point.key);
    expect(keys).toEqual(
      expect.arrayContaining(["whatWeCollect", "why", "whoSees", "howLong"]),
    );
  });

  it("covers every document kind the application asks for", () => {
    for (const kind of requiredDocumentsFor(["electrical"])) {
      expect(CONSENT_SCOPE as readonly string[]).toContain(kind);
    }
  });

  it("refuses an upload with no consent at all", () => {
    expect(consentCovers(null, "citizenship")).toBe(false);
  });

  it("refuses consent given to an older version of the words", () => {
    /*
     * The whole point of versioning. "They agreed" is worth nothing without
     * which text they agreed to — if the wording changes, carrying the old
     * consent forward silently is consent to something else.
     */
    const stale = { ...newConsent(), version: "2020-01-01.1" };
    expect(consentCovers(stale, "citizenship")).toBe(false);
  });

  it("refuses a document kind outside the scope that was agreed", () => {
    const narrow = { ...newConsent(), scope: ["citizenship"] };
    expect(consentCovers(narrow, "citizenship")).toBe(true);
    expect(consentCovers(narrow, "selfie")).toBe(false);
  });

  it("stamps the instant, so a consent can be reconstructed later", () => {
    const record = newConsent(new Date("2026-09-10T04:00:00Z"));
    expect(record.grantedAt).toBe("2026-09-10T04:00:00.000Z");
    expect(record.version).toBe(CONSENT_VERSION);
  });
});

/* ------------------------------------------------------------------ *
 * The identity adapter contract
 * ------------------------------------------------------------------ */

/**
 * What ANY face-matching implementation must do.
 *
 * Written now, against the adapter that does nothing, so the day a vendor is
 * plugged in the contract is already the thing being tested rather than
 * whatever that vendor happens to return.
 */
function contractFor(adapter: IdentityAdapter) {
  describe(`identity adapter contract: ${adapter.name}`, () => {
    it("has a stable name for the audit log", () => {
      expect(adapter.name).toMatch(/^[a-z0-9-]+$/);
    });

    it("answers whether it is configured without throwing", () => {
      expect(typeof adapter.isConfigured()).toBe("boolean");
    });

    it("never reports an unverifiable check as a pass", async () => {
      /*
       * THE RULE THIS FILE EXISTS FOR. Unknown is never ok — the same lesson
       * as the placeholder Twilio credentials that failed silently in
       * production for a day. An adapter with no vendor behind it must say
       * `needs_human`, never `match`.
       */
      const result = await adapter.compareFaces({
        selfieUrl: "https://example.invalid/selfie",
        documentUrl: "https://example.invalid/document",
      });
      if (!adapter.isConfigured()) {
        expect(result.outcome).toBe("needs_human");
      }
      expect(["match", "mismatch", "needs_human"]).toContain(result.outcome);
    });

    it("gives a reason a person can act on when it cannot decide", async () => {
      const result = await adapter.compareFaces({
        selfieUrl: "https://example.invalid/selfie",
        documentUrl: "https://example.invalid/document",
      });
      if (result.outcome === "needs_human") {
        expect(result.reason.length).toBeGreaterThan(10);
      }
    });

    it("applies the same rule to liveness", async () => {
      const result = await adapter.checkLiveness({
        selfieUrl: "https://example.invalid/selfie",
      });
      if (!adapter.isConfigured()) {
        expect(result.outcome).toBe("needs_human");
      }
    });
  });
}

contractFor(manualIdentity);

describe("which adapter is in play", () => {
  it("ships with automated matching off and a person in its place", () => {
    expect(identityAdapter().name).toBe("manual");
    expect(identityMatchingIsLive()).toBe(false);
  });

  it("falls back to a person on a mistyped vendor name", () => {
    // A misconfiguration must degrade to a human looking, never to a check
    // that is silently skipped.
    const previous = process.env.IDENTITY_ADAPTER;
    process.env.IDENTITY_ADAPTER = "typo-vendor";
    try {
      expect(identityAdapter().name).toBe("manual");
    } finally {
      if (previous === undefined) delete process.env.IDENTITY_ADAPTER;
      else process.env.IDENTITY_ADAPTER = previous;
    }
  });
});
