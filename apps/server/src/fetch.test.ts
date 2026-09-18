import { describe, expect, it } from "vitest";

import {
  allowed,
  describeArgs,
  describeVideo,
  fetchMedium,
  formatSelector,
  downloadArgs,
  forbidden,
  isPrivateAddress,
  percentOf,
  searchArgs,
  searchVideos,
  ytDlpVersion,
  type RunYtDlp,
} from "./fetch";

// Everything here drives the real module with a stand-in for the one thing it shells out to. No
// network, no binary, and every argument the tool would have been handed is visible to the check --
// which is the only way to test a downloader without downloading anything.
function runner(
  answer: (args: readonly string[]) => { stdout?: string; stderr?: string; code?: number },
): { run: RunYtDlp; calls: string[][] } {
  const calls: string[][] = [];
  const run: RunYtDlp = async (args) => {
    calls.push([...args]);
    const given = answer(args);
    return { stdout: given.stdout ?? "", stderr: given.stderr ?? "", code: given.code ?? 0 };
  };
  return { run, calls };
}

const RESULT = {
  id: "abc123",
  title: "Die Bühne, zweiter Abend",
  duration: 754,
  uploader: "Ein Kanal",
  thumbnails: [{ url: "https://i.example/1.jpg" }, { url: "https://i.example/2.jpg" }],
};

describe("formatSelector", () => {
  it("asks for a real mp4 and falls back to whatever plays", () => {
    const selector = formatSelector({ url: "", kind: "video", format: "mp4", quality: "1080" });

    expect(selector).toContain("bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]");
    // The fallbacks are the point. A video with no separate streams has no `bestvideo+bestaudio`,
    // and a selector without a plain `best` at the end reports "nothing to download" about a video
    // that plays perfectly well in a browser.
    expect(selector.endsWith("/best")).toBe(true);
  });

  it("prefers a codec without insisting on it", () => {
    const selector = formatSelector({
      url: "",
      kind: "video",
      codec: "h264",
      format: "mp4",
      quality: "1080",
    });

    // Both spellings, because the sites hand out both and a filter that knows one of them finds
    // nothing without saying so.
    expect(selector).toContain("h264|avc");
    // And the step after it has dropped the codec again: a video with no H.264 stream should still
    // arrive rather than come back as nothing at all.
    const steps = selector.split("/");
    expect(steps[0]).toContain("vcodec");
    expect(steps[1]).not.toContain("vcodec");
    expect(steps.at(-1)).toBe("best");
  });

  it("asks for the worst of everything where that is what was chosen", () => {
    const selector = formatSelector({
      url: "",
      kind: "video",
      codec: "auto",
      format: "any",
      quality: "worst",
    });

    expect(selector).toContain("worstvideo");
    expect(selector).not.toContain("height");
    expect(selector.split("/").at(-1)).toBe("worst");
  });

  it("leaves the height out when the answer is best", () => {
    const selector = formatSelector({ url: "", kind: "video", format: "mp4", quality: "best" });

    expect(selector).not.toContain("height");
  });

  it("asks for sound alone when sound is what was asked for", () => {
    const selector = formatSelector({ url: "", kind: "audio", format: "m4a", quality: "best" });

    expect(selector).toBe("bestaudio[ext=m4a]/bestaudio/best");
    expect(selector).not.toContain("bestvideo");
  });
});

describe("searchArgs", () => {
  it("searches through the extractor rather than through an API with a key", () => {
    expect(searchArgs("bühne", 5)).toContain("ytsearch5:bühne");
  });

  it("keeps the count inside what the tool will answer", () => {
    expect(searchArgs("x", 500).at(-1)).toBe("ytsearch50:x");
    expect(searchArgs("x", 0).at(-1)).toBe("ytsearch1:x");
  });
});

describe("searchVideos", () => {
  it("reads one video per line, with the picture the dialogue shows", async () => {
    const { run } = runner(() => ({ stdout: `${JSON.stringify(RESULT)}\n` }));

    const found = await searchVideos("bühne", run);

    expect(found).toEqual([
      {
        id: "abc123",
        title: "Die Bühne, zweiter Abend",
        url: "https://www.youtube.com/watch?v=abc123",
        duration: 754,
        uploader: "Ein Kanal",
        // The last one, which is the largest: a grid of thumbnails at 120 pixels wide looks like a
        // search from 2009.
        thumbnail: "https://i.example/2.jpg",
      },
    ]);
  });

  it("asks nothing at all for an empty query", async () => {
    const { run, calls } = runner(() => ({ stdout: "" }));

    expect(await searchVideos("   ", run)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("passes on what the tool said rather than a status of its own", async () => {
    const { run } = runner(() => ({
      code: 1,
      stderr: "[download] something\nERROR: Unable to extract initial data",
    }));

    await expect(searchVideos("bühne", run)).rejects.toThrow("Unable to extract initial data");
  });

  it("skips a line that is not a video, rather than failing the whole search", async () => {
    const { run } = runner(() => ({
      stdout: `${JSON.stringify({ id: "only-an-id" })}\n${JSON.stringify(RESULT)}\n`,
    }));

    expect(await searchVideos("bühne", run)).toHaveLength(1);
  });
});

describe("describeVideo", () => {
  it("reads a single link without pulling in a whole playlist", async () => {
    const { run, calls } = runner(() => ({
      stdout: JSON.stringify({ ...RESULT, webpage_url: "https://example.com/watch?v=abc123" }),
    }));

    const found = await describeVideo("https://example.com/watch?v=abc123", run);

    expect(found.title).toBe("Die Bühne, zweiter Abend");
    expect(found.url).toBe("https://example.com/watch?v=abc123");
    expect(calls[0]).toEqual(describeArgs("https://example.com/watch?v=abc123"));
    expect(calls[0]).toContain("--no-playlist");
  });

  it("refuses a link into the server's own network before running anything", async () => {
    const { run, calls } = runner(() => ({ stdout: "{}" }));

    await expect(describeVideo("http://192.168.1.1/admin", run)).rejects.toThrow(
      "points into the server's own network",
    );

    expect(calls).toEqual([]);
  });

  it("refuses a scheme that is not a link to fetch", async () => {
    const { run } = runner(() => ({ stdout: "{}" }));

    await expect(describeVideo("file:///etc/passwd", run)).rejects.toThrow("only http and https");
  });
});

describe("fetchMedium", () => {
  it("hands back the file the tool wrote, with the type its name says", async () => {
    const { run, calls } = runner((args) => {
      // The tool writes into the directory it was given. Standing in for it here is what makes the
      // rest of this function -- reading the file back, naming it, cleaning up -- testable at all.
      const target = args[args.indexOf("-o") + 1] ?? "";
      const directory = target.slice(0, target.lastIndexOf("\\") + target.lastIndexOf("/") + 1);
      return { stdout: "", code: 0, wrote: directory };
    });

    // The runner above cannot write files, so this check is about the arguments and the failure
    // path; that a file really comes back is the server check's job, where a fake binary writes one.
    await expect(fetchMedium(
      { url: "https://example.com/v", kind: "video", format: "mp4", quality: "1080" },
      run,
    )).rejects.toThrow("the download produced no file");

    const asked = calls[0] ?? [];
    expect(asked).toContain("-f");
    expect(asked[asked.indexOf("-f") + 1]).toBe(
      formatSelector({ url: "", kind: "video", format: "mp4", quality: "1080" }),
    );
    expect(asked).toContain("--merge-output-format");
  });

  it("converts to the sound format somebody asked for", async () => {
    const { run, calls } = runner(() => ({ code: 0 }));

    await expect(fetchMedium(
      { url: "https://example.com/v", kind: "audio", format: "mp3", quality: "best" },
      run,
    )).rejects.toThrow("no file");

    expect(calls[0]).toContain("--extract-audio");
    expect(calls[0]?.[(calls[0]?.indexOf("--audio-format") ?? -1) + 1]).toBe("mp3");
    // `best` means do not argue with the source, so no bitrate is passed at all.
    expect(calls[0]).not.toContain("--audio-quality");
  });

  it("passes a bitrate where one was chosen", async () => {
    const { run, calls } = runner(() => ({ code: 0 }));

    await expect(
      fetchMedium(
        { url: "https://example.com/v", kind: "audio", format: "mp3", quality: "320" },
        run,
      ),
    ).rejects.toThrow("no file");

    expect(calls[0]?.[(calls[0]?.indexOf("--audio-quality") ?? -1) + 1]).toBe("320K");
  });

  it("says what the tool said when the download fails", async () => {
    const { run } = runner(() => ({ code: 1, stderr: "ERROR: Video unavailable" }));

    await expect(fetchMedium(
      { url: "https://example.com/v", kind: "video", format: "mp4", quality: "best" },
      run,
    )).rejects.toThrow("Video unavailable");
  });
});

describe("a download that was refused", () => {
  // YouTube signs every fragment URL and the signature goes stale, and it serves some clients a
  // stream it then refuses them. Both arrive as a 403 partway through a download that was working,
  // and the same link succeeds on the next attempt -- which is what makes it infuriating rather
  // than informative. So: retries in the arguments, and one more attempt as a different client.
  it("asks again as another client", async () => {
    const attempts: string[][] = [];
    const run: RunYtDlp = async (args) => {
      attempts.push([...args]);
      return attempts.length === 1
        ? { stdout: "", stderr: "ERROR: unable to download video data: HTTP Error 403: Forbidden", code: 1 }
        : { stdout: "", stderr: "", code: 0 };
    };

    // No file comes back from either attempt here, and the message proves which one it got to: the
    // second, because the first one's own error never reaches the caller.
    await expect(
      fetchMedium(
        { url: "https://example.com/v", kind: "video", format: "mp4", quality: "best" },
        run,
      ),
    ).rejects.toThrow("the download produced no file");

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).not.toContain("--extractor-args");
    expect(attempts[1]).toContain("--extractor-args");
    expect(attempts[1]?.join(" ")).toContain("player_client=web_safari");
    // Everything else is the same request, or the second attempt would be a different download.
    expect(attempts[0]?.filter((one) => one !== "--extractor-args")).toEqual(
      attempts[1]?.filter(
        (one, index) =>
          one !== "--extractor-args" && attempts[1]?.[index - 1] !== "--extractor-args",
      ),
    );
  });

  it("does not try twice for a failure that is not a refusal", async () => {
    let attempts = 0;
    const run: RunYtDlp = async () => {
      attempts += 1;
      return { stdout: "", stderr: "ERROR: Video unavailable", code: 1 };
    };

    await expect(
      fetchMedium(
        { url: "https://example.com/v", kind: "video", format: "mp4", quality: "best" },
        run,
      ),
    ).rejects.toThrow("Video unavailable");

    expect(attempts).toBe(1);
  });

  it("carries retries, because a stale fragment is the ordinary case", () => {
    const args = downloadArgs(
      { url: "https://example.com/v", kind: "video", format: "mp4", quality: "best" },
      "/tmp/x",
      [],
    );

    expect(args).toContain("--retries");
    expect(args).toContain("--fragment-retries");
    expect(args).toContain("--extractor-retries");
  });

  it("knows a refusal from anything else", () => {
    expect(forbidden("ERROR: HTTP Error 403: Forbidden")).toBe(true);
    expect(forbidden("ERROR: Video unavailable")).toBe(false);
  });
});

describe("percentOf", () => {
  it("reads the number out of a download line", () => {
    expect(percentOf("[download]  12.3% of 10.00MiB at 1.00MiB/s ETA 00:09")).toBe(12);
    expect(percentOf("[download] 100% of 10.00MiB in 00:09")).toBe(100);
  });

  // Most of what the tool writes is not progress, and a line misread as zero would jerk a bar
  // backwards on every merge message.
  it("says nothing about a line that is not progress", () => {
    expect(percentOf(`[Merger] Merging formats into "x.mp4"`)).toBeUndefined();
    expect(percentOf("")).toBeUndefined();
  });
});

describe("fetchMedium progress", () => {
  it("asks for one line per update and reports what they say", async () => {
    const seen: number[] = [];
    const run: RunYtDlp = async (args, onLine) => {
      expect(args).toContain("--newline");
      onLine?.("[download]   0.0% of 10.00MiB");
      onLine?.("[download]  50.0% of 10.00MiB");
      onLine?.("[Merger] Merging formats");
      onLine?.("[download] 100% of 10.00MiB");
      return { stdout: "", stderr: "", code: 0 };
    };

    await expect(fetchMedium(
      { url: "https://example.com/v", kind: "video", format: "mp4", quality: "best" },
      run,
      (percent) => seen.push(percent),
    )).rejects.toThrow("no file");

    expect(seen).toEqual([0, 50, 100]);
  });
});

describe("ytDlpVersion", () => {
  it("is the version where the tool is installed", async () => {
    const { run } = runner(() => ({ stdout: "2026.08.31\n" }));

    expect(await ytDlpVersion(run)).toBe("2026.08.31");
  });

  it("is nothing at all where it is not, which is what a dialogue asks before it offers", async () => {
    const missing: RunYtDlp = async () => {
      throw new Error("yt-dlp is not installed on this server");
    };

    expect(await ytDlpVersion(missing)).toBeUndefined();
  });
});

describe("isPrivateAddress", () => {
  it("knows the ranges a downloader must never be pointed at", () => {
    const inside = ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "fe80::1"];
    for (const address of inside) expect(isPrivateAddress(address)).toBe(true);
  });

  it("lets a public address through", () => {
    for (const address of ["1.1.1.1", "93.184.216.34", "2606:2800:220:1::248"]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  it("reads an IPv4 address wearing an IPv6 coat", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("allowed", () => {
  it("takes an ordinary link", async () => {
    await expect(allowed("https://www.youtube.com/watch?v=abc")).resolves.toBeUndefined();
  });

  it("refuses the address a cloud instance keeps its credentials at", async () => {
    await expect(allowed("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      "own network",
    );
  });

  it("refuses something that is not a link at all", async () => {
    await expect(allowed("not a link")).rejects.toThrow("not a link");
  });
});
