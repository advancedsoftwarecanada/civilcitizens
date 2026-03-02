"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useInviteViewStore } from "../../../../../../../_lib/inviteViewStore";
import BackgroundVideo from "../../../../../../../_components/BackgroundVideo";

const ORG_INVITE_TOKEN_KEY = "civil.orgInviteToken";

type InviteResolveResponse = {
  invite?: {
    token: string;
    message: string | null;
    viewCount: number;
    registrationCount: number;
    joinCount: number;
  };
  viewer?: {
    id: string | null;
    isInviteOwner: boolean;
  };
  inviter?: {
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
    coverUrl: string | null;
  } | null;
  organization?: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    coverUrl: string | null;
    logoUrl: string | null;
    provinceCode: string;
    communitySlug: string;
  };
  error?: string;
};

export default function OrganizationInviteLandingPage() {
  const params = useParams<{ province: string; municipality: string; organization: string; token: string }>();
  const router = useRouter();

  const province = typeof params?.province === "string" ? params.province : "";
  const municipality = typeof params?.municipality === "string" ? params.municipality : "";
  const organization = typeof params?.organization === "string" ? params.organization : "";
  const token = typeof params?.token === "string" ? params.token : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InviteResolveResponse | null>(null);
  const [isGuestTemplate, setIsGuestTemplate] = useState(true);
  const inviteGuestMode = useInviteViewStore((state) => state.inviteGuestMode);
  const setInviteGuestMode = useInviteViewStore((state) => state.setInviteGuestMode);

  useEffect(() => {
    let cancelled = false;
    if (inviteGuestMode === null) {
      setInviteGuestMode(true);
      setIsGuestTemplate(true);
    }

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const tokenValue = typeof window !== "undefined" ? window.localStorage.getItem("token") : null;
        const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (tokenValue) {
          authHeaders.authorization = `Bearer ${tokenValue}`;
        }

        const response = await fetch(
          `/api/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/invite/${encodeURIComponent(token)}/resolve`,
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({}),
          },
        );
        const payload: InviteResolveResponse = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError(payload?.error || "Unable to load invite.");
          setIsGuestTemplate(true);
          setInviteGuestMode(true);
          return;
        }
        setData(payload);

        const ownerView = payload?.viewer?.isInviteOwner === true;
        const guestMode = !ownerView;
        setIsGuestTemplate(guestMode);
        setInviteGuestMode(guestMode);
      } catch {
        if (!cancelled) {
          setError("Unable to load invite.");
          setIsGuestTemplate(true);
          setInviteGuestMode(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (province && municipality && organization && token) {
      void run();
    } else {
      setError("Invalid invite link.");
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [province, municipality, organization, token, setInviteGuestMode, inviteGuestMode]);

  const landingPath = useMemo(() => {
    return `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/invite/${encodeURIComponent(token)}`;
  }, [province, municipality, organization, token]);

  const landingAbsoluteUrl = useMemo(() => {
    if (typeof window === "undefined") return landingPath;
    return `${window.location.origin}${landingPath}`;
  }, [landingPath]);

  const qrUrl = useMemo(() => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(landingAbsoluteUrl)}`;
  }, [landingAbsoluteUrl]);

  const inviterName = data?.inviter?.name || (data?.inviter?.handle ? `@${data.inviter.handle}` : "A Civil member");
  const orgName = data?.organization?.name || "this organization";

  const handleJoinCivil = () => {
    try {
      window.localStorage.setItem(ORG_INVITE_TOKEN_KEY, token);
    } catch {}
    router.push(`/register?orgInviteToken=${encodeURIComponent(token)}`);
  };

  if (loading) {
    if (isGuestTemplate) {
      return (
        <div className="relative min-h-screen overflow-hidden">
          <BackgroundVideo fixed />
          <div className="absolute inset-0 bg-slate-950/60" aria-hidden="true" />
          <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
            <div className="w-full max-w-3xl rounded-3xl border border-white/20 bg-white/90 p-6 text-sm text-neutral-700 shadow-[0_30px_120px_rgba(15,23,42,0.35)] backdrop-blur-sm">
              Loading invite…
            </div>
          </main>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-50">
        <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
          <div className="rounded-3xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600">Loading invite…</div>
        </main>
      </div>
    );
  }

  if (error || !data?.organization || !data?.invite) {
    if (isGuestTemplate) {
      return (
        <div className="relative min-h-screen overflow-hidden">
          <BackgroundVideo fixed />
          <div className="absolute inset-0 bg-slate-950/60" aria-hidden="true" />
          <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
            <div className="w-full max-w-3xl rounded-3xl border border-red-200 bg-red-50/95 p-6 text-sm text-red-700 shadow-[0_30px_120px_rgba(15,23,42,0.35)] backdrop-blur-sm">
              {error || "This invite is unavailable."}
            </div>
          </main>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-50">
        <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {error || "This invite is unavailable."}
          </div>
        </main>
      </div>
    );
  }

  const inviteCard = (
    <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <div className="relative h-44 w-full bg-neutral-100">
        {data.organization.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.organization.coverUrl} alt={orgName} className="h-full w-full object-cover" />
        ) : data.inviter?.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.inviter.coverUrl} alt={inviterName} className="h-full w-full object-cover" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
        <div className="absolute bottom-4 left-4 flex items-center gap-3 text-white">
          <div className="h-14 w-14 overflow-hidden rounded-full border border-white/70 bg-white/20">
            {data.organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.organization.logoUrl} alt={orgName} className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-white/80">Organization invite</p>
            <p className="text-lg font-semibold">{orgName}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-5 md:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <div className="relative inline-flex items-center gap-3 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
            {data.inviter?.coverUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.inviter.coverUrl} alt={`${inviterName} cover`} className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-black/45" />
              </>
            ) : null}
            <div className="relative h-9 w-9 overflow-hidden rounded-full bg-neutral-200">
              {data.inviter?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.inviter.avatarUrl} alt={inviterName} className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="relative">
              <p className={`text-[11px] uppercase tracking-wide ${data.inviter?.coverUrl ? "text-white/80" : "text-neutral-500"}`}>Invited by</p>
              <p className={`text-sm font-semibold ${data.inviter?.coverUrl ? "text-white" : "text-neutral-800"}`}>{inviterName}</p>
            </div>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Join {orgName} on Civil</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Build momentum in {data.organization.communitySlug.replace(/-/g, " ")} with your local civic organization.
            </p>
          </div>

          {data.invite.message ? (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              “{data.invite.message}”
            </div>
          ) : null}

          {data.organization.description ? (
            <p className="text-sm leading-6 text-neutral-700">{data.organization.description}</p>
          ) : null}

          {!isGuestTemplate ? (
            <div className="grid grid-cols-3 gap-2 text-center text-xs sm:max-w-md">
              <div className="rounded-xl border border-neutral-200 px-3 py-2">
                <p className="text-neutral-500">Views</p>
                <p className="text-base font-semibold text-neutral-900">{data.invite.viewCount}</p>
              </div>
              <div className="rounded-xl border border-neutral-200 px-3 py-2">
                <p className="text-neutral-500">Signups</p>
                <p className="text-base font-semibold text-neutral-900">{data.invite.registrationCount}</p>
              </div>
              <div className="rounded-xl border border-neutral-200 px-3 py-2">
                <p className="text-neutral-500">Joins</p>
                <p className="text-base font-semibold text-neutral-900">{data.invite.joinCount}</p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleJoinCivil}
              className="rounded-xl bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
            >
              Join Civil
            </button>
          </div>
          <p className="text-xs text-neutral-500">Finish signup and you will be automatically connected to this organization invite.</p>
        </div>

        <aside className="space-y-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <div className="text-sm font-semibold text-neutral-800">Invite QR code</div>
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt="Invite QR code" className="h-auto w-full" />
          </div>
          <p className="text-xs text-neutral-600">Scan this QR code to open this invite page directly.</p>
        </aside>
      </div>
    </div>
  );

  if (isGuestTemplate) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <BackgroundVideo fixed />
        <div className="absolute inset-0 bg-slate-950/60" aria-hidden="true" />
        <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
          <div className="w-full max-w-5xl space-y-4">
            <div className="flex justify-center">
              <Link href="/" className="inline-flex items-center" aria-label="Civil Citizens home">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-white.svg" alt="Civil Citizens" className="h-14 w-auto" />
              </Link>
            </div>
            {inviteCard}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {inviteCard}
      </main>
    </div>
  );
}
