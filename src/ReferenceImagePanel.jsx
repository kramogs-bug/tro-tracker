import { useEffect, useRef, useState } from "react";
import { Expand, ImageUp, RotateCw, X } from "lucide-react";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const REFERENCE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);
const REFERENCE_IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/i;

export default function ReferenceImagePanel({
  resetKey = 0,
  compact = false,
  temporaryUpload = false,
  onFileChange = null,
}) {
  const inputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [rotation, setRotation] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");

  const clear = () => {
    setPreviewUrl("");
    setRotation(0);
    setExpanded(false);
    setError("");
    onFileChange?.(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  useEffect(() => {
    setPreviewUrl("");
    setRotation(0);
    setExpanded(false);
    setError("");
    onFileChange?.(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [onFileChange, resetKey]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const choose = (file) => {
    if (!file) return;
    if (
      !REFERENCE_IMAGE_TYPES.has(file.type) &&
      !REFERENCE_IMAGE_EXTENSION.test(file.name)
    ) {
      setError("Please choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      setError("Reference image must be 20 MB or smaller.");
      return;
    }
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    onFileChange?.(file);
    setRotation(0);
    setError("");
  };

  return (
    <section
      className={`rounded-2xl border border-dashed border-[#88BDA4] bg-[#F8FBF5] ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Reference screenshot</h3>
          <p className="mt-1 text-xs text-[#659287]">
            {temporaryUpload
              ? "Optional. A compressed copy is stored temporarily for review and deleted after approval or rejection."
              : "Manual reference only. The image stays on this device and is not uploaded or saved."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!inputRef.current) return;
            inputRef.current.value = "";
            inputRef.current.click();
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-[#B1D3B9] bg-white px-3 py-2 text-xs font-bold hover:bg-[#E6F2DD]"
        >
          <ImageUp size={15} /> {previewUrl ? "Replace image" : "Attach image"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => choose(event.currentTarget.files?.[0])}
        />
      </div>

      {error ? (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">
          {error}
        </p>
      ) : null}

      {previewUrl ? (
        <div className="mt-3">
          <div className="overflow-hidden rounded-xl border border-[#E6F2DD] bg-[#29453E]/5">
            <img
              src={previewUrl}
              alt="Shell quantity reference"
              className={`${compact ? "max-h-56" : "max-h-80"} w-full object-contain transition-transform`}
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRotation((current) => (current + 90) % 360)}
              className="rounded-lg bg-white p-2 text-[#527A70]"
              aria-label="Rotate reference image"
            >
              <RotateCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-lg bg-white p-2 text-[#527A70]"
              aria-label="Open full-size reference image"
            >
              <Expand size={16} />
            </button>
            <button
              type="button"
              onClick={clear}
              className="rounded-lg bg-red-50 p-2 text-red-700"
              aria-label="Remove reference image"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : null}

      {expanded && previewUrl ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-[#29453E]/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Full-size reference image"
        >
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute right-4 top-4 rounded-xl bg-white p-3 text-[#29453E]"
            aria-label="Close full-size image"
          >
            <X size={20} />
          </button>
          <img
            src={previewUrl}
            alt="Full-size shell quantity reference"
            className="max-h-full max-w-full object-contain"
            style={{ transform: `rotate(${rotation}deg)` }}
          />
        </div>
      ) : null}
    </section>
  );
}
