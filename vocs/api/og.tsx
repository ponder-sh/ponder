import { ImageResponse } from "@vercel/og";

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request) {
  const { searchParams } = new URL(request.url);

  // const requestUrl = new URL(request.url);
  // const baseUrl = requestUrl.origin;
  // const backgroundImageUrl = `${baseUrl}/og-template.png`;

  const title = searchParams.get("title");
  const description = searchParams.get("description");

  // const interRegular = await fetch(
  //   new URL("/Inter_28pt-Regular.ttf", import.meta.url),
  // );
  // const interRegularData = await interRegular.arrayBuffer();

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        backgroundImage: "url(/og-template.png)",
        backgroundSize: "1200px 630px", // Or "cover"
        display: "flex",
        flexDirection: "column",
        padding: "80px",
        paddingTop: "300px",
        // fontFamily: "Inter",
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
            fontWeight: 900,
            marginBottom: 12,
            letterSpacing: "-1px",
          }}
        >
          {title}
        </div>
        {description && (
          <div
            style={{
              opacity: 0.9,
              fontSize: "36px",
              lineHeight: "1.4",
              letterSpacing: "-1px",
            }}
          >
            {description}
          </div>
        )}
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      // fonts: [
      //   {
      //     name: "Inter",
      //     data: interRegularData,
      //   },
      // ],
    },
  );
}

// async function loadGoogleFont(font: string, text: string) {
//   const url = `https://fonts.googleapis.com/css2?family=${font}&text=${encodeURIComponent(text)}`;
//   const css = await (await fetch(url)).text();
//   const resource = css.match(
//     /src: url\((.+)\) format\('(opentype|truetype)'\)/,
//   );
//   const fontUrl = resource?.[1];

//   if (fontUrl) {
//     const response = await fetch(fontUrl);
//     if (response.status === 200) {
//       return await response.arrayBuffer();
//     }
//   }

//   throw new Error("failed to load font data");
// }
