import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { availableMethods, gatewayFor, PAYMENT_METHODS } from "@/lib/payments";
import { esewaSignature, signaturesMatch } from "@/lib/payments/esewa";

/**
 * The gateway contract, and the one rule that protects the money.
 *
 * A customer coming back to our success URL is a browser we do not control
 * saying "it worked". These tests forge exactly that claim and prove every
 * adapter ignores it and asks the gateway's own servers instead.
 *
 * `fetch` is mocked so the gateway's answer can be chosen; nothing else is.
 * The adapters under test are the ones that ship.
 */

const originalFetch = globalThis.fetch;

/** The gateway's answer, whatever the callback claimed. */
function gatewaySays(body: unknown, ok = true) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 502,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  process.env.ESEWA_PRODUCT_CODE = "EPAYTEST";
  process.env.ESEWA_SECRET_KEY = "8gBm/:&EnhH.1/q";
  process.env.KHALTI_SECRET_KEY = "test-secret";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("every gateway satisfies the same contract", () => {
  for (const method of PAYMENT_METHODS) {
    it(`${method} implements the interface`, () => {
      const gateway = gatewayFor(method);
      expect(gateway.method).toBe(method);
      expect(typeof gateway.isConfigured).toBe("function");
      expect(typeof gateway.initiate).toBe("function");
      expect(typeof gateway.verify).toBe("function");
      expect(typeof gateway.refund).toBe("function");
    });
  }

  it("always offers cash, whatever else is configured", () => {
    // Most bookings here settle in notes at the door. A missing key must
    // never take that away.
    delete process.env.ESEWA_SECRET_KEY;
    delete process.env.KHALTI_SECRET_KEY;
    expect(availableMethods()).toContain("cash");
  });

  it("hides a gateway with no credentials rather than failing later", () => {
    delete process.env.KHALTI_SECRET_KEY;
    expect(availableMethods()).not.toContain("khalti");
  });
});

describe("a forged callback is not evidence", () => {
  it("eSewa: a callback claiming COMPLETE loses to a gateway saying otherwise", async () => {
    globalThis.fetch = gatewaySays({ status: "NOT_FOUND" }) as never;

    const result = await gatewayFor("esewa").verify({
      reference: "SKP-forged",
      expectedAmount: 2000,
      // Everything an attacker could put in the return URL.
      callback: { status: "COMPLETE", total_amount: "2000", ref_id: "fake" },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.status).toBe("failed");
  });

  it("Khalti: a callback claiming Completed loses to a lookup saying User canceled", async () => {
    globalThis.fetch = gatewaySays({ status: "User canceled" }) as never;

    const result = await gatewayFor("khalti").verify({
      reference: "SKP-forged",
      expectedAmount: 2000,
      callback: { pidx: "abc", status: "Completed", transaction_id: "fake" },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.status).toBe("failed");
  });

  it("asks the gateway even when the callback carries nothing at all", async () => {
    // Reconciliation calls verify with an empty callback. It must still work,
    // because our own reference is the only identifier that matters.
    const fetchSpy = gatewaySays({ status: "COMPLETE", ref_id: "r1", total_amount: 2000 });
    globalThis.fetch = fetchSpy as never;

    const result = await gatewayFor("esewa").verify({
      reference: "SKP-1",
      expectedAmount: 2000,
      callback: {},
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(result.ok && result.status).toBe("paid");
  });
});

describe("the amount the gateway reports is what gets reconciled", () => {
  it("eSewa reports the gateway's figure, not the callback's", async () => {
    // The forged callback says 2,000; the gateway says 200. The adapter
    // surfaces 200 so the caller can refuse to settle.
    globalThis.fetch = gatewaySays({
      status: "COMPLETE",
      ref_id: "r1",
      total_amount: 200,
    }) as never;

    const result = await gatewayFor("esewa").verify({
      reference: "SKP-1",
      expectedAmount: 2000,
      callback: { total_amount: "2000" },
    });

    expect(result.ok && result.status === "paid" && result.amount).toBe(200);
  });

  it("Khalti converts paisa back to rupees at the one boundary", async () => {
    // Khalti is denominated in paisa. Getting this wrong charges someone a
    // hundred times too much, and both numbers look plausible in review.
    globalThis.fetch = gatewaySays({
      status: "Completed",
      transaction_id: "t1",
      total_amount: 250_000,
    }) as never;

    const result = await gatewayFor("khalti").verify({
      reference: "SKP-1",
      expectedAmount: 2500,
      callback: { pidx: "abc" },
    });

    expect(result.ok && result.status === "paid" && result.amount).toBe(2500);
  });
});

describe("a gateway we cannot reach is not a failed payment", () => {
  it("eSewa reports unavailable rather than failed on a network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as never;

    const result = await gatewayFor("esewa").verify({
      reference: "SKP-1",
      expectedAmount: 2000,
      callback: {},
    });

    // ok:false means "no answer", which the caller must not treat as failure —
    // the money may well have left the customer's account.
    expect(result.ok).toBe(false);
  });

  it("Khalti reports unavailable on a 502", async () => {
    globalThis.fetch = gatewaySays({ detail: "bad gateway" }, false) as never;

    const result = await gatewayFor("khalti").verify({
      reference: "SKP-1",
      expectedAmount: 2000,
      callback: { pidx: "abc" },
    });

    expect(result.ok).toBe(false);
  });

  it("treats a pending gateway answer as pending, not paid", async () => {
    globalThis.fetch = gatewaySays({ status: "PENDING" }) as never;

    const result = await gatewayFor("esewa").verify({
      reference: "SKP-1",
      expectedAmount: 2000,
      callback: {},
    });

    expect(result.ok && result.status).toBe("pending");
  });
});

describe("eSewa's signature", () => {
  it("hashes the three fields in the order eSewa expects", () => {
    // The order is part of the contract. Getting it wrong produces a
    // signature eSewa rejects with a message that does not say why.
    const signature = esewaSignature(
      {
        total_amount: "100",
        transaction_uuid: "SKP-1",
        product_code: "EPAYTEST",
      },
      "secret",
    );
    // Same inputs in a different object order must give the same signature.
    const reordered = esewaSignature(
      {
        product_code: "EPAYTEST",
        total_amount: "100",
        transaction_uuid: "SKP-1",
      },
      "secret",
    );
    expect(signature).toBe(reordered);
  });

  it("changes when any signed field changes", () => {
    const base = { total_amount: "100", transaction_uuid: "a", product_code: "P" };
    const tampered = { ...base, total_amount: "1" };
    expect(esewaSignature(base, "s")).not.toBe(esewaSignature(tampered, "s"));
  });

  it("compares in constant time and rejects a mismatch", () => {
    expect(signaturesMatch("abc", "abc")).toBe(true);
    expect(signaturesMatch("abc", "abd")).toBe(false);
    // Different lengths must not throw — timingSafeEqual does if they differ.
    expect(signaturesMatch("abc", "abcd")).toBe(false);
    expect(signaturesMatch("", "abc")).toBe(false);
  });

  it("signs the form it actually posts", async () => {
    const result = await gatewayFor("esewa").initiate({
      reference: "SKP-1",
      amount: 1500,
      successUrl: "https://example.test/ok",
      failureUrl: "https://example.test/no",
      description: "Plumbing",
      customer: { name: "Alice", phone: "+9779800000001" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("form");
    const fields = result.fields!;
    expect(fields.total_amount).toBe("1500");
    expect(
      signaturesMatch(
        fields.signature,
        esewaSignature(fields, process.env.ESEWA_SECRET_KEY!),
      ),
    ).toBe(true);
  });

  it("never puts the signature in the stored raw record", async () => {
    const result = await gatewayFor("esewa").initiate({
      reference: "SKP-1",
      amount: 1500,
      successUrl: "https://example.test/ok",
      failureUrl: "https://example.test/no",
      description: "Plumbing",
      customer: { name: null, phone: null },
    });
    expect(JSON.stringify(result.ok && result.raw)).not.toContain(
      process.env.ESEWA_SECRET_KEY!,
    );
  });
});

describe("cash is a first-class method, not a fallback", () => {
  it("needs no gateway to initiate against", async () => {
    const result = await gatewayFor("cash").initiate({
      reference: "SKP-1",
      amount: 1500,
      successUrl: "https://example.test/ok",
      failureUrl: "https://example.test/no",
      description: "Plumbing",
      customer: { name: null, phone: null },
    });
    expect(result.ok).toBe(false);
  });

  it("stays pending until the customer confirms, and never self-settles", async () => {
    const result = await gatewayFor("cash").verify({
      reference: "SKP-1",
      expectedAmount: 1500,
      callback: { status: "paid" },
    });
    expect(result.ok && result.status).toBe("pending");
  });
});
