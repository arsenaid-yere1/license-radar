"use client";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { enrollmentMessage } from "@/lib/sms/messages";
import { otpDisclosure, reminderDisclosure } from "@/lib/sms/disclosures";
import type { Enrollment, SmsAction, SmsState } from "@/lib/sms/schema";
const subscribe = () => () => {};
function useEnrollment(enrollment: Enrollment, action: SmsAction) {
  const router = useRouter();
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [committed, setCommitted] = useState(enrollment);
  const [source, setSource] = useState(enrollment);
  if (source !== enrollment) {
    setSource(enrollment);
    if (enrollment.version >= committed.version) setCommitted(enrollment);
  }
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  const [state, submit, pending] = useActionState<SmsState, FormData>(
    async (previous, form) => {
      form.set("requestId", crypto.randomUUID());
      let next: SmsState;
      try {
        next = await action(previous, form);
      } catch {
        next = {
          status: "uncertain",
          message:
            "We could not confirm this change. Reload before continuing.",
        };
      } finally {
        setCode("");
      }
      if (next.enrollment) setCommitted(next.enrollment);
      return next;
    },
    { status: "idle" },
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
    if (state.message) feedback.current?.focus();
  }, [state, router]);
  const reloadRequired = [
    "conflict",
    "uncertain",
    "busy",
    "verification-required",
  ].includes(state.status);
  const disabled = pending || !ready || reloadRequired;
  return {
    committed,
    state,
    submit,
    pending,
    ready,
    phone,
    setPhone,
    code,
    setCode,
    feedback,
    reloadRequired,
    disabled,
  };
}
type FormProps = ReturnType<typeof useEnrollment>;
function SendForm({ model }: { model: FormProps }) {
  const { committed, submit, disabled, pending, phone, setPhone } = model;
  return (
    <form
      action={submit}
      onReset={(event) => event.preventDefault()}
      onSubmit={(event) => {
        if (
          committed.phoneSuffix &&
          !window.confirm(
            "Changing your phone ends previous verification and reminder consent. Continue?",
          )
        )
          event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="send" />
      <input type="hidden" name="expectedVersion" value={committed.version} />
      <input
        type="hidden"
        name="changeConfirmed"
        value={committed.phoneSuffix ? "on" : "off"}
      />
      <fieldset disabled={disabled}>
        <div className="field">
          <label htmlFor="sms-phone">International phone number</label>
          <input
            id="sms-phone"
            name="phone"
            type="tel"
            autoComplete="off"
            placeholder="+12025550123"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            aria-describedby="sms-phone-help"
            required
          />
          <p id="sms-phone-help" className="hint">
            Include + and your country code. Changing your phone ends previous
            verification and reminder consent.
          </p>
        </div>
        <p className="hint">
          {otpDisclosure}{" "}
          <Link href="/sms-information">SMS terms and privacy</Link>
        </p>
        <label className="sms-choice">
          <input type="checkbox" name="otpPermission" required /> I request a
          verification text to this phone.
        </label>
        <button disabled={disabled}>
          {pending ? "Saving…" : "Request verification code"}
        </button>
      </fieldset>
    </form>
  );
}
function CheckForm({ model }: { model: FormProps }) {
  const { committed, submit, disabled, code, setCode } = model;
  return (
    <>
      {committed.challengeId && committed.reason === "verification-pending" && (
        <form action={submit} onReset={(event) => event.preventDefault()}>
          <input type="hidden" name="intent" value="check" />
          <input
            type="hidden"
            name="expectedVersion"
            value={committed.version}
          />
          <input
            type="hidden"
            name="challengeId"
            value={committed.challengeId}
          />
          <fieldset disabled={disabled}>
            <div className="field">
              <label htmlFor="sms-code">Six-digit verification code</label>
              <input
                id="sms-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </div>
            <button disabled={disabled}>Verify phone</button>
          </fieldset>
          {committed.expiresAt && (
            <p className="hint">
              This attempt expires at{" "}
              {new Date(committed.expiresAt).toLocaleTimeString()}. A resend
              does not extend its expiry.
            </p>
          )}
        </form>
      )}
    </>
  );
}
function ConsentForm({
  model,
  practiceName,
}: {
  model: FormProps;
  practiceName: string;
}) {
  const { committed, submit, disabled } = model;
  return (
    <>
      {committed.verified &&
        !committed.consented &&
        committed.reason !== "provider-opted-out" && (
          <form action={submit}>
            <input type="hidden" name="intent" value="consent" />
            <input
              type="hidden"
              name="expectedVersion"
              value={committed.version}
            />
            <fieldset disabled={disabled}>
              <p>
                {reminderDisclosure(practiceName)}{" "}
                <Link href="/sms-information">SMS terms and privacy</Link>
              </p>
              <label className="sms-choice">
                <input type="checkbox" name="consent" required /> I agree to
                renewal reminder texts for this practice.
              </label>
              <button disabled={disabled}>Enroll in renewal texts</button>
            </fieldset>
          </form>
        )}
    </>
  );
}
export function EnrollmentPanel({
  enrollment,
  configured,
  practiceName,
  action,
}: {
  enrollment: Enrollment;
  configured: boolean;
  practiceName: string;
  action: SmsAction;
}) {
  const model = useEnrollment(enrollment, action);
  const { committed, pending, ready, submit } = model;
  return (
    <section className="panel sms-panel">
      <h2>My reminder texts</h2>
      <p>{enrollmentMessage(committed.reason)}</p>
      {committed.phoneSuffix && (
        <p>Saved phone: •••• {committed.phoneSuffix}</p>
      )}
      {!configured && (
        <p className="hint">
          Text enrollment is not configured yet. You can still withdraw existing
          consent.
        </p>
      )}
      {!committed.canEdit && (
        <p className="hint">
          Only administrators and managers can verify a phone or enroll. You can
          withdraw your own consent.
        </p>
      )}
      {configured && committed.canEdit && (
        <>
          <SendForm model={model} />
          {committed.retryAfter && (
            <p className="hint">
              Next code request no earlier than{" "}
              {new Date(committed.retryAfter).toLocaleTimeString()}.
            </p>
          )}
          <CheckForm model={model} />
          <ConsentForm model={model} practiceName={practiceName} />
        </>
      )}
      {committed.phoneSuffix && (
        <form action={submit}>
          <input type="hidden" name="intent" value="withdraw" />
          <button disabled={pending || !ready}>
            Withdraw reminder consent
          </button>
        </form>
      )}
      <Feedback model={model} />
    </section>
  );
}

function Feedback({ model }: { model: FormProps }) {
  const { state, feedback, reloadRequired, committed } = model;
  return (
    <>
      {state.message && (
        <p
          ref={feedback}
          tabIndex={-1}
          role={state.status === "success" ? "status" : "alert"}
          className={state.status === "success" ? "success" : "error"}
        >
          {state.message}
        </p>
      )}
      {(reloadRequired || committed.challengeId) && (
        <a className="text-link" href="/practice/sms">
          Reload enrollment
        </a>
      )}
    </>
  );
}
