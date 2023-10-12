import { Ratelimit } from "@upstash/ratelimit";
import redis from "../../utils/redis";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

console.log("Starting script...");

// Create a new ratelimiter, that allows 5 requests per 24 hours
const ratelimit = redis
  ? new Ratelimit({
      redis: redis,
      limiter: Ratelimit.fixedWindow(5, "1440 m"),
      analytics: true,
    })
  : undefined;

export async function POST(request: Request) {
  console.log("POST function called.");

  // Rate Limiter Code
  if (ratelimit) {
    const headersList = headers();
    const ipIdentifier = headersList.get("x-real-ip");
    console.log("IP Identifier:", ipIdentifier);

    const result = await ratelimit.limit(ipIdentifier ?? "");
    console.log("Rate Limit Result:", result);

    if (!result.success) {
      console.log("Rate limit exceeded.");
      return new Response(
        "Too many uploads in 1 day. Please try again in a 24 hours.",
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": result.limit,
            "X-RateLimit-Remaining": result.remaining,
          } as any,
        }
      );
    }
  }

  const { imageUrl, theme, room } = await request.json();
  console.log("Received data:", imageUrl, theme, room);

  // POST request to Replicate to start the image restoration generation process
  let startResponse = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Token " + process.env.REPLICATE_API_KEY,
    },
    body: JSON.stringify({
      version:
        "854e8727697a057c525cdb45ab037f64ecca770a1769cc52287c2e56472a247b",
      input: {
        image: imageUrl,
        prompt:
          room === "Gaming Room"
            ? "a room for gaming with gaming computers, gaming consoles, and gaming chairs"
            : `a ${theme.toLowerCase()} ${room.toLowerCase()}`,
        a_prompt:
          "best quality, extremely detailed, photo from Pinterest, interior, cinematic photo, ultra-detailed, ultra-realistic, award-winning",
        n_prompt:
          "longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality",
      },
    }),
  });

  console.log("Start response:", startResponse);

  let jsonStartResponse = await startResponse.json();
  console.log("JSON Start Response:", jsonStartResponse);

  let endpointUrl = jsonStartResponse.urls.get;
  console.log("Endpoint URL:", endpointUrl);

  // GET request to get the status of the image restoration process & return the result when it's ready
  let restoredImage = null;
  while (!restoredImage) {
    console.log("Polling for result...");
    let finalResponse = await fetch(endpointUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Token " + process.env.REPLICATE_API_KEY,
      },
    });
    console.log("Final Response:", finalResponse);

    let jsonFinalResponse = await finalResponse.json();
    console.log("JSON Final Response:", jsonFinalResponse);

    if (jsonFinalResponse.status === "succeeded") {
      restoredImage = jsonFinalResponse.output;
    } else if (jsonFinalResponse.status === "failed") {
      break;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log("Restored Image:", restoredImage);

  return NextResponse.json(
    restoredImage ? restoredImage : "Failed to restore image"
  );
}

console.log("Script completed.");
