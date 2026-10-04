import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The call count is counted, and there is no longer a way to type one.
 *
 * WHY THIS READS SOURCE RATHER THAN BEHAVIOUR. The count itself is asserted against a
 * database in `tests/db/customer-risk.test.ts` — who may write a row, who may read it,
 * what channels exist. What a db test cannot see is whether `claimNoShow` still ACCEPTS
 * a number from the browser: a signature that kept the old field and quietly preferred
 * the count would pass every one of those cases, and the first caller to pass the old
 * argument would be back to evidence the claimant chose.
 *
 * So these cases assert the ENDS: the field is gone from both the data function and the
 * action, and the count comes from the table. It is the `trip_debt_wired` shape and the
 * `triage_log_id` lesson — every link can be right while the chain is wrong.
 */
const strip = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const RISK = strip("lib/data/customer-risk.ts");
const ACTION = strip("app/[locale]/(work)/provider/jobs/actions.ts");
const PANEL = strip("components/provider/arrival-panel.tsx");

describe("the contact count cannot be supplied by the claimant", () => {
  it("is read from the table inside claimNoShow", () => {
    const claim = RISK.slice(RISK.indexOf("export async function claimNoShow"));
    const body = claim.slice(0, claim.indexOf("export async function", 10));
    expect(body).toMatch(/from\("booking_contact_attempts"\)/);
    expect(body).toMatch(/count: "exact"/);
  });

  /*
   * THE FIELD IS GONE, NOT IGNORED. An ignored field is one refactor away from being
   * read again, and nothing would fail in between.
   */
  it("takes no contactAttempts argument anywhere on the path", () => {
    expect(RISK).not.toMatch(/contactAttempts:\s*number/);
    expect(ACTION).not.toMatch(/contactAttempts/);
    expect(PANEL).not.toMatch(/contactAttempts/);
  });

  /*
   * AND THE PANEL NO LONGER KEEPS ITS OWN COUNTER. It had one, used both for the
   * confirm sentence and as the evidence — so a counter left behind would show a
   * professional a number that is not the one a reviewer sees.
   */
  it("keeps no local tally in the browser", () => {
    expect(PANEL).not.toMatch(/setContactAttempts/);
  });

  /*
   * THE TAP IS RECORDED THROUGH THE ACTION, which is what makes the count exist at all.
   * `recordContactAttempt` with no caller would be a table nothing writes to — the sin
   * this repository has paid for four times, and `booking_refusals.reason_code` in
   * miniature one phase ago.
   */
  it("is written from a button, through the session", () => {
    expect(ACTION).toMatch(/recordContactAttemptAction/);
    expect(ACTION).toMatch(/recordContactAttempt\(/);
    expect(strip("components/provider/job-card.tsx")).toMatch(
      /recordContactAttemptAction\(/,
    );
  });

  /*
   * AND THE ACTOR COMES FROM THE SESSION. Three holes in this product have been the
   * same shape — an id arrived from the browser and nothing asked whose it was — and a
   * forgeable provider id here would let anybody manufacture a call history against any
   * booking id they could name.
   */
  it("never takes a provider id from the caller", () => {
    const fn = ACTION.slice(ACTION.indexOf("recordContactAttemptAction"));
    const body = fn.slice(0, fn.indexOf("export async function", 10));
    expect(body).toMatch(/getSessionProfile\(\)/);
    expect(body).toMatch(/providerProfileId: profile\.id/);
    expect(body).not.toMatch(/providerProfileId: input/);
  });
});

describe("the arrival photograph is not re-encoded on its way up", () => {
  /*
   * THE CASE THAT WOULD HAVE CAUGHT THE WHOLE FEATURE BEING POINTLESS. `prepareImage`
   * compresses through a canvas, which is right for every other upload here and
   * destroys EXIF — including the camera clock the skew is computed from. A panel that
   * reached for it would store a photograph with `exif_skew_minutes` null every single
   * time, and nothing would fail: the column is nullable, null means "not recorded",
   * and the screen would quietly say so for ever.
   */
  it("sends the original bytes rather than the compressor's", () => {
    expect(PANEL).not.toMatch(/prepareImage/);
    expect(PANEL).toMatch(/arrayBuffer\(\)/);
  });

  /* And the server is what strips it, so nothing unstripped is ever stored. */
  it("is stripped and read on the server", () => {
    const photos = strip("lib/data/arrival-photos.ts");
    expect(photos).toMatch(/checkUploadedImage\(/);
    expect(photos).toMatch(/checked\.bytes/);
    expect(photos).toMatch(/checked\.takenAt/);
  });
});
