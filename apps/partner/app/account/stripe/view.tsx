"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { trackOnce } from "@/components/Analytics";
import type { AccountSnapshot, BusinessProfileInput } from "@repo/data/stripe";
import {
  acceptStripeTerms,
  disconnectStripe,
  refreshStripeStatus,
  startStripeOnboarding,
  submitStripeBankAccount,
  submitStripeBusinessProfile,
  type StripeActionResult,
} from "./actions";
import {
  currentStep,
  dueRequirements,
  requirementLabelKey,
  stepForRequirement,
  type StripeStep,
} from "./steps";
import { COUNTRY_OPTIONS } from "./countries";

const EmbeddedManagement = dynamic(() => import("./embedded"), { ssr: false });

interface AccountDefaults {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  company: string;
  address: string;
  city: string;
  postalCode: string;
  country: string | null;
  businessId: string;
}

interface Props {
  account: AccountDefaults;
  stripeConnectAccountId: string | null;
  detailsSubmitted: boolean;
  onboardingStatus: string | null;
  requirementsDue: string[];
}

const STEPS: { id: StripeStep; labelKey: string }[] = [
  { id: "business-type", labelKey: "stepBusinessType" },
  { id: "details", labelKey: "stepDetails" },
  { id: "bank", labelKey: "stepBank" },
  { id: "terms", labelKey: "stepTerms" },
  { id: "status", labelKey: "stepStatus" },
];

const STATUS_STYLE: Record<string, { cls: string; key: string }> = {
  complete: { cls: "bg-green-50 text-green-700", key: "statusComplete" },
  pending_verification: {
    cls: "bg-amber-50 text-amber-700",
    key: "statusPending",
  },
  restricted: { cls: "bg-red-50 text-red-700", key: "statusRestricted" },
  in_progress: { cls: "bg-amber-50 text-amber-700", key: "statusInProgress" },
};

interface PersonForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string;
  line1: string;
  city: string;
  postalCode: string;
  idNumber: string;
  nationality: string;
}

interface OwnerForm {
  firstName: string;
  lastName: string;
  email: string;
  dob: string;
  sameAddress: boolean;
  line1: string;
  city: string;
  postalCode: string;
  nationality: string;
  percent: string;
}

const MAX_OWNERS = 4;
const PHONE_RE = /^\+?[0-9 ()-]{6,20}$/;

function parseDob(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function SelectInput({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { code: string; label: string }[];
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-gray-700 mb-1"
      >
        {label}
      </label>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  readOnly,
  hint,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange?: (v: string) => void;
  type?: string;
  readOnly?: boolean;
  hint?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-gray-700 mb-1"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="input"
        value={value}
        readOnly={readOnly}
        autoComplete={autoComplete}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

export default function StripeView({
  account,
  stripeConnectAccountId,
  detailsSubmitted: initialSubmitted,
  onboardingStatus: initialStatus,
  requirementsDue,
}: Props) {
  const t = useTranslations("StripeConnect");
  const [pending, startTransition] = useTransition();
  const [hasAccount, setHasAccount] = useState(!!stripeConnectAccountId);
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [status, setStatus] = useState(initialStatus);
  const [errors, setErrors] = useState<string[]>([]);
  const columns = {
    stripeConnectAccountId: hasAccount
      ? (stripeConnectAccountId ?? "pending")
      : null,
    stripeConnectRequirementsDue: requirementsDue,
  };
  const derived = currentStep(columns, snapshot);
  const [openOverride, setOpenOverride] = useState<StripeStep | null>(null);
  const open = openOverride ?? derived;

  const due = hasAccount ? dueRequirements(columns, snapshot) : [];
  const groupsDue = new Set(due.map(stepForRequirement));
  const isDone = (s: StripeStep) =>
    s === "business-type"
      ? hasAccount
      : s === "status"
        ? false
        : hasAccount && !groupsDue.has(s);

  const [businessType, setBusinessType] = useState<"company" | "individual">(
    "company",
  );

  function apply(r: StripeActionResult, after?: () => void) {
    if (r.status === "error") {
      setErrors(r.errors);
      return;
    }
    setErrors([]);
    setHasAccount(true);
    setSnapshot(r.snapshot);
    setSubmitted(r.snapshot.detailsSubmitted);
    setStatus(r.snapshot.status);
    // GA4: the moment onboarding completes (observed transition, not merely visiting a complete account).
    if (r.snapshot.status === "complete") trackOnce("payments_connected:stripe", "payments_connected", { provider: "stripe" });
    setOpenOverride(null);
    after?.();
  }

  function run(fn: () => Promise<StripeActionResult>) {
    setErrors([]);
    startTransition(async () => apply(await fn()));
  }

  // ---- Step 1
  const countryMissing = !account.country;
  const stepBusinessType = (
    <div className="space-y-3">
      {countryMissing && (
        <div
          role="status"
          className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800"
        >
          {t("countryMissing")}{" "}
          <Link href="/account" className="underline font-medium">
            {t("countryMissingLink")}
          </Link>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {(["company", "individual"] as const).map((bt) => (
          <button
            key={bt}
            type="button"
            disabled={pending || countryMissing}
            onClick={() => {
              setBusinessType(bt);
              run(() => startStripeOnboarding(bt));
            }}
            className="text-left border border-gray-200 rounded-xl p-4 hover:border-gray-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <span className="block text-sm font-semibold text-gray-900">
              {t(bt === "company" ? "typeCompany" : "typeIndividual")}
            </span>
            <span className="block text-xs text-gray-500 mt-1">
              {t(bt === "company" ? "typeCompanyDesc" : "typeIndividualDesc")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle")}</p>
      </div>

      {errors.length > 0 && (
        <div
          role="status"
          className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4"
        >
          <ul className="text-sm text-red-800 list-disc pl-4">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <ol className="space-y-3">
        {STEPS.map((s, idx) => {
          const done = isDone(s.id);
          const isOpen = open === s.id;
          const locked = !hasAccount && s.id !== "business-type";
          return (
            <li key={s.id} className="card">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                      done
                        ? "bg-green-50 text-green-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {done ? "✓" : idx + 1}
                  </span>
                  {t(s.labelKey)}
                </h2>
                {done && !isOpen && (
                  <button
                    type="button"
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
                    onClick={() => setOpenOverride(s.id)}
                  >
                    {t("edit")}
                  </button>
                )}
              </div>
              {isOpen && !locked && (
                <div className="mt-4">
                  {s.id === "business-type" && stepBusinessType}
                  {s.id === "details" && (
                    <DetailsForm
                      account={account}
                      snapshotType={businessType}
                      pending={pending}
                      onSubmit={(input) =>
                        run(() => submitStripeBusinessProfile(input))
                      }
                      onInvalid={() => setErrors([t("validationRequired")])}
                      onBadDob={() => setErrors([t("validationDob")])}
                      onBadPhone={() => setErrors([t("validationPhone")])}
                    />
                  )}
                  {s.id === "bank" && (
                    <BankForm
                      defaultHolder={
                        account.company ||
                        `${account.firstName} ${account.lastName}`.trim()
                      }
                      pending={pending}
                      onSubmit={(iban, holder) =>
                        run(() =>
                          submitStripeBankAccount({
                            iban,
                            accountHolderName: holder,
                          }),
                        )
                      }
                      onInvalid={() => setErrors([t("validationIban")])}
                    />
                  )}
                  {s.id === "terms" && (
                    <TermsForm
                      pending={pending}
                      onSubmit={() => run(() => acceptStripeTerms())}
                    />
                  )}
                  {s.id === "status" && (
                    <StatusPanel
                      status={status}
                      due={due}
                      pending={pending}
                      onContinue={(step) => setOpenOverride(step)}
                      onRefresh={() => run(() => refreshStripeStatus())}
                      onDisconnect={() => {
                        if (!confirm(t("disconnectConfirm"))) return;
                        startTransition(async () => {
                          const r = await disconnectStripe();
                          if (r.status === "error") {
                            setErrors(r.errors);
                            return;
                          }
                          setErrors([]);
                          setHasAccount(false);
                          setSnapshot(null);
                          setSubmitted(false);
                          setStatus(null);
                          setOpenOverride(null);
                        });
                      }}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {submitted && hasAccount && (
        <section className="card mt-6" aria-labelledby="stripe-account-heading">
          <h2
            id="stripe-account-heading"
            className="text-sm font-semibold text-gray-900 mb-4"
          >
            {t("embeddedTitle")}
          </h2>
          <EmbeddedManagement />
        </section>
      )}
    </div>
  );
}

function StatusPanel({
  status,
  due,
  pending,
  onContinue,
  onRefresh,
  onDisconnect,
}: {
  status: string | null;
  due: string[];
  pending: boolean;
  onContinue: (s: StripeStep) => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const t = useTranslations("StripeConnect");
  const style = (status && STATUS_STYLE[status]) || {
    cls: "bg-gray-100 text-gray-600",
    key: "statusNotStarted",
  };
  return (
    <div className="space-y-4">
      <span className={`badge ${style.cls}`}>{t(style.key)}</span>
      {due.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-700 mb-2">
            {t("requirementsTitle")}
          </p>
          <ul className="space-y-1">
            {due.map((k) => {
              const lk = requirementLabelKey(k);
              const step = stepForRequirement(k);
              return (
                <li
                  key={k}
                  className="flex items-center justify-between text-sm text-gray-700"
                >
                  <span>{lk ? t(lk) : k}</span>
                  {step !== "status" && (
                    <button
                      type="button"
                      className="text-xs font-medium text-gray-900 underline"
                      onClick={() => onContinue(step)}
                    >
                      {t("continue")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          onClick={onRefresh}
        >
          {t("refresh")}
        </button>
        <button
          type="button"
          className="btn-secondary text-red-600"
          disabled={pending}
          onClick={onDisconnect}
        >
          {t("disconnect")}
        </button>
      </div>
    </div>
  );
}

function BankForm({
  defaultHolder,
  pending,
  onSubmit,
  onInvalid,
}: {
  defaultHolder: string;
  pending: boolean;
  onSubmit: (iban: string, holder: string) => void;
  onInvalid: () => void;
}) {
  const t = useTranslations("StripeConnect");
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState(defaultHolder);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = iban.replace(/\s+/g, "").toUpperCase();
        if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean) || !holder.trim())
          return onInvalid();
        onSubmit(clean, holder.trim());
      }}
    >
      <p className="text-xs text-gray-500">{t("bankIntro")}</p>
      <Field
        id="stripe-iban"
        label={t("iban")}
        value={iban}
        onChange={setIban}
        autoComplete="off"
      />
      <Field
        id="stripe-holder"
        label={t("holderName")}
        value={holder}
        onChange={setHolder}
      />
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? t("saving") : t("saveBank")}
      </button>
    </form>
  );
}

function TermsForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: () => void;
}) {
  const t = useTranslations("StripeConnect");
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{t("termsIntro")}</p>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          {t("termsAgree")}{" "}
          <a
            href="https://stripe.com/connect-account/legal/full"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t("termsStripe")}
          </a>{" "}
          {t("termsAnd")}{" "}
          <Link
            href="/legal/merchant-agreement"
            target="_blank"
            className="underline"
          >
            {t("termsSunbnb")}
          </Link>
        </span>
      </label>
      <button
        type="button"
        className="btn-primary"
        disabled={!agreed || pending}
        onClick={onSubmit}
      >
        {pending ? t("saving") : t("submitStripe")}
      </button>
    </div>
  );
}

function DetailsForm({
  account,
  snapshotType,
  pending,
  onSubmit,
  onInvalid,
  onBadDob,
  onBadPhone,
}: {
  account: AccountDefaults;
  snapshotType: "company" | "individual";
  pending: boolean;
  onSubmit: (input: BusinessProfileInput) => void;
  onInvalid: () => void;
  onBadDob: () => void;
  onBadPhone: () => void;
}) {
  const t = useTranslations("StripeConnect");
  // After a reload the chosen type is not in local state; company is the default and the
  // business-type step can be reopened to switch.
  const [type, setType] = useState<"company" | "individual">(snapshotType);
  const country = account.country ?? "";
  const [company, setCompany] = useState({
    name: account.company,
    taxId: account.businessId,
    phone: account.phone,
    line1: account.address,
    city: account.city,
    postalCode: account.postalCode,
  });
  const [person, setPerson] = useState<PersonForm>({
    firstName: account.firstName,
    lastName: account.lastName,
    email: account.email,
    phone: account.phone,
    dob: "",
    line1: account.address,
    city: account.city,
    postalCode: account.postalCode,
    idNumber: "",
    nationality: country,
  });
  const [owners, setOwners] = useState<OwnerForm[]>([]);
  const [sameAddress, setSameAddress] = useState(true);
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState(false);
  const [percent, setPercent] = useState("");
  const [url, setUrl] = useState("");
  const setP = (k: keyof PersonForm) => (v: string) =>
    setPerson((p) => ({ ...p, [k]: v }));
  const setC = (k: keyof typeof company) => (v: string) =>
    setCompany((p) => ({ ...p, [k]: v }));

  const requiredOwnerFields = (o: OwnerForm) => [
    o.firstName,
    o.lastName,
    o.email,
    o.dob,
    ...(o.sameAddress ? [] : [o.line1, o.city, o.postalCode]),
  ];
  const setO = (i: number, patch: Partial<OwnerForm>) =>
    setOwners((list) =>
      list.map((o, idx) => (idx === i ? { ...o, ...patch } : o)),
    );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const addr =
      type === "company" && sameAddress
        ? {
            line1: company.line1,
            city: company.city,
            postal_code: company.postalCode,
            country,
          }
        : {
            line1: person.line1,
            city: person.city,
            postal_code: person.postalCode,
            country,
          };
    const required = [
      person.firstName,
      person.lastName,
      person.email,
      person.dob,
      addr.line1,
      addr.city,
      addr.postal_code,
      country,
      person.phone,
      ...(type === "company"
        ? [
            company.name,
            company.taxId,
            company.phone,
            company.line1,
            company.city,
            company.postalCode,
            title,
          ]
        : []),
      ...(type === "company" ? owners.flatMap(requiredOwnerFields) : []),
    ];
    if (required.some((v) => !v.trim())) return onInvalid();
    if (
      !PHONE_RE.test(person.phone.trim()) ||
      (type === "company" && !PHONE_RE.test(company.phone.trim()))
    ) {
      return onBadPhone();
    }
    const dob = parseDob(person.dob);
    if (!dob) return onBadDob();
    const ownerInputs = [];
    if (type === "company") {
      for (const o of owners) {
        const odob = parseDob(o.dob);
        if (!odob) return onBadDob();
        ownerInputs.push({
          first_name: o.firstName.trim(),
          last_name: o.lastName.trim(),
          email: o.email.trim(),
          dob: odob,
          address: o.sameAddress
            ? {
                line1: company.line1.trim(),
                city: company.city.trim(),
                postal_code: company.postalCode.trim(),
                country,
              }
            : {
                line1: o.line1.trim(),
                city: o.city.trim(),
                postal_code: o.postalCode.trim(),
                country,
              },
          ...(o.nationality ? { nationality: o.nationality } : {}),
          ...(o.percent !== "" ? { percent_ownership: Number(o.percent) } : {}),
        });
      }
    }
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const personFields = {
      first_name: person.firstName.trim(),
      last_name: person.lastName.trim(),
      email: person.email.trim(),
      phone: person.phone.trim(),
      ...(person.nationality ? { nationality: person.nationality } : {}),
      dob,
      address: addr,
    };
    const base = { ...(opt(url) ? { url: opt(url) } : {}) };
    if (type === "company") {
      onSubmit({
        businessType: "company",
        company: {
          name: company.name.trim(),
          tax_id: opt(company.taxId),
          phone: company.phone.trim(),
          address: {
            line1: company.line1.trim(),
            city: company.city.trim(),
            postal_code: company.postalCode.trim(),
            country,
          },
        },
        representative: {
          ...personFields,
          title: title.trim(),
          owner,
          ...(owner && percent !== ""
            ? { percent_ownership: Number(percent) }
            : {}),
          id_number: opt(person.idNumber),
        },
        ...(ownerInputs.length ? { owners: ownerInputs } : {}),
        ...base,
      });
    } else {
      onSubmit({
        businessType: "individual",
        individual: { ...personFields, id_number: opt(person.idNumber) },
        ...base,
      });
    }
  }

  const addressFields = (
    v: { line1: string; city: string; postalCode: string },
    set: (k: "line1" | "city" | "postalCode") => (x: string) => void,
    prefix: string,
  ) => (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <Field
          id={`${prefix}-line1`}
          label={t("addressLine")}
          value={v.line1}
          onChange={set("line1")}
        />
      </div>
      <Field
        id={`${prefix}-city`}
        label={t("city")}
        value={v.city}
        onChange={set("city")}
      />
      <Field
        id={`${prefix}-postal`}
        label={t("postalCode")}
        value={v.postalCode}
        onChange={set("postalCode")}
      />
      <Field
        id={`${prefix}-country`}
        label={t("country")}
        value={country}
        readOnly
      />
    </div>
  );

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div
        className="flex gap-4 text-sm text-gray-700"
        role="radiogroup"
        aria-label={t("stepBusinessType")}
      >
        {(["company", "individual"] as const).map((bt) => (
          <label key={bt} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="bt"
              checked={type === bt}
              onChange={() => setType(bt)}
            />
            {t(bt === "company" ? "typeCompany" : "typeIndividual")}
          </label>
        ))}
      </div>

      {type === "company" && (
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold text-gray-900 mb-2">
            {t("businessSection")}
          </legend>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              id="co-name"
              label={t("legalName")}
              value={company.name}
              onChange={setC("name")}
            />
            <Field
              id="co-tax"
              label={t("taxId")}
              value={company.taxId}
              onChange={setC("taxId")}
            />
            <Field
              id="co-phone"
              label={t("phone")}
              value={company.phone}
              onChange={setC("phone")}
              type="tel"
            />
          </div>
          {addressFields(company, setC, "co")}
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold text-gray-900 mb-2">
          {t(type === "company" ? "representative" : "personSection")}
        </legend>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field
            id="p-first"
            label={t("firstName")}
            value={person.firstName}
            onChange={setP("firstName")}
          />
          <Field
            id="p-last"
            label={t("lastName")}
            value={person.lastName}
            onChange={setP("lastName")}
          />
          <Field
            id="p-email"
            label={t("email")}
            value={person.email}
            onChange={setP("email")}
            type="email"
          />
          <Field
            id="p-phone"
            label={t("phone")}
            value={person.phone}
            onChange={setP("phone")}
            type="tel"
          />
          <Field
            id="p-dob"
            label={t("dob")}
            value={person.dob}
            onChange={setP("dob")}
            type="date"
          />
          <SelectInput
            id="p-nationality"
            label={t("nationality")}
            value={person.nationality}
            onChange={setP("nationality")}
            options={COUNTRY_OPTIONS}
          />
          <Field
            id="p-id"
            label={t("idNumber")}
            value={person.idNumber}
            onChange={setP("idNumber")}
            hint={t("idNumberHint")}
          />
        </div>
        {type === "company" && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={sameAddress}
              onChange={(e) => setSameAddress(e.target.checked)}
            />
            {t("sameAddress")}
          </label>
        )}
        {(type === "individual" || !sameAddress) &&
          addressFields(person, setP, "p")}
        {type === "company" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              id="p-title"
              label={t("jobTitle")}
              value={title}
              onChange={setTitle}
            />
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                <input
                  type="checkbox"
                  checked={owner}
                  onChange={(e) => setOwner(e.target.checked)}
                />
                {t("isOwner")}
              </label>
              {owner && (
                <div className="flex-1">
                  <Field
                    id="p-percent"
                    label={t("ownership")}
                    value={percent}
                    onChange={setPercent}
                    type="number"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </fieldset>

      {type === "company" && (
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold text-gray-900 mb-2">
            {t("ownersSection")}
          </legend>
          <p className="text-xs text-gray-500">{t("ownersHint")}</p>
          {owners.map((o, i) => (
            <div
              key={i}
              className="border border-gray-200 rounded-xl p-3 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">
                  {t("ownerN", { n: i + 1 })}
                </span>
                <button
                  type="button"
                  className="text-xs font-medium text-red-600 underline"
                  onClick={() =>
                    setOwners((list) => list.filter((_, idx) => idx !== i))
                  }
                >
                  {t("removeOwner")}
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field
                  id={`o${i}-first`}
                  label={t("firstName")}
                  value={o.firstName}
                  onChange={(v) => setO(i, { firstName: v })}
                />
                <Field
                  id={`o${i}-last`}
                  label={t("lastName")}
                  value={o.lastName}
                  onChange={(v) => setO(i, { lastName: v })}
                />
                <Field
                  id={`o${i}-email`}
                  label={t("email")}
                  value={o.email}
                  onChange={(v) => setO(i, { email: v })}
                  type="email"
                />
                <Field
                  id={`o${i}-dob`}
                  label={t("dob")}
                  value={o.dob}
                  onChange={(v) => setO(i, { dob: v })}
                  type="date"
                />
                <SelectInput
                  id={`o${i}-nationality`}
                  label={t("nationality")}
                  value={o.nationality}
                  onChange={(v) => setO(i, { nationality: v })}
                  options={COUNTRY_OPTIONS}
                />
                <Field
                  id={`o${i}-percent`}
                  label={t("ownership")}
                  value={o.percent}
                  onChange={(v) => setO(i, { percent: v })}
                  type="number"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={o.sameAddress}
                  onChange={(e) => setO(i, { sameAddress: e.target.checked })}
                />
                {t("sameAddress")}
              </label>
              {!o.sameAddress && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <Field
                      id={`o${i}-line1`}
                      label={t("addressLine")}
                      value={o.line1}
                      onChange={(v) => setO(i, { line1: v })}
                    />
                  </div>
                  <Field
                    id={`o${i}-city`}
                    label={t("city")}
                    value={o.city}
                    onChange={(v) => setO(i, { city: v })}
                  />
                  <Field
                    id={`o${i}-postal`}
                    label={t("postalCode")}
                    value={o.postalCode}
                    onChange={(v) => setO(i, { postalCode: v })}
                  />
                </div>
              )}
            </div>
          ))}
          {owners.length < MAX_OWNERS && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                setOwners((list) => [
                  ...list,
                  {
                    firstName: "",
                    lastName: "",
                    email: "",
                    dob: "",
                    sameAddress: true,
                    line1: "",
                    city: "",
                    postalCode: "",
                    nationality: country,
                    percent: "",
                  },
                ])
              }
            >
              {t("addOwner")}
            </button>
          )}
        </fieldset>
      )}

      <Field
        id="site-url"
        label={t("website")}
        value={url}
        onChange={setUrl}
        type="url"
        hint={t("websiteHint")}
      />

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? t("saving") : t("saveDetails")}
      </button>
    </form>
  );
}
