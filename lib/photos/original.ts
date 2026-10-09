/**
 * The file as the phone wrote it, base64, with no re-encode at all.
 *
 * DELIBERATELY NOT `prepareImage`. That compresses through a canvas, which is right for
 * every photograph whose job is to be looked at and which destroys EXIF — measured in
 * Chromium, not assumed. Two kinds of photograph in this product are evidence rather than
 * illustration, and for both the camera's own clock is half the check: the arrival
 * photograph a professional takes at a door nobody answered, and the photographs a
 * customer sends with a guarantee claim. Those go up as the phone wrote them and the
 * server strips the metadata after reading the one field it wants.
 *
 * ONE COPY, BECAUSE THERE WERE ABOUT TO BE TWO. This was a local function inside
 * `components/provider/arrival-panel.tsx`; the claim dialog needs exactly the same four
 * lines, and a second chunked base64 reader is the kind of duplication that drifts in one
 * place and not the other.
 *
 * REFUSED IN THE BROWSER WHEN IT IS TOO BIG, rather than sent and rejected. A server
 * action argument over the body limit is refused by the framework before any of our code
 * runs — which is exactly how every document upload in the application form once failed
 * with nothing in the logs. Null means "no photograph", which both callers handle as the
 * ordinary case.
 */
export const MAX_ORIGINAL_PHOTO_BYTES = 2 * 1024 * 1024;

export async function readOriginalPhoto(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/") || file.size > MAX_ORIGINAL_PHOTO_BYTES) {
    return null;
  }
  try {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    // Chunked: `String.fromCharCode(...bytes)` on two megabytes blows the argument
    // limit and throws on exactly the phones this has to work on.
    for (let i = 0; i < bytes.length; i += 8192) {
      // `Array.from` rather than a spread: the repo targets a lower lib and a
      // typed-array spread needs downlevelIteration.
      binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 8192)));
    }
    return window.btoa(binary);
  } catch {
    return null;
  }
}
