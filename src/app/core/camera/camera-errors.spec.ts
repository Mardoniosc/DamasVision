import { mapCameraError, unsupportedCameraError } from './camera-errors';

describe('mapCameraError', () => {
  it.each([
    ['NotAllowedError', 'PERMISSION_DENIED'],
    ['PermissionDeniedError', 'PERMISSION_DENIED'],
    ['SecurityError', 'PERMISSION_DENIED'],
    ['NotFoundError', 'NO_DEVICE'],
    ['DevicesNotFoundError', 'NO_DEVICE'],
    ['OverconstrainedError', 'NO_DEVICE'],
    ['NotReadableError', 'DEVICE_BUSY'],
    ['TrackStartError', 'DEVICE_BUSY'],
    ['AbortError', 'DEVICE_BUSY'],
    ['TypeError', 'UNKNOWN'],
  ])('maps DOMException %s to %s', (name, code) => {
    expect(mapCameraError(new DOMException('raw browser message', name)).code).toBe(code);
  });

  it.each([null, undefined, 'boom', 42, {}, { name: 7 }])('maps %p to UNKNOWN', (value) => {
    expect(mapCameraError(value).code).toBe('UNKNOWN');
  });

  it('never exposes the raw browser message or stack', () => {
    const error = new DOMException('internal detail at line 42', 'NotAllowedError');

    const mapped = mapCameraError(error);

    expect(mapped.message).not.toContain('internal detail');
    expect(Object.keys(mapped)).toEqual(['code', 'message']);
  });

  it('distinguishes insecure contexts', () => {
    expect(unsupportedCameraError(false).message).toContain('HTTPS');
    expect(unsupportedCameraError(true).message).not.toContain('HTTPS');
  });
});
