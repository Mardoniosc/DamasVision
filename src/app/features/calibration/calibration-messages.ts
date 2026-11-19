import {
  CalibrationIssue,
  CalibrationIssueCode,
  CalibrationOrientation,
  CornerName,
} from '../../domain/board/calibration';

export const CORNER_LABELS: Readonly<Record<CornerName, string>> = {
  topLeft: 'Canto superior esquerdo',
  topRight: 'Canto superior direito',
  bottomRight: 'Canto inferior direito',
  bottomLeft: 'Canto inferior esquerdo',
};

const ISSUE_MESSAGES: Readonly<Record<CalibrationIssueCode, string>> = {
  INVALID_SOURCE_SIZE: 'A imagem da câmera ainda não está disponível.',
  INVALID_POINT: 'Há um canto com posição inválida.',
  OUT_OF_BOUNDS: 'Há cantos fora da imagem.',
  CORNERS_TOO_CLOSE: 'Há cantos muito próximos entre si.',
  WRONG_ORDER:
    'Os cantos estão espelhados: o superior esquerdo deve ficar à esquerda do superior direito.',
  NOT_CONVEX:
    'Os cantos não formam um quadrilátero convexo (linhas cruzadas ou canto para dentro).',
  AREA_TOO_SMALL: 'A área marcada é pequena demais. Aproxime a câmera ou abra mais os cantos.',
};

export function describeIssue(issue: CalibrationIssue): string {
  const message = ISSUE_MESSAGES[issue.code];
  if (issue.corners.length === 0 || issue.corners.length === 4) {
    return message;
  }
  const corners = issue.corners.map((corner) => CORNER_LABELS[corner].toLowerCase()).join(', ');
  return `${message} (${corners})`;
}

export const ORIENTATION_LABELS: Readonly<Record<CalibrationOrientation, string>> = {
  NORMAL: '0°',
  ROTATED_90: '90°',
  ROTATED_180: '180°',
  ROTATED_270: '270°',
};
