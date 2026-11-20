import { MOVE_VIDEO, SYNTHETIC_BOARD_VIDEO } from './paths';
import { MOVE_VIDEO_SEGMENTS } from './move-video';
import { writeMoveVideo, writeSyntheticBoardVideo } from './synthetic-video';

/** Generates the synthetic camera videos before the browsers launch. */
export default function globalSetup(): void {
  writeSyntheticBoardVideo(SYNTHETIC_BOARD_VIDEO);
  writeMoveVideo(MOVE_VIDEO, MOVE_VIDEO_SEGMENTS);
}
