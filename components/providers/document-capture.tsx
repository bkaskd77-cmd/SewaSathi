"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Camera, Check, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  captureQuality,
  judgeCapture,
  measureCapture,
  type CaptureProblem,
} from "@/lib/verification";
import { encodeToBudget } from "@/lib/utils/image";
import { cn } from "@/lib/utils";

/**
 * Photographing one document, judged before it is sent.
 *
 * THE FEEDBACK SAYS WHAT TO DO, NOT WHAT IS WRONG. "Poor quality" tells
 * somebody they have failed and leaves them nowhere; "move somewhere brighter"
 * tells them the next thing to try. The person holding the phone is the one we
 * most want to succeed — they are a tradesperson standing in a corridor with a
 * cracked screen, and every rejection they cannot act on is a step towards
 * giving up on the form.
 *
 * IT DECIDES ON THE DEVICE AND UPLOADS NOTHING TO BE TOLD NO. The measurement
 * is arithmetic over pixels already on the phone. Sending a photograph of a
 * citizenship certificate to a server to be told it is blurry would mean
 * transmitting the very thing we are about to reject, over a connection they
 * are paying for by the megabyte.
 *
 * DOWNSCALED TWICE, FOR TWO DIFFERENT REASONS: to about 480px for measuring,
 * because a twelve-megapixel Laplacian is a visible pause on these phones; and
 * to 1600px for sending, because the reviewer needs to read a number, not
 * count the paper's fibres.
 */

const MEASURE_EDGE = 480;

type Stage =
  | { name: "empty" }
  | { name: "checking" }
  | { name: "problem"; problem: CaptureProblem; preview: string }
  | {
      name: "ready";
      preview: string;
      base64: string;
      /** What the compression settled on, shown so the size is not a mystery. */
      bytes: number;
      quality: number;
    }
  | { name: "sending" }
  | { name: "sent" }
  | { name: "failed"; message: string };

export type DocumentCaptureProps = {
  kind: string;
  label: string;
  hint?: string;
  required: boolean;
  /** True once a document of this kind has already arrived. */
  alreadyUploaded: boolean;
  /** Ask for a date on the kinds that lapse. */
  wantsExpiry?: boolean;
  onUpload: (input: {
    kind: string;
    base64: string;
    captureQuality: number;
    expiresOn: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
};

/** Draw an image onto a canvas at most `edge` on its long side. */
function drawScaled(
  image: HTMLImageElement,
  edge: number,
): HTMLCanvasElement | null {
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function DocumentCapture(props: DocumentCaptureProps) {
  const t = useTranslations("join.apply");
  const [stage, setStage] = React.useState<Stage>(
    props.alreadyUploaded ? { name: "sent" } : { name: "empty" },
  );
  const [expiresOn, setExpiresOn] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setStage({ name: "checking" });

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("unreadable"));
        element.src = objectUrl;
      });

      const measured = drawScaled(image, MEASURE_EDGE);
      if (!measured) {
        setStage({ name: "failed", message: t("capture.wrongType") });
        return;
      }
      const context = measured.getContext("2d", { willReadFrequently: true });
      const pixels = context?.getImageData(
        0,
        0,
        measured.width,
        measured.height,
      );
      if (!pixels) {
        setStage({ name: "failed", message: t("capture.wrongType") });
        return;
      }

      const measurement = measureCapture(
        pixels.data,
        measured.width,
        measured.height,
      );
      const verdict = judgeCapture(measurement);
      const preview = drawScaled(image, 320)?.toDataURL("image/jpeg", 0.6) ?? "";

      if (!verdict.ok) {
        // Kept on screen beside the advice: seeing the dark photograph next to
        // "move somewhere brighter" is what makes the advice land.
        setStage({ name: "problem", problem: verdict.problem, preview });
        return;
      }

      /*
       * COMPRESSED TO A BYTE BUDGET, not to a fixed quality.
       *
       * This used to encode at 1600px and quality 0.82 and send whatever came
       * out. A document photograph from a modern phone comes out at one to two
       * megabytes, and a server action argument is a request body that Next
       * caps — so the framework refused every upload before any of our code
       * ran, and the form could only say "that did not save". The hero already
       * had a budget for exactly this reason; this path did not, and one place
       * knowing about the ceiling is the same as nowhere knowing.
       */
      const encoded = encodeToBudget(image, "document");
      if (!encoded) {
        setStage({ name: "failed", message: t("capture.wrongType") });
        return;
      }
      setStage({
        name: "ready",
        preview,
        base64: encoded.dataUrl,
        bytes: encoded.bytes,
        quality: captureQuality(measurement),
      });
    } catch {
      setStage({ name: "failed", message: t("capture.wrongType") });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function send() {
    if (stage.name !== "ready") return;
    const { base64, quality } = stage;
    setStage({ name: "sending" });
    const result = await props.onUpload({
      kind: props.kind,
      base64,
      captureQuality: quality,
      expiresOn: expiresOn || null,
    });
    setStage(
      result.ok
        ? { name: "sent" }
        : { name: "failed", message: t(`errors.${result.error ?? "generic"}`) },
    );
  }

  const advice =
    stage.name === "problem"
      ? t(`capture.${stage.problem}`)
      : stage.name === "failed"
        ? stage.message
        : null;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        stage.name === "sent"
          ? "border-primary/40 bg-primary/5"
          : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor={`capture-${props.kind}`}>{props.label}</Label>
          {props.hint ? (
            <p className="mt-1 text-caption text-muted-foreground">
              {props.hint}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-caption text-muted-foreground">
          {props.required ? t("required") : t("optional")}
        </span>
      </div>

      {/* The photograph stays visible beside the advice about it. */}
      {(stage.name === "problem" || stage.name === "ready") && stage.preview ? (
        <div className="mt-3 animate-rise overflow-hidden rounded-md border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={stage.preview}
            alt=""
            className="block max-h-48 w-full object-contain bg-muted"
          />
        </div>
      ) : null}

      {advice ? (
        <p
          key={advice}
          className="mt-3 animate-rise text-body-sm text-warning-ink"
          role="status"
        >
          {advice}
        </p>
      ) : null}

      {stage.name === "ready" ? (
        <p className="mt-3 animate-rise text-body-sm text-primary" role="status">
          {t("capture.good")}
        </p>
      ) : null}

      {props.wantsExpiry && stage.name !== "sent" ? (
        <div className="mt-3 space-y-1.5">
          <Label htmlFor={`expiry-${props.kind}`}>
            {t("documents.expiry")}
          </Label>
          <input
            id={`expiry-${props.kind}`}
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-body-md"
          />
        </div>
      ) : null}

      <input
        ref={inputRef}
        id={`capture-${props.kind}`}
        type="file"
        accept="image/jpeg,image/png"
        // `environment` opens the rear camera on a phone rather than the photo
        // roll, which is what somebody holding a certificate actually wants.
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
          event.target.value = "";
        }}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {stage.name === "sent" ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-body-sm text-primary">
              <Check aria-hidden="true" className="size-4" />
              {t("documents.uploaded")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="btn-tactile"
              onClick={() => {
                setStage({ name: "empty" });
                inputRef.current?.click();
              }}
            >
              <RefreshCw aria-hidden="true" />
              {t("documents.retake")}
            </Button>
          </>
        ) : stage.name === "ready" ? (
          <>
            <Button type="button" className="btn-tactile" onClick={() => void send()}>
              {t("documents.done")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="btn-tactile"
              onClick={() => inputRef.current?.click()}
            >
              {t("documents.retake")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant={stage.name === "problem" ? "default" : "outline"}
            className="btn-tactile"
            disabled={stage.name === "checking" || stage.name === "sending"}
            onClick={() => inputRef.current?.click()}
          >
            {stage.name === "checking" || stage.name === "sending" ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Camera aria-hidden="true" />
            )}
            {stage.name === "checking"
              ? t("documents.checking")
              : stage.name === "sending"
                ? t("documents.uploading")
                : stage.name === "problem"
                  ? t("documents.retake")
                  : t("documents.take")}
          </Button>
        )}
      </div>
    </div>
  );
}
