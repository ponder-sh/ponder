import { Layout } from "vocs";
import { OutdatedVersion } from "../../components/outdated-version.client";
import { VersionPicker } from "../../components/version-picker.client";

export default function DocsWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Layout>
      {/* The sidebar header slot is hidden on mobile. */}
      <VersionPicker className="md:hidden" />
      <OutdatedVersion />
      {children}
    </Layout>
  );
}
