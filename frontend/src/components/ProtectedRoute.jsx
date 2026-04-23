import { Navigate, Outlet } from "react-router-dom";

export default function ProtectedRoute() {
  const sid = localStorage.getItem("session_id");
  if (!sid) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
