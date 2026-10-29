import { Handler } from "vocs/server";

// Overrides the default Vocs OG image. Content stays inside the center
// 630x630 square because Slack crops large images to a square thumbnail.
export default function handler(request: Request) {
  return Handler.og(({ config, title, description, logo }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        width: "100%",
        height: "100%",
        backgroundColor: "#161616",
        color: "#ffffff",
      }}
    >
      {config.baseUrl && (
        <img
          alt=""
          src={`${config.baseUrl}/og-background.jpg`}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          width: 560,
          textAlign: "center",
        }}
      >
        {logo && <img alt="" src={logo} style={{ height: 40 }} />}
        <div
          style={{
            fontSize: title.length < 20 ? 64 : 52,
            fontWeight: 700,
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 26, color: "rgba(255, 255, 255, 0.6)" }}>
            {description}
          </div>
        )}
      </div>
    </div>
  )).fetch(request);
}
