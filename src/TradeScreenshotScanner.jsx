import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ImageUp,
  LoaderCircle,
  ScanLine,
  X,
} from "lucide-react";
import { SHELL_ITEMS } from "./sellablesData.js";
import { format } from "./tracker.js";

const input =
  "w-full rounded-xl border border-[#B1D3B9] bg-white px-3 py-2.5 text-center font-bold outline-none focus:border-[#527A70]";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#527A70] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#29453E]";
const soft =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#B1D3B9] bg-white px-4 py-2.5 text-sm font-bold hover:bg-[#F2F8ED]";

function detectedValues(result) {
  return {
    quantities: Object.fromEntries(
      SHELL_ITEMS.map((item) => [
        item.name,
        String(result.quantities[item.name] || ""),
      ]),
    ),
    shovels: String(result.shovels || ""),
  };
}

export default function TradeScreenshotScanner({ onApply }) {
  const inputRef = useRef(null);
  const scanIdRef = useRef(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState(null);
  const [values, setValues] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const chooseFile = async (file) => {
    if (!file) return;
    const scanId = scanIdRef.current + 1;
    scanIdRef.current = scanId;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setResult(null);
    setValues(null);
    setError("");
    setProgress({ progress: 0, status: "Preparing screenshot" });
    try {
      const { scanTradeScreenshot } = await import("./tradeImageDetector.js");
      const next = await scanTradeScreenshot(file, (update) => {
        if (scanIdRef.current === scanId) setProgress(update);
      });
      if (scanIdRef.current !== scanId) return;
      setResult(next);
      setValues(detectedValues(next));
      setProgress(null);
    } catch (scanError) {
      if (scanIdRef.current !== scanId) return;
      setProgress(null);
      setError(scanError?.message || "Could not read this screenshot.");
    }
  };

  const clear = () => {
    scanIdRef.current += 1;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setResult(null);
    setValues(null);
    setProgress(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const apply = () => {
    if (!values) return;
    const quantities = Object.fromEntries(
      Object.entries(values.quantities).map(([name, value]) => [
        name,
        Math.max(0, Math.floor(Number(value) || 0)),
      ]),
    );
    const shovels = Math.max(0, Math.floor(Number(values.shovels) || 0));
    if (![...Object.values(quantities), shovels].some((value) => value > 0)) {
      setError("No detected quantity to apply.");
      return;
    }
    onApply({ quantities, shovels, capturedAt: result?.capturedAt || null });
    clear();
  };

  return (
    <section className="mt-5 rounded-2xl border-2 border-dashed border-[#88BDA4] bg-white p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#E6F2DD] text-[#527A70]">
            <ScanLine size={21} />
          </span>
          <div>
            <h2 className="font-bold">Scan trade screenshot</h2>
            <p className="mt-1 text-sm text-[#659287]">
              Free on-device OCR. The screenshot never leaves this browser.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={primary}
          disabled={Boolean(progress)}
        >
          <ImageUp size={17} /> Upload screenshot
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
      </div>

      {progress ? (
        <div className="mt-4 rounded-xl bg-[#E6F2DD] p-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            <LoaderCircle size={17} className="animate-spin" />
            {progress.status}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-[#527A70] transition-[width]"
              style={{
                width: `${Math.max(4, Math.round(progress.progress * 100))}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-[#659287]">
            First scan may take longer while the free OCR model is cached.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}

      {result && values ? (
        <div className="mt-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-bold">
                <CheckCircle2 size={18} className="text-[#527A70]" />
                Detection ready · {format(result.confidence, 0)}% confidence
              </p>
              <p className="mt-1 text-xs text-[#659287]">
                Review the detected values, then apply them to the calculator.
              </p>
            </div>
            <button type="button" onClick={clear} aria-label="Clear screenshot">
              <X size={19} />
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
            <img
              src={previewUrl}
              alt="Uploaded trade screenshot"
              className="h-40 w-full rounded-xl border border-[#E6F2DD] object-cover"
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {SHELL_ITEMS.map((item) => (
                <label
                  key={item.name}
                  className="rounded-xl bg-[#F8FBF5] p-3 text-xs font-bold text-[#527A70]"
                >
                  {item.name}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={values.quantities[item.name]}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        quantities: {
                          ...current.quantities,
                          [item.name]: event.target.value,
                        },
                      }))
                    }
                    className={`mt-1.5 ${input}`}
                  />
                </label>
              ))}
              <label className="rounded-xl bg-[#F8FBF5] p-3 text-xs font-bold text-[#527A70]">
                Shovels
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={values.shovels}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      shovels: event.target.value,
                    }))
                  }
                  className={`mt-1.5 ${input}`}
                />
              </label>
            </div>
          </div>

          {result.warnings.length ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
              {result.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-col justify-end gap-2 sm:flex-row">
            <button type="button" onClick={clear} className={soft}>
              Cancel
            </button>
            <button type="button" onClick={apply} className={primary}>
              <CheckCircle2 size={16} /> Apply detected values
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
