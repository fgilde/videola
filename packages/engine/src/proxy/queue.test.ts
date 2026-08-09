import { beforeEach, describe, expect, it } from "vitest";

import { putProxy } from "@videola/media";
import { installFakeOpfs } from "@videola/media/src/fake-opfs";

import { ProxyQueue } from "./queue";

import type { ProxyMessage, ProxyRequest } from "./queue";

const A = "a".repeat(64);
const B = "b".repeat(64);

// Stands in for the worker without pretending to encode anything. What is under test is the order
// the queue works in and what it tells the interface, not what mediabunny writes.
class FakeWorker {
  static live: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<ProxyMessage>) => void) | null = null;
  onerror: (() => void) | null = null;
  request?: ProxyRequest;
  terminated = false;

  constructor() {
    FakeWorker.live.push(this);
  }

  postMessage(request: ProxyRequest): void {
    this.request = request;
  }

  terminate(): void {
    this.terminated = true;
  }

  finish(built: { height: number; bytes: number } | undefined): void {
    this.onmessage?.({
      data: { type: "done", hash: this.request!.hash, built },
    } as MessageEvent<ProxyMessage>);
  }

  die(): void {
    this.onerror?.();
  }
}

function queueOver(maxHeight?: number): { queue: ProxyQueue; changes: () => number } {
  let changes = 0;
  const queue = new ProxyQueue({
    createWorker: () => new FakeWorker() as unknown as Worker,
    maxHeight,
    onChange: () => {
      changes += 1;
    },
  });
  return { queue, changes: () => changes };
}

describe("ProxyQueue", () => {
  beforeEach(() => {
    installFakeOpfs();
    FakeWorker.live = [];
  });

  it("builds one medium at a time and then the next", async () => {
    const { queue } = queueOver();

    await queue.want([A, B]);

    expect(FakeWorker.live).toHaveLength(1);
    expect(queue.building).toBe(A);
    expect(queue.states.get(B)).toBeUndefined();

    FakeWorker.live[0]!.finish({ height: 720, bytes: 1000 });

    expect(FakeWorker.live).toHaveLength(2);
    expect(queue.states.get(A)).toBe("ready");
    expect(queue.building).toBe(B);
  });

  it("closes the worker it was given for each medium", async () => {
    const { queue } = queueOver();
    await queue.want([A]);

    FakeWorker.live[0]!.finish({ height: 720, bytes: 1000 });

    expect(FakeWorker.live[0]!.terminated).toBe(true);
    expect(queue.building).toBeUndefined();
  });

  // A proxy that was refused -- material already small enough, a machine with no encoder -- must
  // leave no "ready" behind, or the library would promise a speed that is not there.
  it("leaves no mark on a medium that got no proxy", async () => {
    const { queue } = queueOver();
    await queue.want([A]);

    FakeWorker.live[0]!.finish(undefined);

    expect(queue.states.get(A)).toBeUndefined();
  });

  it("carries on after a worker dies without a word", async () => {
    const { queue } = queueOver();
    await queue.want([A, B]);

    FakeWorker.live[0]!.die();

    expect(queue.states.get(A)).toBeUndefined();
    expect(queue.building).toBe(B);
  });

  it("does not build a proxy that is already on disk", async () => {
    await putProxy(A, new Uint8Array([1, 2, 3]));
    const { queue } = queueOver();

    await queue.want([A]);

    expect(FakeWorker.live).toHaveLength(0);
    expect(queue.states.get(A)).toBe("ready");
  });

  it("ignores a medium it is already working on", async () => {
    const { queue } = queueOver();
    await queue.want([A]);

    await queue.want([A, A]);

    expect(FakeWorker.live).toHaveLength(1);
  });

  it("passes the height it was built with through to the worker", async () => {
    const { queue } = queueOver(360);

    await queue.want([A]);

    expect(FakeWorker.live[0]!.request).toEqual({ hash: A, maxHeight: 360 });
  });

  it("tells the interface every time the picture changes", async () => {
    const { queue, changes } = queueOver();

    await queue.want([A]);
    FakeWorker.live[0]!.finish({ height: 720, bytes: 1000 });

    expect(changes()).toBe(2);
  });

  it("starts nothing more once it is disposed", async () => {
    const { queue } = queueOver();
    await queue.want([A, B]);

    queue.dispose();
    FakeWorker.live[0]!.finish({ height: 720, bytes: 1000 });

    expect(FakeWorker.live).toHaveLength(1);
  });
});
