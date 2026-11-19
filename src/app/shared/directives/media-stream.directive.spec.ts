import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FakeMediaStream,
  FakeMediaStreamTrack,
} from '../../../../tests/fixtures/fake-media-devices';
import { MediaStreamDirective } from './media-stream.directive';

function fakeStream(): MediaStream {
  return new FakeMediaStream([
    new FakeMediaStreamTrack({ deviceId: 'cam', label: 'Cam' }),
  ]).asMediaStream();
}

@Component({
  imports: [MediaStreamDirective],
  template: `
    @if (visible()) {
      <video [appMediaStream]="stream()" (playbackFailed)="failures = failures + 1"></video>
    }
  `,
})
class HostComponent {
  readonly stream = signal<MediaStream | null>(null);
  readonly visible = signal(true);
  failures = 0;
}

describe('MediaStreamDirective', () => {
  let play: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function render(): Promise<{
    host: HostComponent;
    video: () => HTMLVideoElement | null;
    stable: () => Promise<void>;
  }> {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return {
      host: fixture.componentInstance,
      video: () => element.querySelector('video'),
      stable: () => fixture.whenStable(),
    };
  }

  it('attaches the stream, mutes the element and starts playback', async () => {
    const { host, video, stable } = await render();
    const stream = fakeStream();

    host.stream.set(stream);
    await stable();

    expect(video()?.srcObject).toBe(stream);
    expect(video()?.muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('switches and clears the stream', async () => {
    const { host, video, stable } = await render();
    const first = fakeStream();
    const second = fakeStream();

    host.stream.set(first);
    await stable();
    host.stream.set(second);
    await stable();
    expect(video()?.srcObject).toBe(second);

    host.stream.set(null);
    await stable();
    expect(video()?.srcObject).toBeNull();
  });

  it('detaches the stream on destroy without stopping its tracks', async () => {
    const { host, stable, video } = await render();
    const stream = fakeStream();
    host.stream.set(stream);
    await stable();
    const element = video();

    host.visible.set(false);
    await stable();

    expect(element?.srcObject).toBeNull();
    expect(stream.getTracks()[0]?.readyState).toBe('live');
  });

  it('emits playbackFailed when playback is rejected', async () => {
    play.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    const { host, stable } = await render();

    host.stream.set(fakeStream());
    await stable();

    expect(host.failures).toBe(1);
  });

  it('ignores playback interrupted by a newer stream', async () => {
    play.mockRejectedValue(new DOMException('interrupted', 'AbortError'));
    const { host, stable } = await render();

    host.stream.set(fakeStream());
    await stable();

    expect(host.failures).toBe(0);
  });
});
