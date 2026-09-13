import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

describe("ProviderInstanceIcon", () => {
  it("positions the initials badge with negative offsets so it does not obscure small provider icons", () => {
    const markup = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind="codex"
        displayName="Test User"
        showBadge
        className="size-4"
        iconClassName="size-4"
      />,
    );

    expect(markup).toContain("-right-0.5");
    expect(markup).toContain("-bottom-0.5");
    expect(markup).not.toMatch(/(?<!-)right-0(?!\.)/);
    expect(markup).not.toMatch(/(?<!-)bottom-0(?!\.)/);
  });

  it("omits the badge when showBadge is false", () => {
    const markup = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind="codex"
        displayName="Test User"
        className="size-4"
        iconClassName="size-4"
      />,
    );

    expect(markup).not.toContain("-right-0.5");
    expect(markup).not.toContain("-bottom-0.5");
  });
});