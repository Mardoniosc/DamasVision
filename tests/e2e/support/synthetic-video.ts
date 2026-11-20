import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultCorners } from '../../../src/app/domain/board/calibration';
import { Piece } from '../../../src/app/domain/board/piece';
import { RgbaImage } from '../../../src/app/vision/perspective';
import {
  midgamePosition,
  renderCameraView,
  renderNormalizedBoard,
} from '../../fixtures/synthetic-board';

/**
 * Builds the fake camera used by the recognition E2E: a Y4M video (what Chromium's
 * `--use-file-for-fake-video-capture` reads) showing a synthetic board whose corners
 * coincide with the calibration page's default corners, so the default calibration
 * is exact. The board shows {@link E2E_POSITION}.
 */
export const E2E_VIDEO_SIZE = { width: 640, height: 480 } as const;
export const E2E_POSITION: readonly Piece[] = midgamePosition();

/**
 * A game seen by the camera (E8-T01): each segment shows a position for some seconds, at
 * one frame per second (the app samples it every 200 ms). Used to test moves detected by
 * the camera end to end, with the real worker and OpenCV.js.
 */
export function writeMoveVideo(
  path: string,
  segments: readonly { readonly position: readonly Piece[]; readonly seconds: number }[],
): void {
  const header = Buffer.from(
    `YUV4MPEG2 W${E2E_VIDEO_SIZE.width} H${E2E_VIDEO_SIZE.height} F1:1 Ip A1:1 C420jpeg\n`,
    'ascii',
  );
  const chunks: Buffer[] = [header];
  for (const { position, seconds } of segments) {
    const board = renderNormalizedBoard(position, { size: 400 });
    const frame = toI420(renderCameraView(board, defaultCorners(E2E_VIDEO_SIZE), E2E_VIDEO_SIZE));
    for (let i = 0; i < seconds; i++) chunks.push(Buffer.from('FRAME\n', 'ascii'), frame);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat(chunks));
}

export function writeSyntheticBoardVideo(path: string, frames = 2): void {
  const board = renderNormalizedBoard(E2E_POSITION, { size: 400 });
  const image = renderCameraView(board, defaultCorners(E2E_VIDEO_SIZE), E2E_VIDEO_SIZE);
  const frame = toI420(image);
  const header = Buffer.from(
    `YUV4MPEG2 W${image.width} H${image.height} F30:1 Ip A1:1 C420jpeg\n`,
    'ascii',
  );
  const chunks: Buffer[] = [header];
  for (let i = 0; i < frames; i++) {
    chunks.push(Buffer.from('FRAME\n', 'ascii'), frame);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat(chunks));
}

/** RGBA → planar YUV 4:2:0, full range (BT.601 "JPEG" coefficients). */
function toI420(image: RgbaImage): Buffer {
  const { width, height, data } = image;
  const y = Buffer.alloc(width * height);
  const u = Buffer.alloc((width / 2) * (height / 2));
  const v = Buffer.alloc((width / 2) * (height / 2));
  const at = (px: number, py: number, c: number): number => data[(py * width + px) * 4 + c] ?? 0;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      y[py * width + px] = clamp(
        0.299 * at(px, py, 0) + 0.587 * at(px, py, 1) + 0.114 * at(px, py, 2),
      );
    }
  }
  for (let py = 0; py < height; py += 2) {
    for (let px = 0; px < width; px += 2) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        r += at(px + dx, py + dy, 0) / 4;
        g += at(px + dx, py + dy, 1) / 4;
        b += at(px + dx, py + dy, 2) / 4;
      }
      const index = (py / 2) * (width / 2) + px / 2;
      u[index] = clamp(-0.168736 * r - 0.331264 * g + 0.5 * b + 128);
      v[index] = clamp(0.5 * r - 0.418688 * g - 0.081312 * b + 128);
    }
  }
  return Buffer.concat([y, u, v]);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
