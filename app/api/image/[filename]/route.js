const ALLOWED_DOMAINS = [
  "cdn.dummyjson.com",
];

export async function GET(request, { params }) {
  try {
    const { filename } = await params;

    if (
      !filename ||
      !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(filename)
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

    const response = await fetch(imageUrl, {
      redirect: "error",
    });

    if (!response.ok) {
      return new Response("Image not found", {
        status: 404,
      });
    }

    const contentType = response.headers.get("content-type");

    if (
      !contentType ||
      !["image/jpeg", "image/png", "image/webp"].includes(contentType)
    ) {
      return new Response("Invalid image type", {
        status: 415,
      });
    }

    const image = await response.arrayBuffer();

    return new Response(image, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return new Response("Failed to load image", {
      status: 500,
    });
  }
}
