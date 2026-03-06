"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useViewerStore } from "../../_lib/viewerStore";

import Modal from "../../_components/Modal";
import { buildApiUrl } from "../../_lib/api";
import CivilCard from "../../_components/CivilCard";

type OrganizationMember = {
  userId: string;
  role: string;
  jobTitle?: string | null;
  jobDescription?: string | null;
  status: "active" | "pending" | "removed";
  joinedAt: string | null;
  invitedBy?: string | null;
  notes?: string | null;
};

type MemberProfile = {
  id: string;
  handle: string | null;
  name?: string | null;
  firstName: string | null;
  lastName: string | null;
  image: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  slug: string | null;
};

type SearchUser = {
  id: string;
  handle: string | null;
  firstName: string | null;
  lastName: string | null;
  image: string | null;
};

type OrganizationMembersPayload = {
  organizationId: string;
  slug: string;
  members: OrganizationMember[];
  profiles: Record<string, MemberProfile>;
};

type MyInviteLink = {
  id: string;
  token: string;
  createdAt: string;
  message: string | null;
  viewCount: number;
  registrationCount: number;
  joinCount: number;
  landingUrl: string;
};

type Props = {
  province: string;
  municipality: string;
  organizationSlug?: string;
  slug?: string;
  initialData?: OrganizationMembersPayload;
};

function getDisplayName(profile?: MemberProfile | SearchUser | null) {
  if (!profile) return "Unknown user";
  const toTitleCase = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b([a-z])/g, (match) => match.toUpperCase())
      .replace(/([-'’])([a-z])/g, (_match, punctuation: string, char: string) => `${punctuation}${char.toUpperCase()}`);

  if ("name" in profile && typeof profile.name === "string" && profile.name.trim().length > 0) {
    return toTitleCase(profile.name.trim());
  }
  const full = `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim();
  if (full) return toTitleCase(full);
  return profile.handle || "Unknown user";
}

function normalizeMemberRole(role: unknown): string {
  const value = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (value === "owner") return "owner";
  if (value === "manager") return "admin";
  if (value === "admin") return "admin";
  if (value === "moderator") return "moderator";
  if (value === "follower") return "member";
  if (value === "member") return "member";
  return "member";
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeMembersPayload(payload: any): { members: OrganizationMember[]; profiles: Record<string, MemberProfile> } {
  const rowsRaw = [
    ...(Array.isArray(payload?.members) ? payload.members : []),
    ...(Array.isArray(payload?.followers) ? payload.followers : []),
  ];

  const profiles: Record<string, MemberProfile> = {};
  const members: OrganizationMember[] = [];

  rowsRaw.forEach((row: any) => {
    const userId = typeof row?.userId === "string" ? row.userId : typeof row?.id === "string" ? row.id : null;
    if (!userId) return;

    const user = row?.user && typeof row.user === "object" ? row.user : null;
    const handle = typeof user?.handle === "string" ? user.handle : null;
    const name = typeof user?.name === "string" ? user.name : null;
    const avatarUrl = typeof user?.avatarUrl === "string" ? user.avatarUrl : typeof row?.image === "string" ? row.image : null;
    const coverUrl = typeof user?.coverUrl === "string" ? user.coverUrl : null;

    profiles[userId] = {
      id: userId,
      handle,
      name,
      firstName: null,
      lastName: null,
      image: avatarUrl,
      avatarUrl,
      coverUrl,
      slug: null,
    };

    members.push({
      userId,
      role: normalizeMemberRole(row?.role),
      jobTitle: typeof row?.jobTitle === "string" && row.jobTitle.trim().length > 0 ? row.jobTitle.trim() : null,
      jobDescription: typeof row?.jobDescription === "string" && row.jobDescription.trim().length > 0 ? row.jobDescription.trim() : null,
      status: "active",
      joinedAt: parseIsoDate(row?.joinedAt),
      invitedBy: null,
      notes: null,
    });
  });

  return { members, profiles };
}

export default function OrganizationMembersClient({
  province,
  municipality,
  organizationSlug,
  slug,
  initialData,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const resolvedOrganizationSlug = (organizationSlug ?? slug ?? "").trim();
  const initialNormalized = useMemo(() => {
    if (!initialData) return { members: [] as OrganizationMember[], profiles: {} as Record<string, MemberProfile> };
    if (initialData.profiles && typeof initialData.profiles === "object") {
      return {
        members: Array.isArray(initialData.members) ? initialData.members : [],
        profiles: initialData.profiles,
      };
    }
    return normalizeMembersPayload(initialData as any);
  }, [initialData]);

  const [members, setMembers] = useState<OrganizationMember[]>(initialNormalized.members);
  const [profiles, setProfiles] = useState<Record<string, MemberProfile>>(initialNormalized.profiles);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [loadedFromApi, setLoadedFromApi] = useState<boolean>(Boolean(initialData));

  const [inviteUsersOpen, setInviteUsersOpen] = useState(false);
  const [inviteUrlOpen, setInviteUrlOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [memberFilterQuery, setMemberFilterQuery] = useState("");
  const [inviteMessage, setInviteMessage] = useState("I'd love for you to join this organization on Civil.");
  const [inviteBusy, setInviteBusy] = useState(false);

  const [linkMessage, setLinkMessage] = useState("Join my organization on Civil and help us grow our impact.");
  const [linkBusy, setLinkBusy] = useState(false);
  const [myInviteLinks, setMyInviteLinks] = useState<MyInviteLink[]>([]);
  const [inviteLinksLoading, setInviteLinksLoading] = useState(false);

  const currentUserIdFromStore = useViewerStore((state) => state.me?.id ?? null);
  const [currentUserIdFallback, setCurrentUserIdFallback] = useState<string | null>(null);
  const currentUserId = currentUserIdFromStore ?? currentUserIdFallback;

  const currentMembership = useMemo(() => {
    if (!currentUserId) return null;
    return members.find((member) => member.userId === currentUserId) ?? null;
  }, [currentUserId, members]);

  const canModerate = useMemo(() => {
    if (!currentMembership) return false;
    if (currentMembership.status !== "active") return false;
    return currentMembership.role === "owner" || currentMembership.role === "admin";
  }, [currentMembership]);

  const showManagerTools = useMemo(() => {
    if (!canModerate) return false;
    if (!pathname) return false;
    return pathname.includes("/settings/members");
  }, [canModerate, pathname]);

  const getAuthHeaders = useCallback(() => {
    const headers: Record<string, string> = {};
    const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null;
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }, []);

  useEffect(() => {
    if (currentUserIdFromStore) return;
    let cancelled = false;

    const run = async () => {
      try {
        const response = await fetch(buildApiUrl("/me"), {
          headers: getAuthHeaders(),
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (cancelled || !response.ok) return;
        const id =
          typeof payload?.id === "string"
            ? payload.id
            : typeof payload?.me?.id === "string"
              ? payload.me.id
              : typeof payload?.user?.id === "string"
                ? payload.user.id
                : null;
        if (id) setCurrentUserIdFallback(id);
      } catch {
        // ignore
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [currentUserIdFromStore, getAuthHeaders]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!inviteUsersOpen || trimmed.length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "10" });
        const response = await fetch(buildApiUrl(`/search/users?${params.toString()}`), {
          headers: getAuthHeaders(),
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setSearchResults([]);
          return;
        }

        const usersRaw =
          Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.users) ? payload.users : Array.isArray(payload) ? payload : [];
        const users = usersRaw
          .map((item: any): SearchUser | null => {
            const id = typeof item?.id === "string" ? item.id : null;
            if (!id) return null;
            return {
              id,
              handle: typeof item?.handle === "string" ? item.handle : null,
              firstName: typeof item?.firstName === "string" ? item.firstName : null,
              lastName: typeof item?.lastName === "string" ? item.lastName : null,
              image: typeof item?.image === "string" ? item.image : null,
            };
          })
          .filter((item: SearchUser | null): item is SearchUser => Boolean(item))
          .filter((user: SearchUser) => !members.some((member) => member.userId === user.id));

        setSearchResults(users.slice(0, 10));
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [searchQuery, inviteUsersOpen, members, getAuthHeaders]);

  const refreshMembers = useCallback(async () => {
    if (!resolvedOrganizationSlug) {
      throw new Error("Organization slug is required.");
    }

    const endpoint = buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(resolvedOrganizationSlug)}/members`);
    const response = await fetch(endpoint, {
      headers: getAuthHeaders(),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Unable to refresh members.");
    }

    const normalized = normalizeMembersPayload(payload);
    setMembers(normalized.members);
    setProfiles(normalized.profiles);
    setLoadedFromApi(true);
  }, [getAuthHeaders, municipality, province, resolvedOrganizationSlug]);

  const refreshMyInviteLinks = useCallback(async () => {
    if (!resolvedOrganizationSlug || !currentUserId) {
      setMyInviteLinks([]);
      return;
    }
    setInviteLinksLoading(true);
    try {
      const endpoint = buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(resolvedOrganizationSlug)}/governance/invite-links`);
      const response = await fetch(endpoint, {
        headers: getAuthHeaders(),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) {
          setMyInviteLinks([]);
          return;
        }
        throw new Error(payload?.error || "Unable to load invite pages.");
      }

      const rows = Array.isArray(payload?.inviteLinks) ? payload.inviteLinks : [];
      const normalized = rows
        .map((row: any): MyInviteLink | null => {
          const id = typeof row?.id === "string" ? row.id : null;
          const tokenValue = typeof row?.token === "string" ? row.token : null;
          const landingUrl = typeof row?.landingUrl === "string" ? row.landingUrl : null;
          if (!id || !tokenValue || !landingUrl) return null;
          return {
            id,
            token: tokenValue,
            createdAt: typeof row?.createdAt === "string" ? row.createdAt : new Date().toISOString(),
            message: typeof row?.message === "string" ? row.message : null,
            viewCount: typeof row?.viewCount === "number" ? row.viewCount : 0,
            registrationCount: typeof row?.registrationCount === "number" ? row.registrationCount : 0,
            joinCount: typeof row?.joinCount === "number" ? row.joinCount : 0,
            landingUrl,
          };
        })
        .filter((item: MyInviteLink | null): item is MyInviteLink => Boolean(item));

      setMyInviteLinks(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load invite pages.");
    } finally {
      setInviteLinksLoading(false);
    }
  }, [currentUserId, getAuthHeaders, municipality, province, resolvedOrganizationSlug]);

  useEffect(() => {
    if (loadedFromApi) return;
    let cancelled = false;

    const run = async () => {
      try {
        await refreshMembers();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load members.");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadedFromApi, refreshMembers]);

  useEffect(() => {
    if (!showManagerTools || !currentUserId) {
      setMyInviteLinks([]);
      return;
    }
    void refreshMyInviteLinks();
  }, [showManagerTools, currentUserId, refreshMyInviteLinks]);

  async function removeMember(targetUserId: string) {
    setError(null);
    setSuccess(null);
    setBusyUserId(targetUserId);
    try {
      const endpoint = buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(resolvedOrganizationSlug)}/members/${encodeURIComponent(targetUserId)}`);
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to remove member.");
      }

      await refreshMembers();
      setSuccess("Member removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove member.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function inviteSelectedUser() {
    if (!selectedUserId) return;
    setError(null);
    setSuccess(null);
    setInviteBusy(true);
    try {
      const endpoint = buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(resolvedOrganizationSlug)}/governance/invite-users`);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ userId: selectedUserId, message: inviteMessage.trim() || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to send invite.");
      }

      setSuccess("Invite sent to Civil user.");
      setInviteUsersOpen(false);
      setSelectedUserId(null);
      setSearchQuery("");
      setSearchResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send invite.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function createInviteLink() {
    setError(null);
    setSuccess(null);
    setLinkBusy(true);
    try {
      const endpoint = buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(resolvedOrganizationSlug)}/governance/invite-links`);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ message: linkMessage.trim() || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to create invite URL.");
      }

      const landingUrl = typeof payload?.landingUrl === "string" ? payload.landingUrl : null;
      if (!landingUrl) {
        throw new Error("Invite URL was created but no landing URL was returned.");
      }

      await refreshMyInviteLinks();

      router.push(landingUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create invite URL.");
    } finally {
      setLinkBusy(false);
      setInviteUrlOpen(false);
    }
  }

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const roleOrder = { owner: 0, admin: 1, moderator: 2, member: 3 } as const;
      const roleDiff =
        (roleOrder[a.role as keyof typeof roleOrder] ?? 4) -
        (roleOrder[b.role as keyof typeof roleOrder] ?? 4);
      if (roleDiff !== 0) return roleDiff;
      const aTime = a.joinedAt ? new Date(a.joinedAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.joinedAt ? new Date(b.joinedAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }, [members]);

  const filteredMembers = useMemo(() => {
    const query = memberFilterQuery.trim().toLowerCase();
    if (!query) return sortedMembers;

    return sortedMembers.filter((member) => {
      const profile = profiles[member.userId];
      const displayName = getDisplayName(profile).toLowerCase();
      const handle = (profile?.handle ?? "").toLowerCase();
      const title = (member.jobTitle ?? "").toLowerCase();
      const description = (member.jobDescription ?? "").toLowerCase();
      return (
        displayName.includes(query) ||
        handle.includes(query) ||
        title.includes(query) ||
        description.includes(query)
      );
    });
  }, [memberFilterQuery, profiles, sortedMembers]);

  return (
    <div className="space-y-4">
      {(error || success) && (
        <div className="space-y-2">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <span>{success}</span>
            </div>
          )}
        </div>
      )}

      {showManagerTools && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-3">
          <button
            type="button"
            onClick={() => setInviteUsersOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            Invite Civil Users
          </button>
          <button
            type="button"
            onClick={() => setInviteUrlOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-500 bg-blue-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600"
          >
            Get Invite URL
          </button>
        </div>
      )}

      {showManagerTools && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-neutral-900">My Invite Pages</h3>
            <button
              type="button"
              onClick={() => void refreshMyInviteLinks()}
              className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
            >
              Refresh
            </button>
          </div>

          {inviteLinksLoading ? (
            <p className="text-sm text-neutral-500">Loading your invite pages…</p>
          ) : myInviteLinks.length === 0 ? (
            <p className="text-sm text-neutral-500">No invite pages yet. Create one with “Get Invite URL”.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-neutral-200">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-3 py-2">Welcome message</th>
                    <th className="px-3 py-2">Views</th>
                    <th className="px-3 py-2">Signups</th>
                    <th className="px-3 py-2">Joins</th>
                    <th className="px-3 py-2">Open</th>
                    <th className="px-3 py-2">Copy Share URL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {myInviteLinks.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-neutral-800">{item.message || "No welcome message"}</td>
                      <td className="px-3 py-2 text-neutral-700">{item.viewCount}</td>
                      <td className="px-3 py-2 text-neutral-700">{item.registrationCount}</td>
                      <td className="px-3 py-2 text-neutral-700">{item.joinCount}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => {
                            const absoluteUrl = item.landingUrl.startsWith("http")
                              ? item.landingUrl
                              : `${window.location.origin}${item.landingUrl}`;
                            window.open(absoluteUrl, "_blank", "noopener,noreferrer");
                          }}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
                        >
                          Open
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const absoluteUrl = item.landingUrl.startsWith("http")
                              ? item.landingUrl
                              : `${window.location.origin}${item.landingUrl}`;
                            try {
                              await navigator.clipboard.writeText(absoluteUrl);
                              setSuccess("Invite URL copied.");
                            } catch {
                              setError("Unable to copy invite URL.");
                            }
                          }}
                          className="rounded-lg border border-blue-600 bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                        >
                          Copy Share URL
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-neutral-200 bg-white p-3">
        <input
          value={memberFilterQuery}
          onChange={(event) => setMemberFilterQuery(event.target.value)}
          placeholder="Filter members by name, @handle, title, or description"
          className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-400"
        />
      </div>

      {filteredMembers.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No members match your filter.
        </div>
      ) : null}

      <div className="grid gap-4">
        {filteredMembers.map((member) => {
          const profile = profiles[member.userId];
          const isSelf = member.userId === currentUserId;
          const isBusy = busyUserId === member.userId;
          const canManageTarget = showManagerTools && !isSelf && member.role !== "owner";
          const profileHref = profile?.handle ? `/u/${encodeURIComponent(profile.handle)}` : null;

          return (
            <CivilCard
              key={`${member.userId}-${member.role}-${member.status}`}
              size="lg"
              name={getDisplayName(profile)}
              avatarAlt={getDisplayName(profile)}
              avatarInitials={getDisplayName(profile)}
              avatarSrc={profile?.image ?? null}
              avatarHref={profileHref ?? undefined}
              titleHref={profileHref ?? undefined}
              coverUrl={profile?.coverUrl ?? null}
              subtitle={profile?.handle ? `@${profile.handle}` : member.userId.slice(0, 8)}
              align="start"
              details={
                <>
                  <p className="truncate text-sm font-medium text-white/90">{member.jobTitle || "No job title set for this organization"}</p>
                  {member.jobDescription ? <p className="mt-2 line-clamp-2 text-sm text-white/85">{member.jobDescription}</p> : null}
                </>
              }
              trailing={
                showManagerTools && canManageTarget ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => removeMember(member.userId)}
                    className="rounded-lg border border-red-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-red-600 backdrop-blur disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>
                ) : null
              }
            />
          );
        })}
      </div>

      <Modal
        open={inviteUsersOpen}
        onClose={() => {
          setInviteUsersOpen(false);
          setSelectedUserId(null);
        }}
        title="Invite Civil Users"
        maxWidthClassName="max-w-2xl"
      >
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Search Civil users and send an in-app invitation to join this organization.
          </p>
          <div className="relative">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by name or @handle"
              className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-400"
            />
          </div>
          <textarea
            value={inviteMessage}
            onChange={(event) => setInviteMessage(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-400"
            placeholder="Optional personal note"
          />
          <div className="max-h-64 space-y-2 overflow-auto rounded-xl border border-neutral-200 p-2">
            {searching ? (
              <p className="px-2 py-3 text-sm text-neutral-500">Searching…</p>
            ) : searchQuery.trim().length < 2 ? (
              <p className="px-2 py-3 text-sm text-neutral-500">Enter at least 2 characters to search.</p>
            ) : searchResults.length === 0 ? (
              <p className="px-2 py-3 text-sm text-neutral-500">No matching users found.</p>
            ) : (
              searchResults.map((user) => {
                const selected = selectedUserId === user.id;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setSelectedUserId(user.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition ${
                      selected ? "bg-neutral-100" : "hover:bg-neutral-50"
                    }`}
                  >
                    <div className="h-8 w-8 overflow-hidden rounded-full bg-neutral-200">
                      {user.image ? (
                        <img src={user.image} alt={getDisplayName(user)} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-neutral-900">{getDisplayName(user)}</p>
                      <p className="text-xs text-neutral-500">{user.handle ? `@${user.handle}` : user.id.slice(0, 8)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setInviteUsersOpen(false)}
              className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={inviteSelectedUser}
              disabled={inviteBusy || !selectedUserId}
              className="rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {inviteBusy ? "Sending…" : "Send invite"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={inviteUrlOpen}
        onClose={() => setInviteUrlOpen(false)}
        title="Get Invite URL"
        maxWidthClassName="max-w-xl"
      >
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Generate a unique invite URL for this organization. You can share it publicly, and registrations from that link will be tracked.
          </p>
          <textarea
            value={linkMessage}
            onChange={(event) => setLinkMessage(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-400"
            placeholder="Optional invite message"
          />
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
            Each successful signup from this invite awards the inviter 100 organization reputation points.
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setInviteUrlOpen(false)}
              className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createInviteLink}
              disabled={linkBusy}
              className="rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {linkBusy ? "Creating…" : "Create invite URL"}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
