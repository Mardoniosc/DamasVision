import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_VISION_CONFIG } from '../../vision/vision.config';
import { resolveClassifierConfig } from '../../vision/recognition/classifier.config';
import { SquareTrace } from '../../vision/recognition/square-trace';
import { RecognitionDebugComponent } from './recognition-debug.component';

function trace(squareIndex: number, overrides: Partial<SquareTrace> = {}): SquareTrace {
  const column = squareIndex % 8;
  const row = Math.floor(squareIndex / 8);
  return {
    squareIndex,
    piece: 'BLACK',
    confidence: 0.97,
    decision: 'ACCEPT',
    reason: 'BLACK_CONTRAST',
    limitingStage: 'COLOR',
    explanation: `explicação ${squareIndex}`,
    regions: {
      centerX: column * 100 + 50,
      centerY: row * 100 + 50,
      size: 100,
      pieceRadius: 30,
      markRadius: 10,
      backgroundRadius: 47,
      markSearch: { endX: column * 100 + 50, endY: row * 100 - 20, radius: 22 },
    },
    roi: { cornerMatches: [true, true, true, true], visibleCorners: 4, quality: 1 },
    occupancy: { decision: 'OCCUPIED', confidence: 1, reason: 'OCCUPIED_FOREGROUND' },
    color: { decision: 'BLACK', confidence: 0.97, reason: 'BLACK_CONTRAST' },
    pieceType: { decision: 'MAN', confidence: 1, reason: 'NO_MARK' },
    features: {
      foregroundRatio: 0.9,
      shadowRatio: 0,
      ringForegroundRatio: 1,
      backgroundLuminance: 0.3,
      backgroundRelative: 0.5,
      lightReference: 0.6,
      pieceLuminance: 0.1,
      pieceLuminanceStd: 0.02,
      bodyLuminance: 0.1,
      markLuminance: 0.1,
      contrastRatio: 0.33,
      markCoverage: 0,
      markOffset: null,
      backgroundColor: [40, 60, 120],
      bodyColor: [20, 20, 20],
    },
    ...overrides,
  };
}

describe('RecognitionDebugComponent (G3 diagnostic mode)', () => {
  let fixture: ComponentFixture<RecognitionDebugComponent>;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const square = (index: number): SVGGElement =>
    element().querySelector(`[data-debug-square="${index}"]`) as SVGGElement;

  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    fixture = TestBed.createComponent(RecognitionDebugComponent);
    fixture.componentRef.setInput('config', resolveClassifierConfig(DEFAULT_VISION_CONFIG));
    fixture.componentRef.setInput('traces', [
      trace(1),
      trace(3, {
        piece: 'EMPTY',
        reason: 'EMPTY_BACKGROUND',
        color: null,
        pieceType: null,
        limitingStage: 'OCCUPANCY',
      }),
      trace(5, {
        piece: 'UNKNOWN',
        decision: 'RETRY',
        reason: 'ROI_OBSTRUCTED',
        roi: { cornerMatches: [false, false, false, false], visibleCorners: 0, quality: 0 },
      }),
      trace(7, { piece: 'UNKNOWN', decision: 'RETRY', reason: 'AMBIGUOUS_COLOR' }),
      trace(8, { decision: 'WARN', confidence: 0.7 }),
    ]);
    fixture.componentRef.setInput('frame', {
      sharpness: 90,
      meanLuminance: 0.46,
      alignmentQuality: 0.2,
      issues: ['CALIBRATION_MISALIGNED'],
    });
    fixture.detectChanges();
  });

  it('draws the classifier regions of every traced square at the traced positions', () => {
    const rect = square(1).querySelector('rect') as SVGRectElement;
    const circles = square(1).querySelectorAll('circle');

    expect(element().querySelectorAll('[data-debug-square]')).toHaveLength(5);
    expect(rect.getAttribute('x')).toBe('100');
    expect(circles[0]?.getAttribute('r')).toBe('30');
    expect(circles[1]?.getAttribute('r')).toBe('47');
  });

  it('distinguishes empty, piece, low-confidence, unknown and obstructed squares', () => {
    expect(element().querySelector('[data-testid="debug-counts"]')?.textContent).toContain(
      '1 vazias · 1 peças · 1 baixa confiança · 1 desconhecidas · 1 obstruídas',
    );
    const fill = (index: number) => square(index).querySelector('rect')?.getAttribute('fill');
    expect(new Set([1, 3, 5, 7, 8].map(fill)).size).toBe(5);
  });

  it('marks which corners matched the board background', () => {
    const corners = (index: number) =>
      [...square(index).querySelectorAll('rect')].slice(1).map((r) => r.getAttribute('fill'));

    expect(corners(1)).toEqual(Array(4).fill('#22c55e'));
    expect(corners(5)).toEqual(Array(4).fill('#ef4444'));
  });

  it('shows the frame assessment and flags a misaligned grid', () => {
    const assessment = element().querySelector('[data-testid="frame-assessment"]');

    expect(assessment?.textContent).toContain('CALIBRATION_MISALIGNED');
    expect(assessment?.querySelector('.text-red-700')?.textContent).toContain('0.20');
  });

  it('inspects a square on click and compares two with Shift + click', () => {
    square(1).dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    const names = () =>
      [...element().querySelectorAll('[data-testid="inspected-name"]')].map((n) =>
        n.textContent?.trim(),
      );

    expect(names()).toEqual(['Casa b8']);
    expect(element().querySelector('[data-testid="inspected-explanation"]')?.textContent).toBe(
      'explicação 1',
    );
    expect(element().querySelector('[data-testid="inspected-features"]')?.textContent).toContain(
      '0.900',
    );

    square(3).dispatchEvent(new MouseEvent('click', { shiftKey: true }));
    fixture.detectChanges();
    expect(names()).toEqual(['Casa b8', 'Casa d8']);

    square(5).dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    expect(names()).toEqual(['Casa f8']);
  });
});
