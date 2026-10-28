const ALLOWED_DOMAINS = [
  "cdn.dummyjson.com",
];

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
];

export async function GET(request, { params }) {
  try {
    const { filename } = await params;

    if (
      !filename ||
      !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|avif)$/i.test(filename)
    ) {
      return new Response("Invalid image filename", {
        status: 400,
      });
    }

    const source = request.nextUrl.searchParams.get("source");

    if (!source) {
      return new Response("Image source required", {
        status: 400,
      });
    }

    const imageUrl = new URL(source);

    if (
      imageUrl.protocol !== "https:" ||
      !ALLOWED_DOMAINS.includes(imageUrl.hostname)
    ) {
      return new Response("Image domain not allowed", {
        status: 403,
      });
    }

    const response = await fetch(imageUrl.href, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "error",
      cache: "force-cache",
    });

    if (!response.ok) {
      console.error("Image fetch failed:", response.status, imageUrl.href);

      return new Response("Image not found", {
        status: response.status,
      });
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase();

    if (!contentType || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
      console.error("Invalid image content type:", contentType);

      return new Response("Invalid image type", {
        status: 415,
      });
    }

    const image = await response.arrayBuffer();

    return new Response(image, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Image proxy error:", error);

    return new Response("Failed to load image", {
      status: 500,
    });
  }
}
