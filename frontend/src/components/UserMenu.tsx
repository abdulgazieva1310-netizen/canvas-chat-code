import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "@/lib/api/client";
import { saveAuthorization } from "@/lib/api/session";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: Api.getProfile,
    enabled: open,
    retry: false,
  });
  const logout = useMutation({
    mutationFn: Api.logout,
    onSuccess: async () => {
      saveAuthorization(null);
      await client.cancelQueries();
      // Leave the protected route before clearing its authentication/history cache.
      await navigate({ to: "/login", search: { redirect: "/" }, replace: true });
      client.clear();
    },
  });
  const initials =
    profile.data?.name
      ?.trim()
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-sm font-semibold"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {profile.data ? (
            <>
              <p>{profile.data.name}</p>
              <p className="break-all text-xs font-normal text-muted-foreground">
                {profile.data.email}
              </p>
            </>
          ) : (
            <p>{profile.error ? "Could not load account." : "Loading account…"}</p>
          )}
        </DropdownMenuLabel>
        {profile.error && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void profile.refetch();
            }}
          >
            Retry loading account
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">Profile Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={logout.isPending}
          onSelect={(event) => {
            event.preventDefault();
            logout.mutate();
          }}
        >
          {logout.isPending ? "Logging out…" : "Logout"}
        </DropdownMenuItem>
        {logout.error && (
          <p role="alert" className="px-2 py-1.5 text-sm text-destructive">
            Could not log out: {logout.error.message}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
