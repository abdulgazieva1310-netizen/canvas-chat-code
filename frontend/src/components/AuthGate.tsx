import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "@tanstack/react-router";
import { Api, ApiError } from "@/lib/api/client";

export function AuthGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  if (pathname === "/login" || pathname === "/register") return children;
  return <ProtectedSession>{children}</ProtectedSession>;
}

function ProtectedSession({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [needsLogin, setNeedsLogin] = useState(false);
  const session = useQuery({
    queryKey: ["history"],
    queryFn: Api.getHistory,
    retry: false,
    enabled: !needsLogin,
  });
  useEffect(() => {
    const expired = () => setNeedsLogin(true);
    window.addEventListener("api:unauthorized", expired);
    return () => window.removeEventListener("api:unauthorized", expired);
  }, []);
  if (needsLogin || (session.error instanceof ApiError && session.error.status === 401)) {
    return <Navigate to="/login" search={{ redirect: location.href }} replace />;
  }
  if (session.isPending)
    return (
      <p role="status" className="p-10">
        Loading session…
      </p>
    );
  if (session.error)
    return (
      <main className="p-10">
        <p role="alert">{session.error.message}</p>
        <button className="btn btn-primary mt-4" onClick={() => void session.refetch()}>
          Retry
        </button>
      </main>
    );
  return children;
}
