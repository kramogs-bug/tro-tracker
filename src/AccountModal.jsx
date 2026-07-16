import { useState } from "react";
import { Cloud, Eye, EyeOff, LogIn, UserPlus, X } from "lucide-react";
import { isCloudConfigured, supabase } from "./supabaseClient.js";

const inputClass =
  "mt-1.5 w-full rounded-xl border border-[#B1D3B9] bg-white px-3 py-2.5 outline-none focus:border-[#527A70]";
const primaryClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#527A70] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#29453E] disabled:cursor-not-allowed disabled:opacity-60";

export default function AccountModal({ onClose }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    setIsError(false);
    const result =
      mode === "signup"
        ? await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: { emailRedirectTo: window.location.origin },
          })
        : await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
    setBusy(false);
    if (result.error) {
      setIsError(true);
      setMessage(result.error.message);
      return;
    }
    if (mode === "signup" && !result.data.session) {
      setMessage("Account created. Check your email to confirm, then sign in.");
      setMode("login");
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#29453E]/60 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-title"
    >
      <section className="w-full max-w-md rounded-2xl bg-[#F8FBF5] p-5 shadow-2xl sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <span className="grid size-11 place-items-center rounded-xl bg-[#E6F2DD] text-[#527A70]">
              <Cloud size={21} />
            </span>
            <h2 id="account-title" className="mt-3 text-xl font-bold">
              {mode === "signup" ? "Create cloud account" : "Sign in to sync"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-[#659287]">
              Use the same account on another device to load your tracker data.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account dialog"
            className="rounded-lg p-2 hover:bg-[#E6F2DD]"
          >
            <X size={20} />
          </button>
        </header>

        {!isCloudConfigured ? (
          <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
            Cloud sync is not configured on this deployment.
          </p>
        ) : (
          <form className="mt-5" onSubmit={submit}>
            <label className="block text-sm font-bold">
              Email
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="mt-4 block text-sm font-bold">
              Password
              <span className="relative mt-1.5 block">
                <input
                  required
                  minLength="6"
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`${inputClass} mt-0 pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[#659287]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            {message ? (
              <p
                className={`mt-4 rounded-xl p-3 text-sm font-bold ${isError ? "bg-red-50 text-red-700" : "bg-[#E6F2DD] text-[#527A70]"}`}
                role={isError ? "alert" : "status"}
              >
                {message}
              </p>
            ) : null}
            <button disabled={busy} className={`mt-5 w-full ${primaryClass}`}>
              {mode === "signup" ? <UserPlus size={17} /> : <LogIn size={17} />}
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={() => {
            setMode((current) => (current === "login" ? "signup" : "login"));
            setMessage("");
            setIsError(false);
          }}
          className="mt-4 w-full text-center text-sm font-bold text-[#527A70]"
        >
          {mode === "login"
            ? "No account? Create one"
            : "Already have an account? Sign in"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-center text-xs text-[#659287]"
        >
          Continue without account · local save only
        </button>
      </section>
    </div>
  );
}
