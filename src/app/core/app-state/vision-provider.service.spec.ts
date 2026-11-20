import { TestBed } from '@angular/core/testing';
import { InMemorySettings } from '../../../../tests/fixtures/in-memory-settings';
import { SETTINGS_REPOSITORY } from '../persistence/settings.repository';
import { normalizeServiceUrl, resolveServiceUrl } from '../workers/vision-provider';
import { VisionProviderState } from '../workers/vision-provider.state';
import { VISION_WORKER_FACTORY, VisionWorkerClient } from '../workers/vision-worker.client';
import { VisionProviderService } from './vision-provider.service';

describe('vision provider (G3.1)', () => {
  let settings: InMemorySettings;

  beforeEach(() => {
    settings = new InMemorySettings();
    TestBed.configureTestingModule({
      providers: [{ provide: SETTINGS_REPOSITORY, useValue: settings }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  const service = () => TestBed.inject(VisionProviderService);

  it.each([
    ['http://127.0.0.1:8765', 'http://127.0.0.1:8765'],
    ['http://localhost:9000/', 'http://localhost:9000'],
    [' http://[::1]:8765 ', 'http://[::1]:8765'],
  ])('accepts the loopback URL %s', (url, normalized) => {
    expect(normalizeServiceUrl(url)).toBe(normalized);
  });

  it.each([
    'http://192.168.0.10:8765',
    'https://vision.example.com',
    'ftp://127.0.0.1:8765',
    'http://127.0.0.1:8765/v1',
    'http://user:pw@127.0.0.1:8765',
    'not a url',
  ])('rejects %s: frames never leave this machine', (url) => {
    expect(normalizeServiceUrl(url)).toBeNull();
  });

  it('defaults to the browser recognizer, also for an invalid stored value', async () => {
    await service().load();
    expect(service().current().kind).toBe('browser');

    await settings.set('vision.provider', {
      kind: 'local-service',
      serviceUrl: 'http://evil.test',
    });
    await service().load();
    expect(service().current()).toEqual({ kind: 'browser', serviceUrl: 'http://127.0.0.1:8765' });
  });

  it('saves a valid choice and publishes it', async () => {
    await service().save({ kind: 'local-service', serviceUrl: 'http://localhost:8800/' });

    expect(settings.values.get('vision.provider')).toEqual({
      kind: 'local-service',
      serviceUrl: 'http://localhost:8800',
    });
    expect(TestBed.inject(VisionProviderState).usesService()).toBe(true);
    await expect(
      service().save({ kind: 'local-service', serviceUrl: 'http://10.0.0.2:8765' }),
    ).rejects.toThrow('Use o serviço deste servidor ou um endereço deste computador');
  });

  it('probes the service health and its contract version', async () => {
    const answers = [
      { status: 'ok', contractVersion: 1, serviceVersion: '0.1.0', opencvVersion: '5.0.0' },
      { status: 'ok', contractVersion: 7 },
    ];
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(answers.shift())));

    expect(await service().probe('http://127.0.0.1:8765')).toEqual({
      ok: true,
      serviceVersion: '0.1.0',
      opencvVersion: '5.0.0',
    });
    expect(await service().probe('http://127.0.0.1:8765')).toMatchObject({ ok: false });

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const down = await service().probe('http://127.0.0.1:8765');
    expect(down).toMatchObject({ ok: false });
    expect(down.ok ? '' : down.message).toContain('npm run vision:serve');
  });

  it('the worker factory creates the remote worker and configures it first', () => {
    const created: { url: string; messages: unknown[] }[] = [];
    class StubWorker {
      readonly messages: unknown[] = [];
      constructor(url: URL | string) {
        created.push({ url: String(url), messages: this.messages });
      }
      postMessage(message: unknown): void {
        this.messages.push(message);
      }
    }
    vi.stubGlobal('Worker', StubWorker);
    const state = TestBed.inject(VisionProviderState);
    const factory = TestBed.inject(VISION_WORKER_FACTORY);

    factory();
    state.set({ kind: 'local-service', serviceUrl: 'http://127.0.0.1:8765' });
    factory();

    // The bundler renames worker chunks: the two workers are told apart by URL and messages.
    expect(created[0]?.messages).toEqual([]);
    expect(created[1]?.url).not.toBe(created[0]?.url);
    expect(created[1]?.messages[0]).toMatchObject({
      type: 'REMOTE_CONFIG',
      serviceUrl: 'http://127.0.0.1:8765',
    });
  });

  it('a vision worker is created only once the stored choice is read', async () => {
    let resolve!: () => void;
    const created: string[] = [];
    TestBed.overrideProvider(VISION_WORKER_FACTORY, {
      useValue: () => {
        created.push(TestBed.inject(VisionProviderState).settings().kind);
        throw new Error('stop after creation');
      },
    });
    const state = TestBed.inject(VisionProviderState);
    state.trackLoad(
      new Promise<void>((done) => {
        resolve = () => {
          state.set({ kind: 'local-service', serviceUrl: 'http://127.0.0.1:8765' });
          done();
        };
      }),
    );
    const client = TestBed.runInInjectionContext(() => new VisionWorkerClient());

    const init = client.init().catch(() => undefined);
    await Promise.resolve();
    expect(created).toEqual([]);
    resolve();
    await init;

    expect(created).toEqual(['local-service']);
  });

  describe("the service of the app's own server (Docker, ADR-043)", () => {
    const deploymentFile = (body: unknown, status = 200) =>
      vi.stubGlobal('fetch', async (url: string) =>
        url.includes('/deployment.json')
          ? new Response(JSON.stringify(body), { status })
          : new Response('{}', { status: 404 }),
      );

    it('accepts the same-origin address', () => {
      expect(normalizeServiceUrl('same-origin')).toBe('same-origin');
      expect(resolveServiceUrl('same-origin', 'http://192.168.0.5:8092')).toBe(
        'http://192.168.0.5:8092',
      );
      expect(resolveServiceUrl('http://127.0.0.1:8765', 'http://x:8092')).toBe(
        'http://127.0.0.1:8765',
      );
    });

    it("uses the server's default when nothing is stored on this device", async () => {
      deploymentFile({ visionProvider: { kind: 'local-service', serviceUrl: 'same-origin' } });

      await service().load();

      expect(service().current()).toEqual({ kind: 'local-service', serviceUrl: 'same-origin' });
      expect(service().deploymentDefault()?.serviceUrl).toBe('same-origin');
    });

    it("a choice stored on this device wins over the server's default", async () => {
      deploymentFile({ visionProvider: { kind: 'local-service', serviceUrl: 'same-origin' } });
      await settings.set('vision.provider', {
        kind: 'browser',
        serviceUrl: 'http://127.0.0.1:8765',
      });

      await service().load();

      expect(service().current().kind).toBe('browser');
    });

    it('ignores a missing or invalid deployment file', async () => {
      deploymentFile('<html>', 200);
      await service().load();
      expect(service().current().kind).toBe('browser');

      deploymentFile({ visionProvider: { kind: 'local-service', serviceUrl: 'http://evil.test' } });
      await service().load();
      expect(service().current().kind).toBe('browser');
    });

    it("probes the service on the app's origin", async () => {
      const urls: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            status: 'ok',
            contractVersion: 1,
            serviceVersion: '0.1.0',
            opencvVersion: '5.0.0',
          }),
        );
      });

      expect(await service().probe('same-origin')).toMatchObject({ ok: true });
      expect(urls[0]).toBe(`${location.origin}/v1/health?ngsw-bypass=1`);
    });
  });
});
