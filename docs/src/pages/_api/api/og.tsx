import { ImageResponse } from "@takumi-rs/image-response/wasm";
import wasm from "@takumi-rs/wasm/takumi_wasm_bg.wasm?url";
import interRegular from "../../../assets/fonts/Inter_28pt-Regular.ttf?arraybuffer";
import background from "../../../assets/og-template.png?inline";

/**
 * Open Graph image for every page. This does not use `Handler.og` from
 * `vocs/server` because that renders WebP, and some link unfurlers only
 * accept PNG and JPEG.
 */
export default async function handler(request: Request) {
  const url = new URL(request.url);
  const title = url.searchParams.get("title") ?? "Ponder";
  const description = url.searchParams.get("description");

  const module = await fetch(new URL(wasm, url.origin)).then((response) =>
    response.arrayBuffer(),
  );

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        backgroundImage: `url("${background}")`,
        backgroundSize: "cover",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        paddingTop: "230px",
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          textAlign: "left",
          color: "white",
          // 1200px width - 2 * 80px padding
          width: "1040px",
          maxWidth: "1040px",
        }}
      >
        <div
          style={{
            fontSize: "52px",
            letterSpacing: "-1px",
            marginBottom: 12,
          }}
        >
          {title}
        </div>
        {description && (
          <div
            style={{
              fontSize: "36px",
              opacity: 0.9,
              lineHeight: "1.3",
              letterSpacing: "-1px",
            }}
          >
            {description}
          </div>
        )}
      </div>
    </div>,
    {
      format: "png",
      module,
      fonts: [{ name: "Inter", data: interRegular }],
      width: 1200,
      height: 630,
      headers: { "cache-control": "public, max-age=86400" },
    },
  );
}
