export async function writeToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based fallback.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.inset = "0 auto auto -9999px";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  try {
    // `execCommand` is the only broadly supported fallback when the async
    // Clipboard API is unavailable. Keep the legacy surface isolated here so
    // the rest of the application never depends on its deprecated DOM typing.
    const legacyDocument = document as { execCommand(command: "copy"): boolean };
    return legacyDocument.execCommand("copy");
  } catch {
    return false;
  } finally {
    textArea.remove();
  }
}
