import { SYNTHETIC_BOARD_VIDEO } from './paths';
import { writeSyntheticBoardVideo } from './synthetic-video';

/** Generates the synthetic board video before the browsers launch. */
export default function globalSetup(): void {
  writeSyntheticBoardVideo(SYNTHETIC_BOARD_VIDEO);
}
