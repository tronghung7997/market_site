import Link from "next/link";

export default function RootNotFound() {
  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "system-ui" }}>
          <p>404</p>
          <h1>This page is not here</h1>
          <p>The link may be outdated, or the page was moved.</p>
          <p><Link href="/">Back to marketplace</Link></p>
        </main>
      </body>
    </html>
  );
}
