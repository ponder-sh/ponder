import { Canonical } from "../components/canonical.client";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Canonical />
      <link rel="preload" as="image" href="/hero.png" />
      <script async src="https://sa-api.ponder.sh/latest.js" />
      <noscript>
        <img
          src="https://sa-api.ponder.sh/noscript.gif"
          alt=""
          referrerPolicy="no-referrer-when-downgrade"
        />
      </noscript>
      {children}
    </>
  );
}
