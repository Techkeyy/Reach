async function verify() {
  const baseUrl = "https://reach-seven-lemon.vercel.app";
  const res = await fetch(`${baseUrl}/auth/register/options`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": baseUrl,
    },
    body: JSON.stringify({ username: "testuser" }),
  });
  const json = await res.json();
  console.log("Auth options status:", res.status);
  console.log("Auth options response:", json);
}
void verify();
