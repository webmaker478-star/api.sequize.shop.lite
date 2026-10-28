const ALLOWED_DOMAINS = ["cdn.dummyjson.com"];

module.exports = async (req, res) => {
  try {
    const filename = req.query.filename;
    const source = req.query.source;

    if (
      !filename ||
      !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(filename)
    ) {
      return res.status(400).send("Invalid image filename");
    }

    if (!source) {
      return res.status(400).send("Image source required");
    }

    const imageUrl = new URL(source);

    if (
      imageUrl.protocol !== "https:" ||
      !ALLOWED_DOMAINS.includes(imageUrl.hostname)
    ) {
      return res.status(403).send("Image domain not allowed");
    }

    const response = await fetch(imageUrl.href, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "image/webp,image/*,*/*;q=0.8"
      },
      redirect: "error"
    });

    if (!response.ok) {
      return res.status(404).send("Image not found");
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase();

    if (
      !["image/jpeg", "image/png", "image/webp"].includes(contentType)
    ) {
      return res.status(415).send("Invalid image type");
    }

    const image = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=604800"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).send(image);
  } catch (error) {
    console.error("Image proxy error:", error);
    return res.status(500).send("Failed to load image");
  }
};
