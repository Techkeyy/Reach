import ClaimPage from "./ClaimPage";
import SenderDashboard from "./SenderDashboard";

function isClaimRoute() {
  return window.location.pathname.replace(/\/$/, "").startsWith("/c/");
}

export default function App() {
  return isClaimRoute() ? <ClaimPage /> : <SenderDashboard />;
}
