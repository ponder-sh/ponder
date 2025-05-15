import { ImageResponse } from "@vercel/og";

export const config = {
  runtime: "edge",
};

// https://og-playground.vercel.app/?share=bVLBbtswDP0VQcPQi5O4blYEQtrD2n3BCuySiyzRslpZNCQ5mRfk30c5FdYNO4l8pN6jnnjmCjVwwffaHg-esZhmBw_nc44Z68GaPgl2c1vXn2-qK3iyOvX_YNrG0cmZ0M7Bz4Lm-NkGUMmip5pCNw2-VF-nmGw3P6FP4LOIogNCKbdSvZmAk9dP6DBQ_VNz1zTNl9JAbAt86m2CAo5Sa-sNwbt6fB_kcjn4xxzs7WBYDOrhwPuUxig2myOquNZwXIKVQ4MrLcPbOh7Ngb-_n9rviYzy4g4bZDDWv-Ao2HZHAmxzFSAX_zR19LLv9hfQMHf3eZgF-VE8bdFpwv6iKulXTAkHwVa3DbE_kkedNfsN0f9HB0epbCLz6zURfFBttovqB4Vmm-meobMemHHYSscGSFLLJOlmYDNOgWlU00CfIfO_FdXrySuOY4YjF2e-rAIXu7qu-NUrLrY50dBOhotOuggVhwFf7cs85kVLpyUjnjzot6EFzUUKE1wqnmRLHT04hycMTvPLbw
export default async function handler(request: Request) {
  const { searchParams } = new URL(request.url);

  const requestUrl = new URL(request.url);
  const baseUrl = requestUrl.origin;
  const backgroundImageUrl = `${baseUrl}/og-template.png`;

  const title = searchParams.get("title");
  const description = searchParams.get("description");

  // const interRegular = await fetch(
  //   new URL("/Inter_28pt-Regular.ttf", import.meta.url),
  // );
  // const interRegularData = await interRegular.arrayBuffer();

  return new ImageResponse(
    <div // Outermost container for background
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center", // Center the text wrapper vertically
        justifyContent: "center", // Center the text wrapper horizontally
        backgroundImage: `url(${backgroundImageUrl})`,
        backgroundSize: "1200px 630px", // Or "cover"
        // fontFamily: "Inter",
      }}
    >
      <div // Text wrapper
        style={{
          display: "flex",
          flexDirection: "column",
          textAlign: "left",
          padding: "80px",
          color: "white",
          maxWidth: "1040px", // 1200px width - 2 * 80px padding
        }}
      >
        <div // Title
          style={{
            fontSize: "42px",
            fontWeight: "bold",
            marginBottom: 20,
          }}
        >
          {title}
        </div>
        {description && (
          <div
            style={{
              opacity: 0.8,
              fontSize: "32px",
              lineHeight: "1.4",
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
